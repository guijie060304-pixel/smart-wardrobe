import type { Bounds, Point } from './body-model';

export interface CanvasTransform { scale: number; translateX: number; translateY: number }

export function fitBodyToCanvas(bounds: Bounds, width: number, height: number, padding = 16): CanvasTransform {
  const logicalWidth = bounds.right - bounds.left;
  const logicalHeight = bounds.bottom - bounds.top;
  if (![width, height, logicalWidth, logicalHeight, padding].every(Number.isFinite)
    || width <= 0 || height <= 0 || logicalWidth <= 0 || logicalHeight <= 0 || padding < 0) {
    throw new Error('画布或人体尺寸无效。');
  }
  const inset = Math.min(padding, Math.min(width, height) * 0.2);
  const scale = Math.min((width - inset * 2) / logicalWidth, (height - inset * 2) / logicalHeight);
  return {
    scale,
    translateX: width / 2 - (bounds.left + bounds.right) / 2 * scale,
    translateY: height / 2 - (bounds.top + bounds.bottom) / 2 * scale,
  };
}

export function transformPoint(point: Point, transform: CanvasTransform): Point {
  return { x: point.x * transform.scale + transform.translateX, y: point.y * transform.scale + transform.translateY };
}
