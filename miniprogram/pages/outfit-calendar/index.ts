import type { CalendarDay, CalendarLook } from '../../models/outfit-calendar';
import type { Outfit } from '../../models/outfit';
import type { Garment } from '../../models/garment';
import { layerName, type TryOnLayer } from '../../config/try-on';
import { outfitCalendarService, outfitService, garmentService } from '../../services/instances';
import { openWardrobeMatching } from '../../services/wardrobe-navigation';
import { calendarCells, calendarDateLabel, CALENDAR_RANGE, isCalendarDate, localDateKey, shiftCalendarMonth } from '../../utils/calendar-date';
import { CALENDAR_NOTE_LIMIT, DAY_LOOK_LIMIT } from '../../utils/outfit-calendar';

interface LookCard extends CalendarLook { pieces: Array<{ garmentId: string; imagePath: string; name: string; layerName: string; failed: boolean }> }
interface OutfitChoice { id: string; name: string; images: string[]; count: number; missing: number; added: boolean; selected: boolean }
interface State { days: CalendarDay[]; outfits: Outfit[]; garments: Garment[]; failedImages: Set<string> }
const states = new WeakMap<object, State>();
type IdEvent = { currentTarget: { dataset: { id: string } } };

Page({
  data: {
    selectedDate: '', today: '', monthLabel: '', dateLabel: '', dateContext: '', range: CALENDAR_RANGE,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'], cells: [] as ReturnType<typeof calendarCells>,
    looks: [] as LookCard[], revision: 0, noteSaved: '', noteDraft: '', noteDirty: false, editingNote: false,
    noteLimit: CALENDAR_NOTE_LIMIT, lookLimit: DAY_LOOK_LIMIT, loadError: '', error: '', saving: false,
    pickerOpen: false, pickerError: '', outfitQuery: '', selectedOutfitIds: [] as string[], choices: [] as OutfitChoice[], outfitCount: 0,
  },
  onLoad(query: { date?: string }) {
    states.set(this, { days: [], outfits: [], garments: [], failedImages: new Set() });
    const today = localDateKey();
    this.setData({ today, selectedDate: isCalendarDate(query.date) ? query.date : today });
  },
  onShow() { this.setData({ today: localDateKey() }); this.loadCalendar(); },
  onUnload() { states.delete(this); wx.disableAlertBeforeUnload(); },
  loadCalendar() {
    const state = states.get(this); if (!state) return;
    try {
      state.days = outfitCalendarService.list();
      const date = this.data.selectedDate;
      const day = state.days.find((entry) => entry.date === date);
      const note = day?.note || '', preserveDraft = this.data.noteDirty;
      const conflictingNote = preserveDraft && note !== this.data.noteSaved;
      const marks: Record<string, { count: number; hasNote: boolean }> = {};
      for (const entry of state.days) marks[entry.date] = { count: entry.looks.length, hasNote: !!entry.note };
      const looks: LookCard[] = (day?.looks || []).map((look) => ({ ...look, pieces: look.items.map((item) => ({
        garmentId: item.garmentId, imagePath: item.imagePath, name: item.name, layerName: layerName(item.layer as TryOnLayer), failed: state.failedImages.has(item.imagePath),
      })) }));
      this.setData({ cells: calendarCells(date, this.data.today, marks), looks, monthLabel: `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月`,
        dateLabel: calendarDateLabel(date), dateContext: date === this.data.today ? '今天 · 参考喜欢的组合' : date < this.data.today ? '回顾这一天收藏的穿搭' : '提前准备这一天的穿搭',
        revision: conflictingNote ? this.data.revision : day?.revision || 0,
        noteSaved: preserveDraft ? this.data.noteSaved : note, noteDraft: preserveDraft ? this.data.noteDraft : note,
        loadError: '', error: conflictingNote ? '注意事项已在其他页面更改。当前输入已保留，可取消修改后重新读取。' : '' });
      if (this.data.pickerOpen) this.filterOutfits();
    } catch (error) { this.setData({ loadError: error instanceof Error ? error.message : '日历读取失败，请重试。' }); }
  },
  selectDate(event: { currentTarget: { dataset: { date: string } } }) { this.requestDate(event.currentTarget.dataset.date); },
  onDatePicker(event: { detail: { value: string } }) { this.requestDate(event.detail.value); },
  goToday() { const today = localDateKey(); this.setData({ today }); this.requestDate(today); },
  changeMonth(event: { currentTarget: { dataset: { offset: string | number } } }) {
    try { this.requestDate(shiftCalendarMonth(this.data.selectedDate, Number(event.currentTarget.dataset.offset))); }
    catch (error) { this.showError(error); }
  },
  requestDate(date: string) {
    if (this.data.saving || !isCalendarDate(date) || date === this.data.selectedDate) return;
    const change = () => {
      this.setData({ selectedDate: date, noteDirty: false, editingNote: false, pickerOpen: false, selectedOutfitIds: [], outfitQuery: '' });
      wx.disableAlertBeforeUnload(); this.loadCalendar();
    };
    if (!this.data.noteDirty) { change(); return; }
    wx.showModal({ title: '先保存注意事项？', content: '当前输入还没有保存，保存成功后再切换日期。', confirmText: '保存并切换', cancelText: '继续编辑',
      success: (result) => { if (result.confirm && this.saveNote(true)) change(); }, fail: () => this.showError(new Error('暂时无法切换日期，当前输入已保留。')) });
  },
  editNote() {
    if (this.data.saving || this.data.loadError) return;
    this.setData({ editingNote: true });
    wx.nextTick(() => wx.pageScrollTo({ selector: '#dayNote', duration: 200 }));
  },
  onNoteInput(event: { detail: { value: string } }) {
    if (this.data.saving) return;
    const value = event.detail.value;
    this.setData({ noteDraft: value, noteDirty: value !== this.data.noteSaved });
    if (this.data.noteDirty) wx.enableAlertBeforeUnload({ message: '注意事项尚未保存，离开将丢失本次输入。' }); else wx.disableAlertBeforeUnload();
  },
  cancelNote() {
    if (this.data.saving) return;
    this.setData({ noteDirty: false, editingNote: false, noteDraft: this.data.noteSaved, error: '' });
    wx.disableAlertBeforeUnload(); this.loadCalendar();
  },
  saveNote(silent = false): boolean {
    if (this.data.saving || this.data.loadError) return false;
    if (!this.data.noteDirty) { this.setData({ editingNote: false }); return true; }
    this.setData({ saving: true, error: '' });
    try {
      outfitCalendarService.saveNote(this.data.selectedDate, this.data.revision, this.data.noteDraft);
      this.setData({ noteDirty: false, editingNote: false }); wx.disableAlertBeforeUnload(); this.loadCalendar();
      if (!silent) wx.showToast({ title: '注意事项已保存', icon: 'success' }); return true;
    } catch (error) { this.showError(error); return false; }
    finally { this.setData({ saving: false }); }
  },
  onSaveNote() { this.saveNote(); },
  openOutfitPicker() {
    if (this.data.saving || this.data.loadError) return;
    const state = states.get(this)!;
    this.setData({ pickerOpen: true, pickerError: '', outfitQuery: '', selectedOutfitIds: [] });
    try { state.outfits = outfitService.list(); state.garments = garmentService.list(); this.filterOutfits(); }
    catch (error) { this.setData({ pickerError: error instanceof Error ? error.message : '穿搭读取失败。', choices: [] }); }
    wx.nextTick(() => wx.pageScrollTo({ selector: '#outfitPicker', duration: 200 }));
  },
  closeOutfitPicker() { if (!this.data.saving) this.setData({ pickerOpen: false, selectedOutfitIds: [] }); },
  onOutfitQuery(event: { detail: { value: string } }) { this.setData({ outfitQuery: event.detail.value }); this.filterOutfits(); },
  filterOutfits() {
    const state = states.get(this)!;
    const query = this.data.outfitQuery.trim().toLocaleLowerCase(), added = new Set(this.data.looks.map((look) => look.sourceOutfitId));
    const choices = state.outfits.filter((outfit) => !query || outfit.name.toLocaleLowerCase().includes(query)).map((outfit) => {
      const pieces = outfit.items.map((item) => state.garments.find((entry) => entry.id === item.garmentId));
      return { id: outfit.id, name: outfit.name, images: pieces.flatMap((item) => item ? [item.image.displayPath] : []), count: outfit.items.length,
        missing: pieces.filter((item) => !item).length, added: added.has(outfit.id), selected: this.data.selectedOutfitIds.includes(outfit.id) };
    });
    this.setData({ choices, outfitCount: state.outfits.length });
  },
  toggleOutfit(event: IdEvent) {
    if (this.data.saving) return;
    const id = event.currentTarget.dataset.id, choice = this.data.choices.find((item) => item.id === id);
    if (!choice || choice.added) return;
    const ids = this.data.selectedOutfitIds;
    if (!ids.includes(id) && ids.length + this.data.looks.length >= DAY_LOOK_LIMIT) { this.showError(new Error(`同一天最多保存 ${DAY_LOOK_LIMIT} 套穿搭。`)); return; }
    this.setData({ selectedOutfitIds: ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id] }); this.filterOutfits();
  },
  async addSelectedOutfits() {
    if (this.data.saving || this.data.loadError || !this.data.selectedOutfitIds.length) return;
    const { selectedDate, revision, selectedOutfitIds } = this.data;
    this.setData({ saving: true, error: '' });
    try {
      await outfitCalendarService.addOutfits(selectedDate, revision, [...selectedOutfitIds]);
      if (!states.has(this)) return;
      this.setData({ pickerOpen: false, selectedOutfitIds: [] }); this.loadCalendar();
      wx.showToast({ title: '已加入当天穿搭', icon: 'success' });
    } catch (error) { if (states.has(this)) this.showError(error); }
    finally { if (states.has(this)) this.setData({ saving: false }); }
  },
  removeLook(event: IdEvent) {
    if (this.data.saving || this.data.loadError) return;
    const id = event.currentTarget.dataset.id;
    wx.showModal({ title: '移除当天的这套穿搭？', content: '将删除这一天的照片存档，原来保存的穿搭仍保留。',
      success: async (result) => {
        if (!result.confirm || this.data.saving || !states.has(this)) return;
        this.setData({ saving: true, error: '' });
        try { await outfitCalendarService.removeLook(this.data.selectedDate, this.data.revision, id); if (states.has(this)) this.loadCalendar(); }
        catch (error) { if (states.has(this)) this.showError(error); }
        finally { if (states.has(this)) this.setData({ saving: false }); }
      } });
  },
  previewLook(event: IdEvent) {
    const look = this.data.looks.find((item) => item.id === event.currentTarget.dataset.id);
    const urls = look?.pieces.filter((item) => item.imagePath && !item.failed).map((item) => item.imagePath) || [];
    if (urls.length) wx.previewImage({ urls, current: urls[0] });
  },
  onArchiveImageError(event: { currentTarget: { dataset: { path: string } } }) {
    states.get(this)?.failedImages.add(event.currentTarget.dataset.path); this.loadCalendar();
  },
  goMatch() {
    if (this.data.saving) return;
    const go = () => openWardrobeMatching();
    if (!this.data.noteDirty) go();
    else wx.showModal({ title: '先保存注意事项？', content: '保存成功后前往自由搭配，日期记录会留在本机。', confirmText: '保存并前往', cancelText: '继续编辑',
      success: (result) => { if (result.confirm && this.saveNote(true)) go(); } });
  },
  showError(error: unknown) { const message = error instanceof Error ? error.message : '保存未完成，请重试。'; this.setData({ error: message }); wx.showToast({ title: message, icon: 'none' }); },
});
