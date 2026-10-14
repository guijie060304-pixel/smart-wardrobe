import type { Garment } from '../models/garment';
import { isCategoryPath } from '../config/categories';
import { cloneFitting, fittingMatches } from '../utils/garment-fitting';

export interface GarmentRepository {
  list(): Garment[];
  put(garment: Garment): void;
  remove(id: string): void;
}

interface GarmentSnapshot {
  version: 1;
  garments: Garment[];
}

const STORAGE_KEY = 'smart-wardrobe.garments.v1';

function isGarment(value: unknown): value is Garment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Garment;
  const validDate = (date: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  return typeof item.id === 'string' && item.id.length > 0
    && typeof item.name === 'string'
    && isCategoryPath(item.category)
    && !!item.image && typeof item.image.displayPath === 'string' && item.image.displayPath.length > 0
    && (item.image.overlayPath === undefined || typeof item.image.overlayPath === 'string')
    && (item.image.originalPath === undefined || (typeof item.image.originalPath === 'string' && item.image.originalPath.length > 0))
    && (item.fitting === undefined || fittingMatches(item.fitting, item))
    && [item.color, item.style, item.fit, item.material, item.brand, item.note]
      .every((field) => field === undefined || typeof field === 'string')
    && (item.seasons === undefined || (Array.isArray(item.seasons) && item.seasons.every((s) => seasons.includes(s))))
    && (item.tags === undefined || (Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === 'string')))
    && (item.purchasePrice === undefined || (typeof item.purchasePrice === 'number' && Number.isFinite(item.purchasePrice) && item.purchasePrice >= 0))
    && (item.purchaseDate === undefined || (typeof item.purchaseDate === 'string' && validDate(item.purchaseDate)))
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt));
}

export class LocalGarmentRepository implements GarmentRepository {
  list(): Garment[] {
    const raw: unknown = wx.getStorageSync(STORAGE_KEY);
    if (raw === '' || raw === undefined || raw === null) return [];
    if (!raw || typeof raw !== 'object') throw new Error('衣橱数据格式异常，请先备份本地数据。');
    const snapshot = raw as Partial<GarmentSnapshot>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.garments)
      || !snapshot.garments.every(isGarment)
      || new Set(snapshot.garments.map((item) => item.id)).size !== snapshot.garments.length) {
      throw new Error('衣橱数据格式异常，请先备份本地数据。');
    }
    return snapshot.garments.map((item) => ({ ...item, category: { ...item.category }, image: { ...item.image },
      fitting: item.fitting ? cloneFitting(item.fitting) : undefined,
      seasons: item.seasons ? [...item.seasons] : undefined, tags: item.tags ? [...item.tags] : undefined }));
  }

  put(garment: Garment): void {
    const garments = this.list();
    if (!isGarment(garment)) throw new Error('衣物记录无效，无法保存。');
    const index = garments.findIndex((item) => item.id === garment.id);
    if (index >= 0) garments[index] = garment;
    else garments.push(garment);
    wx.setStorageSync(STORAGE_KEY, { version: 1, garments } satisfies GarmentSnapshot);
  }

  remove(id: string): void {
    const garments = this.list();
    wx.setStorageSync(STORAGE_KEY, {
      version: 1,
      garments: garments.filter((item) => item.id !== id),
    } satisfies GarmentSnapshot);
  }
}
