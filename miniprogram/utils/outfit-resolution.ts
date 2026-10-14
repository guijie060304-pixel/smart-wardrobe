import { getTryOnLayer, layerName, type TryOnLayer } from '../config/try-on';
import type { Garment } from '../models/garment';
import type { OutfitItem } from '../models/outfit';
import type { TryOnGarment } from '../rendering/garment-layout';
import { cloneOutfitItems } from './outfit-validation';

export interface OutfitIssue { garmentId: string; layerName: string; label: string }
export function resolveOutfitItems(items: OutfitItem[], garments: Garment[]): { available: TryOnGarment[]; issues: OutfitIssue[] } {
  const available: TryOnGarment[] = [];
  const issues: OutfitIssue[] = [];
  for (const item of cloneOutfitItems(items)) {
    const garment = garments.find((entry) => entry.id === item.garmentId);
    if (garment && getTryOnLayer(garment) === item.layer) available.push({ ...item, garment });
    else issues.push({ garmentId: item.garmentId, layerName: layerName(item.layer as TryOnLayer),
      label: garment ? `${garment.name}：分类已改变，暂时无法按原图层试穿` : '衣物已删除，原搭配位置保留' });
  }
  return { available, issues };
}
