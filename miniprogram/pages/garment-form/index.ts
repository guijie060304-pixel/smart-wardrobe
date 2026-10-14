import { CATEGORY_GROUPS } from '../../config/categories';
import type { Season } from '../../models/garment';
import { garmentService } from '../../services/instances';
import { chooseImage, editImage, ImageSelectionCancelled, removeImage, saveGarmentImages, garmentImagePaths } from '../../services/image-service';
import { createCutoutSession, closeCutoutSession } from '../../services/cutout-session';
import type { GarmentDraft } from '../../services/garment-service';

const seasons: Array<{ id: Season; name: string }> = [
  { id: 'spring', name: '春季' }, { id: 'summer', name: '夏季' },
  { id: 'autumn', name: '秋季' }, { id: 'winter', name: '冬季' },
];
const textFields = new Set(['name', 'color', 'style', 'fit', 'material', 'brand', 'priceInput', 'note', 'tagsInput']);
interface FormState { alive: boolean; version: number; sessions: Set<string>; expectedUpdatedAt?: string }
const states = new WeakMap<object, FormState>();
function stateFor(page: object): FormState {
  let state = states.get(page); if (!state) { state = { alive: true, version: 0, sessions: new Set() }; states.set(page, state); } return state;
}

function reportImageError(error: unknown): void {
  if (error instanceof ImageSelectionCancelled) return;
  wx.showModal({ title: '图片操作失败', content: error instanceof Error ? error.message : '请重试。', showCancel: false });
}

function pickSource(): Promise<'camera' | 'album'> {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (result) => resolve(result.tapIndex === 0 ? 'camera' : 'album'),
      fail: () => reject(new ImageSelectionCancelled('已取消选择。')),
    });
  });
}

Page({
  data: {
    id: '',
    groupNames: CATEGORY_GROUPS.map((group) => group.name),
    typeNames: CATEGORY_GROUPS[0].types.map((type) => type.name),
    groupIndex: -1,
    typeIndex: -1,
    imagePath: '',
    imageDirty: false,
    imageFailed: false,
    overlayPath: '',
    overlayDirty: false,
    originalPath: '',
    originalDirty: false,
    name: '',
    color: '',
    seasonChoices: seasons.map((season) => ({ ...season, checked: false })),
    selectedSeasons: [] as Season[],
    style: '',
    fit: '',
    material: '',
    brand: '',
    priceInput: '',
    purchaseDate: '',
    note: '',
    tagsInput: '',
    saving: false,
    loadError: '',
  },

  onLoad(query: { id?: string }) {
    const state = stateFor(this);
    if (!query.id) return;
    try {
      const garment = garmentService.get(query.id);
      if (!garment) throw new Error('衣物不存在，可能已被删除。');
      state.expectedUpdatedAt = garment.updatedAt;
      const groupIndex = CATEGORY_GROUPS.findIndex((group) => group.id === garment.category.groupId);
      const typeIndex = CATEGORY_GROUPS[groupIndex].types.findIndex((type) => type.id === garment.category.typeId);
      this.setData({
        id: garment.id,
        groupIndex,
        typeIndex,
        typeNames: CATEGORY_GROUPS[groupIndex].types.map((type) => type.name),
        imagePath: garment.image.displayPath,
        overlayPath: garment.image.overlayPath || '',
        originalPath: garment.image.originalPath || '',
        name: garment.name,
        color: garment.color || '',
        selectedSeasons: garment.seasons || [],
        seasonChoices: seasons.map((season) => ({ ...season, checked: !!garment.seasons?.includes(season.id) })),
        style: garment.style || '',
        fit: garment.fit || '',
        material: garment.material || '',
        brand: garment.brand || '',
        priceInput: garment.purchasePrice === undefined ? '' : String(garment.purchasePrice),
        purchaseDate: garment.purchaseDate || '',
        note: garment.note || '',
        tagsInput: garment.tags?.join('，') || '',
      });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '衣物读取失败。' });
    }
  },

  onUnload() {
    const state = stateFor(this); state.alive = false; state.version++;
    state.sessions.forEach(closeCutoutSession); state.sessions.clear();
    if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  },

  markImageDraft() { if (typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '衣物图片尚未保存，离开将丢失本次修改。' }); },

  openCutout() {
    if (!this.data.imagePath || this.data.imageFailed || this.data.saving) return;
    const state = stateFor(this), version = ++state.version, source = this.data.originalPath || this.data.imagePath;
    state.sessions.forEach(closeCutoutSession); state.sessions.clear();
    const session = createCutoutSession(source, (path) => {
      if (!state.alive || state.version !== version || this.data.saving || source !== (this.data.originalPath || this.data.imagePath)) return false;
      try {
        if (this.data.id && garmentService.get(this.data.id)?.updatedAt !== state.expectedUpdatedAt) return false;
      } catch { return false; }
      this.setData({ originalPath: source, originalDirty: this.data.originalPath ? this.data.originalDirty : this.data.imageDirty,
        imagePath: path, overlayPath: path, imageDirty: true, overlayDirty: true, imageFailed: false });
      this.markImageDraft(); state.sessions.delete(session); return true;
    });
    state.sessions.add(session);
    wx.navigateTo({ url: `/pages/garment-cutout/index?session=${encodeURIComponent(session)}`, fail: () => {
      closeCutoutSession(session); state.sessions.delete(session); if (state.alive) wx.showToast({ title: '无法打开抠图，请重试', icon: 'none' });
    } });
  },

  restoreOriginal() {
    if (!this.data.originalPath || this.data.saving) return;
    const state = stateFor(this), version = state.version, source = this.data.originalPath, dirty = this.data.originalDirty;
    wx.showModal({ title: '恢复原照片', content: '恢复抠图前照片，并移除当前试衣贴图？点击保存衣物后生效。', success: (result) => {
      if (!result.confirm || !state.alive || this.data.saving || state.version !== version || this.data.originalPath !== source) return;
      state.version++;
      this.setData({ imagePath: source, imageDirty: dirty, originalPath: '', originalDirty: false,
        overlayPath: '', overlayDirty: true, imageFailed: false }); this.markImageDraft();
    } });
  },

  onFieldInput(event: { detail: { value: string }; currentTarget: { dataset: { field: string } } }) {
    const field = event.currentTarget.dataset.field;
    if (textFields.has(field)) this.setData({ [field]: event.detail.value });
  },

  onGroupChange(event: { detail: { value: string } }) {
    const groupIndex = Number(event.detail.value);
    const group = CATEGORY_GROUPS[groupIndex];
    if (!group) return;
    this.setData({ groupIndex, typeIndex: -1, typeNames: group.types.map((type) => type.name) });
  },

  onTypeChange(event: { detail: { value: string } }) {
    this.setData({ typeIndex: Number(event.detail.value) });
  },

  onSeasonChange(event: { detail: { value: Season[] } }) {
    const selectedSeasons = event.detail.value;
    this.setData({
      selectedSeasons,
      seasonChoices: seasons.map((season) => ({ ...season, checked: selectedSeasons.includes(season.id) })),
    });
  },

  onDateChange(event: { detail: { value: string } }) {
    this.setData({ purchaseDate: event.detail.value });
  },

  async chooseDisplayImage() {
    if (this.data.saving) return;
    const state = stateFor(this), version = ++state.version;
    try {
      const path = await chooseImage(await pickSource());
      if (!state.alive || version !== state.version || this.data.saving) return;
      this.setData({ imagePath: path, imageDirty: true, imageFailed: false, originalPath: '', originalDirty: false, overlayPath: '', overlayDirty: true }); this.markImageDraft();
    } catch (error) { if (state.alive && version === state.version) reportImageError(error); }
  },

  async chooseOverlayImage() {
    if (this.data.saving) return;
    const state = stateFor(this), version = ++state.version;
    try {
      const path = await chooseImage(await pickSource());
      if (!state.alive || version !== state.version || this.data.saving) return;
      this.setData({ overlayPath: path, overlayDirty: true }); this.markImageDraft();
    } catch (error) { if (state.alive && version === state.version) reportImageError(error); }
  },

  async editDisplayImage() {
    if (!this.data.imagePath || this.data.saving) return;
    const state = stateFor(this), version = ++state.version;
    try {
      const source = this.data.originalPath || this.data.imagePath;
      const path = await editImage(source);
      if (!state.alive || version !== state.version || this.data.saving) return;
      this.setData({ imagePath: path, imageDirty: true, imageFailed: false, originalPath: '', originalDirty: false, overlayPath: '', overlayDirty: true }); this.markImageDraft();
    } catch (error) { if (state.alive && version === state.version) reportImageError(error); }
  },

  previewDisplayImage() {
    if (this.data.imagePath && !this.data.imageFailed) {
      wx.previewImage({ urls: [this.data.imagePath], current: this.data.imagePath });
    }
  },

  onImageError() {
    this.setData({ imageFailed: true });
  },

  removeDisplayImage() {
    if (this.data.saving) return; stateFor(this).version++;
    this.setData({ imagePath: '', imageDirty: true, imageFailed: false, originalPath: '', originalDirty: false, overlayPath: '', overlayDirty: true }); this.markImageDraft();
  },

  removeOverlayImage() {
    if (this.data.saving) return; stateFor(this).version++;
    this.setData({ overlayPath: '', overlayDirty: true }); this.markImageDraft();
  },

  async saveGarment() {
    if (this.data.saving || this.data.loadError) return;
    const input = { ...this.data, selectedSeasons: [...this.data.selectedSeasons] };
    const group = CATEGORY_GROUPS[input.groupIndex];
    const type = group?.types[input.typeIndex];
    if (!input.imagePath || input.imageFailed) {
      wx.showToast({ title: '请先选择有效图片', icon: 'none' }); return;
    }
    if (!group || !type) {
      wx.showToast({ title: '请选择衣物分类', icon: 'none' }); return;
    }
    const priceText = input.priceInput.trim();
    const purchasePrice = priceText ? Number(priceText) : undefined;
    if (purchasePrice !== undefined && (!Number.isFinite(purchasePrice) || purchasePrice < 0)) {
      wx.showToast({ title: '购买价格格式有误', icon: 'none' }); return;
    }

    this.setData({ saving: true });
    const state = stateFor(this); state.version++;
    wx.showLoading({ title: '正在保存' });
    let created: string[] = [];
    let stored = false;
    try {
      const previous = input.id ? garmentService.get(input.id) : undefined;
      if (input.id && previous?.updatedAt !== state.expectedUpdatedAt) throw new Error('衣物已修改，请返回重新打开编辑。');
      const prepared = await saveGarmentImages({ displayPath: input.imagePath, overlayPath: input.overlayPath || undefined, originalPath: input.originalPath || undefined },
        new Set([input.imageDirty ? input.imagePath : '', input.overlayDirty ? input.overlayPath : '', input.originalDirty ? input.originalPath : ''].filter(Boolean)));
      created = prepared.created;
      if (!state.alive) throw new Error('编辑已关闭，未保存衣物。');

      const draft: GarmentDraft = {
        name: input.name,
        category: { groupId: group.id, typeId: type.id },
        image: prepared.image,
        color: input.color,
        seasons: input.selectedSeasons,
        style: input.style,
        fit: input.fit,
        material: input.material,
        brand: input.brand,
        purchasePrice,
        purchaseDate: input.purchaseDate || undefined,
        note: input.note,
        tags: input.tagsInput.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      };
      const saved = input.id ? garmentService.update(input.id, draft, state.expectedUpdatedAt) : garmentService.create(draft);
      stored = true;
      state.expectedUpdatedAt = saved.updatedAt;
      if (state.alive) this.setData({ id: saved.id, imagePath: saved.image.displayPath, overlayPath: saved.image.overlayPath || '', originalPath: saved.image.originalPath || '',
        imageDirty: false, overlayDirty: false, originalDirty: false });

      const referenced = new Set(garmentService.list().flatMap((garment) => garmentImagePaths(garment.image)));
      const oldPaths = previous ? garmentImagePaths(previous.image).filter((path) => !referenced.has(path)) : [];
      await Promise.all(oldPaths.map((path) => removeImage(path).catch(() => undefined)));
      if (!state.alive) return;
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      wx.showToast({ title: '保存成功', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      if (!stored) {
        await Promise.all(created.map((path) => removeImage(path).catch(() => undefined)));
        if (state.alive) wx.showModal({ title: '保存失败', content: error instanceof Error ? error.message : '请检查本地空间并重试。', showCancel: false });
      } else if (state.alive) wx.showToast({ title: '已保存，请手动返回', icon: 'none' });
    } finally {
      wx.hideLoading();
      if (state.alive) this.setData({ saving: false });
    }
  },
});
