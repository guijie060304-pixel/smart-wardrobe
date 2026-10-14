export interface PixelPoint { x: number; y: number }
export interface PixelRect { x: number; y: number; width: number; height: number }
export function limitedSize(width: number, height: number, limit: number): { width: number; height: number } {
  if (![width, height, limit].every((v) => Number.isFinite(v) && v > 0)) throw new Error('图片尺寸无效。');
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 蒙版和用户硬标记独立于照片。一次连续笔画是一个可撤销操作。 */
export class CutoutMask {
  mask: Uint8Array;
  seeds: Uint8Array;
  private history: Array<{ mask: Uint8Array; seeds: Uint8Array }> = [];
  private pending?: { mask: Uint8Array; seeds: Uint8Array };
  constructor(readonly width: number, readonly height: number) {
    this.mask = new Uint8Array(width * height).fill(255);
    this.seeds = new Uint8Array(width * height);
  }
  get canUndo(): boolean { return this.history.length > 0; }
  begin(): void { if (!this.pending) this.pending = { mask: this.mask.slice(), seeds: this.seeds.slice() }; }
  commit(): void { if (this.pending) { this.history.push(this.pending); if (this.history.length > 10) this.history.shift(); this.pending = undefined; } }
  cancel(): void { if (this.pending) { this.mask = this.pending.mask; this.seeds = this.pending.seeds; this.pending = undefined; } }
  undo(): void { this.cancel(); const previous = this.history.pop(); if (previous) { this.mask = previous.mask; this.seeds = previous.seeds; } }
  replace(mask: Uint8Array, clearSeeds = false): void {
    if (mask.length !== this.mask.length) throw new Error('蒙版尺寸不匹配。');
    this.begin(); this.mask = mask.slice(); if (clearSeeds) this.seeds.fill(0); this.commit();
  }
  reset(): void { this.replace(new Uint8Array(this.mask.length).fill(255), true); }
  stroke(from: PixelPoint, to: PixelPoint, radius: number, keep: boolean): void {
    const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius)), maxX = Math.min(this.width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius)), maxY = Math.min(this.height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
    const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = length2 ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / length2)) : 0;
      if ((x - from.x - t * dx) ** 2 + (y - from.y - t * dy) ** 2 > radius * radius) continue;
      const index = y * this.width + x; this.mask[index] = keep ? 255 : 0; this.seeds[index] = keep ? 1 : 2;
    }
  }
  polygon(points: PixelPoint[]): void {
    if (points.length < 3) return;
    this.begin(); this.mask.fill(0); this.seeds.fill(0);
    // 扫描线偶奇填充允许凹轮廓；领口等空洞由擦除笔补充。
    for (let y = 0; y < this.height; y++) {
      const crossings: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j], b = points[i], scan = y + .5;
        if ((a.y > scan) !== (b.y > scan)) crossings.push(a.x + (scan - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const start = Math.max(0, Math.ceil(crossings[i] - .5)), end = Math.min(this.width - 1, Math.floor(crossings[i + 1] - .5));
        for (let x = start; x <= end; x++) this.mask[y * this.width + x] = 255;
      }
    }
    this.commit();
  }
}

export function resizeMask(mask: Uint8Array, width: number, height: number, targetWidth: number, targetHeight: number): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++)
    output[y * targetWidth + x] = mask[Math.min(height - 1, Math.floor(y * height / targetHeight)) * width + Math.min(width - 1, Math.floor(x * width / targetWidth))];
  return output;
}

/** 保持 RGB 不变；仅将原 alpha 与轻微软化的蒙版相乘。 */
export function maskedPixels(source: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, feather = false): Uint8ClampedArray {
  if (mask.length !== width * height || source.length !== width * height * 4) throw new Error('图片像素无效。');
  const output = source.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x; let alpha = mask[i];
    if (feather) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = x + dx, b = y + dy; if (a < 0 || b < 0 || a >= width || b >= height) continue;
        sum += mask[b * width + a]; count++;
      }
      alpha = sum / count;
    }
    output[i * 4 + 3] = Math.round(source[i * 4 + 3] * alpha / 255);
  }
  return output;
}
export function visibleBounds(pixels: Uint8ClampedArray, width: number, height: number): PixelRect {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 12) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('没有可见衣物，请用保留笔补回需要的部分。');
  left = Math.max(0, left - 2); top = Math.max(0, top - 2); right = Math.min(width - 1, right + 2); bottom = Math.min(height - 1, bottom + 2);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
