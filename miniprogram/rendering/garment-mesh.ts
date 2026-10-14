import type { Garment } from '../models/garment';
import type { FittingPoint, FittingPointKey, GarmentFitting } from '../models/garment-fitting';
import { fittingError, fittingMatches } from '../utils/garment-fitting';
import type { BodyModel, Bounds, Point } from './body-model';
import type { GarmentPlacement } from './garment-layout';
import type { LoadedGarment } from './garment-images';
import { interpolatePoint as lerp, suggestGarmentFitting } from './garment-rig';

export interface MeshVertex { source: Point; target: Point }
export type MeshTriangle = [MeshVertex, MeshVertex, MeshVertex];
export interface GarmentMesh { triangles: MeshTriangle[]; bounds: Bounds; placement: GarmentPlacement; fitting: GarmentFitting }
interface Row { left: Point; right: Point; neck?: [Point, Point] }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const triangleArea = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** 同一分区中的共享顶点保证连续；袖根与衣身共用肩/腋点，不用整图拉伸。 */
export function buildGarmentMesh(body: BodyModel, entry: Pick<LoadedGarment, 'item' | 'image' | 'content' | 'path'>): GarmentMesh | undefined {
  const garment = entry.item.garment, image = entry.image;
  let fitting = garment.fitting;
  const path = entry.path || garment.image.overlayPath || garment.image.displayPath;
  if (fitting?.imagePath === path && fitting.typeId === garment.category.typeId && !fittingMatches(fitting, garment, path)) return;
  if (!fittingMatches(fitting, garment, path)) {
    // 仅透明素材采用规则初值。照片、复杂背景和加载回退仍按原图显示。
    if (!entry.content?.transparent || !entry.content.cutout) return;
    fitting = suggestGarmentFitting(garment, image.width, image.height, entry.content);
  }
  if (!fitting || fitting.mode !== 'adapt' || fittingError(fitting)) return;
  const rig = fitting;
  const p = (key: FittingPointKey): Point => ({ x: rig.points[key]!.x * image.width, y: rig.points[key]!.y * image.height });
  const triangles: MeshTriangle[] = [];
  const across = (row: Row, u: number): Point => {
    if (!row.neck) return lerp(row.left, row.right, u);
    const [nl, nr] = row.neck, a = clamp((nl.x - row.left.x) / (row.right.x - row.left.x), 0.05, 0.45);
    const b = clamp((nr.x - row.left.x) / (row.right.x - row.left.x), 0.55, 0.95);
    if (u < a) return lerp(row.left, nl, u / a);
    if (u <= b) return lerp(nl, nr, (u - a) / (b - a));
    return lerp(nr, row.right, (u - b) / (1 - b));
  };
  const strip = (source: Row[], target: Row[]): void => {
    for (let r = 0; r < source.length - 1; r++) {
      // 细分纵向，曲线比例平滑过渡，避免胸腰处折线明显。
      for (let v = 0; v < 3; v++) for (let u = 0; u < 8; u++) {
        const vertex = (x: number, y: number): MeshVertex => ({
          source: lerp(across(source[r], x), across(source[r + 1], x), y),
          target: lerp(across(target[r], x), across(target[r + 1], x), y),
        });
        const a = vertex(u / 8, v / 3), b = vertex((u + 1) / 8, v / 3);
        const c = vertex((u + 1) / 8, (v + 1) / 3), d = vertex(u / 8, (v + 1) / 3);
        triangles.push([a, b, c], [a, c, d]);
      }
    }
  };
  const h = body.height, d = body.dimensions;
  const regular = rig.ease === 'regular', loose = rig.ease === 'loose';
  const ease = loose ? 1.27 : regular ? 1.13 : 1.045;
  const row = (y: number, width: number): Row => ({ left: { x: -width / 2, y }, right: { x: width / 2, y } });
  const sourceRow = (left: FittingPointKey, right: FittingPointKey): Row => ({ left: p(left), right: p(right) });
  const hipWidth = d.hipWidth * (loose ? 1.2 : regular ? 1.09 : 1.035);
  const waistWidth = Math.max(d.waistWidth * ease, regular ? d.chestWidth * 0.97 : loose ? d.chestWidth * 1.23 : 0);
  if (rig.kind === 'upper' || rig.kind === 'dress') {
    const outer = entry.item.layer === 'outer';
    const shoulderWidth = d.shoulderWidth * (loose ? 1.1 : 1.025);
    const shoulder = row(body.anchors.shoulderLeft.y, shoulderWidth);
    shoulder.neck = [{ x: -h * 0.031, y: h * 0.153 }, { x: h * 0.031, y: h * 0.153 }];
    const chestWidth = Math.max(d.chestWidth * ease, shoulderWidth * 0.83) * (outer ? 1.06 : 1);
    const armpit = row(Math.min(body.anchors.chest.y + h * 0.035, body.anchors.waist.y - h * 0.04), chestWidth);
    const sourceTop = sourceRow('shoulderLeft', 'shoulderRight'); sourceTop.neck = [p('neckLeft'), p('neckRight')];
    const sourceArm = sourceRow('armpitLeft', 'armpitRight'), sourceHem = sourceRow('hemLeft', 'hemRight');
    let hemY = rig.length === 'short' ? body.anchors.waist.y + h * 0.018
      : rig.length === 'long' ? (outer ? h * 0.79 : body.anchors.hip.y + h * 0.1) : body.anchors.hip.y + h * (outer ? 0.06 : 0.025);
    if (rig.kind === 'dress') hemY = h * (rig.length === 'short' ? 0.69 : rig.length === 'long' ? 0.975 : 0.88);
    const waist = row(body.anchors.waist.y, waistWidth * (outer ? 1.06 : 1));
    if (rig.kind === 'dress') {
      const sourceHip = sourceRow('hipLeft', 'hipRight');
      const flare = clamp((sourceHem.right.x - sourceHem.left.x) / (sourceHip.right.x - sourceHip.left.x), 0.85, 2.25);
      strip([sourceTop, sourceArm, sourceRow('waistLeft', 'waistRight'), sourceHip, sourceHem],
        [shoulder, armpit, waist, row(body.anchors.hip.y, hipWidth), row(hemY, hipWidth * flare)]);
    } else {
      const sourceWaist = { left: lerp(sourceArm.left, sourceHem.left, 0.64), right: lerp(sourceArm.right, sourceHem.right, 0.64) };
      strip([sourceTop, sourceArm, sourceWaist, sourceHem], [shoulder, armpit, waist, row(hemY, Math.max(hipWidth, chestWidth * (loose ? 0.99 : 0.95)))]);
    }
    if (rig.sleeve !== 'none') for (const sign of [-1, 1]) {
      const left = sign === -1, rootOuter = left ? shoulder.left : shoulder.right, rootInner = left ? armpit.left : armpit.right;
      const srcOuter = p(left ? 'shoulderLeft' : 'shoulderRight'), srcInner = p(left ? 'armpitLeft' : 'armpitRight');
      const cuffOuter = p(left ? 'cuffLeftOuter' : 'cuffRightOuter'), cuffInner = p(left ? 'cuffLeftInner' : 'cuffRightInner');
      const half = h * (rig.sleeve === 'long' ? 0.016 : 0.024) * (loose ? 1.35 : regular ? 1.12 : 1);
      const cuffY = rig.sleeve === 'long' ? h * 0.497 : Math.max(h * 0.315, rootInner.y + h * 0.035);
      // 宽松袖口的内侧仍须位于腋点外侧，不能回折进衣身。
      const cuffX = sign * Math.max(d.shoulderWidth / 2 + h * (rig.sleeve === 'long' ? 0.035 : 0.026),
        rig.sleeve === 'short' ? Math.abs(rootInner.x) + half + h * 0.008 : 0);
      const cuff: Row = { left: { x: cuffX + sign * half, y: cuffY - h * 0.003 }, right: { x: cuffX - sign * half, y: cuffY + h * 0.003 } };
      const source = [{ left: srcOuter, right: srcInner }], target = [{ left: rootOuter, right: rootInner }];
      if (rig.sleeve === 'long') {
        source.push({ left: lerp(srcOuter, cuffOuter, 0.55), right: lerp(srcInner, cuffInner, 0.55) });
        const elbowHalf = h * 0.023 * (loose ? 1.3 : regular ? 1.12 : 1);
        const elbowX = sign * Math.max(d.shoulderWidth / 2 + h * 0.026, Math.abs(rootInner.x) + elbowHalf + h * 0.008);
        target.push({ left: { x: elbowX + sign * elbowHalf, y: h * 0.34 }, right: { x: elbowX - sign * elbowHalf, y: h * 0.35 } });
      }
      source.push({ left: cuffOuter, right: cuffInner }); target.push(cuff);
      strip(source, target);
    }
  } else if (rig.kind === 'skirt') {
    const sHip = sourceRow('hipLeft', 'hipRight'), sHem = sourceRow('hemLeft', 'hemRight');
    const flare = clamp((sHem.right.x - sHem.left.x) / (sHip.right.x - sHip.left.x), 0.8, 2.6);
    strip([sourceRow('waistLeft', 'waistRight'), sHip, sHem], [row(body.anchors.waist.y, d.waistWidth * 1.06),
      row(body.anchors.hip.y, hipWidth), row(h * (rig.length === 'short' ? 0.65 : rig.length === 'long' ? 0.95 : 0.81), hipWidth * flare)]);
  } else {
    const sHip = sourceRow('hipLeft', 'hipRight'), crotch = p('crotch');
    const sWaist = sourceRow('waistLeft', 'waistRight');
    const targetHip = row(body.anchors.hip.y, hipWidth), crotchY = body.anchors.crotch.y + h * (loose ? 0.018 : 0.005);
    const yEnd = h * (rig.length === 'short' ? 0.66 : rig.length === 'long' ? 0.99 : 0.965);
    const legSources: Row[][] = [], legTargets: Row[][] = [];
    const sourceRoots: Point[] = [], targetRoots: Point[] = [];
    for (const sign of [-1, 1]) {
      const left = sign === -1;
      const sOuter = p(left ? 'ankleLeftOuter' : 'ankleRightOuter'), sInner = p(left ? 'ankleLeftInner' : 'ankleRightInner');
      const sRoot = lerp(left ? sHip.left : sHip.right, sOuter, clamp((crotch.y - (left ? sHip.left.y : sHip.right.y)) / (sOuter.y - (left ? sHip.left.y : sHip.right.y)), 0.05, 0.9));
      const root = { x: sign * hipWidth * 0.46, y: crotchY };
      sourceRoots.push(sRoot); targetRoots.push(root);
      const legCenter = sign * d.hipWidth * 0.245;
      const sourceWidth = Math.abs(sOuter.x - sInner.x) / (sHip.right.x - sHip.left.x) * hipWidth;
      const legWidth = clamp(sourceWidth, h * (loose ? 0.085 : regular ? 0.06 : 0.044), hipWidth * 0.48);
      const end: Row = { left: { x: legCenter + sign * legWidth / 2, y: yEnd }, right: { x: legCenter - sign * legWidth / 2, y: yEnd } };
      const source: Row[] = [{ left: sRoot, right: crotch }], target: Row[] = [{ left: root, right: { x: 0, y: crotchY } }];
      if (body.anchors.knee.y < yEnd - h * 0.025) {
        const t = clamp((body.anchors.knee.y - crotchY) / (yEnd - crotchY), 0.1, 0.9);
        source.push({ left: lerp(sRoot, sOuter, t), right: lerp(crotch, sInner, t) });
        const half = Math.max(legWidth / 2, h * (loose ? 0.042 : regular ? 0.028 : 0.021));
        target.push({ left: { x: legCenter + sign * half, y: body.anchors.knee.y }, right: { x: legCenter - sign * half, y: body.anchors.knee.y } });
      }
      source.push({ left: sOuter, right: sInner }); target.push(end);
      legSources.push(source); legTargets.push(target);
    }
    strip([sWaist, sHip], [row(body.anchors.waist.y, d.waistWidth * 1.06), targetHip]);
    // 裆点两侧分别成片，裤腿中间保留真实空隙。
    const sMid = lerp(sHip.left, sHip.right, 0.5), tMid = lerp(targetHip.left, targetHip.right, 0.5);
    strip([{ left: sHip.left, right: sMid }, { left: sourceRoots[0], right: crotch }],
      [{ left: targetHip.left, right: tMid }, { left: targetRoots[0], right: { x: 0, y: crotchY } }]);
    strip([{ left: sMid, right: sHip.right }, { left: crotch, right: sourceRoots[1] }],
      [{ left: tMid, right: targetHip.right }, { left: { x: 0, y: crotchY }, right: targetRoots[1] }]);
    for (let i = 0; i < 2; i++) strip(legSources[i], legTargets[i]);
  }
  // 用户标记交叉或极端体型导致折叠时安全回退，绝不绘制无穷矩阵。
  if (!triangles.length || triangles.some(([a, b, c]) => {
    const source = triangleArea(a.source, b.source, c.source), target = triangleArea(a.target, b.target, c.target);
    return !Number.isFinite(source * target) || Math.abs(source) < 1e-5 || Math.abs(target) < 1e-7 || source * target <= 0;
  })) return;
  const points = triangles.flatMap((triangle) => triangle.map((v) => v.target));
  const bounds = { left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)) };
  return { triangles, bounds, fitting: rig, placement: { centerX: (bounds.left + bounds.right) / 2, centerY: (bounds.top + bounds.bottom) / 2,
    width: bounds.right - bounds.left, height: bounds.bottom - bounds.top } };
}

export function pointInTriangle(point: FittingPoint, triangle: [Point, Point, Point]): boolean {
  const [a, b, c] = triangle, ab = triangleArea(a, b, point), bc = triangleArea(b, c, point), ca = triangleArea(c, a, point);
  return (ab >= -1e-7 && bc >= -1e-7 && ca >= -1e-7) || (ab <= 1e-7 && bc <= 1e-7 && ca <= 1e-7);
}
