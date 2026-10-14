import { SAMPLE_BODY } from '../../config/body';
import { layerName, type TryOnLayer } from '../../config/try-on';
import type { BodyMeasurements } from '../../models/body-profile';
import type { Outfit, OutfitBoardItem } from '../../models/outfit';
import type { TryOnGarment } from '../../rendering/garment-layout';
import { bodyProfileService, garmentService, outfitService } from '../../services/instances';
import { tryOnSession } from '../../services/try-on-session';
import { resolveOutfitItems, type OutfitIssue } from '../../utils/outfit-resolution';
import { boardSignature, changeBoardItem, completeBoard, reorderBoard } from '../../utils/outfit-board';

Page({
  data: { id: '', outfit: null as Outfit | null, nameInput: '', bodyProfile: { ...SAMPLE_BODY } as BodyMeasurements,
    hasProfile: false, renderItems: [] as TryOnGarment[], issues: [] as OutfitIssue[],
    previewMode: 'board', modelError: '', boardLayout: [] as OutfitBoardItem[], boardDirty: false, activeBoardId: '',
    rows: [] as Array<{ id: string; name: string; layerName: string; imagePath: string }>, loadError: '', saving: false, updatedDate: '' },
  onLoad(query: { id?: string }) { this.setData({ id: query.id || '' }); },
  onShow() { if (!this.data.boardDirty) this.loadOutfit(); },
  onUnload() { wx.disableAlertBeforeUnload(); },
  loadOutfit() {
    try {
      const outfit = outfitService.get(this.data.id, true);
      if (!outfit) throw new Error('这套穿搭不存在，请返回列表重新选择。');
      const resolved = resolveOutfitItems(outfit.items, garmentService.list());
      this.setData({ outfit, nameInput: outfit.name, boardLayout: completeBoard(outfit.items, outfit.board), boardDirty: false,
        activeBoardId: resolved.available[resolved.available.length - 1]?.garmentId || '',
        renderItems: resolved.available, issues: resolved.issues, loadError: '', updatedDate: outfit.updatedAt.slice(0, 10),
        rows: resolved.available.map((item) => ({ id: item.garmentId, name: item.garment.name,
          layerName: layerName(item.layer as TryOnLayer), imagePath: item.garment.image.displayPath })) });
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      if (this.data.previewMode === 'model') this.loadModel();
    } catch (error) { this.setData({ loadError: error instanceof Error ? error.message : '穿搭读取失败。' }); }
  },
  setPreviewMode(event: { currentTarget: { dataset: { mode: string } } }) {
    if (this.data.saving) return;
    const previewMode = event.currentTarget.dataset.mode === 'model' ? 'model' : 'board';
    this.setData({ previewMode }); if (previewMode === 'model') this.loadModel();
  },
  loadModel() {
    try { const profile = bodyProfileService.get(); this.setData({ bodyProfile: profile || { ...SAMPLE_BODY }, hasProfile: !!profile, modelError: '' }); }
    catch (error) { this.setData({ modelError: error instanceof Error ? error.message : '身材读取失败，可继续使用搭配画布。' }); }
  },
  setBoardLayout(boardLayout: OutfitBoardItem[]) {
    const outfit = this.data.outfit;
    if (!outfit || outfit.deletedAt || this.data.saving || this.data.loadError) return;
    const boardDirty = boardSignature(boardLayout) !== boardSignature(completeBoard(outfit.items, outfit.board));
    const wasDirty = this.data.boardDirty;
    this.setData({ boardLayout, boardDirty });
    if (boardDirty && !wasDirty) wx.enableAlertBeforeUnload({ message: '画布排列还未保存，离开将丢失本次调整。' });
    else if (!boardDirty && wasDirty) wx.disableAlertBeforeUnload();
  },
  onBoardSelect(event: { detail: { garmentId: string } }) { this.setData({ activeBoardId: event.detail.garmentId }); },
  selectBoardItem(event: { currentTarget: { dataset: { id: string } } }) { this.setData({ activeBoardId: event.currentTarget.dataset.id }); },
  onBoardRaise(event: { detail: { garmentId: string } }) { this.setData({ activeBoardId: event.detail.garmentId }); this.setBoardLayout(reorderBoard(this.data.boardLayout, event.detail.garmentId)); },
  onBoardChange(event: { detail: OutfitBoardItem }) { this.setBoardLayout(changeBoardItem(this.data.boardLayout, event.detail.garmentId, event.detail)); },
  frontBoardItem() { this.setBoardLayout(reorderBoard(this.data.boardLayout, this.data.activeBoardId)); },
  backBoardItem() { this.setBoardLayout(reorderBoard(this.data.boardLayout, this.data.activeBoardId, false)); },
  resetBoard() { if (this.data.outfit) this.setBoardLayout(completeBoard(this.data.outfit.items)); },
  saveBoard(): boolean {
    const outfit = this.data.outfit;
    if (!outfit || outfit.deletedAt || this.data.saving || this.data.loadError) return false;
    if (!this.data.boardDirty) return true;
    this.setData({ saving: true });
    try {
      const saved = outfitService.saveBoard(outfit.id, outfit.revision, this.data.boardLayout);
      this.setData({ outfit: saved, boardDirty: false, updatedDate: saved.updatedAt.slice(0, 10) }); wx.disableAlertBeforeUnload();
      wx.showToast({ title: '画布排列已保存', icon: 'success' }); return true;
    } catch (error) { this.showError(error); return false; }
    finally { this.setData({ saving: false }); }
  },
  onSaveBoard() { this.saveBoard(); },
  onNameInput(event: { detail: { value: string } }) { this.setData({ nameInput: event.detail.value }); },
  rename() {
    if (!this.data.outfit || this.data.saving || this.data.loadError) return;
    this.setData({ saving: true });
    try {
      outfitService.rename(this.data.id, this.data.outfit.revision, this.data.nameInput);
      this.loadOutfit(); wx.showToast({ title: '名称已保存', icon: 'success' });
    } catch (error) { this.showError(error); }
    finally { this.setData({ saving: false }); }
  },
  editInTryOn() {
    if (!this.data.outfit || this.data.outfit.deletedAt || this.data.loadError) return;
    if (this.data.boardDirty) {
      wx.showModal({ title: '先保存画布排列？', content: '保存成功后再进入模特试衣。', confirmText: '保存并前往', cancelText: '继续排列',
        success: (result) => { if (result.confirm && this.saveBoard()) this.editInTryOn(); } }); return;
    }
    const load = () => {
      try {
        const latest = outfitService.get(this.data.id);
        if (!latest) throw new Error('这套穿搭已删除，请重新读取。');
        if (latest.revision !== this.data.outfit?.revision) throw new Error('穿搭已更改，请重新读取后再载入。');
        const garments = garmentService.list();
        tryOnSession.load(latest, garments);
        tryOnSession.setName(this.data.nameInput);
        wx.switchTab({ url: '/pages/try-on/index' });
      } catch (error) { this.showError(error); }
    };
    if (tryOnSession.hasUnsavedChanges()) {
      wx.showModal({ title: '载入穿搭', content: '将替换试衣间中尚未保存的组合或调整，确定继续吗？',
        success: (result) => { if (result.confirm) load(); } });
    } else load();
  },
  deleteOutfit() {
    if (!this.data.outfit || this.data.saving || this.data.loadError) return;
    wx.showModal({ title: '删除穿搭', content: '穿搭将移入回收站，可随时恢复。衣橱中的衣物会保留。',
      success: (result) => {
        if (!result.confirm || !this.data.outfit || this.data.saving) return;
        this.setData({ saving: true });
        try { outfitService.delete(this.data.id, this.data.outfit.revision); this.loadOutfit(); wx.showToast({ title: '已移入回收站', icon: 'success' }); }
        catch (error) { this.showError(error); }
        finally { this.setData({ saving: false }); }
      } });
  },
  restoreOutfit() {
    if (!this.data.outfit || this.data.saving || this.data.loadError) return;
    this.setData({ saving: true });
    try { outfitService.restore(this.data.id, this.data.outfit.revision); this.loadOutfit(); wx.showToast({ title: '穿搭已恢复', icon: 'success' }); }
    catch (error) { this.showError(error); }
    finally { this.setData({ saving: false }); }
  },
  showError(error: unknown) { wx.showModal({ title: '操作未完成', content: error instanceof Error ? error.message : '请稍后重试。', showCancel: false }); },
});
