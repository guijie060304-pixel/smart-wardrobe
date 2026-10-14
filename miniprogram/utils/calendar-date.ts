export const CALENDAR_RANGE = { start: '1900-01-01', end: '2199-12-31' };
const pad = (value: number): string => String(value).padStart(2, '0');
export function localDateKey(value = new Date()): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < CALENDAR_RANGE.start || value > CALENDAR_RANGE.end) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftCalendarMonth(value: string, offset: number): string {
  if (!isCalendarDate(value) || !Number.isSafeInteger(offset)) throw new Error('日期无效。');
  const [year, month, day] = value.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  const shifted = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(day, last))}`;
  if (!isCalendarDate(shifted)) throw new Error('已到日历支持的日期边界。');
  return shifted;
}
export interface CalendarCell { date: string; day: number; inMonth: boolean; selected: boolean; today: boolean; disabled: boolean; count: number; hasNote: boolean }
export function calendarCells(selected: string, today: string, marks: Record<string, { count: number; hasNote: boolean }> = {}): CalendarCell[] {
  if (!isCalendarDate(selected)) throw new Error('日期无效。');
  const [year, month] = selected.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, 1 - mondayOffset + index, 12));
    const key = date.toISOString().slice(0, 10);
    return { date: key, day: date.getUTCDate(), inMonth: key.slice(0, 7) === selected.slice(0, 7), selected: key === selected,
      today: key === today, disabled: !isCalendarDate(key), count: marks[key]?.count || 0, hasNote: !!marks[key]?.hasNote };
  });
}
export function calendarDateLabel(value: string): string {
  if (!isCalendarDate(value)) throw new Error('日期无效。');
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日 · 星期${'日一二三四五六'[new Date(`${value}T12:00:00.000Z`).getUTCDay()]}`;
}
