import type { Outfit } from '../../models/outfit';
import { garmentService, outfitService } from '../../services/instances';
import { resolveOutfitItems } from '../../utils/outfit-resolution';
import { openWardrobeMatching } from '../../services/wardrobe-navigation';

interface OutfitCard { id: string; name: string; count: number; issueCount: number; images: string[]; date: string; kindLabel: string }
Page({
  data: { deleted: false, query: '', outfits: [] as Outfit[], cards: [] as OutfitCard[], loadError: '', deletingId: '' },
  onShow() { this.loadOutfits(); },
  loadOutfits() {
    try {
      const outfits = outfitService.list(this.data.deleted ? 'deleted' : 'active');
      const garments = garmentService.list();
      const query = this.data.query.trim().toLocaleLowerCase();
      const cards = outfits.filter((item) => !query || item.name.toLocaleLowerCase().includes(query)).map((item) => {
        const resolved = resolveOutfitItems(item.items, garments);
        return { id: item.id, name: item.name, count: item.items.length, issueCount: resolved.issues.length,
          images: resolved.available.slice(0, 3).map((entry) => entry.garment.image.displayPath),
          date: (item.deletedAt || item.updatedAt).slice(0, 10), kindLabel: item.kind === 'free' ? '自由搭配' : item.kind === 'try-on' ? '模特试衣' : '已保存' };
      });
      this.setData({ outfits, cards, loadError: '' });
    } catch (error) { this.setData({ loadError: error instanceof Error ? error.message : '穿搭读取失败。' }); }
  },
  setMode(event: { currentTarget: { dataset: { mode: string } } }) {
    this.setData({ deleted: event.currentTarget.dataset.mode === 'deleted' }); this.loadOutfits();
  },
  onQueryInput(event: { detail: { value: string } }) { this.setData({ query: event.detail.value }); this.loadOutfits(); },
  openOutfit(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  deleteCard(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.deleted || this.data.deletingId || this.data.loadError) return;
    const outfit = this.data.outfits.find((item) => item.id === event.currentTarget.dataset.id);
    if (!outfit) return;
    this.setData({ deletingId: outfit.id });
    wx.showModal({ title: '删除这套穿搭？', content: '移入回收站后仍可恢复，衣橱和日历存档会保留。',
      success: (result) => {
        if (!result.confirm) return;
        try { outfitService.delete(outfit.id, outfit.revision); this.loadOutfits(); wx.showToast({ title: '已移入回收站', icon: 'success' }); }
        catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '删除未完成，请重试', icon: 'none' }); this.loadOutfits(); }
      }, fail: () => wx.showToast({ title: '暂时无法删除，请重试', icon: 'none' }),
      complete: () => this.setData({ deletingId: '' }) });
  },
  goTryOn() { wx.switchTab({ url: '/pages/try-on/index' }); },
  goMatch() { openWardrobeMatching(); },
  goCalendar() { wx.navigateTo({ url: '/pages/outfit-calendar/index' }); },
});
