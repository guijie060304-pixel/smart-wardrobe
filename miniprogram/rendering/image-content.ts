export interface ImageSourceRect { x: number; y: number; width: number; height: number }
export interface SilhouetteRow { y: number; left: number; right: number }
export interface GarmentImageContent { sourceRect?: ImageSourceRect; bodyWidthRatio?: number; transparent?: boolean; cutout?: boolean; rows?: SilhouetteRow[] }

/** 只分析透明度，不把白色衣物或复杂照片背景当成空白删除。 */
export function alphaContent(data: ArrayLike<number>, width: number, height: number):
  { bounds: ImageSourceRect; bodyWidthRatio?: number; transparent: boolean; cutout: boolean; rows: SilhouetteRow[] } | null {
  if (data.length < width * height * 4 || width <= 0 || height <= 0) throw new Error('图片像素无效。');
  const visible = (x: number, y: number) => data[(y * width + x) * 4 + 3] > 12;
  let left = width, right = -1, top = height, bottom = -1, count = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!visible(x, y)) continue;
    count++;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) return null;
  const cutout = count / ((right - left + 1) * (bottom - top + 1)) < 0.96;
  const spans: number[] = [], center = Math.round((left + right) / 2);
  for (const fraction of [0.45, 0.52, 0.6, 0.68, 0.75]) {
    const y = Math.round(top + (bottom - top) * fraction);
    if (!visible(center, y)) continue;
    let a = center, b = center;
    while (a > left && visible(a - 1, y)) a -= 1;
    while (b < right && visible(b + 1, y)) b += 1;
    spans.push((b - a + 1) / (right - left + 1));
  }
  spans.sort((a, b) => a - b);
  const transparent = left > 0 || top > 0 || right < width - 1 || bottom < height - 1
    || !visible(0, 0) || !visible(width - 1, 0);
  const rows: SilhouetteRow[] = [];
  for (let i = 0; i <= 40; i++) {
    const y = Math.round(top + (bottom - top) * i / 40);
    let a = left, b = right;
    while (a <= b && !visible(a, y)) a++;
    while (b >= a && !visible(b, y)) b--;
    if (a <= b) rows.push({ y: y / height, left: a / width, right: (b + 1) / width });
  }
  // 一像素余量保护半透明边缘，返回的是裁切来源，不修改原始图片。
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  right = Math.min(width - 1, right + 1); bottom = Math.min(height - 1, bottom + 1);
  return { bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, transparent, cutout, rows,
    ...(transparent && spans.length >= 3 ? { bodyWidthRatio: Math.max(0.35, spans[Math.floor(spans.length / 2)]) } : {}) };
}
