import type { Outfit } from '../models/outfit';
import { cloneOutfit, isOutfit } from '../utils/outfit-validation';

export interface OutfitRepository { list(): Outfit[]; put(outfit: Outfit): void }
interface OutfitSnapshot { version: 1; outfits: Outfit[] }
const STORAGE_KEY = 'smart-wardrobe.outfits.v1';

export class LocalOutfitRepository implements OutfitRepository {
  list(): Outfit[] {
    const raw: unknown = wx.getStorageSync(STORAGE_KEY);
    if (raw === '' || raw === undefined || raw === null) return [];
    if (!raw || typeof raw !== 'object') throw new Error('穿搭数据格式异常，暂时无法读取。');
    const snapshot = raw as Partial<OutfitSnapshot>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.outfits) || !snapshot.outfits.every(isOutfit)
      || new Set(snapshot.outfits.map((item) => item.id)).size !== snapshot.outfits.length) {
      throw new Error('穿搭数据格式异常，暂时无法读取。');
    }
    return snapshot.outfits.map(cloneOutfit);
  }
  put(outfit: Outfit): void {
    if (!isOutfit(outfit)) throw new Error('穿搭记录无效，无法保存。');
    const outfits = this.list();
    const index = outfits.findIndex((item) => item.id === outfit.id);
    if (index < 0) outfits.push(cloneOutfit(outfit));
    else outfits[index] = cloneOutfit(outfit);
    wx.setStorageSync(STORAGE_KEY, { version: 1, outfits } satisfies OutfitSnapshot);
  }
}
