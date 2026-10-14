import { CATEGORY_GROUPS, getCategoryName } from '../../config/categories';
import { getTryOnLayer, layerName } from '../../config/try-on';
import type { Garment, Season } from '../../models/garment';
import { filterGarments } from '../../services/garment-service';
import { garmentService, outfitService } from '../../services/instances';
import { TryOnSession } from '../../services/try-on-session';
import { consumeWardrobeMatchingRequest } from '../../services/wardrobe-navigation';
import type { OutfitBoardItem } from '../../models/outfit';
import type { TryOnGarment } from '../../rendering/garment-layout';
import { changeBoardItem, completeBoard, reorderBoard } from '../../utils/outfit-board';
import { OUTFIT_NAME_LIMIT } from '../../utils/outfit-validation';

// 衣橱搭配与 2D 试衣分别保留内存草稿，共用组合规则和保存服务。
const outfitDraft = new TryOnSession();

interface GarmentCard extends Garment {
  categoryName: string;
  imageFailed?: boolean;
  selected: boolean;
  canMatch: boolean;
}

const seasonOptions = ['全部季节', '春季', '夏季', '秋季', '冬季'];
const seasonValues: Array<Season | undefined> = [undefined, 'spring', 'summer', 'autumn', 'winter'];

Page({
  data: {
    garments: [] as Garment[],
    visible: [] as GarmentCard[],
    query: '',
    groupOptions: ['全部分类', ...CATEGORY_GROUPS.map((group) => group.name)],
    groupIndex: 0,
    typeOptions: ['全部品类'],
    typeIndex: 0,
    colorOptions: ['全部颜色'],
    colorIndex: 0,
    seasonOptions,
    seasonIndex: 0,
    styleOptions: ['全部风格'],
    styleIndex: 0,
    loadError: '',
    scrollAnchor: '',
    outfitMode: false,
    selected: [] as Array<{ id: string; name: string; imagePath: string; layerName: string }>,
    savingOutfit: false,
    outfitNameInput: '', outfitNameLimit: OUTFIT_NAME_LIMIT,
    showBoard: false, boardLocked: false, draftActiveId: '', draftBoardItems: [] as TryOnGarment[], draftBoardLayout: [] as OutfitBoardItem[],
  },

  onShow() {
    const requestedMatching = consumeWardrobeMatchingRequest();
    try {
      const garments = garmentService.list();
      const colors = [...new Set(garments.map((item) => item.color).filter((value): value is string => !!value))].sort();
      const styles = [...new Set(garments.map((item) => item.style).filter((value): value is string => !!value))].sort();
      this.setData({
        garments,
        colorOptions: ['全部颜色', ...colors],
        colorIndex: 0,
        styleOptions: ['全部风格', ...styles],
        styleIndex: 0,
        loadError: '',
      });
      const removed = outfitDraft.reconcile(garments);
      this.syncOutfitSelection();
      this.applyFilter();
      if (requestedMatching) this.startOutfitMode();
      if (removed.length) wx.showToast({ title: '已移除不可用的搭配衣物', icon: 'none' });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '衣橱读取失败。', garments: [], visible: [] });
    }
  },

  applyFilter(resetScroll = true) {
    const group = CATEGORY_GROUPS[this.data.groupIndex - 1];
    const type = group?.types[this.data.typeIndex - 1];
    const color = this.data.colorIndex ? this.data.colorOptions[this.data.colorIndex] : undefined;
    const style = this.data.styleIndex ? this.data.styleOptions[this.data.styleIndex] : undefined;
    const visible = filterGarments(this.data.garments, {
      query: this.data.query,
      groupId: group?.id,
      typeId: type?.id,
      color,
      season: seasonValues[this.data.seasonIndex],
      style,
    }).map((item) => ({ ...item, categoryName: getCategoryName(item.category), canMatch: !!getTryOnLayer(item),
      selected: this.data.selected.some((entry) => entry.id === item.id) }));
    this.setData({ visible, ...(resetScroll ? { scrollAnchor: this.data.scrollAnchor === 'list-start-a' ? 'list-start-b' : 'list-start-a' } : {}) });
  },

  syncOutfitSelection() {
    const items = outfitDraft.list();
    const draftBoardItems = items.flatMap((item) => { const garment = this.data.garments.find((entry) => entry.id === item.garmentId); return garment ? [{ ...item, garment }] : []; });
    this.setData({ draftBoardItems, draftBoardLayout: completeBoard(items, this.data.draftBoardLayout),
      draftActiveId: items.some((item) => item.garmentId === this.data.draftActiveId) ? this.data.draftActiveId : items[items.length - 1]?.garmentId || '',
      ...(!items.length ? { showBoard: false, boardLocked: false } : {}) });
    this.setData({ selected: outfitDraft.list().flatMap((item) => {
      const garment = this.data.garments.find((entry) => entry.id === item.garmentId);
      return garment ? [{ id: garment.id, name: garment.name, imagePath: garment.image.displayPath,
        layerName: layerName(getTryOnLayer(garment)!) }] : [];
    }) });
  },
  startOutfitMode() {
    if (this.data.savingOutfit || this.data.loadError) return;
    this.setData({ outfitMode: true, query: '', groupIndex: 0, typeIndex: 0, typeOptions: ['全部品类'],
      colorIndex: 0, seasonIndex: 0, styleIndex: 0 });
    this.applyFilter();
  },
  browseGarments() {
    if (!this.data.savingOutfit) this.setData({ outfitMode: false, showBoard: false, boardLocked: false });
  },
  selectForOutfit(id: string) {
    if (this.data.savingOutfit || this.data.loadError) return;
    const garment = this.data.garments.find((item) => item.id === id);
    if (!garment) return;
    if (!getTryOnLayer(garment)) { wx.showToast({ title: '请选择上装、下装、外套或连体装', icon: 'none' }); return; }
    try {
      if (this.data.selected.some((item) => item.id === id)) outfitDraft.remove(id);
      else {
        const removed = outfitDraft.wear(garment);
        if (removed.length) wx.showToast({ title: '已替换同层或互斥衣物', icon: 'none' });
      }
      this.syncOutfitSelection();
      this.applyFilter(false);
    } catch (error) { this.showOutfitError(error); }
  },
  removeSelected(event: { currentTarget: { dataset: { id: string } } }) { this.selectForOutfit(event.currentTarget.dataset.id); },
  onOutfitNameInput(event: WechatMiniprogram.Input) { if (!this.data.savingOutfit) this.setData({ outfitNameInput: event.detail.value }); },
  saveSelectedOutfit() {
    if (this.data.savingOutfit || this.data.loadError || !this.data.selected.length) return;
    this.setData({ savingOutfit: true });
    try {
      outfitService.createFree(outfitDraft.list(), this.data.draftBoardLayout, this.data.outfitNameInput);
      this.setData({ outfitNameInput: '' });
      outfitDraft.startNew(); this.syncOutfitSelection(); this.applyFilter(false);
      wx.showToast({ title: '已保存到我的穿搭', icon: 'success' });
    } catch (error) { this.showOutfitError(error); }
    finally { this.setData({ savingOutfit: false }); }
  },
  toggleDraftBoard() {
    if (!this.data.selected.length || this.data.savingOutfit) return;
    const showBoard = !this.data.showBoard;
    this.setData({ showBoard, boardLocked: false, scrollAnchor: showBoard ? 'draft-board' : 'list-start-a' });
  },
  onDraftBoardSelect(event: { detail: { garmentId: string } }) { this.setData({ draftActiveId: event.detail.garmentId }); },
  onDraftBoardRaise(event: { detail: { garmentId: string } }) { if (!this.data.savingOutfit) this.setData({ draftBoardLayout: reorderBoard(this.data.draftBoardLayout, event.detail.garmentId), draftActiveId: event.detail.garmentId }); },
  onDraftBoardChange(event: { detail: OutfitBoardItem }) { if (!this.data.savingOutfit) this.setData({ draftBoardLayout: changeBoardItem(this.data.draftBoardLayout, event.detail.garmentId, event.detail) }); },
  onDraftBoardGesture(event: { detail: { locked: boolean } }) { this.setData({ boardLocked: event.detail.locked }); },
  showOutfitError(error: unknown) { wx.showToast({ title: error instanceof Error ? error.message : '保存失败，请重试', icon: 'none' }); },
  viewOutfits() { wx.navigateTo({ url: '/pages/outfits/index' }); },

  onSearchInput(event: WechatMiniprogram.Input) {
    this.setData({ query: event.detail.value });
    this.applyFilter();
  },

  onGroupChange(event: { detail: { value: string } }) {
    const groupIndex = Number(event.detail.value);
    const group = CATEGORY_GROUPS[groupIndex - 1];
    this.setData({ groupIndex, typeIndex: 0, typeOptions: ['全部品类', ...(group?.types.map((type) => type.name) || [])] });
    this.applyFilter();
  },

  onFilterChange(event: { detail: { value: string }; currentTarget: { dataset: { kind: string } } }) {
    const index = Number(event.detail.value);
    const kind = event.currentTarget.dataset.kind;
    if (kind === 'type') this.setData({ typeIndex: index });
    if (kind === 'color') this.setData({ colorIndex: index });
    if (kind === 'season') this.setData({ seasonIndex: index });
    if (kind === 'style') this.setData({ styleIndex: index });
    this.applyFilter();
  },

  onImageError(event: { currentTarget: { dataset: { id: string } } }) {
    this.setData({ visible: this.data.visible.map((item) => item.id === event.currentTarget.dataset.id ? { ...item, imageFailed: true } : item) });
  },

  openGarment(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.outfitMode) { this.selectForOutfit(event.currentTarget.dataset.id); return; }
    wx.navigateTo({ url: `/pages/garment-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },

  addGarment() {
    wx.navigateTo({ url: '/pages/garment-form/index' });
  },
});
