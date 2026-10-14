import type { Garment } from '../models/garment';
import type { GarmentFitting, FittingPoint, FittingPointKey } from '../models/garment-fitting';
import { effectiveImagePath, fittingKind } from '../utils/garment-fitting';
import type { GarmentImageContent } from './image-content';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
/** 品类模板 + 透明轮廓初值。只给出可校正的规则估计，不识别服装语义。 */
export function suggestGarmentFitting(garment: Garment, width: number, height: number, content: GarmentImageContent = {}): GarmentFitting | undefined {
  const kind = fittingKind(garment);
  if (!kind || width <= 0 || height <= 0) return;
  const rect = content.sourceRect || { x: 0, y: 0, width, height };
  const l = rect.x / width, t = rect.y / height, w = rect.width / width, h = rect.height / height, cx = l + w / 2;
  const type = garment.category.typeId;
  const sleeve = ['vest', 'camisole', 'waistcoat', 'pinafore'].includes(type) ? 'none'
    : ['tshirt', 'polo', 'dress'].includes(type) ? 'short' : 'long';
  const ease = /skinny/.test(type) || /修身|紧身/.test(garment.fit || '') ? 'fitted'
    : /wide-leg/.test(type) || /宽松|oversize/i.test(garment.fit || '') ? 'loose' : 'regular';
  const length = type === 'shorts' ? 'short' : ['trench', 'coat'].includes(type) ? 'long' : 'regular';
  const points: GarmentFitting['points'] = {};
  const put = (key: FittingPointKey, x: number, y: number): void => { points[key] = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }; };
  const edge = (v: number): { left: number; right: number } => {
    const y = t + h * v;
    const row = content.rows?.reduce((a, b) => Math.abs(a.y - y) < Math.abs(b.y - y) ? a : b);
    return row || { left: l, right: l + w };
  };
  if (kind === 'upper' || kind === 'dress') {
    const bodyWidth = w * clamp(content.bodyWidthRatio || (sleeve === 'none' ? 0.9 : 0.6), 0.35, 0.94);
    const shoulderY = t + h * 0.06;
    let armpitV = kind === 'dress' ? 0.2 : 0.32;
    if (content.rows?.length) {
      const candidates = content.rows.filter((r) => r.y > t + h * (kind === 'dress' ? 0.12 : 0.2)
        && r.y < t + h * (kind === 'dress' ? 0.28 : 0.48) && r.right - r.left <= bodyWidth * 1.15);
      if (candidates.length) armpitV = clamp((candidates[0].y - t) / h, kind === 'dress' ? 0.16 : 0.25, kind === 'dress' ? 0.28 : 0.46);
    }
    put('shoulderLeft', cx - bodyWidth * 0.51, shoulderY); put('shoulderRight', cx + bodyWidth * 0.51, shoulderY);
    put('neckLeft', cx - bodyWidth * 0.16, t + h * 0.025); put('neckRight', cx + bodyWidth * 0.16, t + h * 0.025);
    put('armpitLeft', cx - bodyWidth / 2, t + h * armpitV); put('armpitRight', cx + bodyWidth / 2, t + h * armpitV);
    const hem = edge(0.98);
    put('hemLeft', hem.left, t + h * 0.99); put('hemRight', hem.right, t + h * 0.99);
    if (kind === 'dress') {
      const waist = edge(0.4), hip = edge(0.55);
      put('waistLeft', waist.left, t + h * 0.4); put('waistRight', waist.right, t + h * 0.4);
      put('hipLeft', hip.left, t + h * 0.55); put('hipRight', hip.right, t + h * 0.55);
    }
    // 袖口用两端表示，保留源图展开方向，再映射到模特手臂方向。
    const cuffY = t + h * (kind === 'dress' ? 0.1 : 0.15), cuffInnerY = t + h * (kind === 'dress' ? 0.23 : 0.34);
    put('cuffLeftOuter', l + w * 0.015, cuffY); put('cuffLeftInner', l + w * 0.12, cuffInnerY);
    put('cuffRightOuter', l + w * 0.985, cuffY); put('cuffRightInner', l + w * 0.88, cuffInnerY);
  } else {
    const waist = edge(0.035), hip = edge(kind === 'pants' ? 0.2 : 0.25);
    put('waistLeft', waist.left, t + h * 0.025); put('waistRight', waist.right, t + h * 0.025);
    put('hipLeft', hip.left, t + h * (kind === 'pants' ? 0.2 : 0.25)); put('hipRight', hip.right, t + h * (kind === 'pants' ? 0.2 : 0.25));
    if (kind === 'skirt') {
      const hem = edge(0.98); put('hemLeft', hem.left, t + h * 0.99); put('hemRight', hem.right, t + h * 0.99);
    } else {
      put('crotch', cx, t + h * (length === 'short' ? 0.56 : 0.35));
      put('ankleLeftOuter', l + w * 0.045, t + h * 0.99); put('ankleLeftInner', cx - w * 0.06, t + h * 0.99);
      put('ankleRightInner', cx + w * 0.06, t + h * 0.99); put('ankleRightOuter', l + w * 0.955, t + h * 0.99);
    }
  }
  return { version: 1, imagePath: effectiveImagePath(garment), typeId: type, kind, mode: 'adapt', ease, sleeve, length, points };
}
export const interpolatePoint = (a: FittingPoint, b: FittingPoint, t: number): FittingPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
