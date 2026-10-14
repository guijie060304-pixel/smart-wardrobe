import { LAYER_ORDER, TRANSFORM_LIMITS, type TryOnLayer } from '../config/try-on';
import type { Outfit, OutfitItem } from '../models/outfit';
import { assertBoard, cloneBoard } from './outfit-board';

export const OUTFIT_NAME_LIMIT = 60;
export function normalizeOutfitName(name: string): string {
  if (typeof name !== 'string' || !name.trim()) throw new Error('请填写穿搭名称。');
  if (name.trim().length > OUTFIT_NAME_LIMIT) throw new Error(`穿搭名称最多 ${OUTFIT_NAME_LIMIT} 个字。`);
  return name.trim();
}

export function assertOutfitItems(value: unknown): asserts value is OutfitItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error('请至少选择一件衣物，每个图层只能选择一件。');
  const ids = new Set<string>();
  const layers = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.garmentId !== 'string' || !item.garmentId
      || !Object.prototype.hasOwnProperty.call(LAYER_ORDER, item.layer)) throw new Error('穿搭衣物或图层无效。');
    if (ids.has(item.garmentId) || layers.has(item.layer)) throw new Error('穿搭中存在重复衣物或图层。');
    ids.add(item.garmentId); layers.add(item.layer);
    if (item.zIndex !== undefined && (!Number.isSafeInteger(item.zIndex) || item.zIndex < 0 || item.zIndex > 1000)) throw new Error('衣物叠放顺序无效。');
    const t = item.transform;
    if (!t || ![t.offsetX, t.offsetY, t.scale, t.rotationDeg].every((n) => typeof n === 'number' && Number.isFinite(n))
      || Math.abs(t.offsetX) > TRANSFORM_LIMITS.offset || Math.abs(t.offsetY) > TRANSFORM_LIMITS.offset
      || t.scale < TRANSFORM_LIMITS.minScale || t.scale > TRANSFORM_LIMITS.maxScale
      || Math.abs(t.rotationDeg) > TRANSFORM_LIMITS.rotation) throw new Error('穿搭调整参数无效。');
  }
  if (layers.has('one-piece') && (layers.has('top') || layers.has('bottom'))) throw new Error('连体装不能同时搭配上装或下装。');
}

export function cloneOutfitItems(items: OutfitItem[]): OutfitItem[] {
  return items.map((item) => ({ garmentId: item.garmentId, layer: item.layer, transform: { ...item.transform }, ...(item.zIndex === undefined ? {} : { zIndex: item.zIndex }) }))
    .sort((a, b) => LAYER_ORDER[a.layer as TryOnLayer] - LAYER_ORDER[b.layer as TryOnLayer]);
}

export function outfitItemsSignature(items: OutfitItem[]): string {
  return JSON.stringify(cloneOutfitItems(items).map(({ garmentId, layer, transform: t, zIndex }) =>
    [garmentId, layer, t.offsetX, t.offsetY, t.scale, t.rotationDeg, zIndex ?? null]));
}

export function isOutfit(value: unknown): value is Outfit {
  if (!value || typeof value !== 'object') return false;
  const item = value as Outfit;
  try {
    if (typeof item.id !== 'string' || !item.id || normalizeOutfitName(item.name) !== item.name
      || !Number.isSafeInteger(item.revision) || item.revision < 1
      || ![item.createdAt, item.updatedAt].every((s) => typeof s === 'string' && Number.isFinite(Date.parse(s)))
      || (item.deletedAt !== undefined && (typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt))))) return false;
    assertOutfitItems(item.items);
    if (item.kind !== undefined && item.kind !== 'free' && item.kind !== 'try-on') return false;
    if (item.board !== undefined) assertBoard(item.board, item.items);
    return true;
  } catch { return false; }
}

export function cloneOutfit(outfit: Outfit): Outfit { return { ...outfit, items: cloneOutfitItems(outfit.items), ...(outfit.board === undefined ? {} : { board: cloneBoard(outfit.board) }) }; }
