import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORY_GROUPS } from '../miniprogram/config/categories.ts';
import { DEFAULT_TRANSFORM, getTryOnLayer } from '../miniprogram/config/try-on.ts';
import { SAMPLE_BODY } from '../miniprogram/config/body.ts';
import { TryOnSession, tryOnSession } from '../miniprogram/services/try-on-session.ts';
import { buildBodyModel } from '../miniprogram/rendering/body-model.ts';
import { bodyCanvasTransform, renderBodyCanvas } from '../miniprogram/rendering/draw-body.ts';
import { placeGarment } from '../miniprogram/rendering/garment-layout.ts';
import { drawGarments } from '../miniprogram/rendering/draw-garments.ts';
import { CanvasImageCache, loadGarmentImages } from '../miniprogram/rendering/garment-images.ts';
import { GarmentGestures, hitTestGarment } from '../miniprogram/rendering/garment-gestures.ts';
import { alphaContent } from '../miniprogram/rendering/image-content.ts';

const garment = (id, groupId = 'tops', typeId = 'tshirt', overlayPath) => ({
  id, name: id, category: { groupId, typeId }, image: { displayPath: `${id}.png`, ...(overlayPath ? { overlayPath } : {}) },
  createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
});
const top = garment('top');
const bottom = garment('bottom', 'bottoms', 'jeans');
const outer = garment('outer', 'tops', 'jacket');
const dress = garment('dress', 'one-piece', 'dress');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const pointer = (x, y, identifier = 1) => ({ x, y, identifier });
const gestureFit = { scale: 1, translateX: 0, translateY: 0 };
const gestureTarget = (id = 'top', transform = {}) => ({ garmentId: id,
  placement: { centerX: 100, centerY: 100, width: 60, height: 100 }, transform: { ...DEFAULT_TRANSFORM, ...transform } });

test('透明边距自动排除，白色不透明衣物不会被当成背景裁掉，透明图返回空内容', () => {
  const pixels = new Uint8ClampedArray(100 * 120 * 4);
  for (let y = 20; y < 100; y++) for (let x = 25; x < 75; x++) pixels.set([255,255,255,255], (y * 100 + x) * 4);
  const result = alphaContent(pixels, 100, 120);
  assert.deepEqual(result.bounds, { x: 24, y: 19, width: 52, height: 82 });
  assert.equal(result.bodyWidthRatio, 1);
  const opaque = alphaContent(new Uint8ClampedArray(100 * 120 * 4).fill(255), 100, 120);
  assert.deepEqual(opaque.bounds, { x: 0, y: 0, width: 100, height: 120 });
  assert.equal(opaque.bodyWidthRatio, undefined);
  assert.equal(alphaContent(new Uint8ClampedArray(16), 2, 2), null);
});

test('同一衣物不同透明画布使用相同内容尺寸定位，裁切后的图像比例保持不变', () => {
  const body = buildBodyModel(SAMPLE_BODY);
  const a = placeGarment(body, top, 100, 120, { sourceRect: { x: 20, y: 10, width: 60, height: 90 }, bodyWidthRatio: 0.7 });
  const b = placeGarment(body, top, 300, 400, { sourceRect: { x: 120, y: 140, width: 60, height: 90 }, bodyWidthRatio: 0.7 });
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.width / a.height - 60 / 90) < 1e-9);
});

test('画布空白与衣物上的单指上下滑均不修改衣物，也不锁定页面或误触选中', () => {
  for (const x of [5, 100]) {
    const gestures = new GarmentGestures();
    gestures.start([pointer(x, 100)], [gestureTarget()], gestureFit);
    assert.equal(gestures.locked, false);
    assert.equal(gestures.move([pointer(x, 140)]), undefined);
    assert.equal(gestures.longPress(), false);
    gestures.start([pointer(x, 140), pointer(x + 20, 140, 2)], [gestureTarget()], gestureFit);
    assert.equal(gestures.locked, false); // 已开始滚屏，第二指不能突然抢占。
    assert.equal(gestures.end([]), '');
  }
});

test('轻点命中顶层衣物；长按命中后才可拖动，位移按画布比例换算', () => {
  const gestures = new GarmentGestures(), target = gestureTarget();
  const fit = { scale: 2, translateX: 20, translateY: 10 };
  const start = pointer(220, 210);
  gestures.start([start], [target, { ...target, garmentId: 'outer' }], fit);
  gestures.move([pointer(222, 212)]);
  assert.equal(gestures.end([]), 'outer');
  gestures.start([start], [target], fit);
  assert.equal(gestures.longPress(), true);
  assert.equal(gestures.locked, true);
  const change = gestures.move([pointer(240, 200)]);
  assert.deepEqual(change, { garmentId: 'top', transform: { offsetX: 10, offsetY: -5, scale: 1, rotationDeg: 0 } });
  assert.equal(gestures.end([]), '');
  assert.equal(gestures.locked, false);
  gestures.start([pointer(1, 1)], [target], fit);
  assert.equal(gestures.longPress(), false);
});

test('重叠内搭可先在列表选中后长按调整；轻点仍选最上层衣物', () => {
  const gestures = new GarmentGestures(), targets = [gestureTarget(), gestureTarget('outer')];
  gestures.start([pointer(100, 100)], targets, gestureFit, 'top');
  assert.equal(gestures.end([]), 'outer');
  gestures.start([pointer(100, 100)], targets, gestureFit, 'top');
  gestures.longPress();
  assert.equal(gestures.move([pointer(105, 110)]).garmentId, 'top');
});

test('旋转缩放后的命中使用逆变换，不误选矩形外的空白', () => {
  const target = gestureTarget('rotated', { scale: 2, rotationDeg: 90, offsetX: 10 });
  assert.equal(hitTestGarment(pointer(195, 100), [target], gestureFit)?.garmentId, 'rotated');
  assert.equal(hitTestGarment(pointer(110, 180), [target], gestureFit), undefined);
});

test('双指同时平移、放大与旋转，触点顺序变化保持指针身份', () => {
  const gestures = new GarmentGestures();
  gestures.start([pointer(80, 100), pointer(120, 100, 2)], [gestureTarget()], gestureFit);
  assert.equal(gestures.locked, true);
  const change = gestures.move([pointer(120, 150, 2), pointer(120, 70)]);
  assert.deepEqual(change.transform, { scale: 2, rotationDeg: 90, offsetX: 20, offsetY: 10 });
});

test('偏离衣物中心的双指缩放保持手指下的衣物位置，比例到边界后可立即反向', () => {
  const gestures = new GarmentGestures();
  gestures.start([pointer(100, 100), pointer(120, 100, 2)], [gestureTarget()], gestureFit);
  const first = gestures.move([pointer(90, 100), pointer(130, 100, 2)]).transform;
  assert.equal(first.scale, 2);
  assert.equal(first.offsetX, -10); // 以触点中点 110 为中心，而非衣物中心 100。
  const capped = gestures.move([pointer(0, 100), pointer(220, 100, 2)]).transform;
  assert.equal(capped.scale, 3);
  const reversed = gestures.move([pointer(10, 100), pointer(210, 100, 2)]).transform;
  assert.ok(reversed.scale < 3);
  assert.ok(Object.values(reversed).every(Number.isFinite));
});

test('拖动加入第二指不跳变；双指松开一指后等待全部松开，取消立即解锁', () => {
  const gestures = new GarmentGestures(), target = gestureTarget();
  gestures.start([pointer(100, 100)], [target], gestureFit);
  gestures.longPress();
  gestures.move([pointer(110, 110)]);
  gestures.start([pointer(110, 110), pointer(130, 110, 2)], [target], gestureFit);
  assert.equal(gestures.move([pointer(110, 110), pointer(130, 110, 2)]).transform.offsetX, 10);
  gestures.end([pointer(110, 110)]);
  assert.equal(gestures.locked, true);
  assert.equal(gestures.move([pointer(130, 140)]), undefined);
  gestures.end([]);
  assert.equal(gestures.locked, false);
  gestures.start([pointer(100, 100), pointer(120, 100, 2)], [target], gestureFit);
  gestures.cancel();
  assert.equal(gestures.locked, false);
  assert.equal(gestures.move([pointer(150, 150)]), undefined);
});

test('双指空白、过近触点及第三指不会产生无穷参数或意外操作', () => {
  for (const points of [[pointer(0, 0), pointer(10, 0, 2)], [pointer(100, 100), pointer(100, 100, 2)]]) {
    const gestures = new GarmentGestures();
    gestures.start(points, [gestureTarget()], gestureFit);
    assert.equal(gestures.locked, false);
    assert.equal(gestures.move([pointer(80, 100), pointer(120, 100, 2)]), undefined);
  }
  const gestures = new GarmentGestures();
  gestures.start([pointer(80, 100), pointer(120, 100, 2)], [gestureTarget()], gestureFit);
  assert.equal(gestures.move([pointer(100, 100), pointer(100, 100, 2)]), undefined);
  const resumed = gestures.move([pointer(80, 100), pointer(120, 100, 2)]);
  assert.deepEqual(resumed.transform, DEFAULT_TRANSFORM);
  gestures.start([pointer(80, 100), pointer(120, 100, 2), pointer(110, 110, 3)], [gestureTarget()], gestureFit);
  assert.equal(gestures.move([pointer(60, 100), pointer(140, 100, 2)]), undefined);
  gestures.end([]);
  assert.equal(gestures.locked, false);
});

test('试穿分类映射覆盖上装、下装、外套和独立连体装，不混入鞋履配饰或套装', () => {
  for (const group of CATEGORY_GROUPS) for (const type of group.types) {
    const layer = getTryOnLayer(garment('test', group.id, type.id));
    if (['tops', 'bottoms'].includes(group.id)) assert.ok(layer);
    if (['shoes', 'accessories'].includes(group.id) || type.id.endsWith('-set')) assert.equal(layer, undefined);
  }
  assert.equal(getTryOnLayer(top), 'top');
  assert.equal(getTryOnLayer(outer), 'outer');
  assert.equal(getTryOnLayer(bottom), 'bottom');
  assert.equal(getTryOnLayer(dress), 'one-piece');
});

test('组合、同层替换和双向连体装互斥保持外套，重复选择保留调整', () => {
  const session = new TryOnSession();
  for (const item of [outer, top, bottom]) session.wear(item);
  assert.deepEqual(session.list().map((item) => item.layer), ['bottom', 'top', 'outer']);
  session.adjust(top.id, { offsetX: 4, rotationDeg: 20 });
  session.wear(top);
  assert.equal(session.activeId, top.id);
  assert.equal(session.list().find((item) => item.garmentId === top.id).transform.offsetX, 4);
  assert.deepEqual(new Set(session.wear(dress)), new Set([top.id, bottom.id]));
  assert.deepEqual(session.list().map((item) => item.layer), ['one-piece', 'outer']);
  session.wear(top);
  assert.deepEqual(session.list().map((item) => item.layer), ['top', 'outer']);
  session.wear(bottom);
  session.wear(garment('new-top'));
  assert.equal(session.list().filter((item) => item.layer === 'top').length, 1);
  assert.equal(session.activeId, 'new-top');
  const snapshot = session.list();
  assert.throws(() => session.wear(garment('shoes', 'shoes', 'sneakers')), /暂不支持/);
  assert.deepEqual(session.list(), snapshot);
  for (const item of [dress, bottom, dress, top, outer, dress, top, bottom]) {
    session.wear(item);
    const layers = session.list().map((entry) => entry.layer);
    assert.equal(new Set(layers).size, layers.length);
    assert.ok(!layers.includes('one-piece') || (!layers.includes('top') && !layers.includes('bottom')));
    assert.ok(layers.includes('outer'));
  }
});

test('调整参数有限且等比，返回快照独立；重置、移除和清空保持选择有效', () => {
  const session = new TryOnSession();
  session.wear(top); session.wear(outer);
  session.adjust(top.id, { scale: 2.25, rotationDeg: -90, offsetX: 12.5, offsetY: -3 });
  const copy = session.list(); copy[0].transform.scale = 999; copy.pop();
  assert.equal(session.list()[0].transform.scale, 2.25);
  const before = session.list();
  assert.throws(() => session.adjust(top.id, { scale: NaN }), /无效/);
  assert.throws(() => session.adjust(top.id, { offsetY: Infinity }), /无效/);
  assert.deepEqual(session.list(), before);
  session.adjust(top.id, { scale: 999, offsetX: -999, rotationDeg: 999 });
  assert.deepEqual(session.list()[0].transform, { offsetX: -200, offsetY: -3, scale: 3, rotationDeg: 180 });
  session.reset(top.id);
  assert.deepEqual(session.list()[0].transform, DEFAULT_TRANSFORM);
  session.select(top.id); session.remove(top.id);
  assert.equal(session.activeId, outer.id);
  session.clear(); assert.deepEqual(session.list(), []); assert.equal(session.activeId, '');
});

test('衣橱删除或改分类后移除失效引用，修改照片保留调整', () => {
  const session = new TryOnSession();
  for (const item of [top, bottom, outer]) session.wear(item);
  session.adjust(outer.id, { offsetX: 5 });
  assert.deepEqual(new Set(session.reconcile([{ ...top, category: bottom.category }, { ...outer, image: { displayPath: 'new.png' } }])), new Set([top.id, bottom.id]));
  assert.equal(session.list().length, 1);
  assert.equal(session.list()[0].transform.offsetX, 5);
  session.reconcile([]); assert.equal(session.activeId, '');
});

test('默认衣物按人体锚点定位，不拉伸图片，不写回身材或调整参数', () => {
  for (const template of ['masculine', 'feminine']) for (const heightCm of [150, 175, 200]) {
    const body = buildBodyModel({ ...SAMPLE_BODY, template, heightCm });
    const original = structuredClone(body);
    for (const item of [top, bottom, outer, dress, garment('shorts', 'bottoms', 'shorts'), garment('coat', 'tops', 'coat')]) {
      for (const [width, height] of [[400, 600], [1000, 250], [200, 1000]]) {
        const placement = placeGarment(body, item, width, height);
        assert.ok(Math.abs(placement.width / placement.height - width / height) < 1e-9);
        assert.ok(placement.centerY - placement.height / 2 >= body.anchors.shoulderLeft.y - body.height * 0.025 - 1e-9);
        assert.ok(placement.centerY + placement.height / 2 <= body.height);
        assert.ok(Object.values(placement).every(Number.isFinite));
      }
    }
    assert.deepEqual(body, original);
  }
});

function matrixContext() {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], draws = [];
  const multiply = ([a, b, c, d, e, f]) => {
    const [A, B, C, D, E, F] = matrix;
    matrix = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F];
  };
  const methods = {
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    setTransform: (...args) => { matrix = args; }, save: () => stack.push([...matrix]), restore: () => { matrix = stack.pop(); },
    translate: (x, y) => multiply([1, 0, 0, 1, x, y]), scale: (x, y) => multiply([x, 0, 0, y, 0, 0]),
    rotate: (r) => multiply([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    drawImage: (image, ...rect) => draws.push({ src: image.src, matrix: [...matrix], rect }),
  };
  return { context: new Proxy(methods, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => { target[key] = value; return true; } }), draws };
}

test('Canvas 图层顺序和人体/衣物共用变换在不同尺寸、像素比及旋转缩放下保持一致', () => {
  const body = buildBodyModel(SAMPLE_BODY);
  const session = new TryOnSession();
  for (const item of [outer, top, bottom]) session.wear(item);
  session.adjust(top.id, { offsetX: 7, offsetY: -5, scale: 1.5, rotationDeg: 37 });
  const loaded = session.list().reverse().map((item) => ({ item: { ...item, garment: [top, bottom, outer].find((g) => g.id === item.garmentId) }, image: { src: item.garmentId, width: 400, height: 600 } }));
  const original = structuredClone(loaded);
  for (const [width, height, dpr] of [[300, 420, 1], [220, 600, 3], [720, 320, 2]]) {
    const { context, draws } = matrixContext();
    renderBodyCanvas({ getContext: () => context }, width, height, dpr, body, (ctx) => drawGarments(ctx, body, loaded, top.id));
    assert.deepEqual(draws.map((draw) => draw.src), ['bottom', 'top', 'outer']);
    for (const draw of draws) {
      const entry = loaded.find((entry) => entry.item.garmentId === draw.src);
      const placement = placeGarment(body, entry.item.garment, 400, 600);
      const fit = bodyCanvasTransform(body, width, height);
      const [a,b,c,d,e,f] = draw.matrix;
      assert.ok(Math.abs(Math.hypot(a,b) - Math.hypot(c,d)) < 1e-9);
      assert.ok(Math.abs(a*c+b*d) < 1e-9);
      assert.ok(Math.abs(e - ((placement.centerX+entry.item.transform.offsetX)*fit.scale+fit.translateX)*dpr) < 1e-9);
      assert.ok(Math.abs(f - ((placement.centerY+entry.item.transform.offsetY)*fit.scale+fit.translateY)*dpr) < 1e-9);
      assert.ok(Math.abs(Math.hypot(a,b) - dpr*fit.scale*entry.item.transform.scale) < 1e-9);
    }
  }
  assert.deepEqual(loaded, original);
});

function imageCanvas(outcomes = {}) {
  const images = [];
  const canvas = { createImage: () => {
    const image = { width: 400, height: 600, onload: () => {}, onerror: () => {},
      set src(path) { this.path = path; queueMicrotask(() => outcomes[path] === 'fail' ? this.onerror() : this.onload()); },
      get src() { return this.path; },
    };
    images.push(image); return image;
  } };
  return { canvas, images };
}

test('Canvas 图片缓存复用同一路径，坏图不在拖动时反复解码，手动清除后可重试', async () => {
  const { canvas, images } = imageCanvas({ 'bad.png': 'fail' });
  const cache = new CanvasImageCache(canvas);
  const [a,b] = await Promise.all([cache.load('ok.png'), cache.load('ok.png')]);
  assert.equal(a,b); assert.equal(images.length, 1);
  await assert.rejects(cache.load('bad.png'));
  await assert.rejects(cache.load('bad.png')); assert.equal(images.length, 2);
  cache.clear(); await assert.rejects(cache.load('bad.png')); assert.equal(images.length, 3);
  cache.retain([]); await cache.load('ok.png'); assert.equal(images.length, 4);
  cache.clear();
});

test('优先试衣贴图，损坏时回退照片并提示；全部失败不阻止其他衣物', async () => {
  const { canvas } = imageCanvas({ 'overlay.png': 'fail', 'broken.png': 'fail' });
  const items = [garment('a', 'tops', 'tshirt', 'overlay.png'), garment('broken'), outer]
    .map((garment) => ({ garment, garmentId: garment.id, layer: getTryOnLayer(garment), transform: { ...DEFAULT_TRANSFORM } }));
  const result = await loadGarmentImages(new CanvasImageCache(canvas), items);
  assert.deepEqual(result.loaded.map(({ image }) => image.src), ['a.png', 'outer.png']);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /已使用衣物照片/);
  assert.match(result.warnings[1], /重新选择/);
});

test('组件快速换衣时迟到图片不覆盖新组合，拖动按逻辑比例换算，卸载后不更新', async () => {
  let definition;
  globalThis.Component = (value) => { definition = value; };
  await import('../miniprogram/components/body-preview/index.ts');
  globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 2 }) };
  const { context, draws } = matrixContext();
  const images = [];
  const canvas = { getContext: () => context, createImage: () => {
    const image = { width: 400, height: 600, set src(path) { this.path=path; if(path.startsWith('/assets/mannequin/')){this.width=714;this.height=1920;queueMicrotask(()=>this.onload());}}, get src(){return this.path;} }; images.push(image); return image;
  } };
  const asItem = (garment) => ({ garment, garmentId: garment.id, layer: getTryOnLayer(garment), transform: { ...DEFAULT_TRANSFORM } });
  const changes = [];
  const instance = {
    data: structuredClone(definition.data), properties: { profile: SAMPLE_BODY, items: [asItem(top)], activeId: top.id, interactive: true },
    setData(patch) { Object.assign(this.data, patch); }, triggerEvent(name, detail) { changes.push({ name, detail }); },
    createSelectorQuery() { return { select() { return this; }, fields() { return this; }, exec(callback) { queueMicrotask(() => callback([{ node: canvas, width: 300, height: 420 }])); } }; },
  };
  for (const [key, method] of Object.entries(definition.methods)) instance[key] = method.bind(instance);
  definition.lifetimes.ready.call(instance); await tick();
  instance.properties.items = [asItem(outer)]; instance.properties.activeId = outer.id;
  instance.refresh(); await tick();
  images.find((image) => image.src === 'outer.png').onload(); await tick();
  assert.deepEqual(draws.filter(draw=>!draw.src.startsWith('/assets/mannequin/')).map((draw) => draw.src), ['outer.png']);
  images.find((image) => image.src === 'top.png').onload(); await tick();
  assert.deepEqual(draws.filter(draw=>!draw.src.startsWith('/assets/mannequin/')).map((draw) => draw.src), ['outer.png']);
  const scale = bodyCanvasTransform(buildBodyModel(SAMPLE_BODY), 300, 420).scale;
  const fit = bodyCanvasTransform(buildBodyModel(SAMPLE_BODY), 300, 420);
  const box = placeGarment(buildBodyModel(SAMPLE_BODY), outer, 400, 600);
  const x = box.centerX * scale + fit.translateX, y = box.centerY * scale + fit.translateY;
  instance.onTouchStart({ touches: [{ x, y, identifier: 1 }] });
  instance.onLongPress();
  assert.equal(instance.data.gestureLocked, true);
  instance.onTouchMove({ touches: [{ x: x+scale*5, y: y-scale*3, identifier: 1 }] });
  const changed = changes.find((change) => change.name === 'transformchange');
  assert.ok(Math.abs(changed.detail.offsetX - 5) < 1e-9);
  assert.ok(Math.abs(changed.detail.offsetY + 3) < 1e-9);
  instance.properties.items[0].transform = { ...changed.detail };
  const decodedCount = images.length, drawCount = draws.filter(draw=>!draw.src.startsWith('/assets/mannequin/')).length;
  assert.equal(instance.drawCurrent(), true);
  assert.equal(draws.filter(draw=>!draw.src.startsWith('/assets/mannequin/')).length, drawCount + 1);
  assert.equal(images.length, decodedCount);
  instance.onTouchEnd();
  assert.equal(instance.data.gestureLocked, false);
  instance.onTouchStart({ touches: [{ x: 2, y: 2, identifier: 1 }] });
  const count = changes.length;
  instance.onTouchMove({ touches: [{ x: 2, y: 100, identifier: 1 }] });
  instance.onTouchEnd();
  assert.equal(changes.length, count);
  instance.properties.interactive = false;
  instance.onTouchStart({ touches: [{ x, y, identifier: 1 }] });
  instance.onLongPress();
  assert.equal(instance.data.gestureLocked, false);
  instance.properties.interactive = true;
  instance.properties.items = [asItem(bottom)]; instance.refresh(); await tick();
  definition.lifetimes.detached.call(instance);
  const dataBefore = structuredClone(instance.data);
  images.find((image) => image.src === 'bottom.png').onload(); await tick();
  assert.deepEqual(instance.data, dataBefore);
  assert.deepEqual(draws.filter(draw=>!draw.src.startsWith('/assets/mannequin/')).map((draw) => draw.src), ['outer.png', 'outer.png']);
});

test('真实页面处理搜索、调整、跨页试穿和重读失败，不写入衣橱或身材记录', async () => {
  let pageDefinition, detailDefinition, storageFailed = false, writes = 0, modalConfirm = false;
  const stored = new Map([
    ['smart-wardrobe.garments.v1', { version: 1, garments: [top, bottom, outer, dress, garment('shoe', 'shoes', 'sneakers')] }],
    ['smart-wardrobe.body-profile.v1', { version: 1, profile: { ...SAMPLE_BODY, updatedAt: '2026-10-10T00:00:00Z' } }],
  ]);
  globalThis.wx = {
    getStorageSync: (key) => { if (storageFailed) throw new Error('读取失败'); return structuredClone(stored.get(key) || ''); },
    setStorageSync: () => { writes += 1; }, showToast: () => {}, switchTab: () => {},
    showModal: (options) => options.success({ confirm: modalConfirm }),
  };
  globalThis.Page = (value) => { pageDefinition = value; };
  await import('../miniprogram/pages/try-on/index.ts');
  globalThis.Page = (value) => { detailDefinition = value; };
  await import('../miniprogram/pages/garment-detail/index.ts');
  const instantiate = (definition) => {
    const instance = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') instance[name] = method.bind(instance);
    return instance;
  };
  const event = (id) => ({ currentTarget: { dataset: { id } } });
  tryOnSession.clear();
  const page = instantiate(pageDefinition);
  page.onShow(); assert.equal(page.data.hasProfile, true); assert.equal(page.data.catalog.length, 4);
  page.wear(event(top.id)); page.wear(event(bottom.id)); page.wear(event(outer.id));
  page.onGarmentSelect({ detail: { garmentId: top.id } });
  page.onTransformChange({ detail: { garmentId: top.id, offsetX: -1, offsetY: 0, scale: 1.4, rotationDeg: 23 } });
  assert.equal(page.data.renderItems.find((item) => item.garmentId === top.id).transform.scale, 1.4);
  page.onShow(); assert.equal(page.data.activeId, top.id); assert.equal(page.data.scalePercent, 140);
  page.onQueryInput({ detail: { value: '牛仔' } }); assert.deepEqual(page.data.catalog.map((item) => item.id), [bottom.id]);
  page.onQueryInput({ detail: { value: '' } }); page.setLayerFilter({ currentTarget: { dataset: { layer: 'outer' } } });
  assert.deepEqual(page.data.catalog.map((item) => item.id), [outer.id]);
  const detail = instantiate(detailDefinition);
  detail.onLoad({ id: dress.id }); detail.onShow(); assert.equal(detail.data.canTryOn, true);
  detail.tryOnGarment(); page.onShow();
  assert.equal(page.data.activeId, dress.id);
  assert.deepEqual(page.data.wearing.map((item) => item.id), [dress.id, outer.id]);
  const prior = tryOnSession.list(); storageFailed = true; page.onShow();
  assert.match(page.data.catalogError, /读取失败/); assert.deepEqual(tryOnSession.list(), prior);
  storageFailed = false; page.onShow();
  page.clearAll(); assert.deepEqual(tryOnSession.list(), prior);
  modalConfirm = true; page.clearAll(); assert.equal(page.data.wearing.length, 0);
  assert.equal(writes, 0);
});
