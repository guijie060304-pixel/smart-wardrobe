import type { OutfitItem } from './outfit';

export interface CalendarGarment extends OutfitItem {
  name: string;
  /** 日历专属本地照片副本；原衣物缺失时为空。 */
  imagePath: string;
}
export interface CalendarLook {
  id: string;
  sourceOutfitId: string;
  name: string;
  items: CalendarGarment[];
  addedAt: string;
}
export interface CalendarDay {
  date: string;
  looks: CalendarLook[];
  note: string;
  revision: number;
  updatedAt: string;
}
