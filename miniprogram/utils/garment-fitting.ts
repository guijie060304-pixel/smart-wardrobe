import type { Garment } from '../models/garment';
import type { FittingKind, FittingPointKey, GarmentFitting } from '../models/garment-fitting';

export function fittingKind(garment: Pick<Garment, 'category'>): FittingKind | undefined {
  if (garment.category.groupId === 'tops') return 'upper';
  if (garment.category.groupId === 'bottoms') return /skirt/.test(garment.category.typeId) ? 'skirt' : 'pants';
  if (garment.category.groupId === 'one-piece' && ['dress', 'pinafore'].includes(garment.category.typeId)) return 'dress';
  return undefined;
}
export const effectiveImagePath = (garment: Pick<Garment, 'image'>): string => garment.image.overlayPath || garment.image.displayPath;
export const cloneFitting = (f: GarmentFitting): GarmentFitting => ({ ...f,
  points: Object.fromEntries(Object.entries(f.points).map(([key, p]) => [key, { ...p }])) });
export function fittingKeys(kind: FittingKind, sleeve: GarmentFitting['sleeve']): FittingPointKey[] {
  if (kind === 'pants') return ['waistLeft', 'waistRight', 'hipLeft', 'hipRight', 'crotch',
    'ankleLeftOuter', 'ankleLeftInner', 'ankleRightInner', 'ankleRightOuter'];
  if (kind === 'skirt') return ['waistLeft', 'waistRight', 'hipLeft', 'hipRight', 'hemLeft', 'hemRight'];
  return ['neckLeft', 'neckRight', 'shoulderLeft', 'shoulderRight', 'armpitLeft', 'armpitRight',
    ...(kind === 'dress' ? ['waistLeft', 'waistRight', 'hipLeft', 'hipRight'] as FittingPointKey[] : []),
    'hemLeft', 'hemRight', ...(sleeve !== 'none'
      ? ['cuffLeftOuter', 'cuffLeftInner', 'cuffRightOuter', 'cuffRightInner'] as FittingPointKey[] : [])];
}
export const FITTING_POINT_NAMES: Record<FittingPointKey, string> = {
  neckLeft: '左领口', neckRight: '右领口', shoulderLeft: '左肩点', shoulderRight: '右肩点',
  armpitLeft: '左腋下', armpitRight: '右腋下', waistLeft: '左腰线', waistRight: '右腰线',
  hipLeft: '左臀线', hipRight: '右臀线', hemLeft: '左下摆', hemRight: '右下摆',
  cuffLeftOuter: '左袖口外侧', cuffLeftInner: '左袖口内侧', cuffRightOuter: '右袖口外侧', cuffRightInner: '右袖口内侧',
  crotch: '裆底', ankleLeftOuter: '左裤脚外侧', ankleLeftInner: '左裤脚内侧', ankleRightInner: '右裤脚内侧', ankleRightOuter: '右裤脚外侧',
};

/** 防止交叉/退化的衣身和袖子进入网格。所有左/右均指图片左右。 */
export function fittingError(value: unknown): string {
  if (!value || typeof value !== 'object') return '校准记录无效。';
  const f = value as GarmentFitting;
  if (f.version !== 1 || typeof f.imagePath !== 'string' || !f.imagePath || typeof f.typeId !== 'string' || !f.typeId
    || !['upper', 'pants', 'skirt', 'dress'].includes(f.kind) || !['adapt', 'original'].includes(f.mode)
    || !['fitted', 'regular', 'loose'].includes(f.ease) || !['none', 'short', 'long'].includes(f.sleeve)
    || !['short', 'regular', 'long'].includes(f.length) || !f.points || typeof f.points !== 'object') return '校准记录无效。';
  for (const key of fittingKeys(f.kind, f.sleeve)) {
    const p = f.points[key];
    if (!p || ![p.x, p.y].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return `请标记${FITTING_POINT_NAMES[key]}。`;
  }
  // 额外点也必须有效，避免损坏坐标在切换袖型后出现。
  if (Object.entries(f.points).some(([key, p]) => !(key in FITTING_POINT_NAMES) || !p
    || ![p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))) return '校准点坐标无效。';
  if (f.mode === 'original') return '';
  const p = (key: FittingPointKey) => f.points[key]!;
  const pairs: FittingPointKey[][] = f.kind === 'pants' ? [['waistLeft', 'waistRight'], ['hipLeft', 'hipRight'],
    ['ankleLeftOuter', 'ankleLeftInner'], ['ankleRightInner', 'ankleRightOuter']]
    : f.kind === 'skirt' ? [['waistLeft', 'waistRight'], ['hipLeft', 'hipRight'], ['hemLeft', 'hemRight']]
      : [['neckLeft', 'neckRight'], ['shoulderLeft', 'shoulderRight'], ['armpitLeft', 'armpitRight'], ['hemLeft', 'hemRight'],
        ...(f.kind === 'dress' ? [['waistLeft', 'waistRight'], ['hipLeft', 'hipRight']] : [])] as FittingPointKey[][];
  if (pairs.some(([l, r]) => p(r).x - p(l).x < 0.015)) return '左右点发生交叉或距离过近，请按图片左右重新标记。';
  const rowY = (key: FittingPointKey) => p(key).y;
  const rows: FittingPointKey[] = f.kind === 'pants' ? ['waistLeft', 'hipLeft', 'crotch', 'ankleLeftOuter']
    : f.kind === 'skirt' ? ['waistLeft', 'hipLeft', 'hemLeft']
      : ['shoulderLeft', 'armpitLeft', ...(f.kind === 'dress' ? ['waistLeft', 'hipLeft'] as FittingPointKey[] : []), 'hemLeft'];
  for (let i = 1; i < rows.length; i++) {
    const left = rows[i], prev = rows[i - 1];
    if (rowY(left) - rowY(prev) < 0.015) return '衣身各标记应从上到下排列，请检查肩、腋下、腰臀和下摆。';
    const right = left.replace('Left', 'Right') as FittingPointKey, prevRight = prev.replace('Left', 'Right') as FittingPointKey;
    if (p(right) && p(prevRight) && rowY(right) - rowY(prevRight) < 0.015) return '右侧标记顺序有误，请检查上下位置。';
  }
  if (f.kind === 'upper' || f.kind === 'dress') {
    if (p('neckLeft').x <= p('shoulderLeft').x || p('neckRight').x >= p('shoulderRight').x) return '领口应在两侧肩点之间。';
    if (f.sleeve !== 'none') {
      if (Math.hypot(p('cuffLeftOuter').x - p('cuffLeftInner').x, p('cuffLeftOuter').y - p('cuffLeftInner').y) < 0.015
        || Math.hypot(p('cuffRightOuter').x - p('cuffRightInner').x, p('cuffRightOuter').y - p('cuffRightInner').y) < 0.015) return '袖口内外点距离过近。';
      if (p('cuffLeftOuter').x >= p('armpitLeft').x || p('cuffRightOuter').x <= p('armpitRight').x) return '请使用袖子向两侧展开的正面图，并将袖口点放到衣身两侧。';
    }
  }
  if (f.kind === 'pants' && (p('crotch').x <= p('hipLeft').x || p('crotch').x >= p('hipRight').x
    || p('ankleLeftInner').x > p('ankleRightInner').x)) return '请检查裆底和左右裤脚，避免交叉。';
  return '';
}
export function fittingMatches(f: GarmentFitting | undefined, garment: Pick<Garment, 'category' | 'image'>, imagePath = effectiveImagePath(garment)): f is GarmentFitting {
  return !!f && !fittingError(f) && f.imagePath === imagePath && f.typeId === garment.category.typeId && f.kind === fittingKind(garment);
}
