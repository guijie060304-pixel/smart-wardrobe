import assert from 'node:assert/strict';
import test from 'node:test';
import { SAMPLE_BODY } from '../miniprogram/config/body.ts';
import { buildBodyModel, commandPoints } from '../miniprogram/rendering/body-model.ts';
import { fitBodyToCanvas, transformPoint } from '../miniprogram/rendering/canvas-fit.ts';
import { renderBodyCanvas } from '../miniprogram/rendering/draw-body.ts';
import { validateBodyMeasurements } from '../miniprogram/utils/body-validation.ts';
import { LocalBodyProfileRepository } from '../miniprogram/repositories/body-profile-repository.ts';
import { BodyProfileService } from '../miniprogram/services/body-profile-service.ts';

test('身高限定 150–200，其余参数允许任意有限正数', () => {
  for (const heightCm of [150, 175, 200]) assert.deepEqual(validateBodyMeasurements({ ...SAMPLE_BODY, heightCm }), {});
  for (const heightCm of [149.9, 200.1]) assert.ok(validateBodyMeasurements({ ...SAMPLE_BODY, heightCm }).heightCm);
  for (const field of ['weightKg', 'bustCm', 'waistCm', 'hipCm']) {
    for (const value of [0, -1, NaN, Infinity]) assert.ok(validateBodyMeasurements({ ...SAMPLE_BODY, [field]: value })[field]);
    for (const value of [0.001, 1000, Number.MAX_VALUE]) assert.deepEqual(validateBodyMeasurements({ ...SAMPLE_BODY, [field]: value }), {});
  }
  assert.ok(validateBodyMeasurements({ ...SAMPLE_BODY, template: 'unknown' }).template);
});

test('两种模板与胸腰臀、体重参数会影响轮廓，计算不更改原始输入', () => {
  const original = Object.freeze({ ...SAMPLE_BODY });
  const baseline = buildBodyModel(original);
  const headPoints = baseline.parts.find((part) => part.id === 'head').commands.flatMap(commandPoints);
  const torsoPoints = baseline.parts.find((part) => part.id === 'torso').commands.flatMap(commandPoints);
  assert.ok(Math.min(...torsoPoints.map((point) => point.y)) < Math.max(...headPoints.map((point) => point.y)), '头部与颈部应衔接');
  for (const change of [{ template: 'feminine' }, { bustCm: 110 }, { waistCm: 90 }, { hipCm: 115 }, { weightKg: 100 }]) {
    assert.notDeepEqual(buildBodyModel({ ...original, ...change }).parts, baseline.parts);
  }
  assert.deepEqual(original, SAMPLE_BODY);
  assert.equal(buildBodyModel({ ...original, heightCm: 150 }).height, 150);
  assert.equal(buildBodyModel({ ...original, heightCm: 200 }).height, 200);
});

test('参数边界、两种模板和不同画布中人体完整显示，X/Y 共用比例', () => {
  const sizes = [[288, 300], [343, 420], [720, 320], [120, 600], [16, 16]];
  for (const template of ['masculine', 'feminine']) {
    for (const heightCm of [150, 175, 200]) {
      for (const measurements of [
        { weightKg: 65, bustCm: 92, waistCm: 76, hipCm: 96 },
        { weightKg: 0.001, bustCm: 0.001, waistCm: 0.001, hipCm: 0.001 },
        { weightKg: Number.MAX_VALUE, bustCm: Number.MAX_VALUE, waistCm: Number.MAX_VALUE, hipCm: Number.MAX_VALUE },
      ]) {
        const model = buildBodyModel({ template, heightCm, ...measurements });
        const points = model.parts.flatMap((part) => part.commands.flatMap(commandPoints));
        assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
        assert.equal(model.bounds.top, 0);
        assert.equal(model.bounds.bottom, heightCm);
        for (const [width, height] of sizes) {
          const transform = fitBodyToCanvas(model.bounds, width, height);
          assert.ok(Number.isFinite(transform.scale) && transform.scale > 0);
          for (const point of points) {
            const rendered = transformPoint(point, transform);
            assert.ok(rendered.x >= -1e-9 && rendered.x <= width + 1e-9);
            assert.ok(rendered.y >= -1e-9 && rendered.y <= height + 1e-9);
          }
          const center = transformPoint({ x: (model.bounds.left + model.bounds.right) / 2, y: 0 }, transform);
          assert.ok(Math.abs(center.x - width / 2) < 1e-9);
          const unit = transformPoint({ x: 1, y: 1 }, transform);
          assert.ok(Math.abs((unit.x - transform.translateX) - (unit.y - transform.translateY)) < 1e-9);
        }
      }
    }
  }
});

test('设备像素比与重新适配不会累积缩放，也不改变人体模型', () => {
  const calls = [];
  const context = new Proxy({}, {
    get: (_target, key) => (...args) => { calls.push([key, ...args]); return String(key).includes('Gradient') ? { addColorStop() {} } : undefined; },
    set: () => true,
  });
  const canvas = { width: 0, height: 0, getContext: () => context };
  const model = buildBodyModel(SAMPLE_BODY);
  const original = structuredClone(model);
  for (const ratio of [1, 2, 3]) {
    renderBodyCanvas(canvas, 300, 420, ratio, model);
    assert.equal(canvas.width, 300 * ratio);
    assert.equal(canvas.height, 420 * ratio);
  }
  renderBodyCanvas(canvas, 220, 310, 2, model);
  assert.equal(canvas.width, 440);
  assert.deepEqual(calls.filter(([method]) => method === 'setTransform'), [
    ['setTransform', 1, 0, 0, 1, 0, 0], ['setTransform', 2, 0, 0, 2, 0, 0],
    ['setTransform', 3, 0, 0, 3, 0, 0], ['setTransform', 2, 0, 0, 2, 0, 0],
  ]);
  // 画布/人体的基础变换等比；椭圆表面光斑可以在局部使用不同的半径。
  for (const [index, call] of calls.entries()) if (call[0] === 'setTransform') {
    const [, x, y] = calls.slice(index + 1).find(([method]) => method === 'scale');
    assert.equal(x, y); assert.ok(x > 0);
  }
  assert.deepEqual(model, original);
});

test('身材本地保存与重新读取保留原始小数和超常正数', () => {
  const stored = new Map();
  globalThis.wx = {
    getStorageSync: (key) => stored.has(key) ? structuredClone(stored.get(key)) : '',
    setStorageSync: (key, value) => stored.set(key, structuredClone(value)),
  };
  const service = new BodyProfileService(new LocalBodyProfileRepository());
  assert.equal(service.get(), null);
  const input = Object.freeze({ ...SAMPLE_BODY, heightCm: 175.5, waistCm: 1000.25 });
  const saved = service.save(input);
  assert.deepEqual(new BodyProfileService(new LocalBodyProfileRepository()).get(), saved);
  assert.equal(saved.waistCm, 1000.25);
  assert.equal(saved.heightCm, 175.5);
  assert.ok(saved.updatedAt);
  assert.throws(() => service.save({ ...input, weightKg: 0 }), /大于零/);
  assert.deepEqual(service.get(), saved);
});

test('损坏身材记录不被覆盖，存储失败明确传递', () => {
  let writes = 0;
  globalThis.wx = { getStorageSync: () => ({ version: 1, profile: { heightCm: 175 } }), setStorageSync: () => { writes += 1; } };
  const service = new BodyProfileService(new LocalBodyProfileRepository());
  assert.throws(() => service.get(), /格式异常/);
  assert.throws(() => service.save(SAMPLE_BODY), /格式异常/);
  assert.equal(writes, 0);
  globalThis.wx = { getStorageSync: () => '', setStorageSync: () => { throw new Error('空间不足'); } };
  assert.throws(() => service.save(SAMPLE_BODY), /空间不足/);
});

test('新增实测尺寸可选、旧记录兼容；填写时校验有限正数且保留原值', () => {
  for (const key of ['shoulderWidthCm', 'torsoLengthCm', 'inseamCm', 'underBustCm']) {
    assert.deepEqual(validateBodyMeasurements({ ...SAMPLE_BODY, [key]: undefined }), {});
    for (const value of [0, -1, NaN, Infinity, '40']) assert.ok(validateBodyMeasurements({ ...SAMPLE_BODY, [key]: value })[key]);
    const input = { ...SAMPLE_BODY, [key]: Number.MAX_VALUE };
    assert.deepEqual(validateBodyMeasurements(input), {});
    assert.ok(buildBodyModel(input).parts.flatMap((part) => part.commands.flatMap(commandPoints)).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(input[key], Number.MAX_VALUE);
  }
});

test('肩宽/上身长/内侧腿长实际驱动肩线、腰线和裆点，女模下胸围影响胸廓', () => {
  const model = buildBodyModel({ ...SAMPLE_BODY, shoulderWidthCm: 44, torsoLengthCm: 37, inseamCm: 80 });
  assert.equal(model.anchors.shoulderRight.x - model.anchors.shoulderLeft.x, 44);
  assert.equal(model.anchors.waist.y - model.anchors.shoulderLeft.y, 37);
  assert.equal(model.height - model.anchors.crotch.y, 80);
  const a = buildBodyModel({ ...SAMPLE_BODY, template: 'feminine', underBustCm: 75 });
  const b = buildBodyModel({ ...SAMPLE_BODY, template: 'feminine', underBustCm: 85 });
  assert.notDeepEqual(a.parts, b.parts);
});

test('男女表单分别保留输入，女模专有下胸围，预览估算不写入保存记录', async () => {
  let definition;
  const stored = new Map();
  globalThis.wx = { getStorageSync: (key) => stored.get(key) || '', setStorageSync: (key, value) => stored.set(key, structuredClone(value)),
    showToast() {}, switchTab() {} };
  globalThis.Page = (value) => { definition = value; };
  await import('../miniprogram/pages/body-settings/index.ts');
  const p = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [key, method] of Object.entries(definition)) if (typeof method === 'function') p[key] = method.bind(p);
  p.onLoad();
  const fill = (key, value) => p.onFieldInput({ currentTarget: { dataset: { key } }, detail: { value } });
  fill('heightCm', '180'); fill('shoulderWidthCm', '44');
  p.onTemplateChange({ detail: { value: 'feminine' } });
  assert.equal(p.data.fields.find((field) => field.key === 'heightCm').value, '');
  assert.equal(p.data.previewProfile.heightCm, 165);
  assert.ok(p.data.fields.some((field) => field.key === 'underBustCm'));
  for (const [key, value] of Object.entries({ heightCm: '166', weightKg: '55', bustCm: '88', waistCm: '69', hipCm: '93', underBustCm: '76' })) fill(key, value);
  p.onTemplateChange({ detail: { value: 'masculine' } });
  assert.equal(p.data.fields.find((field) => field.key === 'heightCm').value, '180');
  assert.equal(p.data.fields.find((field) => field.key === 'shoulderWidthCm').value, '44');
  assert.ok(!p.data.fields.some((field) => field.key === 'underBustCm'));
  p.onTemplateChange({ detail: { value: 'feminine' } }); p.saveBody();
  const saved = stored.get('smart-wardrobe.body-profile.v1').profile;
  assert.equal(saved.template, 'feminine'); assert.equal(saved.heightCm, 166); assert.equal(saved.underBustCm, 76);
  assert.equal(saved.shoulderWidthCm, undefined); assert.equal(saved.torsoLengthCm, undefined); assert.equal(saved.inseamCm, undefined);
  p.onUnload();
});
