import { TRANSFORM_LIMITS } from '../config/try-on';
import type { GarmentTransform } from '../models/outfit';
import type { CanvasTransform } from './canvas-fit';
import type { GarmentPlacement } from './garment-layout';
import { pointInTriangle } from './garment-mesh';
import type { Point } from './body-model';

export interface GesturePoint { x: number; y: number; identifier: number }
export interface GestureTarget { garmentId: string; placement: GarmentPlacement; transform: GarmentTransform; triangles?: [Point, Point, Point][] }
export interface GestureChange { garmentId: string; transform: GarmentTransform }
type Mode = 'idle' | 'pending' | 'scroll' | 'drag' | 'pinch' | 'blocked';
const slop = 8; // CSS px：轻微手抖不算滚动，滚动后不再转为衣物操作。
const distance = (a: GesturePoint, b: GesturePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: GesturePoint, b: GesturePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const angle = (a: GesturePoint, b: GesturePoint) => Math.atan2(b.y - a.y, b.x - a.x);
const wrap = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** 与绘制使用同一矩形和逆旋转；数组顺序为从底层到顶层。 */
export function hitTestGarment(point: GesturePoint, targets: GestureTarget[], fit: CanvasTransform): GestureTarget | undefined {
  const x = (point.x - fit.translateX) / fit.scale;
  const y = (point.y - fit.translateY) / fit.scale;
  return [...targets].reverse().find(({ placement: box, transform: t, triangles }) => {
    const dx = x - box.centerX - t.offsetX, dy = y - box.centerY - t.offsetY;
    const radians = t.rotationDeg * Math.PI / 180;
    const localX = (dx * Math.cos(radians) + dy * Math.sin(radians)) / t.scale;
    const localY = (-dx * Math.sin(radians) + dy * Math.cos(radians)) / t.scale;
    if (triangles) return triangles.some((triangle) => pointInTriangle({ x: localX + box.centerX, y: localY + box.centerY }, triangle));
    return Math.abs(localX) <= box.width / 2 + 4 / fit.scale / t.scale
      && Math.abs(localY) <= box.height / 2 + 4 / fit.scale / t.scale;
  });
}

/** 单指默认交给原生滚动；只有长按命中衣物或双指命中衣物才锁定画布。 */
export class GarmentGestures {
  mode: Mode = 'idle';
  private target?: GestureTarget;
  private points: GesturePoint[] = [];
  private fit: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };
  private heldLock = false;
  private tapId = '';
  private preferred?: GestureTarget;
  get locked(): boolean { return this.mode === 'drag' || this.mode === 'pinch' || this.heldLock; }
  get garmentId(): string { return this.target?.garmentId || ''; }
  cancel(): void { this.mode = 'idle'; this.target = undefined; this.points = []; this.heldLock = false; this.tapId = ''; this.preferred = undefined; }

  start(touches: GesturePoint[], targets: GestureTarget[], fit: CanvasTransform, activeId = ''): void {
    if (this.mode === 'scroll' || this.mode === 'blocked') return;
    const points = [...touches].sort((a, b) => a.identifier - b.identifier);
    if (points.length > 2) { this.heldLock = this.locked; this.mode = 'blocked'; return; }
    this.fit = { ...fit };
    if (points.length === 1 && this.mode === 'idle') {
      const hit = hitTestGarment(points[0], targets, fit);
      this.tapId = hit?.garmentId || '';
      const preferred = hitTestGarment(points[0], targets.filter((target) => target.garmentId === activeId), fit);
      this.preferred = preferred ? { ...preferred, transform: { ...preferred.transform } } : undefined;
      this.target = hit ? { ...hit, transform: { ...hit.transform } } : undefined;
      this.points = points;
      this.mode = 'pending';
    } else if (points.length === 2 && this.mode !== 'pinch') {
      const hit = this.mode === 'drag' ? this.target : this.preferred || this.target
        || hitTestGarment(points[0], targets.filter((target) => target.garmentId === activeId), fit)
        || hitTestGarment(points[1], targets.filter((target) => target.garmentId === activeId), fit)
        || hitTestGarment(points[0], targets, fit) || hitTestGarment(points[1], targets, fit);
      if (!hit || distance(points[0], points[1]) < slop) { this.mode = 'scroll'; return; }
      this.target = { ...hit, transform: { ...hit.transform } };
      this.points = points;
      this.mode = 'pinch';
    }
  }

  longPress(): boolean {
    if (this.mode !== 'pending' || !this.target) return false;
    this.target = this.preferred || this.target;
    this.mode = 'drag';
    return true;
  }

  move(touches: GesturePoint[]): GestureChange | undefined {
    const points = [...touches].sort((a, b) => a.identifier - b.identifier);
    if (this.mode === 'pending') {
      if (points.length !== 1 || distance(points[0], this.points[0]) > slop) this.mode = 'scroll';
      return;
    }
    if (!this.target || (this.mode !== 'drag' && this.mode !== 'pinch')) return;
    if (points.length !== this.points.length || points.some((p, i) => p.identifier !== this.points[i].identifier)) {
      this.heldLock = true; this.mode = 'blocked'; return;
    }
    // 两指重合时没有可靠的距离/方向；保留上一帧基线，分开后继续。
    if (this.mode === 'pinch' && distance(points[0], points[1]) < slop) return;
    const t = this.target.transform;
    let transform: GarmentTransform;
    if (this.mode === 'drag') {
      transform = { ...t, offsetX: t.offsetX + (points[0].x - this.points[0].x) / this.fit.scale,
        offsetY: t.offsetY + (points[0].y - this.points[0].y) / this.fit.scale };
    } else {
      const before = midpoint(this.points[0], this.points[1]), after = midpoint(points[0], points[1]);
      const scale = clamp(t.scale * distance(points[0], points[1]) / distance(this.points[0], this.points[1]),
        TRANSFORM_LIMITS.minScale, TRANSFORM_LIMITS.maxScale);
      const delta = wrap((angle(points[0], points[1]) - angle(this.points[0], this.points[1])) * 180 / Math.PI);
      const radians = delta * Math.PI / 180, ratio = scale / t.scale;
      const box = this.target.placement;
      const dx = (box.centerX + t.offsetX) * this.fit.scale + this.fit.translateX - before.x;
      const dy = (box.centerY + t.offsetY) * this.fit.scale + this.fit.translateY - before.y;
      transform = { scale, rotationDeg: wrap(t.rotationDeg + delta),
        offsetX: (after.x + ratio * (dx * Math.cos(radians) - dy * Math.sin(radians)) - this.fit.translateX) / this.fit.scale - box.centerX,
        offsetY: (after.y + ratio * (dx * Math.sin(radians) + dy * Math.cos(radians)) - this.fit.translateY) / this.fit.scale - box.centerY };
    }
    transform.offsetX = clamp(transform.offsetX, -TRANSFORM_LIMITS.offset, TRANSFORM_LIMITS.offset);
    transform.offsetY = clamp(transform.offsetY, -TRANSFORM_LIMITS.offset, TRANSFORM_LIMITS.offset);
    // 增量更新，达到缩放边界后反向操作立即响应，也支持从拖动无跳变地加入第二指。
    this.target = { ...this.target, transform };
    this.points = points;
    return { garmentId: this.target.garmentId, transform };
  }

  end(remaining: GesturePoint[]): string {
    if (remaining.length) { this.heldLock = this.locked; this.mode = 'blocked'; return ''; }
    const selected = this.mode === 'pending' ? this.tapId : '';
    this.cancel();
    return selected;
  }
}
