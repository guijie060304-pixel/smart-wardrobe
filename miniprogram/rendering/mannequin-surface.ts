import type { BodyModel } from './body-model';
import type { MannequinBaseLayers } from './mannequin-mesh';
import type { MannequinAtlas } from './mannequin-atlas';
import { drawMannequinAtlas } from './mannequin-warp';
type Context = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
interface Cached { factory: typeof wx.createOffscreenCanvas; image: WechatMiniprogram.Image; surfaces: Map<string, WechatMiniprogram.OffscreenCanvas>; failed?: boolean }
const entries = new WeakMap<BodyModel, Cached>(), atlases = new WeakMap<Context, MannequinAtlas>();
export function setMannequinAtlas(context: Context, atlas?: MannequinAtlas): void { if (atlas) atlases.set(context, atlas); else atlases.delete(context); }
/** 三维白模在开发阶段预渲染；手机只适配投影并缓存，衣物手势不重新准备。 */
export function drawMannequinSurface(context: Context, model: BodyModel, onlyParts?: string[], base: MannequinBaseLayers = { top: true, bottom: true }): boolean {
  const atlas = atlases.get(context); if (!atlas) return false;
  if (typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') { drawMannequinAtlas(context, atlas, model, onlyParts, base); return true; }
  let cached = entries.get(model);
  if (cached?.factory !== wx.createOffscreenCanvas || cached?.image !== atlas.image) {
    cached = { factory: wx.createOffscreenCanvas, image: atlas.image, surfaces: new Map() }; entries.set(model, cached);
  }
  if (cached.failed) { drawMannequinAtlas(context, atlas, model, onlyParts, base); return true; }
  const key = `${base.top}/${base.bottom}/` + (onlyParts ? [...onlyParts].sort().join(',') : 'all');
  try {
    let canvas = cached.surfaces.get(key);
    if (!canvas) {
      const b = model.bounds, w = b.right - b.left, h = b.bottom - b.top, factor = Math.min(4, 1000 / Math.max(w, h));
      canvas = wx.createOffscreenCanvas({ type: '2d', width: Math.max(1, Math.ceil(w * factor)), height: Math.max(1, Math.ceil(h * factor)) });
      const c = canvas.getContext('2d') as Context;
      c.scale(canvas.width / w, canvas.height / h); c.translate(-b.left, -b.top);
      drawMannequinAtlas(c, atlas, model, onlyParts, base); cached.surfaces.set(key, canvas);
    }
    const b = model.bounds; context.drawImage(canvas, b.left, b.top, b.right - b.left, b.bottom - b.top); return true;
  } catch { cached.failed = true; drawMannequinAtlas(context, atlas, model, onlyParts, base); return true; }
}
