import { maskedPixels, visibleBounds } from '../utils/cutout-mask';
export async function exportCutout(canvas: WechatMiniprogram.Canvas, source: Uint8ClampedArray, mask: Uint8Array, width: number, height: number): Promise<string> {
  const pixels = maskedPixels(source, mask, width, height, true), bounds = visibleBounds(pixels, width, height);
  canvas.width = bounds.width; canvas.height = bounds.height;
  const context = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  const output = context.createImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y++) output.data.set(pixels.subarray(((bounds.y + y) * width + bounds.x) * 4,
    ((bounds.y + y) * width + bounds.x + bounds.width) * 4), y * bounds.width * 4);
  context.putImageData(output, 0, 0);
  return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', x: 0, y: 0, width: bounds.width, height: bounds.height,
    destWidth: bounds.width, destHeight: bounds.height, success: (result) => resolve(result.tempFilePath), fail: () => reject(new Error('透明图片生成失败，请重试。')) }));
}
