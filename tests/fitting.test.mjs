import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { SAMPLE_BODIES } from '../miniprogram/config/body.ts';
import { GarmentService } from '../miniprogram/services/garment-service.ts';
import { LocalGarmentRepository } from '../miniprogram/repositories/garment-repository.ts';
import { fittingError, fittingMatches } from '../miniprogram/utils/garment-fitting.ts';
import { suggestGarmentFitting } from '../miniprogram/rendering/garment-rig.ts';
import { buildBodyModel } from '../miniprogram/rendering/body-model.ts';
import { buildGarmentMesh, triangleArea, pointInTriangle } from '../miniprogram/rendering/garment-mesh.ts';
import { triangleMatrix, createMeshSurface } from '../miniprogram/rendering/draw-garment-mesh.ts';
import { hitTestGarment } from '../miniprogram/rendering/garment-gestures.ts';
import { alphaContent } from '../miniprogram/rendering/image-content.ts';
import { calibrationView, calibrationPoint, calibrationHandle } from '../miniprogram/rendering/draw-calibrator.ts';

const require = createRequire(import.meta.url), storageKey = 'smart-wardrobe.garments.v1';
const date = '2026-10-13T00:00:00.000Z';
const garment = (typeId = 'tshirt', groupId = 'tops') => ({ id: `g-${typeId}`, name: typeId, category: { groupId, typeId },
  image: { displayPath: `${typeId}.png` }, createdAt: date, updatedAt: date });
const content = { transparent: true, cutout: true, bodyWidthRatio: 0.6 };
const transform = { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 };
function entry(g, extra = {}) { return { item: { garment: g, garmentId: g.id, layer: g.category.groupId === 'bottoms' ? 'bottom' : 'top', transform: { ...transform } },
  image: { width: 400, height: 600 }, path: g.image.overlayPath || g.image.displayPath, content, ...extra }; }
function rig(g = garment()) { return suggestGarmentFitting(g, 400, 600, content); }
function storage(garments = []) {
  const saved = new Map([[storageKey, { version: 1, garments: structuredClone(garments) }]]);
  let fail = false, writes = 0;
  globalThis.wx = { getStorageSync: (key) => structuredClone(saved.get(key) || ''),
    setStorageSync: (key, value) => { if (fail) throw new Error('空间不足'); writes++; saved.set(key, structuredClone(value)); },
    showToast() {}, navigateBack() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} };
  return { saved, get writes() { return writes; }, fail(value) { fail = value; } };
}
function instantiate(definition) {
  const p = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') p[key] = value.bind(p);
  return p;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('旧衣橱兼容；校准深拷贝、普通编辑保留，换有效图片或品类自动失效', () => {
  const env = storage([garment()]), service = new GarmentService(new LocalGarmentRepository());
  let g = service.get('g-tshirt'); assert.equal(g.fitting, undefined);
  g = service.saveFitting(g.id, rig(g), g.updatedAt);
  const copy = service.get(g.id); copy.fitting.points.hemLeft.x = 0.123;
  assert.notEqual(service.get(g.id).fitting.points.hemLeft.x, 0.123);
  const original = structuredClone(g.fitting);
  g = service.update(g.id, { ...g, name: '改名', fitting: undefined });
  assert.deepEqual(g.fitting, original); assert.equal(g.name, '改名');
  g = service.update(g.id, { ...g, image: { displayPath: 'new.png' } }); assert.equal(g.fitting, undefined);
  g = service.saveFitting(g.id, rig(g), g.updatedAt);
  g = service.update(g.id, { ...g, category: { groupId: 'tops', typeId: 'shirt' } }); assert.equal(g.fitting, undefined);
  assert.ok(env.writes >= 5);
});

test('贴图不变时换展示照片保留校准；移除贴图后失效；无效或过期保存不覆盖记录', () => {
  const original = { ...garment(), image: { displayPath: 'photo.jpg', overlayPath: 'overlay.png' } };
  const env = storage([original]), service = new GarmentService(new LocalGarmentRepository());
  let g = service.saveFitting(original.id, rig(original), original.updatedAt);
  g = service.update(g.id, { ...g, image: { displayPath: 'new-photo.jpg', overlayPath: 'overlay.png' } });
  assert.equal(g.fitting.imagePath, 'overlay.png');
  const before = structuredClone(env.saved.get(storageKey)); env.fail(true);
  assert.throws(() => service.saveFitting(g.id, { ...g.fitting, ease: 'loose' }, g.updatedAt), /空间不足/);
  assert.deepEqual(env.saved.get(storageKey), before); env.fail(false);
  assert.throws(() => service.saveFitting(g.id, g.fitting, 'old'), /已修改/);
  assert.throws(() => service.saveFitting(g.id, { ...g.fitting, imagePath: 'other.png' }, g.updatedAt), /图片或品类/);
  assert.deepEqual(env.saved.get(storageKey), before);
  g = service.update(g.id, { ...g, image: { displayPath: 'new-photo.jpg' } }); assert.equal(g.fitting, undefined);
});

test('坏校准快照拒绝写入；交叉、缺点、NaN 和未知点明确报错，原图模式可关闭变形', () => {
  const g = garment(), f = rig(g);
  assert.equal(fittingError(f), '');
  for (const points of [{ ...f.points, hemLeft: { x: NaN, y: 1 } }, { ...f.points, hemLeft: undefined },
    { ...f.points, arbitrary: { x: 0, y: 0 } }, { ...f.points, shoulderLeft: { x: 0.9, y: 0.05 } }]) {
    const bad = { ...f, points }; assert.ok(fittingError(bad));
    const env = storage([{ ...g, fitting: bad }]);
    assert.throws(() => new LocalGarmentRepository().remove(g.id), /格式异常/); assert.equal(env.writes, 0);
  }
  const crossed = { ...f, points: { ...f.points, shoulderLeft: { x: 0.9, y: 0.05 } }, mode: 'original' };
  assert.equal(fittingError(crossed), ''); assert.equal(buildGarmentMesh(buildBodyModel(SAMPLE_BODIES.masculine), entry({ ...g, fitting: crossed })), undefined);
});

test('男/女和各类衣物的网格有限、不翻折；来源与身材记录不被修改', () => {
  const types = [['tops', 'tshirt'], ['tops', 'shirt'], ['tops', 'vest'], ['tops', 'coat'], ['bottoms', 'jeans'],
    ['bottoms', 'shorts'], ['bottoms', 'skirt'], ['one-piece', 'dress']];
  for (const profile of Object.values(SAMPLE_BODIES)) for (const [group, type] of types) for (const ease of ['fitted', 'regular', 'loose']) {
    const g = garment(type, group); g.fitting = { ...rig(g), ease };
    const body = buildBodyModel(profile), input = entry(g), before = structuredClone({ body, input });
    const mesh = buildGarmentMesh(body, input); assert.ok(mesh, `${profile.template}/${type}/${ease}`);
    assert.ok(mesh.triangles.length > 50 && mesh.triangles.length < 500);
    for (const triangle of mesh.triangles) {
      assert.ok(triangleArea(...triangle.map((v) => v.source)) * triangleArea(...triangle.map((v) => v.target)) > 0);
      assert.ok(triangle.flatMap((v) => [v.source.x, v.source.y, v.target.x, v.target.y]).every(Number.isFinite));
    }
    assert.deepEqual({ body, input }, before);
  }
});

test('肩宽、腰围和余量分别驱动网格，袖长独立于衣身长度，无袖不生成袖片', () => {
  const g = garment('shirt'); g.fitting = rig(g);
  const a = buildGarmentMesh(buildBodyModel(SAMPLE_BODIES.feminine), entry(g));
  const b = buildGarmentMesh(buildBodyModel({ ...SAMPLE_BODIES.feminine, waistCm: 85, shoulderWidthCm: 44 }), entry(g));
  assert.notDeepEqual(a.triangles.map((t) => t.map((v) => v.target)), b.triangles.map((t) => t.map((v) => v.target)));
  assert.deepEqual(a.triangles.map((t) => t.map((v) => v.source)), b.triangles.map((t) => t.map((v) => v.source)));
  const loose = buildGarmentMesh(buildBodyModel(SAMPLE_BODIES.feminine), entry({ ...g, fitting: { ...g.fitting, ease: 'loose' } }));
  assert.ok(loose.placement.width > a.placement.width);
  const short = buildGarmentMesh(buildBodyModel(SAMPLE_BODIES.feminine), entry({ ...g, fitting: { ...g.fitting, sleeve: 'short' } }));
  const none = buildGarmentMesh(buildBodyModel(SAMPLE_BODIES.feminine), entry({ ...g, fitting: { ...g.fitting, sleeve: 'none' } }));
  assert.ok(short.triangles.length < a.triangles.length); assert.ok(none.triangles.length < short.triangles.length);
  assert.ok(none.placement.width < short.placement.width);
});

test('仿射矩阵精确映射三个顶点，非等比与旋转均成立，退化片安全跳过', () => {
  const triangle = [{ source: { x: 12, y: 33 }, target: { x: -8, y: 17 } },
    { source: { x: 80, y: 50 }, target: { x: 4, y: 22 } }, { source: { x: 22, y: 120 }, target: { x: -14, y: 49 } }];
  const [a, b, c, d, e, f] = triangleMatrix(triangle);
  for (const v of triangle) { assert.ok(Math.abs(a * v.source.x + c * v.source.y + e - v.target.x) < 1e-9); assert.ok(Math.abs(b * v.source.x + d * v.source.y + f - v.target.y) < 1e-9); }
  assert.equal(triangleMatrix([triangle[0], triangle[0], triangle[1]]), undefined);
});

test('裤腿中间空隙不抢占滚屏；旋转/缩放后网格命中与绘制使用同一几何', () => {
  const g = garment('jeans', 'bottoms'); g.fitting = rig(g);
  const body = buildBodyModel(SAMPLE_BODIES.feminine), mesh = buildGarmentMesh(body, entry(g));
  const triangles = mesh.triangles.map((t) => t.map((v) => v.target));
  const target = { garmentId: g.id, placement: mesh.placement, triangles, transform: { ...transform, scale: 1.3, rotationDeg: 27, offsetX: 4, offsetY: -2 } };
  const fit = { scale: 2, translateX: 120, translateY: 30 };
  const screen = (p) => { const dx = p.x - mesh.placement.centerX, dy = p.y - mesh.placement.centerY, r = 27 * Math.PI / 180;
    return { x: (mesh.placement.centerX + 4 + (dx * Math.cos(r) - dy * Math.sin(r)) * 1.3) * 2 + 120,
      y: (mesh.placement.centerY - 2 + (dx * Math.sin(r) + dy * Math.cos(r)) * 1.3) * 2 + 30, identifier: 1 }; };
  assert.equal(hitTestGarment(screen({ x: 0, y: body.anchors.knee.y }), [target], fit), undefined);
  const tri = triangles[0], inside = { x: (tri[0].x + tri[1].x + tri[2].x) / 3, y: (tri[0].y + tri[1].y + tri[2].y) / 3 };
  assert.ok(pointInTriangle(inside, tri)); assert.equal(hitTestGarment(screen(inside), [target], fit).garmentId, g.id);
});

test('透明边框的矩形照片不自动变形，真正有透明轮廓才估算；坏手动标记不被自动值掩盖', () => {
  const data = new Uint8ClampedArray(100 * 120 * 4);
  for (let y = 10; y < 110; y++) for (let x = 10; x < 90; x++) data.set([255, 255, 255, 255], (y * 100 + x) * 4);
  let a = alphaContent(data, 100, 120); assert.equal(a.transparent, true); assert.equal(a.cutout, false);
  const g = garment(), body = buildBodyModel(SAMPLE_BODIES.masculine);
  assert.equal(buildGarmentMesh(body, entry(g, { content: { transparent: true, cutout: false } })), undefined);
  assert.ok(buildGarmentMesh(body, entry(g)));
  const bad = rig(g); bad.points.armpitLeft.y = 0;
  assert.equal(buildGarmentMesh(body, entry({ ...g, fitting: bad })), undefined);
  assert.equal(buildGarmentMesh(body, entry(garment('jumpsuit', 'one-piece'))), undefined);
});

test('标记坐标正确处理图片留白、屏幕适配、边缘限制与命中距离', () => {
  const f = rig(), view = calibrationView(400, 600, 300, 350);
  const p = f.points.hemLeft, x = view.x + p.x * 400 * view.scale, y = view.y + p.y * 600 * view.scale;
  const normalized = calibrationPoint(x, y, view);
  assert.ok(Math.abs(normalized.x - p.x) < 1e-9 && Math.abs(normalized.y - p.y) < 1e-9);
  assert.equal(calibrationHandle(f, x, y, view), 'hemLeft');
  assert.deepEqual(calibrationPoint(-100, 10000, view), { x: 0, y: 1 });
  assert.equal(calibrationHandle(f, 0, 0, view), undefined);
});

test('真实校准页草稿不落库，错误/失败保留输入，成功重读复用，离开后无隐式保存', () => {
  const g = garment(), env = storage([g]); let definition, alerts = 0, disabled = 0, back = 0;
  Object.assign(wx, { enableAlertBeforeUnload: () => alerts++, disableAlertBeforeUnload: () => disabled++, navigateBack: () => back++ });
  globalThis.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/garment-fitting/index.ts'); delete require.cache[file]; require(file); delete require.cache[file];
  const p = instantiate(definition); p.onLoad({ id: g.id }); p.onImageInfo({ detail: { width: 400, height: 600, content } });
  assert.equal(p.data.loadError, ''); assert.equal(env.writes, 0); assert.equal(p.data.imageReady, true);
  p.onChoice({ currentTarget: { dataset: { field: 'ease' } }, detail: { value: '2' } });
  p.onPointChange({ detail: { key: 'hemLeft', point: { ...p.data.fitting.points.hemLeft, x: 0.15 } } });
  assert.equal(alerts, 1); assert.equal(env.writes, 0);
  p.onPointChange({ detail: { key: 'shoulderLeft', point: { x: 0.9, y: 0.05 } } }); p.saveFitting();
  assert.ok(p.data.error); assert.equal(env.writes, 0); p.resetPoints();
  env.fail(true); p.saveFitting(); assert.match(p.data.error, /空间不足/); assert.equal(p.data.dirty, true); assert.equal(back, 0);
  env.fail(false); p.saveFitting(); assert.equal(env.writes, 1); assert.equal(back, 1); assert.equal(disabled, 1);
  const reopened = instantiate(definition); reopened.onLoad({ id: g.id });
  assert.equal(reopened.data.fitting.ease, 'loose'); reopened.onUnload(); p.onUnload(); assert.equal(env.writes, 1);
});

function graphicsContext() {
  return new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) },
  { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
}
test('网格离屏缓存只在换图/校准时重建，连续手势复用；旧图片失败仍可回退', async () => {
  let definition, surfaces = 0, decoding = 0;
  const ctx = graphicsContext(), canvas = { width: 0, height: 0, getContext: () => ctx, createImage: () => {
    decoding++; return { width: 400, height: 600, set src(path) { this.path = path; if (path.startsWith('/assets/mannequin/')) { this.width=669; this.height=1920; } queueMicrotask(() => this.onload()); }, get src() { return this.path; } };
  } };
  globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 2 }), createOffscreenCanvas: ({ width, height }) => { surfaces++; return { width, height, getContext: () => graphicsContext() }; } };
  globalThis.Component = (value) => { definition = value; };
  await import('../miniprogram/components/body-preview/index.ts');
  const g = garment(); g.fitting = rig(g);
  const c = { data: structuredClone(definition.data), properties: { profile: SAMPLE_BODIES.feminine, items: [entry(g).item], activeId: g.id, interactive: true },
    setData(patch) { Object.assign(this.data, patch); }, triggerEvent() {}, createSelectorQuery() { return { select() { return this; }, fields() { return this; }, exec(fn) { fn([{ node: canvas, width: 300, height: 420 }]); } }; } };
  for (const [key, fn] of Object.entries(definition.methods)) c[key] = fn.bind(c);
  definition.lifetimes.ready.call(c); await tick(); await tick();
  assert.equal(c.data.renderError, ''); assert.deepEqual(c.data.warnings, []); assert.ok(surfaces >= 2);
  const count = surfaces;
  for (let i = 0; i < 50; i++) { c.properties.items[0].transform.offsetX = i / 20; assert.equal(c.drawCurrent(), true); }
  assert.equal(surfaces, count); assert.equal(decoding, 2);
  c.properties.items[0].garment.fitting = { ...g.fitting, ease: 'loose' }; assert.equal(c.drawCurrent(), false); c.refresh(); await tick(); await tick();
  assert.equal(decoding, 2); assert.equal(surfaces, count + 1); assert.equal(c.data.renderError, '');
  definition.lifetimes.detached.call(c);
  wx.createOffscreenCanvas = () => { throw new Error('不支持离屏'); };
  assert.equal(createMeshSurface({}, {}), undefined);
});

test('校准画布空白滑动不改点，命中标记才禁滚，第二指和取消立即解锁', async () => {
  let definition; const events = [], image = { width: 400, height: 600 };
  const ctx = graphicsContext(), canvas = { width: 0, height: 0, getContext: () => ctx, createImage: () => ({ ...image, set src(_) { queueMicrotask(() => this.onload()); } }) };
  globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 2 }) }; globalThis.Component = (value) => { definition = value; };
  await import('../miniprogram/components/garment-calibrator/index.ts');
  const f = rig(); const c = { data: structuredClone(definition.data), properties: { imagePath: 'tshirt.png', fitting: f, active: 'hemLeft' },
    setData(p) { Object.assign(this.data, p); }, triggerEvent(name, detail) { events.push({ name, detail }); },
    createSelectorQuery() { return { select() { return this; }, fields() { return this; }, exec(fn) { fn([{ node: canvas, width: 300, height: 350 }]); } }; } };
  for (const [key, fn] of Object.entries(definition.methods)) c[key] = fn.bind(c);
  definition.lifetimes.ready.call(c); await tick(); await tick();
  c.onTouchStart({ touches: [{ x: 2, y: 2, identifier: 1 }] }); c.onTouchMove({ touches: [{ x: 2, y: 50, identifier: 1 }] }); c.onTouchEnd({ touches: [] });
  assert.equal(c.data.dragging, false); assert.equal(events.filter((e) => e.name === 'pointchange').length, 0);
  const view = calibrationView(400, 600, 300, 350), p = f.points.hemLeft;
  const touch = { x: view.x + p.x * 400 * view.scale, y: view.y + p.y * 600 * view.scale, identifier: 1 };
  c.onTouchStart({ touches: [touch] }); assert.equal(c.data.dragging, true);
  c.onTouchMove({ touches: [{ ...touch, x: touch.x + 10 }] }); assert.equal(events.filter((e) => e.name === 'pointchange').length, 1);
  c.onTouchStart({ touches: [touch, { ...touch, identifier: 2 }] }); assert.equal(c.data.dragging, false);
  c.onTouchEnd({ touches: [] }); assert.equal(events.filter((e) => e.name === 'pointchange').length, 1);
  definition.lifetimes.detached.call(c);
});
