import { getCategoryName } from '../../config/categories';
import { garmentService, outfitService } from '../../services/instances';
import { openWardrobeMatching } from '../../services/wardrobe-navigation';

Page({
  data: {
    garmentCount: 0,
    recentGarments: [] as Array<{ id: string; name: string; imagePath: string; categoryName: string }>,
    loadError: '',
    outfitCount: 0, outfitError: '', recentOutfits: [] as Array<{ id: string; name: string; count: number }>,
  },
  onShow() {
    try {
      const garments = garmentService.list();
      this.setData({
        garmentCount: garments.length,
        recentGarments: garments.slice(0, 4).map((item) => ({
          id: item.id, name: item.name, imagePath: item.image.displayPath, categoryName: getCategoryName(item.category),
        })),
        loadError: '',
      });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '衣橱读取失败。' });
    }
    try {
      const outfits = outfitService.list();
      this.setData({ outfitCount: outfits.length, outfitError: '', recentOutfits: outfits.slice(0, 3).map((item) => ({ id: item.id, name: item.name, count: item.items.length })) });
    } catch (error) { this.setData({ outfitError: error instanceof Error ? error.message : '穿搭读取失败。' }); }
  },
  goWardrobe() {
    wx.switchTab({ url: '/pages/wardrobe/index' });
  },
  goMatch() { openWardrobeMatching(); },
  goTryOn() {
    wx.switchTab({ url: '/pages/try-on/index' });
  },
  goAddGarment() {
    wx.navigateTo({ url: '/pages/garment-form/index' });
  },
  goOutfits() { wx.navigateTo({ url: '/pages/outfits/index' }); },
  goCalendar() { wx.navigateTo({ url: '/pages/outfit-calendar/index' }); },
  openOutfit(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  openGarment(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/garment-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
});
