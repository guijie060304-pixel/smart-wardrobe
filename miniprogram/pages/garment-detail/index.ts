import { getCategoryName } from '../../config/categories';
import type { Garment } from '../../models/garment';
import { garmentService, outfitService } from '../../services/instances';
import { garmentImagePaths, removeImage } from '../../services/image-service';
import { getTryOnLayer } from '../../config/try-on';
import { tryOnSession } from '../../services/try-on-session';
import { fittingKind } from '../../utils/garment-fitting';

const seasonNames: Record<string, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' };

Page({
  data: {
    id: '',
    garment: null as Garment | null,
    categoryName: '',
    seasonText: '',
    tagText: '',
    imageFailed: false,
    loadError: '',
    canTryOn: false,
    canFit: false,
  },

  onLoad(query: { id?: string }) {
    this.setData({ id: query.id || '' });
  },

  onShow() {
    try {
      const garment = garmentService.get(this.data.id);
      if (!garment) throw new Error('这件衣物不存在，可能已被删除。');
      this.setData({
        garment,
        categoryName: getCategoryName(garment.category),
        seasonText: garment.seasons?.map((value) => seasonNames[value]).join('、') || '',
        tagText: garment.tags?.join('、') || '',
        imageFailed: false,
        loadError: '',
        canTryOn: !!getTryOnLayer(garment),
        canFit: !!fittingKind(garment),
      });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '衣物读取失败。', garment: null });
    }
  },

  onImageError() {
    this.setData({ imageFailed: true });
  },

  previewImage() {
    const path = this.data.garment?.image.displayPath;
    if (path && !this.data.imageFailed) wx.previewImage({ urls: [path], current: path });
  },

  editGarment() {
    wx.navigateTo({ url: `/pages/garment-form/index?id=${encodeURIComponent(this.data.id)}` });
  },
  calibrateGarment() { wx.navigateTo({ url: `/pages/garment-fitting/index?id=${encodeURIComponent(this.data.id)}` }); },

  tryOnGarment() {
    if (!this.data.garment) return;
    try {
      tryOnSession.wear(this.data.garment);
      wx.switchTab({ url: '/pages/try-on/index' });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '暂时无法试穿', icon: 'none' });
    }
  },

  deleteGarment() {
    let referenceCount: number;
    try { referenceCount = outfitService.references(this.data.id).length; }
    catch (error) {
      wx.showModal({ title: '暂时无法删除', content: error instanceof Error ? error.message : '无法检查穿搭引用，请稍后重试。', showCancel: false });
      return;
    }
    wx.showModal({
      title: '删除衣物',
      content: referenceCount ? `这件衣物被 ${referenceCount} 套穿搭引用（含回收站）。删除后保留穿搭并标记衣物缺失，衣物及图片无法恢复。确定删除吗？` : '衣物及图片删除后无法恢复，确定删除吗？',
      confirmColor: '#A34543',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          const garment = garmentService.delete(this.data.id);
          const referenced = new Set(garmentService.list().flatMap((item) => garmentImagePaths(item.image)));
          const paths = garmentImagePaths(garment.image).filter((path) => !referenced.has(path));
          await Promise.all(paths.map((path) => removeImage(path).catch(() => undefined)));
          wx.showToast({ title: '已删除', icon: 'success' });
          wx.navigateBack();
        } catch (error) {
          wx.showModal({ title: '删除失败', content: error instanceof Error ? error.message : '请稍后重试。', showCancel: false });
        }
      },
    });
  },
});
