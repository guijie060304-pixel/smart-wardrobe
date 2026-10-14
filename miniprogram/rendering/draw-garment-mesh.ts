import type { Bounds } from './body-model';
import type { GarmentMesh, MeshTriangle } from './garment-mesh';
import { triangleArea } from './garment-mesh';

type Context = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
export interface MeshSurface { canvas: WechatMiniprogram.OffscreenCanvas; bounds: Bounds }

/** 求来源三角形到目标三角形的仿射映射，退化片不进入绘制。 */
export function triangleMatrix([a, b, c]: MeshTriangle): [number, number, number, number, number, number] | undefined {
  const det = triangleArea(a.source, b.source, c.source);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-5) return;
  const sx1 = b.source.x - a.source.x, sy1 = b.source.y - a.source.y;
  const sx2 = c.source.x - a.source.x, sy2 = c.source.y - a.source.y;
  const tx1 = b.target.x - a.target.x, ty1 = b.target.y - a.target.y;
  const tx2 = c.target.x - a.target.x, ty2 = c.target.y - a.target.y;
  const m0 = (tx1 * sy2 - tx2 * sy1) / det, m2 = (tx2 * sx1 - tx1 * sx2) / det;
  const m1 = (ty1 * sy2 - ty2 * sy1) / det, m3 = (ty2 * sx1 - ty1 * sx2) / det;
  const matrix: [number, number, number, number, number, number] = [m0, m1, m2, m3,
    a.target.x - m0 * a.source.x - m2 * a.source.y, a.target.y - m1 * a.source.x - m3 * a.source.y];
  return matrix.every(Number.isFinite) ? matrix : undefined;
}
export function drawGarmentMesh(context: Context, image: WechatMiniprogram.Image, mesh: GarmentMesh): void {
  for (const triangle of mesh.triangles) {
    const matrix = triangleMatrix(triangle);
    if (!matrix) continue;
    context.save(); context.beginPath();
    const orientation = Math.sign(triangleArea(...triangle.map((v) => v.target) as [typeof triangle[0]['target'], typeof triangle[0]['target'], typeof triangle[0]['target']]));
    // 平行外扩约一像素，避免抗锯齿留下网格白缝；锐角限制尖刺长度。
    triangle.forEach(({ target: p }, i) => {
      const previous = triangle[(i + 2) % 3].target, next = triangle[(i + 1) % 3].target;
      const a = { x: p.x - previous.x, y: p.y - previous.y }, b = { x: next.x - p.x, y: next.y - p.y };
      const al = Math.hypot(a.x, a.y) || 1, bl = Math.hypot(b.x, b.y) || 1;
      const n1 = { x: orientation * a.y / al, y: -orientation * a.x / al }, n2 = { x: orientation * b.y / bl, y: -orientation * b.x / bl };
      const factor = Math.min(1.6, 0.24 / Math.max(0.02, 1 + n1.x * n2.x + n1.y * n2.y));
      const x = p.x + (n1.x + n2.x) * factor, y = p.y + (n1.y + n2.y) * factor;
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath(); context.clip(); context.transform(...matrix);
    context.drawImage(image, 0, 0); context.restore();
  }
}

/** 换衣/换身材时生成一次；拖动/缩放复用整件衣物缓存，不重复绘制几百个三角形。 */
export function createMeshSurface(image: WechatMiniprogram.Image, mesh: GarmentMesh): MeshSurface | undefined {
  if (typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') return;
  try {
    const padding = 0.3, bounds = { left: mesh.bounds.left - padding, top: mesh.bounds.top - padding,
      right: mesh.bounds.right + padding, bottom: mesh.bounds.bottom + padding };
    const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
    const scale = Math.min(4, 1200 / Math.max(w, h));
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: Math.max(1, Math.ceil(w * scale)), height: Math.max(1, Math.ceil(h * scale)) });
    const context = canvas.getContext('2d') as Context;
    context.scale(canvas.width / w, canvas.height / h); context.translate(-bounds.left, -bounds.top);
    drawGarmentMesh(context, image, mesh);
    // 只给衣物自身的非透明部分加明暗，不能把领口、裤腿空隙或模特染黑。
    context.globalCompositeOperation = 'source-atop';
    const light = context.createLinearGradient(bounds.left, 0, bounds.right, 0);
    light.addColorStop(0, 'rgba(30,24,18,0.18)'); light.addColorStop(0.2, 'rgba(30,24,18,0.04)');
    light.addColorStop(0.42, 'rgba(255,251,235,0.055)'); light.addColorStop(0.72, 'rgba(30,24,18,0.02)');
    light.addColorStop(1, 'rgba(30,24,18,0.15)');
    context.fillStyle = light; context.fillRect(bounds.left, bounds.top, w, h);
    // 领肩附近较浅的接触暗部；只影响已有衣物像素。
    const contact = context.createLinearGradient(0, mesh.bounds.top, 0, mesh.bounds.top + Math.min(8, h * 0.15));
    contact.addColorStop(0, 'rgba(26,21,15,0.14)'); contact.addColorStop(1, 'rgba(26,21,15,0)');
    context.fillStyle = contact; context.fillRect(bounds.left, mesh.bounds.top, w, Math.min(8, h * 0.15));
    context.globalCompositeOperation = 'source-over';
    return { canvas, bounds };
  } catch { return; } // 不支持离屏纹理的设备仍可直接绘制网格。
}
