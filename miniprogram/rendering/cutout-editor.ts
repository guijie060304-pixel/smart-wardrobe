import type { PixelPoint } from '../utils/cutout-mask';
export interface CutoutView { width: number; height: number; imageWidth: number; imageHeight: number; zoom: number; panX: number; panY: number }
export function viewScale(view: CutoutView): number { return Math.min(view.width / view.imageWidth, view.height / view.imageHeight) * view.zoom; }
export function imagePoint(point: PixelPoint, view: CutoutView): PixelPoint {
  const scale = viewScale(view);
  return { x: (point.x - view.width / 2 - view.panX) / scale + view.imageWidth / 2,
    y: (point.y - view.height / 2 - view.panY) / scale + view.imageHeight / 2 };
}
export function pinchView(view: CutoutView, before: PixelPoint[], after: PixelPoint[]): CutoutView {
  const middle = (p: PixelPoint[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const distance = (p: PixelPoint[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const start = middle(before), end = middle(after), anchor = imagePoint(start, view);
  const next = { ...view, zoom: Math.max(1, Math.min(6, view.zoom * distance(after) / Math.max(1, distance(before)))) };
  const scale = viewScale(next);
  next.panX = end.x - view.width / 2 - (anchor.x - view.imageWidth / 2) * scale;
  next.panY = end.y - view.height / 2 - (anchor.y - view.imageHeight / 2) * scale;
  next.panX = Math.max(-view.imageWidth * scale / 2, Math.min(view.imageWidth * scale / 2, next.panX));
  next.panY = Math.max(-view.imageHeight * scale / 2, Math.min(view.imageHeight * scale / 2, next.panY)); return next;
}
export function drawCutoutPreview(canvas: WechatMiniprogram.Canvas, surface: WechatMiniprogram.Canvas, view: CutoutView, ratio: number,
  checker: boolean, rect?: { x: number; y: number; width: number; height: number }, polygon: PixelPoint[] = []): void {
  const width = Math.round(view.width * ratio), height = Math.round(view.height * ratio);
  if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, view.width, view.height);
  if (checker) { context.fillStyle = '#D9DFDA'; for (let y = 0; y < view.height; y += 16) for (let x = 0; x < view.width; x += 16)
    if ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0) context.fillRect(x, y, 16, 16); }
  const scale = viewScale(view); context.save(); context.translate(view.width / 2 + view.panX, view.height / 2 + view.panY); context.scale(scale, scale);
  context.translate(-view.imageWidth / 2, -view.imageHeight / 2); context.drawImage(surface, 0, 0, view.imageWidth, view.imageHeight);
  context.strokeStyle = '#B45E3A'; context.lineWidth = 2 / scale;
  if (rect) { context.setLineDash([6 / scale, 4 / scale]); context.strokeRect(rect.x, rect.y, rect.width, rect.height); context.setLineDash([]); }
  if (polygon.length) { context.beginPath(); context.moveTo(polygon[0].x, polygon[0].y); polygon.slice(1).forEach((p) => context.lineTo(p.x, p.y)); context.stroke(); }
  context.restore();
}
