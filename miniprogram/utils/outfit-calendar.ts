import type { CalendarDay, CalendarLook } from '../models/outfit-calendar';
import { assertOutfitItems, cloneOutfitItems, normalizeOutfitName } from './outfit-validation';
import { isCalendarDate } from './calendar-date';

export const CALENDAR_NOTE_LIMIT = 1000;
export const DAY_LOOK_LIMIT = 12;
export function normalizeCalendarNote(value: string): string {
  if (typeof value !== 'string' || value.length > CALENDAR_NOTE_LIMIT) throw new Error(`注意事项最多 ${CALENDAR_NOTE_LIMIT} 个字。`);
  return value.trim();
}
export function cloneCalendarLook(look: CalendarLook): CalendarLook {
  return { id: look.id, sourceOutfitId: look.sourceOutfitId, name: look.name, addedAt: look.addedAt,
    items: cloneOutfitItems(look.items).map((item) => { const original = look.items.find((entry) => entry.garmentId === item.garmentId)!;
      return { ...item, name: original.name, imagePath: original.imagePath }; }) };
}
export function cloneCalendarDay(day: CalendarDay): CalendarDay {
  return { date: day.date, note: day.note, looks: day.looks.map(cloneCalendarLook), revision: day.revision, updatedAt: day.updatedAt };
}
export function isCalendarDay(value: unknown): value is CalendarDay {
  if (!value || typeof value !== 'object') return false;
  const day = value as CalendarDay;
  try {
    if (!isCalendarDate(day.date) || normalizeCalendarNote(day.note) !== day.note || !Number.isSafeInteger(day.revision) || day.revision < 1
      || typeof day.updatedAt !== 'string' || !Number.isFinite(Date.parse(day.updatedAt)) || !Array.isArray(day.looks) || day.looks.length > DAY_LOOK_LIMIT) return false;
    const ids = new Set<string>(), sources = new Set<string>();
    for (const look of day.looks) {
      if (!look || typeof look.id !== 'string' || !look.id || ids.has(look.id) || typeof look.sourceOutfitId !== 'string' || !look.sourceOutfitId
        || sources.has(look.sourceOutfitId) || normalizeOutfitName(look.name) !== look.name || typeof look.addedAt !== 'string' || !Number.isFinite(Date.parse(look.addedAt))) return false;
      ids.add(look.id); sources.add(look.sourceOutfitId); assertOutfitItems(look.items);
      if (!look.items.every((item) => typeof item.name === 'string' && !!item.name && typeof item.imagePath === 'string'
        && (item.imagePath === '' || ((!/^https?:/i.test(item.imagePath) || item.imagePath.startsWith('http://usr/'))
          && /\/calendar_[a-z0-9_-]+\.[a-z0-9]+$/i.test(item.imagePath))))) return false;
    }
    return true;
  } catch { return false; }
}
