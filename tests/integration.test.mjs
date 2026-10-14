import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import { LocalGarmentRepository } from '../miniprogram/repositories/garment-repository.ts';
import { GarmentService } from '../miniprogram/services/garment-service.ts';
import { chooseImage, editImage, ImageSelectionCancelled, removeImage, saveImage } from '../miniprogram/services/image-service.ts';
import { SAMPLE_BODY } from '../miniprogram/config/body.ts';
import { buildBodyModel } from '../miniprogram/rendering/body-model.ts';
import { bodyCanvasTransform } from '../miniprogram/rendering/draw-body.ts';
import { placeGarment } from '../miniprogram/rendering/garment-layout.ts';
import { TryOnSession } from '../miniprogram/services/try-on-session.ts';

const require = createRequire(import.meta.url);
const key = 'smart-wardrobe.garments.v1';
const category = { groupId: 'tops', typeId: 'tshirt' };
const timestamp = '2026-10-10T00:00:00.000Z';
const garment = (id, patch = {}) => ({ id, name: id, category, image: { displayPath: `/user/garment_${id}.png` },
  createdAt: timestamp, updatedAt: timestamp, ...patch });

function store(initial = '', share = false) {
  let snapshot = structuredClone(initial);
  let writes = 0;
  globalThis.wx = {
    getStorageSync: () => share ? snapshot : structuredClone(snapshot),
    setStorageSync: (_key, value) => { writes += 1; snapshot = structuredClone(value); },
  };
  return { get snapshot() { return snapshot; }, get writes() { return writes; } };
}

function page(definition) {
  const instance = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') instance[name] = method.bind(instance);
  return instance;
}

function wardrobeOutfitEnvironment(garments) {
  const stored = new Map([[key, { version: 1, garments }]]);
  let definition, modal, writes = 0, failWrite = false;
  const toasts = [];
  globalThis.wx = {
    getStorageSync: (name) => { assert.ok(!name.includes('body-profile'), '衣橱搭配不读取身材'); return structuredClone(stored.get(name) || ''); },
    setStorageSync: (name, value) => { if (failWrite) throw new Error('存储空间不足'); writes += 1; stored.set(name, structuredClone(value)); },
    showToast: (options) => toasts.push(options.title), showModal: (options) => { modal = options; },
    navigateTo: () => { throw new Error('搭配点选不应跳详情或试衣'); },
  };
  globalThis.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../miniprogram/pages/wardrobe/index.ts');
  delete require.cache[modulePath]; require(modulePath);
  delete require.cache[modulePath]; // 不占用后续既有页面注册测试的模块缓存。
  const instance = page(definition); instance.onShow(); instance.startOutfitMode();
  return { instance, stored, toasts, get writes() { return writes; }, failWrite(value) { failWrite = value; },
    get modal() { return modal; }, reply(result) { modal.success(result); modal.complete(); } };
}

test('衣橱跨筛选选上下装直接保存，不弹命名框，保留独立试衣草稿与列表滚动位置', () => {
  const top = garment('wardrobe-top'), bottom = garment('wardrobe-bottom', { category: { groupId: 'bottoms', typeId: 'jeans' } });
  const { tryOnSession } = require('../miniprogram/services/try-on-session.ts');
  tryOnSession.startNew(); tryOnSession.wear(garment('unrelated-tryon')); tryOnSession.adjust('unrelated-tryon', { scale: 1.8 });
  const before = tryOnSession.list();
  const env = wardrobeOutfitEnvironment([top, bottom]), p = env.instance;
  wx.showModal = () => { throw new Error('自由搭配不应要求命名'); };
  const anchor = p.data.scrollAnchor;
  p.openGarment({ currentTarget: { dataset: { id: top.id } } });
  assert.equal(p.data.scrollAnchor, anchor);
  p.onSearchInput({ detail: { value: bottom.id } });
  p.openGarment({ currentTarget: { dataset: { id: bottom.id } } });
  assert.deepEqual(new Set(p.data.selected.map((item) => item.id)), new Set([top.id, bottom.id]));
  p.saveSelectedOutfit(); p.saveSelectedOutfit();
  assert.equal(env.writes, 1);
  const saved = env.stored.get('smart-wardrobe.outfits.v1').outfits[0];
  assert.match(saved.name, /^自由搭配/); assert.equal(saved.kind, 'free'); assert.equal(saved.items.length, 2); assert.equal(saved.board.length, 2);
  assert.ok(saved.items.every((item) => item.transform.scale === 1 && item.transform.rotationDeg === 0));
  assert.deepEqual(tryOnSession.list(), before);
  assert.equal(p.data.outfitMode, true); assert.equal(p.data.selected.length, 0);
  tryOnSession.startNew();
});

test('衣橱选填名称跨显示/筛选保留，保存失败保留名称/选择/画布，成功后才清空', () => {
  const top = garment('retry-top'), env = wardrobeOutfitEnvironment([top]), p = env.instance;
  p.selectForOutfit(top.id); p.onDraftBoardChange({ detail: { garmentId: top.id, x: 34, y: 64, scale: 1.2, rotationDeg: 8 } });
  const layout = structuredClone(p.data.draftBoardLayout);
  p.onOutfitNameInput({ detail: { value: '  周末出游  ' } });
  p.browseGarments(); p.startOutfitMode(); p.onShow(); p.onSearchInput({ detail: { value: top.id } });
  assert.equal(p.data.outfitNameInput, '  周末出游  ');
  env.failWrite(true); p.saveSelectedOutfit();
  assert.equal(p.data.selected.length, 1); assert.equal(p.data.savingOutfit, false); assert.match(env.toasts.at(-1), /空间不足/);
  assert.deepEqual(p.data.draftBoardLayout, layout);
  assert.equal(p.data.outfitNameInput, '  周末出游  ');
  env.failWrite(false); p.saveSelectedOutfit();
  assert.equal(env.writes, 1); assert.equal(p.data.selected.length, 0);
  assert.equal(env.stored.get('smart-wardrobe.outfits.v1').outfits[0].name, '周末出游'); assert.equal(p.data.outfitNameInput, '');
  p.startOutfitMode(); p.selectForOutfit(top.id);
  env.stored.set(key, { version: 1, garments: [] }); p.onShow();
  assert.equal(p.data.selected.length, 0);
});

test('自由搭配按卫衣品类搜索不漏自定义名或同名衣物，切换筛选不丢选择', () => {
  const hoodie = { groupId: 'tops', typeId: 'hoodie' };
  const first = garment('hoodie-first', { name: '灰色卫衣', category: hoodie, color: '灰色' });
  const renamed = garment('hoodie-renamed', { name: '黑色连帽衫', category: hoodie, color: '黑色' });
  const duplicate = garment('hoodie-duplicate', { name: '灰色卫衣', category: hoodie, color: '灰色' });
  const other = garment('unrelated-shirt', { name: '白色短袖' });
  const env = wardrobeOutfitEnvironment([first, renamed, duplicate, other]), p = env.instance;
  p.selectForOutfit(renamed.id); p.onSearchInput({ detail: { value: '卫衣' } });
  assert.deepEqual(p.data.visible.map((item) => item.id), [first.id, renamed.id, duplicate.id]);
  assert.equal(p.data.visible.find((item) => item.id === renamed.id).selected, true);
  const colorIndex = p.data.colorOptions.indexOf('黑色');
  p.onFilterChange({ currentTarget: { dataset: { kind: 'color' } }, detail: { value: String(colorIndex) } });
  assert.deepEqual(p.data.visible.map((item) => item.id), [renamed.id]);
  p.onFilterChange({ currentTarget: { dataset: { kind: 'color' } }, detail: { value: '0' } });
  assert.equal(p.data.visible.length, 3); assert.equal(p.data.selected[0].id, renamed.id);
  p.onSearchInput({ detail: { value: '' } }); assert.equal(p.data.visible.length, 4); assert.equal(env.writes, 0);
});

test('衣橱搭配沿用同层替换和连体装互斥，点已选取消，不支持品类不写入', () => {
  const top = garment('a'), next = garment('b'), bottom = garment('c', { category: { groupId: 'bottoms', typeId: 'jeans' } });
  const dress = garment('d', { category: { groupId: 'one-piece', typeId: 'dress' } });
  const shoe = garment('e', { category: { groupId: 'shoes', typeId: 'sneakers' } });
  const env = wardrobeOutfitEnvironment([top, next, bottom, dress, shoe]), p = env.instance;
  for (const item of [top, bottom, next]) p.selectForOutfit(item.id);
  assert.deepEqual(new Set(p.data.selected.map((item) => item.id)), new Set([next.id, bottom.id]));
  p.selectForOutfit(dress.id); assert.deepEqual(p.data.selected.map((item) => item.id), [dress.id]);
  p.selectForOutfit(shoe.id); assert.equal(p.data.selected.length, 1);
  p.selectForOutfit(dress.id); assert.equal(p.data.selected.length, 0); assert.equal(env.writes, 0);
});

test('自由搭配入口跨页直接进入选衣，重置旧筛选、保留选择且导航意图只消费一次', () => {
  const { consumeWardrobeMatchingRequest } = require('../miniprogram/services/wardrobe-navigation.ts');
  consumeWardrobeMatchingRequest();
  const top = garment('entry-top'), bottom = garment('entry-bottom', { category: { groupId: 'bottoms', typeId: 'jeans' } });
  const env = wardrobeOutfitEnvironment([top, bottom]), wardrobe = env.instance;
  wardrobe.selectForOutfit(top.id); wardrobe.browseGarments();
  const navigations = [];
  wx.switchTab = (options) => navigations.push(options);
  for (const source of ['home', 'outfits', 'try-on']) {
    let definition; globalThis.Page = (value) => { definition = value; };
    const modulePath = require.resolve(`../miniprogram/pages/${source}/index.ts`);
    delete require.cache[modulePath]; require(modulePath); delete require.cache[modulePath];
    const entry = page(definition);
    wardrobe.setData({ query: '无结果', groupIndex: 2, typeIndex: 1, seasonIndex: 3 }); wardrobe.applyFilter();
    entry.goMatch();
    assert.equal(navigations.at(-1).url, '/pages/wardrobe/index');
    wardrobe.onShow();
    assert.equal(wardrobe.data.outfitMode, true); assert.equal(wardrobe.data.query, '');
    assert.equal(wardrobe.data.groupIndex, 0); assert.equal(wardrobe.data.seasonIndex, 0);
    assert.equal(wardrobe.data.visible.length, 2); assert.deepEqual(wardrobe.data.selected.map((item) => item.id), [top.id]);
    wardrobe.browseGarments(); wardrobe.onShow(); assert.equal(wardrobe.data.outfitMode, false);
  }
  assert.equal(env.writes, 0);
});

test('自由搭配导航失败清除入口意图；过期导航回调不清除更新的请求', () => {
  const { openWardrobeMatching, consumeWardrobeMatchingRequest } = require('../miniprogram/services/wardrobe-navigation.ts');
  consumeWardrobeMatchingRequest();
  const pending = [], toasts = [];
  globalThis.wx = { switchTab: (options) => pending.push(options), showToast: (options) => toasts.push(options.title) };
  openWardrobeMatching(); pending[0].fail(); assert.equal(consumeWardrobeMatchingRequest(), false);
  assert.match(toasts[0], /重试/);
  openWardrobeMatching(); openWardrobeMatching(); pending[1].fail();
  assert.equal(consumeWardrobeMatchingRequest(), true); assert.equal(consumeWardrobeMatchingRequest(), false);
});

test('开始新一套有选衣定位与反馈，取消或弹窗失败保留草稿，确认清除编辑来源和过滤条件', () => {
  let definition; globalThis.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../miniprogram/pages/try-on/index.ts');
  delete require.cache[modulePath]; require(modulePath); delete require.cache[modulePath];
  const { tryOnSession } = require('../miniprogram/services/try-on-session.ts');
  const scrolls = [], toasts = [], modals = [];
  globalThis.wx = { nextTick: (callback) => callback(), pageScrollTo: (options) => scrolls.push(options),
    showToast: (options) => toasts.push(options.title), showModal: (options) => modals.push(options) };
  const p = page(definition); tryOnSession.startNew();
  p.newOutfit(); assert.equal(modals.length, 0); assert.equal(scrolls.at(-1).selector, '#garmentCatalog');
  assert.match(toasts.at(-1), /添加衣物/);
  const top = garment('new-top'); p.setData({ garments: [top] });
  tryOnSession.wear(top); tryOnSession.setName('草稿名称'); p.syncSession();
  p.setData({ query: '无结果', layerFilter: 'bottom' }); p.filterCatalog();
  const before = tryOnSession.allItems();
  p.newOutfit(); modals.at(-1).success({ confirm: false });
  assert.deepEqual(tryOnSession.allItems(), before); assert.equal(tryOnSession.name, '草稿名称'); assert.equal(scrolls.length, 1);
  p.newOutfit(); modals.at(-1).fail(); assert.deepEqual(tryOnSession.allItems(), before); assert.match(toasts.at(-1), /重试/);
  const saved = { id: 'edit-source', name: '已保存', revision: 1, items: before };
  tryOnSession.markSaved(saved); tryOnSession.adjust(top.id, { scale: 1.3 }); p.syncSession();
  p.newOutfit(); modals.at(-1).success({ confirm: true });
  assert.equal(p.data.totalItems, 0); assert.equal(p.data.activeId, ''); assert.equal(p.data.outfitName, '');
  assert.equal(p.data.editingOutfitId, ''); assert.equal(tryOnSession.source, null);
  assert.equal(p.data.query, ''); assert.equal(p.data.layerFilter, ''); assert.equal(p.data.catalog.length, 1);
  assert.equal(scrolls.length, 2); assert.match(toasts.at(-1), /选择衣物/);
  tryOnSession.load(saved, [top]); p.syncSession(); p.newOutfit();
  assert.equal(p.data.editingOutfitId, ''); assert.equal(modals.length, 3, '未修改的已保存穿搭直接退出编辑');
  p.setData({ savingOutfit: true }); const scrollCount = scrolls.length; p.newOutfit(); assert.equal(scrolls.length, scrollCount);
  tryOnSession.startNew();
});

test('损坏衣物字段与重复 ID 阻止页面读取及后续覆盖', () => {
  const valid = garment('good');
  const broken = [
    { ...valid, seasons: 'summer' }, { ...valid, tags: 'a' },
    { ...valid, image: { displayPath: valid.image.displayPath, overlayPath: 42 } },
    { ...valid, purchasePrice: Infinity }, { ...valid, purchaseDate: '2026-02-31' },
    { ...valid, createdAt: 'bad' }, { ...valid, name: null },
  ];
  for (const record of broken) {
    const env = store({ version: 1, garments: [record] });
    const repo = new LocalGarmentRepository();
    assert.throws(() => repo.list(), /格式异常/);
    assert.throws(() => repo.put(valid), /格式异常/);
    assert.equal(env.writes, 0);
  }
  const env = store({ version: 1, garments: [valid, valid] });
  assert.throws(() => new LocalGarmentRepository().list(), /格式异常/);
  assert.equal(env.writes, 0);
});

test('衣物记录返回值不泄漏存储对象引用', () => {
  const env = store({ version: 1, garments: [garment('good')] }, true);
  const repo = new LocalGarmentRepository();
  const read = repo.list();
  read[0].image.displayPath = '/changed.png';
  assert.equal(repo.list()[0].image.displayPath, '/user/garment_good.png');
  assert.equal(env.writes, 0);
});

test('衣物服务拒绝坏日期、季节和标签，旧记录保持原样', () => {
  const env = store();
  const service = new GarmentService(new LocalGarmentRepository());
  const created = service.create({ category, image: { displayPath: '/user/garment_initial.png' }, name: '原衣物' });
  const before = structuredClone(env.snapshot);
  for (const invalid of [{ purchaseDate: '2026-02-31' }, { purchaseDate: '2026-99-99' },
    { seasons: ['unknown'] }, { tags: '标签' }, { image: { displayPath: '/a.png', overlayPath: 23 } }]) {
    assert.throws(() => service.update(created.id, { category, image: created.image, ...invalid }));
  }
  assert.deepEqual(env.snapshot, before);
  assert.equal(env.writes, 1);
});

test('图片格式、复制失败和受管路径边界均有保护', async () => {
  const removed = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getImageInfo: ({ success }) => success({ type: 'unknown' }),
    getFileSystemManager: () => ({ copyFile: () => { throw new Error('不能复制'); },
      unlink: ({ filePath, success }) => { removed.push(filePath); success(); } }),
  };
  await assert.rejects(saveImage('/tmp/a'), /不支持/);
  await removeImage('/user/garment_../private.txt');
  await removeImage('/user/garment_a/../../private.txt');
  await removeImage('/user/garment_a.png');
  assert.deepEqual(removed, ['/user/garment_a.png']);
  globalThis.wx.getImageInfo = ({ success }) => success({ type: 'png' });
  globalThis.wx.getFileSystemManager = () => ({ copyFile: ({ fail }) => fail({ errMsg: '空间不足' }) });
  await assert.rejects(saveImage('/tmp/a.png'), /空间不足/);
});

test('图片选择和裁剪对空结果、损坏文件、取消及成功路径分别反馈', async () => {
  globalThis.wx = {
    chooseMedia: ({ success }) => success({ tempFiles: [] }),
  };
  await assert.rejects(chooseImage('album'), /未获取到图片/);
  globalThis.wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: '/temp/a.png' }] });
  globalThis.wx.getImageInfo = ({ fail }) => fail({ errMsg: 'broken' });
  await assert.rejects(chooseImage('camera'), /无法读取/);
  globalThis.wx.chooseMedia = ({ fail }) => fail({ errMsg: 'chooseMedia:fail cancel' });
  await assert.rejects(chooseImage('album'), ImageSelectionCancelled);
  globalThis.wx.editImage = ({ success }) => success({ tempFilePath: '/temp/crop.png' });
  assert.equal(await editImage('/temp/a.png'), '/temp/crop.png');
  globalThis.wx.editImage = ({ fail }) => fail({ errMsg: 'editImage:fail cancel' });
  await assert.rejects(editImage('/temp/a.png'), ImageSelectionCancelled);
});

test('衣物表单保存期间重复点击只写一次，表单变动不混入当次保存', async () => {
  const storage = new Map();
  let copySuccess;
  let copies = 0;
  let back = 0;
  const dialogs = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync: (k) => structuredClone(storage.get(k) || ''),
    setStorageSync: (k, value) => storage.set(k, structuredClone(value)),
    getImageInfo: ({ success }) => success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: ({ success }) => { copies += 1; copySuccess = success; }, unlink: ({ success }) => success() }),
    showLoading: () => {}, hideLoading: () => {}, showToast: () => {}, showModal: (o) => dialogs.push(o),
    navigateBack: () => { back += 1; },
  };
  let definition;
  globalThis.Page = (value) => { definition = value; };
  require('../miniprogram/pages/garment-form/index.ts');
  globalThis.formDefinition = definition;
  const form = page(definition);
  form.setData({ groupIndex: 0, typeIndex: 0, imagePath: '/tmp/a.png', imageDirty: true, name: '开始保存时' });
  const pending = form.saveGarment();
  await form.saveGarment();
  form.onFieldInput({ detail: { value: '稍后修改' }, currentTarget: { dataset: { field: 'name' } } });
  copySuccess(); await pending;
  assert.equal(copies, 1);
  assert.equal(storage.get(key).garments[0].name, '开始保存时');
  assert.equal(back, 1);
  assert.deepEqual(dialogs, []);
});

test('图片已复制但存储写入失败时清理新文件并允许重新保存', async () => {
  let failWrite = true;
  const deleted = [], messages = [];
  let snapshot = '';
  Object.assign(globalThis.wx, {
    getStorageSync: () => structuredClone(snapshot),
    setStorageSync: (_k, value) => { if (failWrite) throw new Error('空间不足'); snapshot = structuredClone(value); },
    getFileSystemManager: () => ({ copyFile: ({ success }) => success(), unlink: ({ filePath, success }) => { deleted.push(filePath); success(); } }),
    showModal: (o) => messages.push(o.content),
  });
  const form = page(globalThis.formDefinition);
  form.setData({ groupIndex: 0, typeIndex: 0, imagePath: '/tmp/b.png', imageDirty: true });
  await form.saveGarment();
  assert.equal(snapshot, '');
  assert.equal(deleted.length, 1);
  assert.match(messages[0], /空间不足/);
  assert.equal(form.data.saving, false);
  failWrite = false;
  await form.saveGarment();
  assert.equal(snapshot.garments.length, 1);
});

test('更换照片保存失败保留旧记录和旧图片，成功后才清理旧图片', async () => {
  const original = garment('original');
  let snapshot = { version: 1, garments: [original] };
  let failWrite = true;
  const removed = [], dialogs = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync: () => structuredClone(snapshot),
    setStorageSync: (_key, value) => { if (failWrite) throw new Error('空间不足'); snapshot = structuredClone(value); },
    getImageInfo: ({ success }) => success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: ({ success }) => success(),
      unlink: ({ filePath, success }) => { removed.push(filePath); success(); } }),
    showLoading: () => {}, hideLoading: () => {}, showToast: () => {}, navigateBack: () => {},
    showModal: (o) => dialogs.push(o.content),
  };
  const form = page(globalThis.formDefinition);
  form.onLoad({ id: original.id });
  form.setData({ imagePath: '/temp/new.png', imageDirty: true });
  await form.saveGarment();
  assert.deepEqual(snapshot.garments[0], original);
  assert.equal(removed.length, 1);
  assert.notEqual(removed[0], original.image.displayPath);
  assert.match(dialogs[0], /空间不足/);
  failWrite = false;
  await form.saveGarment();
  assert.equal(snapshot.garments[0].id, original.id);
  assert.notEqual(snapshot.garments[0].image.displayPath, original.image.displayPath);
  assert.ok(removed.includes(original.image.displayPath));
});

test('大量连续调整保持图层和参数有效，绘制坐标有限', () => {
  const a = garment('top');
  const b = garment('bottom', { category: { groupId: 'bottoms', typeId: 'jeans' } });
  const c = garment('coat', { category: { groupId: 'tops', typeId: 'coat' } });
  const session = new TryOnSession();
  for (const item of [a, b, c]) session.wear(item);
  const body = buildBodyModel({ ...SAMPLE_BODY, weightKg: Number.MAX_VALUE, bustCm: Number.MAX_VALUE });
  const start = performance.now();
  for (let i = 0; i < 1000; i += 1) {
    session.adjust(a.id, { offsetX: Math.sin(i) * 200, offsetY: Math.cos(i) * 200,
      scale: 0.25 + (i % 276) / 100, rotationDeg: (i % 361) - 180 });
    const current = session.list();
    assert.deepEqual(current.map((item) => item.layer), ['bottom', 'top', 'outer']);
    assert.ok(current.every((item) => Object.values(item.transform).every(Number.isFinite)));
    const view = bodyCanvasTransform(body, 160 + (i % 4) * 100, 280 + (i % 3) * 90);
    const fitted = placeGarment(body, a, 400, 600);
    assert.ok(Number.isFinite(view.scale) && Object.values(fitted).every(Number.isFinite));
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 10000, `主机纯逻辑 1000 次调整耗时 ${elapsed.toFixed(0)}ms`);
});

test('画布原尺寸重绘不重复分配像素缓冲区，尺寸改变仍重设', async () => {
  const { renderBodyCanvas } = await import('../miniprogram/rendering/draw-body.ts');
  let width = 0, height = 0, assignments = 0;
  const context = new Proxy({}, { get: (_target, key) => () => String(key).includes('Gradient') ? { addColorStop() {} } : undefined, set: () => true });
  const canvas = { get width() { return width; }, set width(value) { width = value; assignments += 1; },
    get height() { return height; }, set height(value) { height = value; assignments += 1; },
    getContext: () => context };
  const model = buildBodyModel(SAMPLE_BODY);
  renderBodyCanvas(canvas, 300, 420, 2, model);
  for (let i = 0; i < 100; i += 1) renderBodyCanvas(canvas, 300, 420, 2, model);
  assert.equal(assignments, 2);
  renderBodyCanvas(canvas, 320, 420, 2, model);
  assert.equal(assignments, 3);
});

test('试衣连续微调不重建衣橱目录，替换衣物后会刷新目录', () => {
  let definition;
  globalThis.Page = (value) => { definition = value; };
  require('../miniprogram/pages/try-on/index.ts');
  const { tryOnSession } = require('../miniprogram/services/try-on-session.ts');
  tryOnSession.startNew();
  const first = garment('first');
  const second = garment('second');
  const instance = page(definition);
  instance.data.garments = [first, second];
  let catalogWrites = 0;
  const originalSetData = instance.setData;
  instance.setData = (patch) => { if ('catalog' in patch) catalogWrites += 1; originalSetData.call(instance, patch); };
  instance.wear({ currentTarget: { dataset: { id: first.id } } });
  assert.equal(catalogWrites, 1);
  for (let i = 0; i < 100; i += 1) instance.onTransformChange({ detail: {
    garmentId: first.id, scale: (25 + i) / 100, rotationDeg: i / 2, offsetX: i / 10, offsetY: -i / 10 } });
  assert.equal(catalogWrites, 1);
  instance.wear({ currentTarget: { dataset: { id: second.id } } });
  assert.equal(catalogWrites, 2);
  tryOnSession.startNew();
});

test('模拟页面完成拍照选择、衣物录入/筛选/编辑及身材保存重读', async () => {
  const stored = new Map();
  const copied = [], removed = [], navigated = [], messages = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync: (storageKey) => structuredClone(stored.get(storageKey) || ''),
    setStorageSync: (storageKey, value) => stored.set(storageKey, structuredClone(value)),
    showActionSheet: ({ success }) => success({ tapIndex: 1 }),
    chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: '/temp/shirt.png' }] }),
    getImageInfo: ({ success }) => success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: ({ srcPath, destPath, success }) => {
      copied.push({ srcPath, destPath }); success(); },
    unlink: ({ filePath, success }) => { removed.push(filePath); success(); } }),
    showLoading: () => {}, hideLoading: () => {}, showToast: (o) => messages.push(o.title),
    showModal: (o) => { throw new Error(`意外弹窗：${o.title}`); },
    navigateBack: () => navigated.push('back'), switchTab: ({ url }) => navigated.push(url),
    navigateTo: ({ url }) => navigated.push(url),
  };
  const form = page(globalThis.formDefinition);
  await form.chooseDisplayImage();
  assert.equal(form.data.imagePath, '/temp/shirt.png');
  form.onGroupChange({ detail: { value: '0' } });
  form.onTypeChange({ detail: { value: '0' } });
  form.onFieldInput({ detail: { value: '白色短袖' }, currentTarget: { dataset: { field: 'name' } } });
  form.onSeasonChange({ detail: { value: ['summer'] } });
  await form.saveGarment();
  const saved = stored.get(key).garments[0];
  assert.equal(saved.name, '白色短袖');
  assert.deepEqual(saved.seasons, ['summer']);
  assert.ok(saved.image.displayPath.startsWith('/user/garment_'));

  let wardrobeDefinition;
  globalThis.Page = (value) => { wardrobeDefinition = value; };
  require('../miniprogram/pages/wardrobe/index.ts');
  const wardrobe = page(wardrobeDefinition);
  wardrobe.onShow();
  assert.equal(wardrobe.data.visible.length, 1);
  wardrobe.onSearchInput({ detail: { value: '不存在' } });
  assert.equal(wardrobe.data.visible.length, 0);
  wardrobe.onSearchInput({ detail: { value: '短袖' } });
  assert.equal(wardrobe.data.visible.length, 1);
  wardrobe.onFilterChange({ detail: { value: '2' }, currentTarget: { dataset: { kind: 'season' } } });
  assert.equal(wardrobe.data.visible.length, 1);

  const edit = page(globalThis.formDefinition);
  edit.onLoad({ id: saved.id });
  edit.onFieldInput({ detail: { value: '改名短袖' }, currentTarget: { dataset: { field: 'name' } } });
  await edit.saveGarment();
  assert.equal(stored.get(key).garments[0].name, '改名短袖');
  assert.equal(copied.length, 1);
  assert.deepEqual(removed, []);

  let bodyDefinition;
  globalThis.Page = (value) => { bodyDefinition = value; };
  require('../miniprogram/pages/body-settings/index.ts');
  const body = page(bodyDefinition);
  body.onLoad();
  for (const [field, value] of Object.entries({ heightCm: '175', weightKg: '63.25',
    bustCm: '90', waistCm: '72', hipCm: '96' })) {
    body.onFieldInput({ detail: { value }, currentTarget: { dataset: { key: field } } });
  }
  body.saveBody();
  assert.equal(stored.get('smart-wardrobe.body-profile.v1').profile.weightKg, 63.25);
  const reopened = page(bodyDefinition);
  reopened.onLoad();
  assert.equal(reopened.data.fields.find((field) => field.key === 'weightKg').value, '63.25');
  assert.ok(navigated.includes('/pages/try-on/index'));
  assert.ok(messages.includes('保存成功') && messages.includes('已保存身材'));
});

test('模拟衣物表单图片选择取消、损坏照片和必填项保护', async () => {
  let writes = 0, toast = '';
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync: () => '', setStorageSync: () => { writes += 1; },
    showActionSheet: ({ fail }) => fail({ errMsg: 'cancel' }),
    showToast: (o) => { toast = o.title; }, showModal: () => { throw new Error('取消不应弹窗'); },
  };
  const form = page(globalThis.formDefinition);
  await form.chooseDisplayImage();
  assert.equal(form.data.imagePath, '');
  await form.saveGarment();
  assert.match(toast, /图片/);
  form.setData({ imagePath: '/missing.png', imageFailed: true, groupIndex: 0, typeIndex: 0 });
  await form.saveGarment();
  assert.equal(writes, 0);
});
