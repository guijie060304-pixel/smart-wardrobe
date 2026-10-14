import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { LocalOutfitRepository } from '../miniprogram/repositories/outfit-repository.ts';
import { OutfitService } from '../miniprogram/services/outfit-service.ts';
import { TryOnSession } from '../miniprogram/services/try-on-session.ts';
import { assertBoard, boardSignature, changeBoardItem, cloneBoard, completeBoard, reorderBoard } from '../miniprogram/utils/outfit-board.ts';
import { isOutfit } from '../miniprogram/utils/outfit-validation.ts';
import { sortTryOnGarments } from '../miniprogram/rendering/garment-layout.ts';
import { boardCanvasFit, boardTargets, drawOutfitBoard } from '../miniprogram/rendering/outfit-board.ts';
import { GarmentGestures, hitTestGarment } from '../miniprogram/rendering/garment-gestures.ts';
import { DEFAULT_TRANSFORM } from '../miniprogram/config/try-on.ts';

const require = createRequire(import.meta.url), stamp = '2026-10-13T08:00:00Z';
const top = { id: 'board-top', name: '上衣', category: { groupId: 'tops', typeId: 'tshirt' }, image: { displayPath: '/user/top.png' }, createdAt: stamp, updatedAt: stamp };
const bottom = { ...top, id: 'board-bottom', name: '裤子', category: { groupId: 'bottoms', typeId: 'jeans' }, image: { displayPath: '/user/bottom.png' } };
const items = [{ garmentId: top.id, layer: 'top', transform: { ...DEFAULT_TRANSFORM } }, { garmentId: bottom.id, layer: 'bottom', transform: { ...DEFAULT_TRANSFORM } }];

function environment() {
  const stored = new Map([['smart-wardrobe.garments.v1', { version: 1, garments: structuredClone([top, bottom]) }]]), modals = [], toasts = [], navigations = [];
  let failWrite = false, writes = 0, bodyReads = 0;
  globalThis.wx = {
    getStorageSync: (key) => { if (key.includes('body-profile')) bodyReads++; return structuredClone(stored.get(key) || ''); },
    setStorageSync: (key, value) => { if (failWrite) throw Error('空间不足'); writes++; stored.set(key, structuredClone(value)); },
    showModal: (options) => modals.push(options), showToast: (options) => toasts.push(options.title),
    navigateTo: (options) => navigations.push(options.url), switchTab: (options) => navigations.push(options.url),
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
  };
  const repository = new LocalOutfitRepository();
  const service = new OutfitService(repository, { list: () => structuredClone(stored.get('smart-wardrobe.garments.v1').garments) });
  return { stored, repository, service, modals, toasts, navigations, get bodyReads() { return bodyReads; }, get writes() { return writes; }, failWrite: (value) => { failWrite = value; } };
}
function page(name) {
  let definition; globalThis.Page = (value) => { definition = value; };
  const path = require.resolve(`../miniprogram/pages/${name}/index.ts`); delete require.cache[path]; require(path); delete require.cache[path];
  const p = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [key, method] of Object.entries(definition)) if (typeof method === 'function') p[key] = method.bind(p);
  return p;
}
const byId = (id) => ({ currentTarget: { dataset: { id } } });

test('画布默认位置兼容旧穿搭，拒绝幽灵/重复位置和非有限参数，拷贝不保留外部对象', () => {
  const board = completeBoard(items); assert.equal(board.length, 2); assertBoard(board, items);
  const changed = changeBoardItem(board, top.id, { garmentId: top.id, x: 130, y: -20, scale: 1.4, rotationDeg: 18 });
  assert.equal(changed[0].x, 100); assert.equal(changed[0].y, 0); assert.equal(board[0].x, 30);
  for (const invalid of [board.slice(0, 1), [board[0], board[0]], [{ ...board[0], x: NaN }, board[1]], [{ ...board[0], garmentId: 'ghost' }, board[1]]]) assert.throws(() => assertBoard(invalid, items));
  const old = { id: 'old', name: '原来的穿搭', items, revision: 1, createdAt: stamp, updatedAt: stamp };
  assert.equal(isOutfit(old), true); assert.equal(isOutfit({ ...old, board: [{ ...board[0], zIndex: Infinity }, board[1]] }), false);
  const extra = { ...board[0], hidden: { secret: 'ignored' } }; assert.equal(cloneBoard([extra])[0].hidden, undefined);
  assert.equal(boardSignature(board), boardSignature([...board].reverse()));
});

test('自由搭配名称选填，空白自动标签区分，自定义名称校验且画布与试衣参数独立', () => {
  const env = environment(), board = changeBoardItem(completeBoard(items), top.id, { x: 47, y: 52, scale: 1.3, rotationDeg: -12 });
  const saved = env.service.createFree(items, board), next = env.service.createFree(items, undefined, '  ');
  assert.equal(saved.kind, 'free'); assert.match(saved.name, /^自由搭配/); assert.notEqual(saved.name, next.name); assert.notEqual(saved.id, next.id);
  assert.equal(saved.items.find((item) => item.garmentId === top.id).transform.offsetX, 0);
  assert.equal(saved.board.find((item) => item.garmentId === top.id).x, 47);
  board[0].x = 2; saved.board[0].x = 3; assert.equal(env.service.get(saved.id).board.find((item) => item.garmentId === top.id).x, 47);
  assert.equal(env.bodyReads, 0); assert.equal(env.modals.length, 0);
  const named = env.service.createFree(items, undefined, '  周末出游  '); assert.equal(named.name, '周末出游'); assert.equal(named.kind, 'free');
  const writes = env.writes; assert.throws(() => env.service.createFree(items, undefined, '搭'.repeat(61)), /最多/); assert.equal(env.writes, writes);
});

test('排列保存失败/版本冲突保留原数据，缺失衣物位置仍保留，换衣后只补齐新画布位置', () => {
  const env = environment(), saved = env.service.createFree(items), board = reorderBoard(saved.board, bottom.id);
  env.failWrite(true); assert.throws(() => env.service.saveBoard(saved.id, saved.revision, board), /空间不足/);
  env.failWrite(false); assert.deepEqual(env.service.get(saved.id), saved);
  env.stored.get('smart-wardrobe.garments.v1').garments = [top];
  const updated = env.service.saveBoard(saved.id, saved.revision, board); assert.equal(updated.items.length, 2); assert.equal(updated.board.length, 2);
  assert.throws(() => env.service.saveBoard(saved.id, saved.revision, saved.board), /其他页面/);
  const changed = env.service.update(updated.id, updated.revision, { name: updated.name, items: updated.items.filter((item) => item.garmentId === top.id) });
  assert.equal(changed.board.length, 1); assert.equal(changed.board[0].garmentId, top.id);
});

test('试衣长按置顶能保存/重载，叠放修改算未保存，失效衣物引用不被重写', () => {
  const env = environment(), saved = env.service.create({ name: '试衣', items });
  const session = new TryOnSession(); session.load(saved, [top, bottom]);
  session.bringToFront(bottom.id); assert.equal(session.hasUnsavedChanges(), true);
  const order = () => sortTryOnGarments(session.list().map((item) => ({ ...item, garment: item.garmentId === top.id ? top : bottom }))).map((item) => item.garmentId);
  assert.equal(order().at(-1), bottom.id);
  const updated = env.service.update(saved.id, saved.revision, { name: saved.name, items: session.allItems() }); session.load(updated, [top, bottom]); assert.equal(order().at(-1), bottom.id);
  session.load(updated, [top]); const missing = session.unavailable(); session.bringToFront(top.id); assert.deepEqual(session.unavailable(), missing);
  env.stored.get('smart-wardrobe.garments.v1').garments = [top]; assert.doesNotThrow(() => env.service.update(updated.id, updated.revision, { name: updated.name, items: session.allItems() }));
});

test('画布绘制与命中共用叠放顺序，已选内层可长按提起，单指移动仍交给滚屏', () => {
  const assets = items.map((item, index) => ({ item: { ...item, garment: index ? bottom : top }, image: { width: 200, height: 300, id: item.garmentId } }));
  let board = completeBoard(items).map((item) => ({ ...item, x: 50, y: 50 })); const fit = boardCanvasFit(300, 300);
  const point = { x: 150, y: 150, identifier: 0 };
  assert.equal(hitTestGarment(point, boardTargets(assets, board), fit).garmentId, bottom.id);
  const gestures = new GarmentGestures(); gestures.start([point], boardTargets(assets, board), fit, top.id); assert.equal(gestures.longPress(), true);
  board = reorderBoard(board, gestures.garmentId); assert.equal(hitTestGarment(point, boardTargets(assets, board), fit).garmentId, top.id);
  const moves = gestures.move([{ ...point, x: 175 }]); assert.ok(moves.transform.offsetX > 50); gestures.cancel();
  gestures.start([point], boardTargets(assets, board), fit); assert.equal(gestures.move([{ ...point, y: 200 }]), undefined); assert.equal(gestures.locked, false);
  const drawn = [], context = new Proxy({}, { get: (_t, name) => name === 'drawImage' ? (image) => drawn.push(image.id) : () => {}, set: () => true });
  drawOutfitBoard({ width: 0, height: 0, getContext: () => context }, 300, 300, 2, assets, board, top.id);
  assert.deepEqual(drawn, [bottom.id, top.id]);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function boardComponent(properties, manualImages = false) {
  let definition; globalThis.Component = (value) => { definition = value; };
  const path = require.resolve('../miniprogram/components/outfit-board/index.ts'); delete require.cache[path]; require(path); delete require.cache[path];
  const events = [], images = []; let assignments = 0, width = 0, height = 0;
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  const canvas = { get width() { return width; }, set width(value) { width = value; assignments++; }, get height() { return height; }, set height(value) { height = value; assignments++; },
    getContext: () => context, createImage: () => { const image = { width: 200, height: 300 }; Object.defineProperty(image, 'src', { set(path) { image.path = path; if (!manualImages) queueMicrotask(() => image.onload()); } }); images.push(image); return image; } };
  globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 2 }) };
  const component = { properties: { items: [], layout: [], activeId: '', interactive: true, ...properties }, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }, triggerEvent(name, detail) { events.push({ name, detail }); },
    createSelectorQuery: () => ({ select() { return this; }, fields() { return this; }, exec(callback) { callback([{ node: canvas, width: 300, height: 300 }]); } }) };
  for (const [name, method] of Object.entries(definition.methods)) component[name] = method.bind(component);
  definition.lifetimes.ready.call(component);
  return { component, definition, events, images, get assignments() { return assignments; }, detach: () => definition.lifetimes.detached.call(component) };
}

test('画布组件长按置顶/拖动/松手锁定正确，连续调整复用图片与像素缓冲', async () => {
  const env = boardComponent({ items: items.map((item, index) => ({ ...item, garment: index ? bottom : top })), layout: completeBoard(items) });
  await tick(); const c = env.component; assert.equal(c.data.renderError, ''); assert.equal(env.images.length, 2);
  const position = env.component.properties.layout[0], fit = boardCanvasFit(300, 300);
  const touch = { x: position.x * fit.scale + fit.translateX, y: position.y * fit.scale + fit.translateY, identifier: 0 };
  c.onTouchStart({ touches: [touch] }); assert.equal(c.data.gestureLocked, false); c.onLongPress(); assert.equal(c.data.gestureLocked, true);
  assert.equal(env.events.find((event) => event.name === 'itemraise').detail.garmentId, top.id);
  c.onTouchMove({ touches: [{ ...touch, x: touch.x + 20, y: touch.y + 10 }] });
  const change = env.events.find((event) => event.name === 'layoutchange'); assert.ok(change.detail.x > position.x);
  c.onTouchEnd({ touches: [] }); assert.equal(c.data.gestureLocked, false);
  for (let i = 0; i < 40; i++) { c.properties.layout = changeBoardItem(c.properties.layout, top.id, { x: i + 20, y: 40, scale: 1, rotationDeg: i }); env.definition.observers.layout.call(c); }
  assert.equal(env.images.length, 2); assert.equal(env.assignments, 2); env.detach();
});

test('画布坏图保留位置、换图的迟到结果不覆盖新图，卸载与只读不触发调整', async () => {
  const old = { ...items[0], garment: top }, next = { ...old, garment: { ...top, image: { displayPath: '/user/new.png' } } };
  const env = boardComponent({ items: [old], layout: completeBoard([old]) }, true), c = env.component;
  c.properties.items = [next]; env.definition.observers.items.call(c); env.images[1].onerror(); await tick();
  assert.equal(c.data.warnings.length, 1); env.images[0].onload(); await tick(); assert.equal(c.data.warnings.length, 1);
  c.properties.interactive = false; env.definition.observers.interactive.call(c); c.onTouchStart({ touches: [{ x: 150, y: 150, identifier: 0 }] }); c.onLongPress(); assert.equal(env.events.length, 0);
  env.detach(); c.setData = () => { throw Error('卸载后不能更新'); };
});

test('详情默认画布不读取身材，拖拽草稿跨显示保留，保存/重开保持排列且不改试衣位置', () => {
  const env = environment(), saved = env.service.createFree(items), p = page('outfit-detail'); p.onLoad({ id: saved.id }); p.onShow();
  assert.equal(p.data.previewMode, 'board'); assert.equal(env.bodyReads, 0);
  p.onBoardRaise({ detail: { garmentId: bottom.id } }); p.onBoardChange({ detail: { garmentId: bottom.id, x: 40, y: 44, scale: 1.4, rotationDeg: -15 } });
  const draft = structuredClone(p.data.boardLayout); p.onShow(); assert.deepEqual(p.data.boardLayout, draft); assert.equal(p.data.boardDirty, true);
  assert.equal(p.saveBoard(), true); assert.equal(p.data.boardDirty, false); assert.deepEqual(env.service.get(saved.id).items, saved.items);
  const reopened = page('outfit-detail'); reopened.onLoad({ id: saved.id }); reopened.onShow(); assert.equal(boardSignature(reopened.data.boardLayout), boardSignature(draft));
  reopened.setPreviewMode({ currentTarget: { dataset: { mode: 'model' } } }); assert.equal(env.bodyReads, 1); p.onUnload(); reopened.onUnload();
});

test('详情排列失败与来源版本变化保留草稿，回收站只读且不回写失效衣物', () => {
  const env = environment(), saved = env.service.createFree(items), p = page('outfit-detail'); p.onLoad({ id: saved.id }); p.onShow();
  p.onBoardChange({ detail: { garmentId: top.id, x: 45, y: 45, scale: 1, rotationDeg: 4 } }); const draft = structuredClone(p.data.boardLayout);
  env.failWrite(true); assert.equal(p.saveBoard(), false); assert.equal(p.data.boardDirty, true); assert.deepEqual(p.data.boardLayout, draft);
  env.failWrite(false); env.service.rename(saved.id, saved.revision, '外部旧记录改名'); assert.equal(p.saveBoard(), false); assert.deepEqual(p.data.boardLayout, draft);
  const latest = env.service.get(saved.id); env.service.delete(saved.id, latest.revision); p.loadOutfit(); const readonly = structuredClone(p.data.boardLayout);
  p.onBoardChange({ detail: { garmentId: top.id, x: 10, y: 20, scale: 1, rotationDeg: 4 } }); assert.deepEqual(p.data.boardLayout, readonly); assert.equal(p.saveBoard(), false); p.onUnload();
});

test('列表卡片删除取消不变、重复点击只开一次确认，确认入回收站且保留衣橱/日历', () => {
  const env = environment(), saved = env.service.createFree(items); env.stored.set('smart-wardrobe.calendar.v1', { sentinel: 'untouched' });
  const p = page('outfits'); p.onShow(); p.deleteCard(byId(saved.id)); p.deleteCard(byId(saved.id)); assert.equal(env.modals.length, 1);
  env.modals[0].success({ confirm: false }); env.modals[0].complete(); assert.equal(p.data.cards.length, 1); assert.equal(p.data.deletingId, '');
  p.deleteCard(byId(saved.id)); env.modals[1].success({ confirm: true }); env.modals[1].complete(); assert.equal(p.data.cards.length, 0);
  assert.equal(env.service.list('deleted').length, 1); assert.equal(env.navigations.length, 0); assert.equal(env.stored.get('smart-wardrobe.garments.v1').garments.length, 2);
  assert.deepEqual(env.stored.get('smart-wardrobe.calendar.v1'), { sentinel: 'untouched' });
});

test('列表删除失败或确认期间版本变化不覆盖记录，更新列表后可重试', () => {
  const env = environment(), saved = env.service.createFree(items), p = page('outfits'); p.onShow();
  p.deleteCard(byId(saved.id)); env.failWrite(true); env.modals.at(-1).success({ confirm: true }); env.modals.at(-1).complete();
  assert.equal(p.data.cards.length, 1); assert.match(env.toasts.at(-1), /空间不足/); env.failWrite(false);
  p.deleteCard(byId(saved.id)); env.service.rename(saved.id, saved.revision, '另页修改'); env.modals.at(-1).success({ confirm: true }); env.modals.at(-1).complete();
  assert.equal(p.data.cards.length, 1); assert.match(env.toasts.at(-1), /其他页面/); assert.equal(env.service.get(saved.id).deletedAt, undefined);
});
