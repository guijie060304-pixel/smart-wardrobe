import type { CalendarDay, CalendarLook } from '../models/outfit-calendar';
import type { Garment } from '../models/garment';
import type { Outfit } from '../models/outfit';
import type { OutfitCalendarRepository } from '../repositories/outfit-calendar-repository';
import { isCalendarDate } from '../utils/calendar-date';
import { cloneCalendarDay, cloneCalendarLook, DAY_LOOK_LIMIT, normalizeCalendarNote } from '../utils/outfit-calendar';
import { archiveCalendarImage, removeCalendarImage } from './calendar-images';

interface ImageArchive { save(source: string): Promise<string>; remove(path: string): Promise<void> }
export class OutfitCalendarService {
  constructor(private readonly repository: OutfitCalendarRepository, private readonly outfits: { get(id: string): Outfit | undefined },
    private readonly garments: { list(): Garment[] }, private readonly images: ImageArchive = { save: archiveCalendarImage, remove: removeCalendarImage }) {}
  list(): CalendarDay[] { return this.repository.list().map(cloneCalendarDay); }
  get(date: string): CalendarDay | undefined {
    if (!isCalendarDate(date)) throw new Error('请选择有效日期。');
    return this.list().find((entry) => entry.date === date);
  }
  private checked(date: string, revision: number): CalendarDay {
    const previous = this.get(date);
    if (!Number.isSafeInteger(revision) || revision < 0 || (previous?.revision || 0) !== revision) throw new Error('这一天的记录已更改，请重新读取后再操作。');
    return previous || { date, note: '', looks: [], revision: 0, updatedAt: new Date().toISOString() };
  }
  saveNote(date: string, revision: number, note: string): CalendarDay {
    const previous = this.checked(date, revision);
    const day = { ...previous, note: normalizeCalendarNote(note), revision: revision + 1, updatedAt: new Date().toISOString() };
    this.repository.put(day, revision); return cloneCalendarDay(day);
  }
  async addOutfits(date: string, revision: number, ids: string[]): Promise<CalendarDay> {
    const previous = this.checked(date, revision);
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('请勾选要加入的穿搭。');
    if (previous.looks.length + ids.length > DAY_LOOK_LIMIT) throw new Error(`同一天最多保存 ${DAY_LOOK_LIMIT} 套穿搭。`);
    if (ids.some((id) => previous.looks.some((look) => look.sourceOutfitId === id))) throw new Error('所选穿搭已经加入这一天。');
    const source = ids.map((id) => { const outfit = this.outfits.get(id); if (!outfit || outfit.deletedAt) throw new Error('部分穿搭已移入回收站，请重新选择。'); return outfit; });
    const garments = this.garments.list(), created: string[] = [], looks: CalendarLook[] = [];
    try {
      for (const outfit of source) {
        const now = new Date().toISOString();
        const look: CalendarLook = { id: `look_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`, sourceOutfitId: outfit.id, name: outfit.name, addedAt: now, items: [] };
        for (const item of outfit.items) {
          const garment = garments.find((entry) => entry.id === item.garmentId);
          const imagePath = garment ? await this.images.save(garment.image.displayPath) : '';
          if (imagePath) created.push(imagePath);
          look.items.push({ ...item, transform: { ...item.transform }, name: garment?.name || '已删除的衣物', imagePath });
        }
        looks.push(cloneCalendarLook(look));
      }
      const day = { ...previous, looks: [...previous.looks, ...looks], revision: revision + 1, updatedAt: new Date().toISOString() };
      this.repository.put(day, revision); return cloneCalendarDay(day);
    } catch (error) {
      await Promise.allSettled(created.map((path) => this.images.remove(path)));
      throw error;
    }
  }
  async removeLook(date: string, revision: number, lookId: string): Promise<CalendarDay> {
    const previous = this.checked(date, revision), removed = previous.looks.find((look) => look.id === lookId);
    if (!removed) throw new Error('这套日期记录已移除，请重新读取。');
    const day = { ...previous, looks: previous.looks.filter((look) => look.id !== lookId), revision: revision + 1, updatedAt: new Date().toISOString() };
    const remaining = [...this.list().filter((entry) => entry.date !== date), day];
    const referenced = new Set(remaining.flatMap((entry) => entry.looks.flatMap((look) => look.items.map((item) => item.imagePath))));
    this.repository.put(day, revision);
    await Promise.allSettled(removed.items.filter((item) => item.imagePath && !referenced.has(item.imagePath)).map((item) => this.images.remove(item.imagePath)));
    return cloneCalendarDay(day);
  }
}
