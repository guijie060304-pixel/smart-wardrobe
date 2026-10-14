import type { CalendarDay } from '../models/outfit-calendar';
import { cloneCalendarDay, isCalendarDay } from '../utils/outfit-calendar';

export const CALENDAR_STORAGE_KEY = 'smart-wardrobe.calendar.v1';
export interface OutfitCalendarRepository { list(): CalendarDay[]; put(day: CalendarDay, expectedRevision: number): void }
export class LocalOutfitCalendarRepository implements OutfitCalendarRepository {
  list(): CalendarDay[] {
    const raw: unknown = wx.getStorageSync(CALENDAR_STORAGE_KEY);
    if (raw === '' || raw === undefined || raw === null) return [];
    if (!raw || typeof raw !== 'object') throw new Error('穿搭日历数据格式异常，暂时无法读取。');
    const snapshot = raw as { version?: number; days?: CalendarDay[] };
    if (snapshot.version !== 1 || !Array.isArray(snapshot.days) || !snapshot.days.every(isCalendarDay)
      || new Set(snapshot.days.map((day) => day.date)).size !== snapshot.days.length) throw new Error('穿搭日历数据格式异常，暂时无法读取。');
    return snapshot.days.map(cloneCalendarDay);
  }
  put(day: CalendarDay, expectedRevision: number): void {
    if (!isCalendarDay(day) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || day.revision !== expectedRevision + 1) throw new Error('日历记录无效，无法保存。');
    const days = this.list(), index = days.findIndex((entry) => entry.date === day.date);
    if ((index < 0 ? 0 : days[index].revision) !== expectedRevision) throw new Error('这一天的记录已更改，请重新读取后再操作。');
    if (index < 0) days.push(cloneCalendarDay(day)); else days[index] = cloneCalendarDay(day);
    wx.setStorageSync(CALENDAR_STORAGE_KEY, { version: 1, days });
  }
}
