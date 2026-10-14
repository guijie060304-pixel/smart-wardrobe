import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { CutoutMask, limitedSize, maskedPixels, resizeMask, visibleBounds } from '../miniprogram/utils/cutout-mask.ts';
import { segmentGarment, CutoutCancelled } from '../miniprogram/utils/cutout-segmentation.ts';
import { imagePoint, pinchView } from '../miniprogram/rendering/cutout-editor.ts';
import { saveGarmentImages, garmentImagePaths } from '../miniprogram/services/image-service.ts';
import { GarmentService } from '../miniprogram/services/garment-service.ts';
import { LocalGarmentRepository } from '../miniprogram/repositories/garment-repository.ts';
import { suggestGarmentFitting } from '../miniprogram/rendering/garment-rig.ts';
import { exportCutout } from '../miniprogram/services/cutout-export.ts';
const require = createRequire(import.meta.url);
const { createCutoutSession, deliverCutoutResult, closeCutoutSession, getCutoutSource } = require('../miniprogram/services/cutout-session.ts');
const key = 'smart-wardrobe.garments.v1', timestamp = '2026-10-13T00:00:00.000Z';
function fixture(size = 64) {
  const pixels = new Uint8ClampedArray(size * size * 4), truth = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const body = x >= size * .3 && x < size * .7 && y >= size * .25 && y < size * .85;
    const sleeves = x >= size * .15 && x < size * .85 && y >= size * .25 && y < size * .45;
    const neck = x >= size * .45 && x < size * .55 && y < size * .35;
    const foreground = (body || sleeves) && !neck, i = y * size + x;
    const color = foreground ? [35, 90 + (x % 3) * 3, 165] : [220 + (y % 3) * 3, 210, 190];
    pixels.set([...color, 255], i * 4); truth[i] = foreground ? 255 : 0;
  }
  return { pixels, width: size, height: size, rect: { x: size * .1, y: size * .15, width: size * .8, height: size * .75 }, truth };
}
function page(definition) {
  const p = { data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
  for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') p[name] = method.bind(p);
  return p;
}
let formDefinition, cutoutDefinition;
globalThis.Page = (definition) => { formDefinition = definition; };
require('../miniprogram/pages/garment-form/index.ts');
globalThis.Page = (definition) => { cutoutDefinition = definition; };
require('../miniprogram/pages/garment-cutout/index.ts');
function environment(garments = []) {
  let snapshot = { version: 1, garments: structuredClone(garments) }, fail = false;
  const copies = [], removed = [], dialogs = [], navigation = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' }, getStorageSync: (k) => k === key ? structuredClone(snapshot) : '',
    setStorageSync: (_k, value) => { if (fail) throw new Error('空间不足'); snapshot = structuredClone(value); },
    getImageInfo: ({ success }) => success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: (o) => { copies.push(o); o.success(); }, unlink: (o) => { removed.push(o.filePath); o.success(); } }),
    showLoading() {}, hideLoading() {}, showToast() {}, navigateBack() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    navigateTo: (o) => navigation.push(o), showModal: (o) => dialogs.push(o),
  };
  return { copies, removed, dialogs, navigation, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; }, set fail(value) { fail = value; } };
}
const garment = () => ({ id: 'g', name: '上衣', category: { groupId: 'tops', typeId: 'tshirt' }, image: { displayPath: '/user/garment_old.png' }, createdAt: timestamp, updatedAt: timestamp });

test('图割保留有花纹的衣身和细袖、删除框内背景及领口，结果可重复', async () => {
  const input = fixture(), result = await segmentGarment(input), repeat = await segmentGarment(input);
  assert.deepEqual(result, repeat);
  const correct = result.reduce((sum, value, i) => sum + (value === input.truth[i] ? 1 : 0), 0);
  assert.ok(correct / result.length > .98, `correct ${correct / result.length}`);
});
test('杂乱背景与相近颜色时用户前/背景标记保持硬约束', async () => {
  const input = fixture(), seeds = new Uint8Array(input.width * input.height);
  seeds[2 * input.width + 2] = 1; seeds[35 * input.width + 30] = 2;
  const result = await segmentGarment({ ...input, seeds });
  assert.equal(result[2 * input.width + 2], 255); assert.equal(result[35 * input.width + 30], 0);
  const same = fixture(24); same.pixels.fill(245); for (let i = 3; i < same.pixels.length; i += 4) same.pixels[i] = 255;
  const constraints = new Uint8Array(24 * 24); constraints[12 * 24 + 12] = 1; constraints[0] = 2;
  const uncertain = await segmentGarment({ ...same, seeds: constraints }); assert.equal(uncertain[300], 255); assert.equal(uncertain[0], 0);
});
test('原生透明区域不会被保留标记变回不透明，取消/超时/坏框选明确退出', async () => {
  const input = fixture(32), seeds = new Uint8Array(32 * 32); seeds[16 * 32 + 16] = 1; input.pixels[(16 * 32 + 16) * 4 + 3] = 0;
  const result = await segmentGarment({ ...input, seeds }); assert.equal(result[16 * 32 + 16], 0);
  await assert.rejects(segmentGarment({ ...input, cancelled: () => true }), CutoutCancelled);
  await assert.rejects(segmentGarment({ ...input, timeoutMs: 0 }), /手动圈选/);
  input.pixels[(16 * 32 + 16) * 4 + 3] = 255;
  await assert.rejects(segmentGarment({ ...input, rect: { x: 0, y: 0, width: 32, height: 32 } }), /框外/);
});
test('大图限制为256分析/1024输出，小图不放大；蒙版缩放保留边界', () => {
  assert.deepEqual(limitedSize(4000, 3000, 1024), { width: 1024, height: 768 });
  assert.deepEqual(limitedSize(200, 100, 256), { width: 200, height: 100 });
  assert.throws(() => limitedSize(0, 100, 1024), /尺寸/);
  assert.deepEqual(Array.from(resizeMask(new Uint8Array([0, 255]), 2, 1, 4, 1)), [0, 0, 255, 255]);
});
test('保留/擦除笔是连续圆头笔画，撤销恢复蒙版与硬标记，取消不留误笔', () => {
  const editor = new CutoutMask(40, 40); editor.begin(); editor.stroke({ x: 5, y: 5 }, { x: 30, y: 5 }, 2, false); editor.commit();
  assert.equal(editor.mask[5 * 40 + 15], 0); assert.equal(editor.seeds[5 * 40 + 15], 2);
  editor.begin(); editor.stroke({ x: 15, y: 5 }, { x: 15, y: 5 }, 1, true); editor.cancel(); assert.equal(editor.mask[215], 0);
  editor.undo(); assert.equal(editor.mask[215], 255); assert.equal(editor.seeds[215], 0); assert.equal(editor.canUndo, false);
  for (let i = 0; i < 12; i++) { editor.begin(); editor.stroke({ x: i, y: 20 }, { x: i, y: 20 }, .1, false); editor.commit(); }
  for (let i = 0; i < 10; i++) editor.undo(); assert.equal(editor.canUndo, false); assert.equal(editor.mask[800], 0); assert.equal(editor.mask[802], 255);
});
test('手动凹轮廓圈选支持擦除领口/衣架，再保留补回；重置可撤销', () => {
  const editor = new CutoutMask(20, 20); editor.polygon([{ x: 3, y: 3 }, { x: 17, y: 3 }, { x: 17, y: 17 }, { x: 10, y: 10 }, { x: 3, y: 17 }]);
  assert.equal(editor.mask[0], 0); assert.equal(editor.mask[5 * 20 + 5], 255); assert.equal(editor.mask[16 * 20 + 10], 0);
  editor.begin(); editor.stroke({ x: 10, y: 5 }, { x: 10, y: 5 }, 2, false); editor.commit();
  const before = editor.mask.slice(); editor.reset(); assert.equal(editor.mask[0], 255); editor.undo(); assert.deepEqual(editor.mask, before);
});
test('白衣白底、深衣深底和半透明像素只根据蒙版变化，不按颜色删除衣物', () => {
  for (const color of [0, 255]) {
    const source = new Uint8ClampedArray(8 * 8 * 4).fill(color); for (let i = 3; i < source.length; i += 4) source[i] = 128;
    const mask = new Uint8Array(64).fill(255); mask[0] = 0;
    const result = maskedPixels(source, mask, 8, 8); assert.equal(result[3], 0); assert.equal(result[7], 128); assert.equal(result[4], color);
    assert.equal(source[3], 128); assert.throws(() => visibleBounds(new Uint8ClampedArray(256), 8, 8), /没有可见衣物/);
  }
});
test('边缘软化仅一像素，不填满领口；裁切留白带两像素余量', () => {
  const source = new Uint8ClampedArray(20 * 20 * 4).fill(255), mask = new Uint8Array(400);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * 20 + x] = 255;
  mask[10 * 20 + 10] = 0; mask[10 * 20 + 11] = 0;
  const pixels = maskedPixels(source, mask, 20, 20, true); assert.ok(pixels[(5 * 20 + 5) * 4 + 3] < 255);
  assert.deepEqual(visibleBounds(pixels, 20, 20), { x: 2, y: 2, width: 16, height: 16 });
});
test('缩放平移后落笔准确，双指中点对应图像锚点不跳动，倍率有限', () => {
  const view = { width: 300, height: 400, imageWidth: 1000, imageHeight: 800, zoom: 1, panX: 0, panY: 0 };
  const before = [{ x: 80, y: 140 }, { x: 180, y: 140 }], after = [{ x: 60, y: 170 }, { x: 260, y: 170 }];
  const next = pinchView(view, before, after), anchor = imagePoint({ x: 130, y: 140 }, view);
  assert.equal(next.zoom, 2); const actual = imagePoint({ x: 160, y: 170 }, next);
  assert.ok(Math.abs(anchor.x - actual.x) < 1e-6); assert.ok(Math.abs(anchor.y - actual.y) < 1e-6);
  assert.equal(pinchView(view, before, [{ x: -5000, y: 140 }, { x: 5000, y: 140 }]).zoom, 6);
});
test('PNG导出使用透明像素与实际裁切尺寸，全透明结果不调用导出接口', async () => {
  let options, written; const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (value) => { written = value.data; } };
  const canvas = { getContext: () => context }, source = new Uint8ClampedArray(16 * 16 * 4).fill(255), mask = new Uint8Array(256);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) mask[y * 16 + x] = 255;
  globalThis.wx = { canvasToTempFilePath: (o) => { options = o; o.success({ tempFilePath: '/tmp/cut.png' }); } };
  assert.equal(await exportCutout(canvas, source, mask, 16, 16), '/tmp/cut.png'); assert.equal(options.fileType, 'png');
  assert.equal(options.destWidth, canvas.width); assert.ok(written.some((value, i) => i % 4 === 3 && value === 0));
  options = undefined; await assert.rejects(exportCutout(canvas, source, new Uint8Array(256), 16, 16), /没有可见/); assert.equal(options, undefined);
});
test('会话只保存在内存，取消/消费后不能再回传；过期结果不调用接收方', () => {
  let count = 0; const id = createCutoutSession('/tmp/source.png', () => { count++; return true; });
  assert.equal(getCutoutSource(id), '/tmp/source.png'); assert.equal(deliverCutoutResult(id, '/tmp/result.png'), true);
  assert.equal(deliverCutoutResult(id, '/tmp/late.png'), false); assert.equal(count, 1);
  const second = createCutoutSession('photo', () => { count++; return true; }); closeCutoutSession(second); assert.equal(deliverCutoutResult(second, 'result'), false); assert.equal(count, 1);
});
test('展示与试衣共用PNG仅复制一次，原图另存；复制中途失败回滚新文件', async () => {
  const env = environment(), image = { displayPath: '/tmp/cut.png', overlayPath: '/tmp/cut.png', originalPath: '/tmp/source.jpg' };
  const result = await saveGarmentImages(image, new Set(garmentImagePaths(image)));
  assert.equal(env.copies.length, 2); assert.equal(result.image.displayPath, result.image.overlayPath); assert.notEqual(result.image.originalPath, result.image.displayPath);
  let n = 0; wx.getFileSystemManager = () => ({ copyFile: (o) => { if (++n === 2) o.fail({ errMsg: '空间不足' }); else o.success(); }, unlink: (o) => { env.removed.push(o.filePath); o.success(); } });
  await assert.rejects(saveGarmentImages(image, new Set(garmentImagePaths(image))), /空间不足/); assert.equal(env.removed.length, 1);
});
test('旧v1数据兼容，原图路径拷贝隔离，抠图更换有效图后清除校准，过期保存拒绝', () => {
  const old = garment(); old.fitting = suggestGarmentFitting(old, 300, 400, { transparent: true, cutout: true });
  const env = environment([old]), service = new GarmentService(new LocalGarmentRepository());
  assert.equal(service.get('g').image.originalPath, undefined);
  const image = { displayPath: '/user/garment_cut.png', overlayPath: '/user/garment_cut.png', originalPath: old.image.displayPath };
  const updated = service.update('g', { ...old, image }, old.updatedAt); assert.equal(updated.fitting, undefined);
  const read = service.get('g'); read.image.originalPath = 'wrong'; assert.equal(service.get('g').image.originalPath, old.image.displayPath);
  assert.throws(() => service.update('g', old, old.updatedAt), /衣物已修改/); assert.equal(env.snapshot.garments[0].image.displayPath, image.displayPath);
});
test('抠图只更新表单；保存后统一透明图且原照片不被清理，失败仍保留草稿可重试', async () => {
  const old = garment(), env = environment([old]), form = page(formDefinition); form.onLoad({ id: 'g' });
  form.openCutout(); const id = new URLSearchParams(env.navigation[0].url.split('?')[1]).get('session');
  assert.equal(deliverCutoutResult(id, '/tmp/cut.png'), true); assert.deepEqual(env.snapshot.garments[0], old);
  assert.equal(form.data.originalPath, old.image.displayPath); assert.equal(form.data.imagePath, form.data.overlayPath);
  env.fail = true; await form.saveGarment(); assert.deepEqual(env.snapshot.garments[0], old); assert.equal(env.removed.length, 1); assert.equal(form.data.imagePath, '/tmp/cut.png');
  env.fail = false; await form.saveGarment(); const saved = env.snapshot.garments[0];
  assert.equal(saved.image.displayPath, saved.image.overlayPath); assert.equal(saved.image.originalPath, old.image.displayPath); assert.ok(!env.removed.includes(old.image.displayPath));
});
test('恢复原图在确认保存后生效，旧PNG共享路径只删除一次', async () => {
  const old = garment(); old.image = { displayPath: '/user/garment_cut.png', overlayPath: '/user/garment_cut.png', originalPath: '/user/garment_source.png' };
  const env = environment([old]), form = page(formDefinition); form.onLoad({ id: 'g' }); form.restoreOriginal(); env.dialogs[0].success({ confirm: true });
  assert.equal(env.snapshot.garments[0].image.displayPath, old.image.displayPath); await form.saveGarment();
  assert.equal(env.snapshot.garments[0].image.displayPath, old.image.originalPath); assert.equal(env.snapshot.garments[0].image.overlayPath, undefined);
  assert.deepEqual(env.removed, [old.image.displayPath]); assert.equal(env.copies.length, 0);
});
test('更换/移除图片或表单卸载后，迟到抠图结果不能覆盖新草稿', () => {
  const env = environment([garment()]), form = page(formDefinition); form.onLoad({ id: 'g' }); form.openCutout();
  const id = new URLSearchParams(env.navigation[0].url.split('?')[1]).get('session'); form.removeDisplayImage();
  assert.equal(deliverCutoutResult(id, '/tmp/late.png'), false); assert.equal(form.data.imagePath, '');
  const next = page(formDefinition); next.onLoad({ id: 'g' }); next.openCutout(); const second = new URLSearchParams(env.navigation[1].url.split('?')[1]).get('session'); next.onUnload();
  assert.equal(getCutoutSource(second), undefined); assert.equal(deliverCutoutResult(second, '/tmp/late.png'), false);
});
test('异步复制期间衣物被修改/页面关闭时拒绝提交并回滚新文件', async () => {
  const env = environment([garment()]), form = page(formDefinition); form.onLoad({ id: 'g' }); form.setData({ imagePath: '/tmp/new.png', imageDirty: true });
  let copy; wx.getFileSystemManager = () => ({ copyFile: (o) => { copy = o; }, unlink: (o) => { env.removed.push(o.filePath); o.success(); } });
  const pending = form.saveGarment(); const changed = garment(); changed.name = '新名称'; changed.updatedAt = '2026-10-14T00:00:00.000Z'; env.snapshot = { version: 1, garments: [changed] };
  copy.success(); await pending; assert.equal(env.snapshot.garments[0].name, '新名称'); assert.equal(env.removed.length, 1);
  const second = page(formDefinition); second.onLoad({ id: 'g' }); second.setData({ imagePath: '/tmp/closed.png', imageDirty: true });
  const closing = second.saveGarment(); second.onUnload(); copy.success(); await closing; assert.equal(env.snapshot.garments[0].image.displayPath, changed.image.displayPath); assert.equal(env.removed.length, 2);
});

async function editorEnvironment(size = 64) {
  const input = fixture(size); let exported = 0;
  const makeCanvas = () => {
    const canvas = { width: size, height: size, getContext: () => context,
      createImage: () => { const image = { width: size, height: size }; Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload()); } }); return image; },
      requestAnimationFrame: (callback) => setTimeout(callback, 0), cancelAnimationFrame: (id) => clearTimeout(id) };
    const context = { pixels: input.pixels.slice(), drawImage() {}, getImageData: () => ({ data: context.pixels.slice(), width: canvas.width, height: canvas.height }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: (data) => { context.pixels = data.data.slice(); },
      setTransform() {}, fillRect() {}, save() {}, translate() {}, scale() {}, restore() {}, strokeRect() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    return canvas;
  };
  const visible = makeCanvas(), work = makeCanvas(), output = makeCanvas();
  globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 1 }), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, navigateBack() {},
    canvasToTempFilePath: (o) => { exported++; o.success({ tempFilePath: '/tmp/edited.png' }); } };
  const p = page(cutoutDefinition), id = createCutoutSession('/tmp/source.png', () => true);
  p.createSelectorQuery = () => { let count = 0; const query = { select() { count++; return query; }, fields() { return query; }, exec(callback) {
    callback(count === 3 ? [{ node: visible, width: 128, height: 128 }, { node: work }, { node: output }] : [{ width: 128, height: 128 }]);
  } }; return query; };
  p.onLoad({ session: id }); p.onReady(); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(p.data.ready, true);
  const touch = (x, y, identifier = 1) => ({ x, y, identifier });
  return { p, input, work, output, touch, get exported() { return exported; } };
}
test('编辑器双指介入撤回未完成的擦除笔，剩余单指不再落笔', async () => {
  const { p, work, touch } = await editorEnvironment(); p.selectTool({ currentTarget: { dataset: { tool: 'erase' } } });
  p.onTouchStart({ touches: [touch(64, 64)] }); p.draw(); assert.equal(work.getContext().pixels[(32 * 64 + 32) * 4 + 3], 0);
  p.onTouchStart({ touches: [touch(40, 64), touch(88, 64, 2)] }); p.draw(); assert.equal(work.getContext().pixels[(32 * 64 + 32) * 4 + 3], 255);
  p.onTouchEnd({ touches: [touch(40, 64)] }); p.onTouchMove({ touches: [touch(64, 64)] }); p.onTouchEnd({ touches: [] }); p.draw();
  assert.equal(work.getContext().pixels[(32 * 64 + 32) * 4 + 3], 255); assert.equal(p.data.canUndo, false); p.onUnload();
});
test('编辑器取消新框选保留旧框；圈选、缩放修边和撤销不改变源像素', async () => {
  const { p, work, input, touch } = await editorEnvironment();
  p.onTouchStart({ touches: [touch(15, 15)] }); p.onTouchMove({ touches: [touch(115, 115)] }); p.onTouchEnd({ touches: [] }); assert.equal(p.data.hasRect, true);
  p.onTouchStart({ touches: [touch(50, 50)] }); p.onTouchStart({ touches: [touch(50, 50), touch(80, 80, 2)] }); p.onTouchEnd({ touches: [] });
  await p.estimate(); assert.equal(p.data.hasResult, true); assert.equal(p.data.error, '');
  p.selectTool({ currentTarget: { dataset: { tool: 'polygon' } } });
  p.onTouchStart({ touches: [touch(20, 20)] }); p.onTouchMove({ touches: [touch(100, 20)] }); p.onTouchMove({ touches: [touch(100, 100)] }); p.onTouchMove({ touches: [touch(20, 100)] }); p.onTouchEnd({ touches: [] }); p.draw();
  assert.equal(work.getContext().pixels[3], 0); p.undo(); p.draw(); assert.deepEqual(input.pixels, fixture().pixels); p.onUnload();
});
test('编辑器全透明结果禁止应用，卸载和取消不触发迟到更新', async () => {
  const env = await editorEnvironment(), { p, touch } = env;
  p.selectTool({ currentTarget: { dataset: { tool: 'erase' } } }); p.changeBrush({ detail: { value: 64 } });
  for (const y of [0, 32, 64, 96, 128]) { p.onTouchStart({ touches: [touch(1, y)] }); p.onTouchMove({ touches: [touch(127, y)] }); p.onTouchEnd({ touches: [] }); }
  await p.apply(); assert.equal(env.exported, 0); assert.match(p.data.error, /没有可见/); assert.equal(p.data.busy, false); p.onUnload();
  const running = await editorEnvironment(256); running.p.onTouchStart({ touches: [touch(10, 10)] }); running.p.onTouchMove({ touches: [touch(118, 118)] }); running.p.onTouchEnd({ touches: [] });
  const pending = running.p.estimate(); running.p.cancelEstimate(); await pending; assert.equal(running.p.data.hasResult, false); assert.equal(running.p.data.busy, false);
  const closing = running.p.estimate(); running.p.onUnload(); const before = structuredClone(running.p.data); await closing; assert.deepEqual(running.p.data, before);
});
test('确认恢复原图的迟到回调不覆盖新选图，共享旧文件仍被其他衣物引用时保留', async () => {
  const old = garment(); old.image = { displayPath: '/user/garment_cut.png', overlayPath: '/user/garment_cut.png', originalPath: '/user/garment_source.png' };
  const shared = { ...garment(), id: 'shared', image: { displayPath: old.image.displayPath } };
  const env = environment([old, shared]), p = page(formDefinition); p.onLoad({ id: 'g' }); p.restoreOriginal(); p.removeDisplayImage(); env.dialogs[0].success({ confirm: true }); assert.equal(p.data.imagePath, '');
  const restore = page(formDefinition); restore.onLoad({ id: 'g' }); restore.restoreOriginal(); env.dialogs[1].success({ confirm: true }); await restore.saveGarment();
  assert.ok(!env.removed.includes(old.image.displayPath));
});
