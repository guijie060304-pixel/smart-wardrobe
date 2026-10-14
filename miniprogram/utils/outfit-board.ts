import type { OutfitBoardItem, OutfitItem } from '../models/outfit';

export function cloneBoard(board: OutfitBoardItem[]): OutfitBoardItem[] { return board.map(({ garmentId, x, y, scale, rotationDeg, zIndex }) => ({ garmentId, x, y, scale, rotationDeg, zIndex })); }
export function assertBoard(board: unknown, items: OutfitItem[]): asserts board is OutfitBoardItem[] {
  if (!Array.isArray(board) || board.length !== items.length || new Set(board.map((item) => item?.garmentId)).size !== board.length) throw new Error('搭配画布数据无效。');
  for (const item of board) {
    if (!item || !items.some((entry) => entry.garmentId === item.garmentId)
      || ![item.x, item.y, item.scale, item.rotationDeg, item.zIndex].every((value) => typeof value === 'number' && Number.isFinite(value))
      || item.x < 0 || item.x > 100 || item.y < 0 || item.y > 100 || item.scale < .25 || item.scale > 3
      || Math.abs(item.rotationDeg) > 180 || !Number.isSafeInteger(item.zIndex) || item.zIndex < 0 || item.zIndex > 1000) throw new Error('搭配画布位置或叠放顺序无效。');
  }
}
export function completeBoard(items: OutfitItem[], previous: OutfitBoardItem[] = []): OutfitBoardItem[] {
  return items.map((item, index) => {
    const existing = previous.find((entry) => entry.garmentId === item.garmentId);
    if (existing) return { ...existing };
    const point = items.length === 1 ? [50, 50] : item.layer === 'bottom' ? [68, 65] : item.layer === 'outer' ? [72, 30] : item.layer === 'one-piece' ? [35, 50] : [30, 30];
    return { garmentId: item.garmentId, x: point[0], y: point[1], scale: 1, rotationDeg: 0, zIndex: index };
  });
}
export function changeBoardItem(board: OutfitBoardItem[], garmentId: string, patch: Pick<OutfitBoardItem, 'x' | 'y' | 'scale' | 'rotationDeg'>): OutfitBoardItem[] {
  if (![patch.x, patch.y, patch.scale, patch.rotationDeg].every(Number.isFinite)) throw new Error('画布调整参数无效。');
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  return board.map((item) => item.garmentId !== garmentId ? { ...item } : { ...item,
    x: clamp(patch.x, 0, 100), y: clamp(patch.y, 0, 100), scale: clamp(patch.scale, .25, 3), rotationDeg: clamp(patch.rotationDeg, -180, 180) });
}
export function reorderBoard(board: OutfitBoardItem[], garmentId: string, front = true): OutfitBoardItem[] {
  if (!board.some((item) => item.garmentId === garmentId)) return cloneBoard(board);
  const ordered = [...board].sort((a, b) => a.zIndex - b.zIndex), active = ordered.find((item) => item.garmentId === garmentId)!;
  const others = ordered.filter((item) => item !== active);
  return (front ? [...others, active] : [active, ...others]).map((item, zIndex) => ({ ...item, zIndex }));
}
export function boardSignature(board: OutfitBoardItem[]): string { return JSON.stringify([...board].sort((a, b) => a.garmentId.localeCompare(b.garmentId))); }
