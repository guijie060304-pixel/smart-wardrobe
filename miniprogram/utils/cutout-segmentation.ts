import type { PixelRect } from './cutout-mask';

export interface SegmentationInput {
  pixels: Uint8ClampedArray; width: number; height: number; rect: PixelRect; seeds?: Uint8Array;
  cancelled?: () => boolean; timeoutMs?: number;
}
export class CutoutCancelled extends Error {}
interface Gaussian { mean: number[]; variance: number[]; weight: number }

/** 对角协方差的五分量颜色模型；固定初始化保证同输入结果可重复。 */
async function colorModel(pixels: Uint8ClampedArray, indices: number[], checkpoint: () => Promise<void>): Promise<Gaussian[]> {
  if (!indices.length) throw new Error('请完整框住衣物，并在框外留出一些背景；也可以使用手动圈选。');
  const count = Math.min(5, indices.length), models: Gaussian[] = [];
  for (let k = 0; k < count; k++) {
    const index = indices[Math.floor((k + .5) * indices.length / count)] * 4;
    models.push({ mean: [pixels[index], pixels[index + 1], pixels[index + 2]], variance: [400, 400, 400], weight: 1 / count });
  }
  const step = Math.max(1, Math.ceil(indices.length / 6000));
  for (let round = 0; round < 4; round++) {
    const totals = models.map(() => ({ n: 0, sum: [0, 0, 0], square: [0, 0, 0] })); let sampleCount = 0;
    for (let n = 0; n < indices.length; n += step) {
      const offset = indices[n] * 4; let best = 0, distance = Infinity;
      for (let k = 0; k < models.length; k++) {
        const model = models[k]; let d = 0;
        for (let c = 0; c < 3; c++) d += (pixels[offset + c] - model.mean[c]) ** 2;
        if (d < distance) { distance = d; best = k; }
      }
      const total = totals[best]; total.n++; sampleCount++;
      for (let c = 0; c < 3; c++) { const value = pixels[offset + c]; total.sum[c] += value; total.square[c] += value * value; }
      if (sampleCount % 128 === 0) await checkpoint();
    }
    models.forEach((model, k) => {
      const total = totals[k]; model.weight = Math.max(1e-6, total.n / sampleCount); if (!total.n) return;
      for (let c = 0; c < 3; c++) { model.mean[c] = total.sum[c] / total.n; model.variance[c] = Math.max(64, total.square[c] / total.n - model.mean[c] ** 2); }
    });
  }
  return models;
}
function colorCost(pixels: Uint8ClampedArray, i: number, models: Gaussian[]): number {
  let probability = 0;
  for (const model of models) {
    let distance = 0, determinant = 1;
    for (let c = 0; c < 3; c++) { distance += (pixels[i * 4 + c] - model.mean[c]) ** 2 / model.variance[c]; determinant *= model.variance[c]; }
    probability += model.weight * Math.exp(-distance / 2) / Math.sqrt(determinant);
  }
  return Math.min(50, -Math.log(Math.max(1e-22, probability)));
}

/** 紧凑邻接表、非递归 Dinic。分片涵盖建图、搜索与增广，不阻塞整次求解。 */
class CutGraph {
  private head: Int32Array; private to: Int32Array; private next: Int32Array; private capacity: Float64Array; private used = 0;
  constructor(readonly nodes: number, maxArcs: number, private readonly checkpoint: () => Promise<void>) {
    this.head = new Int32Array(nodes).fill(-1); this.to = new Int32Array(maxArcs); this.next = new Int32Array(maxArcs); this.capacity = new Float64Array(maxArcs);
  }
  edge(a: number, b: number, forward: number, reverse = 0): void {
    const e = this.used; this.used += 2; if (e + 1 >= this.to.length) throw new Error('分割图超出容量。');
    this.to[e] = b; this.capacity[e] = forward; this.next[e] = this.head[a]; this.head[a] = e;
    this.to[e + 1] = a; this.capacity[e + 1] = reverse; this.next[e + 1] = this.head[b]; this.head[b] = e + 1;
  }
  async foreground(source: number, sink: number): Promise<Uint8Array> {
    const level = new Int32Array(this.nodes), queue = new Int32Array(this.nodes), path = new Int32Array(this.nodes);
    let operations = 0;
    for (;;) {
      level.fill(-1); level[source] = 0; let start = 0, end = 1; queue[0] = source;
      while (start < end) {
        const node = queue[start++];
        for (let e = this.head[node]; e >= 0; e = this.next[e]) {
          if (this.capacity[e] > 1e-8 && level[this.to[e]] < 0) { level[this.to[e]] = level[node] + 1; queue[end++] = this.to[e]; }
          if ((++operations & 2047) === 0) await this.checkpoint();
        }
      }
      if (level[sink] < 0) return Uint8Array.from(level, (value) => value >= 0 ? 255 : 0).slice(0, source);
      const current = this.head.slice(); let depth = 0, node = source;
      for (;;) {
        if (node === sink) {
          let flow = Infinity; for (let i = 0; i < depth; i++) flow = Math.min(flow, this.capacity[path[i]]);
          for (let i = 0; i < depth; i++) { const e = path[i]; this.capacity[e] -= flow; this.capacity[e ^ 1] += flow; }
          depth = 0; node = source;
        } else {
          let e = current[node];
          while (e >= 0 && (this.capacity[e] <= 1e-8 || level[this.to[e]] !== level[node] + 1)) e = this.next[e];
          current[node] = e;
          if (e < 0) {
            level[node] = -1; if (!depth) break;
            const previous = path[--depth]; node = this.to[previous ^ 1]; current[node] = this.next[previous];
          } else { path[depth++] = e; node = this.to[e]; }
        }
        if ((++operations & 2047) === 0) await this.checkpoint();
      }
      await this.checkpoint();
    }
  }
}

export async function segmentGarment(input: SegmentationInput): Promise<Uint8Array> {
  const { pixels, width, height, rect, seeds } = input, size = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || Math.max(width, height) > 256
    || pixels.length !== size * 4 || (seeds && seeds.length !== size)
    || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 2 || rect.height < 2) throw new Error('框选或图片像素无效。');
  const deadline = Date.now() + (input.timeoutMs ?? 10000); let yieldedAt = Date.now();
  const checkpoint = async (): Promise<void> => {
    if (input.cancelled?.()) throw new CutoutCancelled('已取消估算。');
    if (Date.now() >= deadline) throw new Error('估算耗时较长，请使用手动圈选，再用保留 / 擦除笔修边。');
    if (Date.now() - yieldedAt >= 8) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); yieldedAt = Date.now(); }
  };
  await checkpoint();
  const hard = new Uint8Array(size), labels = new Uint8Array(size);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    hard[i] = pixels[i * 4 + 3] <= 12 ? 2 : seeds?.[i] || (!inside ? 2 : 0);
    labels[i] = hard[i] === 1 || (inside && hard[i] !== 2) ? 255 : 0;
  }
  const distance = (a: number, b: number): number => { let sum = 0; for (let c = 0; c < 3; c++) sum += (pixels[a * 4 + c] - pixels[b * 4 + c]) ** 2; return sum; };
  let total = 0, pairs = 0;
  for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { const i = y * width + x;
    if (x + 1 < width) { total += distance(i, i + 1); pairs++; } if (y + 1 < height) { total += distance(i, i + width); pairs++; }
  } await checkpoint(); }
  const beta = total > 0 ? pairs / (2 * total) : 0;
  let output: Uint8Array = labels;
  for (let round = 0; round < 3; round++) {
    const fg: number[] = [], bg: number[] = [];
    for (let i = 0; i < size; i++) (output[i] ? fg : bg).push(i);
    const foregroundModel = await colorModel(pixels, fg, checkpoint), backgroundModel = await colorModel(pixels, bg, checkpoint); await checkpoint();
    const graph = new CutGraph(size + 2, size * 8, checkpoint), source = size, sink = size + 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        graph.edge(source, i, hard[i] === 1 ? 10000 : hard[i] === 2 ? 0 : colorCost(pixels, i, backgroundModel));
        graph.edge(i, sink, hard[i] === 2 ? 10000 : hard[i] === 1 ? 0 : colorCost(pixels, i, foregroundModel));
        if (x + 1 < width) { const w = 35 * Math.exp(-beta * distance(i, i + 1)); graph.edge(i, i + 1, w, w); }
        if (y + 1 < height) { const w = 35 * Math.exp(-beta * distance(i, i + width)); graph.edge(i, i + width, w, w); }
      }
      await checkpoint();
    }
    const next = await graph.foreground(source, sink);
    let changed = 0; for (let i = 0; i < size; i++) if (next[i] !== output[i]) changed++;
    output = next; if (!changed || !output.some((v) => v > 0)) break;
  }
  await checkpoint(); return output;
}
