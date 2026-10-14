import { BODY_TEMPLATES, SAMPLE_BODY } from '../../config/body';
import { getCategoryName } from '../../config/categories';
import { getTryOnLayer, layerName, TRY_ON_LAYERS, type TryOnLayer } from '../../config/try-on';
import type { BodyMeasurements } from '../../models/body-profile';
import type { Garment } from '../../models/garment';
import type { GarmentTransform } from '../../models/outfit';
import type { TryOnGarment } from '../../rendering/garment-layout';
import { bodyProfileService, garmentService, outfitService } from '../../services/instances';
import { tryOnSession } from '../../services/try-on-session';
import { resolveOutfitItems, type OutfitIssue } from '../../utils/outfit-resolution';
import { fittingKind } from '../../utils/garment-fitting';
import { openWardrobeMatching } from '../../services/wardrobe-navigation';

type IdEvent = { currentTarget: { dataset: { id: string } } };
type WearingRow = { id: string; name: string; layerName: string; imagePath: string };
type CatalogRow = WearingRow & { categoryName: string; selected: boolean; hasOverlay: boolean };

Page({
  data: {
    bodyProfile: { ...SAMPLE_BODY } as BodyMeasurements, hasProfile: false, templateName: '', loadError: '', catalogError: '',
    garments: [] as Garment[], renderItems: [] as TryOnGarment[], wearing: [] as WearingRow[], catalog: [] as CatalogRow[],
    activeId: '', activeName: '', query: '', layerFilter: '', layers: TRY_ON_LAYERS,
    canFitActive: false,
    scalePercent: 100, rotationDeg: 0, totalSupported: 0,
    outfitName: '', editingOutfitId: '', editingOutfitName: '', unsaved: false, savingOutfit: false,
    unavailable: [] as OutfitIssue[], totalItems: 0,
  },
  onShow() { this.loadProfile(); this.loadCatalog(); },
  loadProfile() {
    try {
      const saved = bodyProfileService.get();
      const bodyProfile = saved || { ...SAMPLE_BODY };
      this.setData({ bodyProfile, hasProfile: !!saved, templateName: BODY_TEMPLATES.find((item) => item.id === bodyProfile.template)?.name || '', loadError: '' });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '身材读取失败。' });
    }
  },
  loadCatalog() {
    try {
      const garments = garmentService.list();
      const removed = tryOnSession.reconcile(garments);
      this.setData({ garments, catalogError: '' });
      this.syncSession();
      if (removed.length) wx.showToast({ title: tryOnSession.source ? '部分衣物不可用，原位置已保留' : '已移除删除或分类变更的衣物', icon: 'none' });
    } catch (error) {
      // 读取失败时保留当前草稿，不按空衣橱误删试衣内容。
      this.setData({ catalogError: error instanceof Error ? error.message : '衣橱读取失败。' });
    }
  },
  syncSession(preferredId?: string, refreshCatalog = true) {
    const items = tryOnSession.list();
    const renderItems: TryOnGarment[] = items.flatMap((item) => {
      const garment = this.data.garments.find((entry) => entry.id === item.garmentId);
      return garment ? [{ ...item, garment }] : [];
    });
    if (preferredId) tryOnSession.select(preferredId);
    const candidateId = tryOnSession.activeId;
    const activeId = items.some((item) => item.garmentId === candidateId) ? candidateId : items[items.length - 1]?.garmentId || '';
    const active = renderItems.find((item) => item.garmentId === activeId);
    const source = tryOnSession.source;
    this.setData({
      outfitName: tryOnSession.name, editingOutfitId: source?.id || '', editingOutfitName: source?.name || '',
      unsaved: tryOnSession.hasUnsavedChanges(), totalItems: tryOnSession.allItems().length,
      unavailable: resolveOutfitItems(tryOnSession.unavailable(), this.data.garments).issues,
      renderItems, activeId, activeName: active?.garment.name || '',
      canFitActive: !!active && !!fittingKind(active.garment),
      wearing: renderItems.map((item) => ({ id: item.garmentId, name: item.garment.name,
        layerName: layerName(item.layer as TryOnLayer), imagePath: item.garment.image.displayPath })),
      scalePercent: Math.round((active?.transform.scale || 1) * 100), rotationDeg: Math.round(active?.transform.rotationDeg || 0),
    });
    if (refreshCatalog) this.filterCatalog();
  },
  filterCatalog() {
    const query = this.data.query.trim().toLocaleLowerCase();
    const allSupported = this.data.garments.filter((item) => !!getTryOnLayer(item));
    const catalog = allSupported.filter((item) => (!this.data.layerFilter || getTryOnLayer(item) === this.data.layerFilter)
      && (!query || item.name.toLocaleLowerCase().includes(query) || getCategoryName(item.category).toLocaleLowerCase().includes(query)))
      .map((item) => ({ id: item.id, name: item.name, imagePath: item.image.displayPath,
        categoryName: getCategoryName(item.category), layerName: layerName(getTryOnLayer(item)!),
        selected: this.data.renderItems.some((entry) => entry.garmentId === item.id), hasOverlay: !!item.image.overlayPath }));
    this.setData({ catalog, totalSupported: allSupported.length });
  },
  wear(event: IdEvent) {
    if (this.data.catalogError) return;
    const garment = this.data.garments.find((item) => item.id === event.currentTarget.dataset.id);
    if (!garment) return;
    try {
      const removed = tryOnSession.wear(garment);
      this.syncSession(garment.id);
      if (removed.length) wx.showToast({ title: '已替换同层或互斥衣物', icon: 'none' });
    } catch (error) { this.showError(error); }
  },
  selectWearing(event: IdEvent) { this.syncSession(event.currentTarget.dataset.id, false); },
  calibrateActive() { if (this.data.canFitActive) wx.navigateTo({ url: `/pages/garment-fitting/index?id=${encodeURIComponent(this.data.activeId)}` }); },
  onGarmentSelect(event: { detail: { garmentId: string } }) {
    if (event.detail.garmentId !== this.data.activeId) this.syncSession(event.detail.garmentId, false);
  },
  onGarmentRaise(event: { detail: { garmentId: string } }) { tryOnSession.bringToFront(event.detail.garmentId); this.syncSession(event.detail.garmentId, false); },
  removeActive() { if (this.data.activeId) { tryOnSession.remove(this.data.activeId); this.syncSession(); } },
  removeWearing(event: IdEvent) { tryOnSession.remove(event.currentTarget.dataset.id); this.syncSession(); },
  adjust(patch: Partial<GarmentTransform>) {
    if (!this.data.activeId) return;
    try { tryOnSession.adjust(this.data.activeId, patch); this.syncSession(undefined, false); }
    catch (error) { this.showError(error); }
  },
  onTransformChange(event: { detail: { garmentId: string } & GarmentTransform }) {
    if (event.detail.garmentId !== this.data.activeId) return;
    const { offsetX, offsetY, scale, rotationDeg } = event.detail;
    this.adjust({ offsetX, offsetY, scale, rotationDeg });
  },
  resetActive() {
    if (!this.data.activeId) return;
    tryOnSession.reset(this.data.activeId); this.syncSession(undefined, false);
  },
  clearAll() {
    if (!this.data.totalItems) return;
    wx.showModal({ title: '清空试衣', content: '移除当前试穿的所有衣物和调整参数？衣橱中的衣物会保留。',
      success: (result) => { if (result.confirm) { tryOnSession.clear(); this.syncSession(); } } });
  },
  onOutfitNameInput(event: { detail: { value: string } }) {
    tryOnSession.setName(event.detail.value);
    this.setData({ outfitName: event.detail.value, unsaved: tryOnSession.hasUnsavedChanges() });
  },
  saveOutfit() { this.persistOutfit(false); },
  saveAsNew() { this.persistOutfit(true); },
  persistOutfit(asNew: boolean) {
    if (this.data.savingOutfit || this.data.catalogError || this.data.loadError) return;
    this.setData({ savingOutfit: true });
    try {
      const source = tryOnSession.source;
      const draft = { name: tryOnSession.name, items: tryOnSession.allItems(), kind: 'try-on' as const };
      const saved = source && !asNew ? outfitService.update(source.id, source.revision, draft) : outfitService.create(draft);
      tryOnSession.markSaved(saved);
      this.syncSession();
      wx.showToast({ title: '穿搭已保存', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存未完成', content: error instanceof Error ? error.message : '请稍后重试，当前调整已保留。', showCancel: false });
    } finally { this.setData({ savingOutfit: false }); }
  },
  newOutfit() {
    if (this.data.savingOutfit) return;
    const start = () => {
      tryOnSession.startNew();
      this.setData({ query: '', layerFilter: '' });
      this.syncSession();
      wx.nextTick(() => wx.pageScrollTo({ selector: '#garmentCatalog', duration: 250 }));
      wx.showToast({ title: this.data.totalSupported ? '已开始新搭配，请选择衣物' : '已开始新搭配，请先添加衣物', icon: 'none' });
    };
    if (tryOnSession.hasUnsavedChanges()) {
      wx.showModal({ title: '新建穿搭', content: '将清空尚未保存的组合或调整，确定继续吗？',
        success: (result) => { if (result.confirm) start(); },
        fail: () => wx.showToast({ title: '暂时无法新建，请重试', icon: 'none' }) });
    } else start();
  },
  viewOutfits() { wx.navigateTo({ url: '/pages/outfits/index' }); },
  goMatch() { openWardrobeMatching(); },
  onQueryInput(event: { detail: { value: string } }) { this.setData({ query: event.detail.value }); this.filterCatalog(); },
  setLayerFilter(event: { currentTarget: { dataset: { layer: string } } }) {
    this.setData({ layerFilter: event.currentTarget.dataset.layer }); this.filterCatalog();
  },
  showError(error: unknown) { wx.showToast({ title: error instanceof Error ? error.message : '试衣操作失败', icon: 'none' }); },
  editBody() { wx.navigateTo({ url: '/pages/body-settings/index' }); },
  addGarment() { wx.navigateTo({ url: '/pages/garment-form/index' }); },
});
