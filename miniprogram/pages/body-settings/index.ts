import { BODY_TEMPLATES, HEIGHT_RANGE, SAMPLE_BODIES } from '../../config/body';
import type { BodyMeasurementField, BodyMeasurements, BodyTemplate } from '../../models/body-profile';
import { bodyProfileService } from '../../services/instances';
import { validateBodyMeasurements } from '../../utils/body-validation';

interface MeasurementInput { key: BodyMeasurementField; name: string; unit: string; value: string; error: string; placeholder: string; hint?: string; optional?: boolean }
const emptyFields: MeasurementInput[] = [
  { key: 'heightCm', name: '身高', unit: 'cm', placeholder: '150–200', value: '', error: '' },
  { key: 'weightKg', name: '体重', unit: 'kg', placeholder: '请输入体重', value: '', error: '' },
  { key: 'bustCm', name: '胸围', unit: 'cm', placeholder: '请输入胸围', value: '', error: '', hint: '软尺水平绕胸部最丰满处一周，填写人体围度。' },
  { key: 'waistCm', name: '腰围', unit: 'cm', placeholder: '请输入腰围', value: '', error: '', hint: '自然站立，在自然腰线水平量一周。' },
  { key: 'hipCm', name: '臀围', unit: 'cm', placeholder: '请输入臀围', value: '', error: '', hint: '双脚并拢，水平绕臀部最丰满处一周。' },
  { key: 'shoulderWidthCm', name: '肩宽', unit: 'cm', placeholder: '选填，留空按比例估算', value: '', error: '', optional: true, hint: '左右肩部外侧骨点之间的水平距离。' },
  { key: 'torsoLengthCm', name: '上身长', unit: 'cm', placeholder: '选填，留空按比例估算', value: '', error: '', optional: true, hint: '肩线到自然腰线的垂直距离，用来定位上衣和裤腰。' },
  { key: 'inseamCm', name: '内侧腿长', unit: 'cm', placeholder: '选填，留空按比例估算', value: '', error: '', optional: true, hint: '不穿鞋，从裆底垂直量到地面。' },
  { key: 'underBustCm', name: '下胸围', unit: 'cm', placeholder: '女模选填', value: '', error: '', optional: true, hint: '沿胸部下缘水平量一周，用于女模胸廓轮廓。' },
];
const drafts = new WeakMap<object, Partial<Record<BodyTemplate, MeasurementInput[]>>>();
function createFields(template: BodyTemplate, profile?: BodyMeasurements | null): MeasurementInput[] {
  return emptyFields.filter((field) => template === 'feminine' || field.key !== 'underBustCm')
    .map((field) => ({ ...field, value: profile?.[field.key] === undefined ? '' : String(profile[field.key]) }));
}
function previewProfile(template: BodyTemplate, fields: MeasurementInput[]): BodyMeasurements {
  const preview = { ...SAMPLE_BODIES[template] };
  for (const field of fields) {
    const value = Number(field.value.trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    if (field.key === 'heightCm' && (value < HEIGHT_RANGE.min || value > HEIGHT_RANGE.max)) continue;
    preview[field.key] = value;
  }
  return preview;
}

Page({
  data: {
    templates: BODY_TEMPLATES,
    template: 'masculine' as BodyTemplate,
    fields: createFields('masculine'),
    previewProfile: { ...SAMPLE_BODIES.masculine },
    saving: false,
    loadError: '',
  },
  onLoad() { this.loadProfile(); },
  onUnload() { drafts.delete(this); },
  loadProfile() {
    try {
      const profile = bodyProfileService.get();
      const template = profile?.template || 'masculine';
      const fields = createFields(template, profile);
      drafts.set(this, { [template]: fields });
      this.setData({
        template, fields, previewProfile: profile || { ...SAMPLE_BODIES[template] },
        loadError: '',
      });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '身材记录读取失败。' });
    }
  },
  onTemplateChange(event: { detail: { value: string } }) {
    const template = event.detail.value;
    if ((template !== 'masculine' && template !== 'feminine') || template === this.data.template) return;
    const saved = drafts.get(this) || {};
    saved[this.data.template] = this.data.fields.map((field) => ({ ...field }));
    const fields = saved[template] || createFields(template);
    drafts.set(this, saved);
    this.setData({ template, fields, previewProfile: previewProfile(template, fields) });
  },
  onFieldInput(event: { detail: { value: string }; currentTarget: { dataset: { key: string } } }) {
    const fields = this.data.fields.map((field) => field.key === event.currentTarget.dataset.key
      ? { ...field, value: event.detail.value, error: '' } : field);
    this.setData({ fields, previewProfile: previewProfile(this.data.template, fields) });
  },
  saveBody() {
    if (this.data.saving || this.data.loadError) return;
    const input: BodyMeasurements = { template: this.data.template, heightCm: 0, weightKg: 0, bustCm: 0, waistCm: 0, hipCm: 0 };
    for (const field of this.data.fields) {
      if (field.optional && !field.value.trim()) continue;
      input[field.key] = Number(field.value.trim());
    }
    const errors = validateBodyMeasurements(input);
    this.setData({ fields: this.data.fields.map((field) => ({ ...field, error: errors[field.key] || '' })) });
    if (Object.keys(errors).length) {
      wx.showToast({ title: '请检查身材参数', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      bodyProfileService.save(input);
      wx.showToast({ title: '已保存身材', icon: 'success' });
      wx.switchTab({ url: '/pages/try-on/index' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: error instanceof Error ? error.message : '请检查本地空间并重试。', showCancel: false });
    } finally { this.setData({ saving: false }); }
  },
});
