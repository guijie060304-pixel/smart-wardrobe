import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORY_GROUPS, getCategoryName } from '../miniprogram/config/categories.ts';
import { filterGarments, GarmentService } from '../miniprogram/services/garment-service.ts';
import { LocalGarmentRepository } from '../miniprogram/repositories/garment-repository.ts';
import { saveImage, removeImage } from '../miniprogram/services/image-service.ts';

class MemoryRepository {
  garments = [];
  list() { return structuredClone(this.garments); }
  put(garment) {
    this.garments = this.garments.filter((item) => item.id !== garment.id);
    this.garments.push(structuredClone(garment));
  }
  remove(id) { this.garments = this.garments.filter((item) => item.id !== id); }
}

const category = { groupId: 'tops', typeId: 'tshirt' };
const image = { displayPath: '/managed/photo.jpg' };

test('分类仅两级且覆盖已列出的具体品类', () => {
  assert.equal(CATEGORY_GROUPS.length, 5);
  assert.equal(CATEGORY_GROUPS.reduce((sum, group) => sum + group.types.length, 0), 63);
  assert.equal(getCategoryName(category), 'T恤');
  assert.ok(CATEGORY_GROUPS.every((group) => group.types.every((type) => !('children' in type))));
});

test('衣物创建、编辑、筛选和删除保持数据约定', () => {
  const service = new GarmentService(new MemoryRepository());
  const created = service.create({ category, image, color: '白色', seasons: ['summer'], style: '休闲', tags: ['  通勤  ', ''] });
  assert.equal(created.name, 'T恤');
  assert.ok(created.id.startsWith('garment_'));
  assert.deepEqual(created.tags, ['通勤']);
  assert.equal(filterGarments(service.list(), { query: 't恤', groupId: 'tops', color: '白色', season: 'summer', style: '休闲' }).length, 1);
  assert.equal(filterGarments(service.list(), { season: 'winter' }).length, 0);

  const updated = service.update(created.id, { category, image, name: '白色短袖', seasons: ['summer'] });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(service.get(created.id)?.name, '白色短袖');
  assert.equal(service.delete(created.id).id, created.id);
  assert.equal(service.list().length, 0);
});

test('搜索同时匹配名称与品类，同名衣物全部保留且其他筛选仍生效', () => {
  const service = new GarmentService(new MemoryRepository()), hoodie = { groupId: 'tops', typeId: 'hoodie' };
  const named = service.create({ category: hoodie, image, name: '灰色卫衣', color: '灰色', seasons: ['autumn'] });
  const renamed = service.create({ category: hoodie, image, name: '黑色连帽衫', color: '黑色', seasons: ['winter'] });
  const duplicate = service.create({ category: hoodie, image, name: '灰色卫衣', color: '灰色', seasons: ['winter'] });
  const tshirt = service.create({ category, image, name: '白色T恤', color: '白色' });
  const garments = service.list(), before = structuredClone(garments);
  assert.deepEqual(new Set(filterGarments(garments, { query: '  卫衣  ' }).map((item) => item.id)), new Set([named.id, renamed.id, duplicate.id]));
  assert.deepEqual(filterGarments(garments, { query: '卫衣', color: '黑色', season: 'winter' }).map((item) => item.id), [renamed.id]);
  assert.equal(filterGarments(garments, { query: '卫衣', groupId: 'bottoms' }).length, 0);
  assert.deepEqual(filterGarments(garments, { query: 't恤' }).map((item) => item.id), [tshirt.id]);
  assert.equal(filterGarments(garments, { query: '' }).length, 4); assert.deepEqual(garments, before);
});

test('损坏的本地记录阻止写入，避免覆盖已有数据', () => {
  const raw = { version: 1, garments: [{ id: 'broken' }] };
  let writeCount = 0;
  globalThis.wx = {
    getStorageSync: () => raw,
    setStorageSync: () => { writeCount += 1; },
  };
  const repository = new LocalGarmentRepository();
  assert.throws(() => repository.list(), /格式异常/);
  assert.throws(() => repository.put({}), /格式异常/);
  assert.equal(writeCount, 0);
});

test('本地 Repository 保存后可以重新读取与删除', () => {
  let snapshot = '';
  globalThis.wx = {
    getStorageSync: () => snapshot,
    setStorageSync: (_key, value) => { snapshot = structuredClone(value); },
  };
  const repository = new LocalGarmentRepository();
  const service = new GarmentService(repository);
  const item = service.create({ category, image, name: '测试上装' });
  assert.equal(new LocalGarmentRepository().list()[0].name, '测试上装');
  service.delete(item.id);
  assert.deepEqual(new LocalGarmentRepository().list(), []);
});

test('图片复制到持久目录并仅删除受管文件', async () => {
  const copied = [];
  const deleted = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getImageInfo: ({ success }) => success({ type: 'png' }),
    getFileSystemManager: () => ({
      copyFile: ({ srcPath, destPath, success }) => { copied.push({ srcPath, destPath }); success(); },
      unlink: ({ filePath, success }) => { deleted.push(filePath); success(); },
    }),
  };
  const path = await saveImage('/tmp/photo.png');
  assert.match(path, /^\/user\/garment_.+\.png$/);
  assert.equal(copied[0].srcPath, '/tmp/photo.png');
  await removeImage(path);
  await removeImage('/other/file.png');
  assert.deepEqual(deleted, [path]);
});
