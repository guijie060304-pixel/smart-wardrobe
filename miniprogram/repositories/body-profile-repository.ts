import type { BodyProfile } from '../models/body-profile';
import { validateBodyMeasurements } from '../utils/body-validation';

export interface BodyProfileRepository {
  get(): BodyProfile | null;
  save(profile: BodyProfile): void;
}

interface BodySnapshot { version: 1; profile: BodyProfile }
const STORAGE_KEY = 'smart-wardrobe.body-profile.v1';

export class LocalBodyProfileRepository implements BodyProfileRepository {
  get(): BodyProfile | null {
    const raw: unknown = wx.getStorageSync(STORAGE_KEY);
    if (raw === '' || raw === undefined || raw === null) return null;
    if (!raw || typeof raw !== 'object') throw new Error('身材记录格式异常，暂时无法读取。');
    const snapshot = raw as Partial<BodySnapshot>;
    const profile = snapshot.profile;
    if (snapshot.version !== 1 || !profile || typeof profile !== 'object'
      || typeof profile.updatedAt !== 'string' || !profile.updatedAt
      || Object.keys(validateBodyMeasurements(profile)).length > 0) {
      throw new Error('身材记录格式异常，暂时无法读取。');
    }
    return { ...profile };
  }

  save(profile: BodyProfile): void {
    // 先检查现有记录，损坏数据不自动覆盖。
    this.get();
    wx.setStorageSync(STORAGE_KEY, { version: 1, profile: { ...profile } } satisfies BodySnapshot);
  }
}
