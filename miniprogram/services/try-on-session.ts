import { DEFAULT_TRANSFORM, getTryOnLayer, LAYER_ORDER, TRANSFORM_LIMITS } from '../config/try-on';
import type { Garment } from '../models/garment';
import type { GarmentTransform, Outfit, OutfitItem } from '../models/outfit';
import { assertOutfitItems, cloneOutfitItems, outfitItemsSignature } from '../utils/outfit-validation';
import { resolveOutfitItems } from '../utils/outfit-resolution';

export function normalizeTransform(value: GarmentTransform): GarmentTransform {
  if (!Object.values(value).every(Number.isFinite)
    || ![value.offsetX, value.offsetY, value.scale, value.rotationDeg].every(Number.isFinite)) throw new Error('衣物调整参数无效。');
  const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
  return {
    offsetX: clamp(value.offsetX, -TRANSFORM_LIMITS.offset, TRANSFORM_LIMITS.offset),
    offsetY: clamp(value.offsetY, -TRANSFORM_LIMITS.offset, TRANSFORM_LIMITS.offset),
    scale: clamp(value.scale, TRANSFORM_LIMITS.minScale, TRANSFORM_LIMITS.maxScale),
    rotationDeg: clamp(value.rotationDeg, -TRANSFORM_LIMITS.rotation, TRANSFORM_LIMITS.rotation),
  };
}

/** 当前运行期间的试衣草稿；正式穿搭持久化由穿搭模块负责。 */
export class TryOnSession {
  private items: OutfitItem[] = [];
  private selectedId = '';
  private unavailableItems: OutfitItem[] = [];
  private editing: { id: string; name: string; revision: number } | null = null;
  private baseline = '';
  private draftName = '';
  get activeId(): string { return this.selectedId; }
  get source(): { id: string; name: string; revision: number } | null { return this.editing ? { ...this.editing } : null; }
  get name(): string { return this.draftName; }
  setName(name: string): void { this.draftName = name; }
  allItems(): OutfitItem[] { return cloneOutfitItems([...this.items, ...this.unavailableItems]); }
  unavailable(): OutfitItem[] { return cloneOutfitItems(this.unavailableItems); }
  hasUnsavedChanges(): boolean {
    return this.editing ? outfitItemsSignature(this.allItems()) !== this.baseline || this.draftName !== this.editing.name
      : this.allItems().length > 0 || !!this.draftName.trim();
  }
  load(outfit: Outfit, garments: Garment[]): void {
    if (outfit.deletedAt) throw new Error('请先从回收站恢复这套穿搭。');
    assertOutfitItems(outfit.items);
    const resolved = resolveOutfitItems(outfit.items, garments);
    this.items = cloneOutfitItems(resolved.available);
    const validIds = new Set(this.items.map((item) => item.garmentId));
    this.unavailableItems = cloneOutfitItems(outfit.items.filter((item) => !validIds.has(item.garmentId)));
    this.selectedId = this.items[this.items.length - 1]?.garmentId || '';
    this.markSaved(outfit);
  }
  markSaved(outfit: Outfit): void {
    this.editing = { id: outfit.id, name: outfit.name, revision: outfit.revision };
    this.baseline = outfitItemsSignature(outfit.items);
    this.draftName = outfit.name;
  }
  startNew(): void { this.clear(); this.editing = null; this.baseline = ''; this.draftName = ''; }
  select(id: string): void { if (this.items.some((item) => item.garmentId === id)) this.selectedId = id; }
  bringToFront(id: string): void {
    if (!this.items.some((item) => item.garmentId === id)) return;
    const ordered = [...this.items].sort((a, b) => (a.zIndex ?? LAYER_ORDER[a.layer as keyof typeof LAYER_ORDER]) - (b.zIndex ?? LAYER_ORDER[b.layer as keyof typeof LAYER_ORDER]));
    const ids = [...ordered.filter((item) => item.garmentId !== id).map((item) => item.garmentId), id];
    this.items = this.items.map((item) => ({ ...item, zIndex: ids.indexOf(item.garmentId) }));
    this.select(id);
  }
  list(): OutfitItem[] { return this.items.map((item) => ({ ...item, transform: { ...item.transform } })); }
  wear(garment: Garment): string[] {
    const layer = getTryOnLayer(garment);
    if (!layer) throw new Error('这类衣物暂不支持试穿。');
    if (this.items.some((item) => item.garmentId === garment.id && item.layer === layer)) { this.select(garment.id); return []; }
    const removed = [...this.items, ...this.unavailableItems].filter((item) => item.layer === layer || item.garmentId === garment.id
      || (layer === 'one-piece' && (item.layer === 'top' || item.layer === 'bottom'))
      || ((layer === 'top' || layer === 'bottom') && item.layer === 'one-piece'));
    this.items = this.items.filter((item) => !removed.includes(item));
    this.unavailableItems = this.unavailableItems.filter((item) => !removed.includes(item));
    this.items.push({ garmentId: garment.id, layer, transform: { ...DEFAULT_TRANSFORM } });
    this.items.sort((a, b) => LAYER_ORDER[a.layer as keyof typeof LAYER_ORDER] - LAYER_ORDER[b.layer as keyof typeof LAYER_ORDER]);
    if (this.items.some((item) => item.zIndex !== undefined)) this.bringToFront(garment.id);
    this.select(garment.id);
    return removed.map((item) => item.garmentId);
  }
  adjust(id: string, patch: Partial<GarmentTransform>): void {
    const item = this.items.find((entry) => entry.garmentId === id);
    if (!item) throw new Error('请先选择正在试穿的衣物。');
    item.transform = normalizeTransform({ ...item.transform, ...patch });
  }
  reset(id: string): void { this.adjust(id, { ...DEFAULT_TRANSFORM }); }
  remove(id: string): void {
    this.items = this.items.filter((item) => item.garmentId !== id);
    this.unavailableItems = this.unavailableItems.filter((item) => item.garmentId !== id);
    if (this.selectedId === id) this.selectedId = this.items[this.items.length - 1]?.garmentId || '';
  }
  clear(): void { this.items = []; this.unavailableItems = []; this.selectedId = ''; }
  reconcile(garments: Garment[]): string[] {
    if (this.editing) {
      const all = this.allItems();
      const previousIds = new Set(this.items.map((item) => item.garmentId));
      const resolved = resolveOutfitItems(all, garments);
      this.items = cloneOutfitItems(resolved.available);
      const validIds = new Set(this.items.map((item) => item.garmentId));
      this.unavailableItems = all.filter((item) => !validIds.has(item.garmentId));
      if (!validIds.has(this.selectedId)) this.selectedId = this.items[this.items.length - 1]?.garmentId || '';
      return this.unavailableItems.filter((item) => previousIds.has(item.garmentId)).map((item) => item.garmentId);
    }
    const removed = this.items.filter((item) => {
      const garment = garments.find((entry) => entry.id === item.garmentId);
      return !garment || getTryOnLayer(garment) !== item.layer;
    });
    this.items = this.items.filter((item) => !removed.includes(item));
    if (!this.items.some((item) => item.garmentId === this.selectedId)) this.selectedId = this.items[this.items.length - 1]?.garmentId || '';
    return removed.map((item) => item.garmentId);
  }
}

export const tryOnSession = new TryOnSession();
