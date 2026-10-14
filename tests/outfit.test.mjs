import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { DEFAULT_TRANSFORM } from '../miniprogram/config/try-on.ts';
import { SAMPLE_BODY } from '../miniprogram/config/body.ts';
import { LocalOutfitRepository } from '../miniprogram/repositories/outfit-repository.ts';
import { OutfitService } from '../miniprogram/services/outfit-service.ts';
import { TryOnSession } from '../miniprogram/services/try-on-session.ts';
import { resolveOutfitItems } from '../miniprogram/utils/outfit-resolution.ts';

const garment = (id, groupId = 'tops', typeId = 'tshirt') => ({ id, name: id, category: { groupId, typeId },
  image: { displayPath: `/user/garment_${id}.png` }, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z' });
const top = garment('top'), bottom = garment('bottom', 'bottoms', 'jeans'), outer = garment('outer', 'tops', 'jacket');
const item = (garmentId, layer, transform = {}) => ({ garmentId, layer, transform: { ...DEFAULT_TRANSFORM, ...transform } });
const baseItems = [item(top.id, 'top', { offsetX: 3.25, offsetY: -7.5, scale: 1.37, rotationDeg: -12 }), item(bottom.id, 'bottom')];
const require = createRequire(import.meta.url);

function setup(garments = [top, bottom, outer]) {
  const stored = new Map();
  let failRead = false, failWrite = false, writes = 0;
  globalThis.wx = {
    getStorageSync: (key) => { if (failRead) throw new Error('读取失败'); return structuredClone(stored.get(key) || ''); },
    setStorageSync: (key, value) => { if (failWrite) throw new Error('空间不足'); writes += 1; stored.set(key, structuredClone(value)); },
  };
  const source = { garments: structuredClone(garments), list() { return structuredClone(this.garments); } };
  const service = new OutfitService(new LocalOutfitRepository(), source);
  return { service, source, stored, get writes() { return writes; }, failRead: (value) => { failRead = value; }, failWrite: (value) => { failWrite = value; } };
}

test('穿搭保存和重新读取保留原始调整，只记录 ID/图层/参数，不复制身材或图片', () => {
  const { service, source, stored } = setup();
  const input = structuredClone(baseItems);
  const saved = service.create({ name: '  通勤  ', items: input });
  assert.match(saved.id, /^outfit_/); assert.equal(saved.name, '通勤'); assert.equal(saved.revision, 1);
  input[0].transform.offsetX = 999;
  const reloaded = new OutfitService(new LocalOutfitRepository(), source).get(saved.id);
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(reloaded.items.find((entry) => entry.garmentId === top.id).transform, baseItems[0].transform);
  const serialized = JSON.stringify(stored.get('smart-wardrobe.outfits.v1'));
  assert.ok(!serialized.includes('/user/')); assert.ok(!serialized.includes('heightCm'));
  reloaded.items[0].transform.scale = 2.5;
  assert.deepEqual(service.get(saved.id), saved);
});

test('拒绝空名称、空组合、重复或互斥图层、坏参数和伪造引用，已有记录不变', () => {
  const env = setup();
  const saved = env.service.create({ name: '原穿搭', items: baseItems });
  const invalid = [
    { name: ' ' }, { name: '长'.repeat(61) }, { items: [] },
    { items: [item(top.id, 'top'), item(outer.id, 'top')] },
    { items: [item(top.id, 'top'), item(top.id, 'outer')] },
    { items: [item('missing', 'top')] }, { items: [item(top.id, 'outer')] },
    { items: [item(top.id, 'accessory')] }, { items: [item(top.id, 'top', { scale: 0 })] },
    { items: [item(top.id, 'top', { offsetY: Infinity })] },
    { items: [item(top.id, 'top', { rotationDeg: 181 })] },
    { items: [item(top.id, 'top'), item(bottom.id, 'one-piece')] },
  ];
  for (const patch of invalid) assert.throws(() => env.service.create({ name: '无效', items: baseItems, ...patch }));
  assert.equal(env.writes, 1); assert.deepEqual(env.service.get(saved.id), saved);
});

test('修改、改名与过期版本冲突检查不依赖时间戳差异', () => {
  const { service } = setup();
  const saved = service.create({ name: '原名', items: baseItems });
  const updated = service.update(saved.id, saved.revision, { name: '新名', items: [item(outer.id, 'outer')] });
  assert.equal(updated.id, saved.id); assert.equal(updated.createdAt, saved.createdAt); assert.equal(updated.revision, 2);
  assert.throws(() => service.update(saved.id, saved.revision, { name: '过期', items: baseItems }), /其他页面更改/);
  assert.throws(() => service.delete(saved.id, saved.revision), /其他页面更改/);
  const renamed = service.rename(updated.id, updated.revision, '仅改名');
  assert.equal(renamed.revision, 3); assert.deepEqual(renamed.items, updated.items);
});

test('删除到回收站和恢复保留内容，旧编辑不能覆盖已删除穿搭，也不恢复衣物', () => {
  const { service, source } = setup();
  const saved = service.create({ name: '可恢复', items: baseItems });
  service.delete(saved.id, saved.revision);
  assert.equal(service.list().length, 0); assert.equal(service.get(saved.id), undefined);
  const deleted = service.list('deleted')[0]; assert.ok(deleted.deletedAt);
  assert.deepEqual(deleted.items, saved.items);
  assert.throws(() => service.update(saved.id, saved.revision, { name: '旧编辑', items: baseItems }), /回收站/);
  source.garments = [outer];
  const restored = service.restore(deleted.id, deleted.revision);
  assert.equal(restored.id, saved.id); assert.equal(restored.deletedAt, undefined); assert.equal(restored.revision, 3);
  assert.deepEqual(restored.items, saved.items); assert.equal(service.list('deleted').length, 0);
  assert.deepEqual(source.garments, [outer]);
  assert.throws(() => service.restore(deleted.id, deleted.revision), /其他页面更改/);
});

test('损坏快照、重复 ID 和坏调整阻止写入；读写失败不假报保存成功', () => {
  const env = setup();
  const saved = env.service.create({ name: '完整记录', items: baseItems });
  for (const raw of [{ version: 9, outfits: [] }, { version: 1, outfits: [saved, saved] },
    { version: 1, outfits: [{ ...saved, items: [{ ...saved.items[0], transform: null }] }] }]) {
    env.stored.set('smart-wardrobe.outfits.v1', raw);
    const writesBefore = env.writes;
    assert.throws(() => env.service.list(), /格式异常/);
    assert.throws(() => env.service.create({ name: '不能覆盖', items: baseItems }), /格式异常/);
    assert.equal(env.writes, writesBefore);
  }
  env.stored.set('smart-wardrobe.outfits.v1', { version: 1, outfits: [saved] });
  env.failWrite(true);
  assert.throws(() => env.service.rename(saved.id, saved.revision, '失败'), /空间不足/);
  assert.deepEqual(env.service.get(saved.id), saved);
  env.failWrite(false); env.failRead(true);
  assert.throws(() => env.service.list(), /读取失败/);
});

test('衣物缺失或换分类后保留原引用和参数，可查看、改名、更新其他衣物并替换缺失位置', () => {
  const { service, source } = setup();
  let saved = service.create({ name: '保留位置', items: baseItems });
  source.garments = [bottom, outer];
  let resolution = resolveOutfitItems(saved.items, source.list());
  assert.equal(resolution.issues.length, 1); assert.equal(resolution.available.length, 1);
  const session = new TryOnSession(); session.load(saved, source.list());
  assert.equal(session.unavailable().length, 1); assert.deepEqual(session.allItems(), saved.items);
  assert.equal(session.hasUnsavedChanges(), false);
  session.adjust(bottom.id, { offsetY: 4 });
  saved = service.update(saved.id, saved.revision, { name: '仍保留位置', items: session.allItems() });
  assert.deepEqual(saved.items.find((entry) => entry.garmentId === top.id), baseItems[0]);
  assert.throws(() => service.create({ name: '不能凭空创建缺失引用', items: saved.items }), /删除或分类改变/);
  const forged = structuredClone(saved.items); forged.find((entry) => entry.garmentId === top.id).transform.offsetX = 5;
  assert.throws(() => service.update(saved.id, saved.revision, { name: '不能改失效位置', items: forged }), /删除或分类改变/);
  const newTop = garment('new-top'); source.garments.push(newTop);
  session.wear(newTop);
  assert.equal(session.unavailable().length, 0);
  saved = service.update(saved.id, saved.revision, { name: '替换完成', items: session.allItems() });
  assert.ok(!saved.items.some((entry) => entry.garmentId === top.id));
  source.garments = source.garments.map((entry) => entry.id === newTop.id ? { ...entry, category: outer.category } : entry);
  resolution = resolveOutfitItems(saved.items, source.list());
  assert.match(resolution.issues[0].label, /分类已改变/);
  assert.deepEqual(service.get(saved.id).items, saved.items);
});

test('试衣载入完整恢复调整，草稿与存储隔离；缺失/重新可用核对不产生隐式删除', () => {
  const { service, source } = setup();
  const saved = service.create({ name: '原始调整', items: baseItems });
  const session = new TryOnSession(); session.load(saved, source.list());
  assert.equal(session.name, saved.name); assert.equal(session.hasUnsavedChanges(), false);
  assert.deepEqual(session.list(), saved.items);
  session.setName('草稿改名'); assert.equal(session.hasUnsavedChanges(), true);
  session.setName(saved.name); assert.equal(session.hasUnsavedChanges(), false);
  session.reconcile([bottom]); assert.equal(session.unavailable().length, 1);
  assert.deepEqual(session.allItems(), saved.items); assert.equal(session.hasUnsavedChanges(), false);
  session.reconcile(source.list()); assert.equal(session.unavailable().length, 0);
  session.adjust(top.id, { rotationDeg: 45 }); assert.equal(session.hasUnsavedChanges(), true);
  assert.deepEqual(service.get(saved.id), saved);
  const updated = service.update(saved.id, saved.revision, { name: session.name, items: session.allItems() });
  session.markSaved(updated); assert.equal(session.hasUnsavedChanges(), false);
  session.startNew(); assert.deepEqual(session.allItems(), []); assert.equal(session.source, null); assert.equal(session.name, '');
  assert.throws(() => session.load({ ...saved, deletedAt: saved.updatedAt }, source.list()), /回收站/);
});

test('更新穿搭写入失败时原记录和当前草稿均保留，成功后才建立新基线', () => {
  const env = setup();
  const saved = env.service.create({ name: '保存保护', items: baseItems });
  const session = new TryOnSession(); session.load(saved, env.source.list()); session.adjust(top.id, { scale: 2 });
  const draft = session.allItems(); env.failWrite(true);
  assert.throws(() => env.service.update(saved.id, saved.revision, { name: session.name, items: draft }), /空间不足/);
  assert.deepEqual(env.service.get(saved.id), saved); assert.deepEqual(session.allItems(), draft);
  assert.equal(session.source.revision, saved.revision); assert.equal(session.hasUnsavedChanges(), true);
});

test('真实页面保存、详情载入、覆盖保护、编辑、另存、搜索、删除及回收站恢复形成完整流程', async () => {
  const env = setup();
  env.stored.set('smart-wardrobe.garments.v1', { version: 1, garments: [top, bottom, outer] });
  env.stored.set('smart-wardrobe.body-profile.v1', { version: 1, profile: { ...SAMPLE_BODY, updatedAt: '2026-10-10T00:00:00Z' } });
  let confirm = true;
  const errors = [], navigations = [];
  Object.assign(globalThis.wx, {
    showToast: () => {}, showModal: (options) => { if (!options.success) errors.push(options.content); else options.success({ confirm }); },
    switchTab: ({ url }) => navigations.push(url), navigateTo: ({ url }) => navigations.push(url), navigateBack: () => {},
  });
  const definitions = {};
  for (const pageName of ['try-on', 'outfit-detail', 'outfits', 'home']) {
    globalThis.Page = (value) => { definitions[pageName] = value; };
    await import(`../miniprogram/pages/${pageName}/index.ts`);
  }
  const instantiate = (definition) => {
    const instance = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') instance[name] = method.bind(instance);
    return instance;
  };
  const byId = (id) => ({ currentTarget: { dataset: { id } } });
  const { outfitService } = await import('../miniprogram/services/instances.ts');
  // 页面模块由 tsx 的 CJS 加载器执行，使用同一加载器获取内存会话。
  const { tryOnSession } = require('../miniprogram/services/try-on-session.ts');
  tryOnSession.startNew();
  const page = instantiate(definitions['try-on']); page.onShow();
  const scaleOnCanvas = (scale) => page.onTransformChange({ detail: { garmentId: page.data.activeId,
    ...page.data.renderItems.find((item) => item.garmentId === page.data.activeId).transform, scale } });
  page.wear(byId(top.id)); page.wear(byId(bottom.id)); page.onOutfitNameInput({ detail: { value: '第一套穿搭' } });
  scaleOnCanvas(1.45); page.saveOutfit();
  const saved = outfitService.list()[0]; assert.ok(saved); assert.equal(page.data.unsaved, false);
  const details = instantiate(definitions['outfit-detail']); details.onLoad({ id: saved.id }); details.onShow();
  assert.equal(details.data.renderItems.length, 2);
  scaleOnCanvas(2);
  const dirtyBefore = tryOnSession.allItems(); confirm = false; details.editInTryOn();
  assert.deepEqual(tryOnSession.allItems(), dirtyBefore);
  confirm = true; details.editInTryOn(); page.onShow();
  assert.deepEqual(tryOnSession.allItems(), saved.items);
  scaleOnCanvas(1.6); page.saveOutfit();
  assert.equal(outfitService.get(saved.id).revision, 2);
  page.onOutfitNameInput({ detail: { value: '第二套穿搭' } }); page.saveAsNew();
  assert.equal(outfitService.list().length, 2); assert.notEqual(page.data.editingOutfitId, saved.id);
  const list = instantiate(definitions.outfits); list.onShow();
  list.onQueryInput({ detail: { value: '第一套' } }); assert.equal(list.data.cards.length, 1);
  details.loadOutfit(); confirm = false; details.deleteOutfit(); assert.ok(outfitService.get(saved.id));
  confirm = true; details.deleteOutfit(); assert.equal(outfitService.get(saved.id), undefined);
  list.setMode({ currentTarget: { dataset: { mode: 'deleted' } } }); assert.equal(list.data.cards.length, 1);
  details.restoreOutfit(); assert.ok(outfitService.get(saved.id));
  details.onNameInput({ detail: { value: '恢复后改名' } }); details.rename(); assert.equal(outfitService.get(saved.id).name, '恢复后改名');
  const home = instantiate(definitions.home); home.onShow(); assert.equal(home.data.outfitCount, 2);
  assert.equal(home.data.recentOutfits.length, 2);
  assert.ok(navigations.includes('/pages/try-on/index')); assert.deepEqual(errors, []);
  const sourceBefore = tryOnSession.source; const draftBefore = tryOnSession.allItems();
  env.failWrite(true); scaleOnCanvas(1.8); page.saveOutfit();
  assert.match(errors.at(-1), /空间不足/); assert.deepEqual(tryOnSession.source, sourceBefore);
  assert.notDeepEqual(tryOnSession.allItems(), draftBefore); assert.equal(page.data.unsaved, true);
});

test('衣物详情删除提示引用数量且保留正常/回收站穿搭，缺失衣物仍可载入替换', async () => {
  const env = setup();
  env.stored.set('smart-wardrobe.garments.v1', { version: 1, garments: [top, bottom, outer] });
  env.stored.set('smart-wardrobe.body-profile.v1', { version: 1, profile: { ...SAMPLE_BODY, updatedAt: '2026-10-10T00:00:00Z' } });
  const { outfitService } = await import('../miniprogram/services/instances.ts');
  const saved = outfitService.create({ name: '引用衣物', items: baseItems });
  const trash = outfitService.create({ name: '回收站引用', items: [item(top.id, 'top')] }); outfitService.delete(trash.id, trash.revision);
  const snapshot = structuredClone(env.stored.get('smart-wardrobe.outfits.v1'));
  let definition, modalContent = '', deletion;
  globalThis.Page = (value) => { definition = value; };
  await import('../miniprogram/pages/garment-detail/index.ts');
  Object.assign(globalThis.wx, { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({ unlink: ({ success }) => success() }),
    showModal: (options) => { modalContent = options.content; deletion = options.success?.({ confirm: true }); }, showToast: () => {}, navigateBack: () => {} });
  const page = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') page[name] = method.bind(page);
  page.onLoad({ id: top.id }); page.onShow(); page.deleteGarment(); await deletion;
  assert.match(modalContent, /2 套穿搭/); assert.match(modalContent, /标记衣物缺失/);
  assert.deepEqual(env.stored.get('smart-wardrobe.outfits.v1'), snapshot);
  const garments = env.stored.get('smart-wardrobe.garments.v1').garments;
  assert.ok(!garments.some((entry) => entry.id === top.id));
  const session = new TryOnSession(); session.load(outfitService.get(saved.id), garments);
  assert.equal(session.unavailable().length, 1); assert.deepEqual(session.allItems(), saved.items);
  session.wear(outer); session.remove(top.id);
  const changed = outfitService.update(saved.id, saved.revision, { name: '主动移除缺失位置', items: session.allItems() });
  assert.ok(!changed.items.some((entry) => entry.garmentId === top.id));
});
