import type { Garment } from '../models/garment';
import type { GarmentTransform, OutfitLayer } from '../models/outfit';

export type TryOnLayer = Extract<OutfitLayer, 'bottom' | 'top' | 'outer' | 'one-piece'>;
export const TRY_ON_LAYERS: Array<{ id: TryOnLayer; name: string }> = [
  { id: 'top', name: '上装' }, { id: 'bottom', name: '下装' },
  { id: 'outer', name: '外套' }, { id: 'one-piece', name: '连体装' },
];
export const LAYER_ORDER: Record<TryOnLayer, number> = { bottom: 0, top: 1, 'one-piece': 2, outer: 3 };
export const DEFAULT_TRANSFORM: GarmentTransform = { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 };
export const TRANSFORM_LIMITS = { offset: 200, minScale: 0.25, maxScale: 3, rotation: 180 };
const outerTypes = new Set(['jacket', 'blazer', 'trench', 'coat', 'down-jacket', 'padded-jacket', 'leather-jacket', 'waistcoat']);
const onePieceTypes = new Set(['dress', 'jumpsuit', 'overalls', 'pinafore']);

export function getTryOnLayer(garment: Garment): TryOnLayer | undefined {
  const { groupId, typeId } = garment.category;
  if (groupId === 'tops') return outerTypes.has(typeId) ? 'outer' : 'top';
  if (groupId === 'bottoms') return 'bottom';
  if (groupId === 'one-piece' && onePieceTypes.has(typeId)) return 'one-piece';
  return undefined;
}

export function layerName(layer: TryOnLayer): string {
  return TRY_ON_LAYERS.find((item) => item.id === layer)?.name || '';
}
