import type { TryOnGarment } from './garment-layout';
import { alphaContent, type GarmentImageContent } from './image-content';
import type { GarmentMesh } from './garment-mesh';
import type { MeshSurface } from './draw-garment-mesh';

/** 每个 Canvas 独享图片对象；失败保留到用户重试或路径变化，避免拖动时反复解码坏图。 */
export class CanvasImageCache {
  private entries = new Map<string, Promise<WechatMiniprogram.Image>>();
  private content = new WeakMap<WechatMiniprogram.Image, GarmentImageContent>();
  constructor(private readonly canvas: Pick<WechatMiniprogram.Canvas, 'createImage'>) {}
  load(path: string): Promise<WechatMiniprogram.Image> {
    const previous = this.entries.get(path);
    if (previous) return previous;
    const pending = new Promise<WechatMiniprogram.Image>((resolve, reject) => {
      const image = this.canvas.createImage();
      const timeout = setTimeout(() => reject(new Error('图片读取超时')), 10000);
      image.onload = () => {
        clearTimeout(timeout);
        if (image.width > 0 && image.height > 0) resolve(image);
        else reject(new Error('图片尺寸无效'));
      };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('图片无法读取')); };
      try { image.src = path; }
      catch (error) { clearTimeout(timeout); reject(error); }
    });
    this.entries.set(path, pending);
    return pending;
  }
  retain(paths: string[]): void {
    for (const path of this.entries.keys()) if (!paths.includes(path)) this.entries.delete(path);
  }
  describe(image: WechatMiniprogram.Image): GarmentImageContent {
    const previous = this.content.get(image);
    if (previous) return previous;
    let result: GarmentImageContent = {};
    if (typeof wx !== 'undefined' && typeof wx.createOffscreenCanvas === 'function') {
      let measured: ReturnType<typeof alphaContent> | undefined;
      const factor = Math.min(1, 384 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * factor)), height = Math.max(1, Math.round(image.height * factor));
      try {
        const scratch = wx.createOffscreenCanvas({ type: '2d', width, height });
        const context = scratch.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
        context.drawImage(image, 0, 0, width, height);
        measured = alphaContent(context.getImageData(0, 0, width, height).data, width, height);
      } catch { /* 不支持像素读取的设备保留原图，仍可手动调整。 */ }
      if (measured === null) throw new Error('图片没有可见衣物。');
      if (measured) result = { sourceRect: {
        x: measured.bounds.x / width * image.width, y: measured.bounds.y / height * image.height,
        width: measured.bounds.width / width * image.width, height: measured.bounds.height / height * image.height,
      }, bodyWidthRatio: measured.bodyWidthRatio, transparent: measured.transparent, cutout: measured.cutout, rows: measured.rows };
    }
    this.content.set(image, result);
    return result;
  }
  clear(): void { this.entries.clear(); }
}

export interface LoadedGarment { item: TryOnGarment; image: WechatMiniprogram.Image; path?: string; content?: GarmentImageContent; mesh?: GarmentMesh; surface?: MeshSurface }
export async function loadGarmentImages(cache: CanvasImageCache, items: TryOnGarment[]): Promise<{ loaded: LoadedGarment[]; warnings: string[] }> {
  cache.retain(items.flatMap(({ garment }) => [garment.image.displayPath, garment.image.overlayPath || '']));
  const results = await Promise.all(items.map(async (item) => {
    const { garment } = item;
    const preferred = garment.image.overlayPath || garment.image.displayPath;
    const load = async (path: string): Promise<LoadedGarment> => {
      const image = await cache.load(path);
      return { item, image, path, content: cache.describe(image) };
    };
    try { return { loaded: await load(preferred), warning: '' }; }
    catch {
      if (garment.image.overlayPath && garment.image.overlayPath !== garment.image.displayPath) {
        try { return { loaded: await load(garment.image.displayPath), warning: `${garment.name}：贴图无法读取，已使用衣物照片。` }; }
        catch { /* 展示明确失败提示，其他衣物仍可绘制。 */ }
      }
      return { loaded: null, warning: `${garment.name}：图片无法读取，请编辑衣物重新选择。` };
    }
  }));
  return {
    loaded: results.flatMap((result) => result.loaded ? [result.loaded] : []),
    warnings: results.map((result) => result.warning).filter(Boolean),
  };
}
