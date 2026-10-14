import { SAMPLE_BODY } from '../../config/body';
import { getTryOnLayer } from '../../config/try-on';
import type { Garment } from '../../models/garment';
import type { GarmentFitting, FittingPointKey, FittingPoint } from '../../models/garment-fitting';
import type { GarmentImageContent } from '../../rendering/image-content';
import type { TryOnGarment } from '../../rendering/garment-layout';
import { suggestGarmentFitting } from '../../rendering/garment-rig';
import { buildGarmentMesh } from '../../rendering/garment-mesh';
import { buildBodyModel } from '../../rendering/body-model';
import { garmentService, bodyProfileService } from '../../services/instances';
import { cloneFitting, effectiveImagePath, FITTING_POINT_NAMES, fittingError, fittingKeys, fittingKind, fittingMatches } from '../../utils/garment-fitting';

const easeValues = ['fitted', 'regular', 'loose'] as const, sleeveValues = ['none', 'short', 'long'] as const, lengthValues = ['short', 'regular', 'long'] as const;
const loadedInfo = new WeakMap<object, { width: number; height: number; content: GarmentImageContent }>();
Page({
  data: {
    id: '', garment: null as Garment | null, fitting: null as GarmentFitting | null, imagePath: '', imageReady: false,
    profile: { ...SAMPLE_BODY }, previewItems: [] as TryOnGarment[], showPreview: false,
    points: [] as Array<{ key: FittingPointKey; name: string; number: number }>, active: '' as FittingPointKey | '', activeName: '',
    easeNames: ['贴身', '常规', '宽松'], sleeveNames: ['无袖', '短袖', '长袖'], lengthNames: ['偏短', '常规', '偏长'],
    easeIndex: 1, sleeveIndex: 1, lengthIndex: 1, hasSleeves: false, transparent: false,
    error: '', saving: false, dirty: false, loadError: '',
  },
  onLoad(query: { id?: string }) {
    try {
      const garment = garmentService.get(query.id || '');
      if (!garment) throw new Error('衣物不存在，可能已被删除。');
      if (!fittingKind(garment)) throw new Error('这类衣物暂不支持分区贴合，可继续在试衣间使用原图。');
      this.setData({ id: garment.id, garment, imagePath: effectiveImagePath(garment), profile: bodyProfileService.get() || { ...SAMPLE_BODY } });
      if (fittingMatches(garment.fitting, garment)) this.applyFitting(cloneFitting(garment.fitting));
    } catch (error) { this.setData({ loadError: error instanceof Error ? error.message : '衣物读取失败。' }); }
  },
  onUnload() { loadedInfo.delete(this); },
  applyFitting(fitting: GarmentFitting, dirty = false) {
    const wasDirty = this.data.dirty;
    const keys = fittingKeys(fitting.kind, fitting.sleeve);
    const active = keys.includes(this.data.active as FittingPointKey) ? this.data.active : keys[0];
    const garment = { ...this.data.garment!, fitting };
    this.setData({ fitting, active, activeName: FITTING_POINT_NAMES[active as FittingPointKey],
      points: keys.map((key, i) => ({ key, name: FITTING_POINT_NAMES[key], number: i + 1 })),
      hasSleeves: fitting.kind === 'upper' || fitting.kind === 'dress', easeIndex: easeValues.indexOf(fitting.ease),
      sleeveIndex: sleeveValues.indexOf(fitting.sleeve), lengthIndex: lengthValues.indexOf(fitting.length),
      previewItems: [{ garmentId: garment.id, layer: getTryOnLayer(garment)!, garment, transform: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 } }],
      error: '', dirty: this.data.dirty || dirty });
    if (dirty && !wasDirty) wx.enableAlertBeforeUnload({ message: '校准还没有保存，确定离开吗？' });
  },
  onImageInfo(event: { detail: { width: number; height: number; content: GarmentImageContent } }) {
    const info = event.detail; loadedInfo.set(this, info);
    this.setData({ imageReady: true, transparent: !!info.content.transparent && !!info.content.cutout });
    if (!this.data.fitting) this.applyFitting(suggestGarmentFitting(this.data.garment!, info.width, info.height, info.content)!);
  },
  onImageError() { this.setData({ imageReady: false }); },
  onPointSelect(event: { detail?: { key: FittingPointKey }; currentTarget?: { dataset: { key: FittingPointKey } } }) {
    const key = event.detail?.key || event.currentTarget?.dataset.key;
    if (key && this.data.points.some((p) => p.key === key)) this.setData({ active: key, activeName: FITTING_POINT_NAMES[key] });
  },
  onPointChange(event: { detail: { key: FittingPointKey; point: FittingPoint } }) {
    if (!this.data.fitting || this.data.saving) return;
    const { key, point } = event.detail;
    if (!this.data.points.some((p) => p.key === key) || ![point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return;
    this.applyFitting({ ...this.data.fitting, points: { ...this.data.fitting.points, [key]: { ...point } } }, true);
  },
  onChoice(event: { currentTarget: { dataset: { field: string } }; detail: { value: string } }) {
    const fitting = this.data.fitting; if (!fitting || this.data.saving) return;
    const index = Number(event.detail.value), field = event.currentTarget.dataset.field;
    if (field === 'ease' && easeValues[index]) this.applyFitting({ ...fitting, ease: easeValues[index] }, true);
    if (field === 'sleeve' && sleeveValues[index]) this.applyFitting({ ...fitting, sleeve: sleeveValues[index] }, true);
    if (field === 'length' && lengthValues[index]) this.applyFitting({ ...fitting, length: lengthValues[index] }, true);
  },
  setMode(event: { currentTarget: { dataset: { mode: string } } }) {
    const mode = event.currentTarget.dataset.mode;
    if (this.data.fitting && !this.data.saving && (mode === 'adapt' || mode === 'original')) this.applyFitting({ ...this.data.fitting, mode }, true);
  },
  resetPoints() {
    const info = loadedInfo.get(this); if (!info || !this.data.garment || this.data.saving) return;
    const suggestion = suggestGarmentFitting(this.data.garment, info.width, info.height, info.content)!;
    this.applyFitting({ ...suggestion, ease: this.data.fitting?.ease || suggestion.ease, sleeve: this.data.fitting?.sleeve || suggestion.sleeve,
      length: this.data.fitting?.length || suggestion.length, mode: this.data.fitting?.mode || 'adapt' }, true);
  },
  togglePreview() { this.setData({ showPreview: !this.data.showPreview }); },
  saveFitting() {
    const fitting = this.data.fitting, info = loadedInfo.get(this);
    if (!fitting || !info || !this.data.imageReady || this.data.saving) return;
    let error = fittingError(fitting);
    if (!error && fitting.mode === 'adapt' && !buildGarmentMesh(buildBodyModel(this.data.profile), {
      item: this.data.previewItems[0], image: { width: info.width, height: info.height } as WechatMiniprogram.Image,
      content: info.content, path: this.data.imagePath,
    })) error = '这些标记会让衣物发生交叉，请调整肩点、腋下或袖口后再预览。也可保存为原图模式。';
    if (error) { this.setData({ error }); wx.showToast({ title: '请检查校准标记', icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      garmentService.saveFitting(this.data.id, fitting, this.data.garment!.updatedAt);
      wx.disableAlertBeforeUnload(); this.setData({ dirty: false });
      wx.showToast({ title: '贴合校准已保存', icon: 'success' }); wx.navigateBack();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '保存失败，请重试。' }); }
    finally { this.setData({ saving: false }); }
  },
});
