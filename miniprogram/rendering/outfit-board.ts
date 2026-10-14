import type { OutfitBoardItem } from '../models/outfit';
import type { TryOnGarment, GarmentPlacement } from './garment-layout';
import type { GarmentImageContent } from './image-content';
import { fitBodyToCanvas } from './canvas-fit';
import type { GestureTarget } from './garment-gestures';

export interface BoardAsset { item: TryOnGarment; image?: WechatMiniprogram.Image; content?: GarmentImageContent }
export const boardCanvasFit = (width: number, height: number) => fitBodyToCanvas({ left: 0, right: 100, top: 0, bottom: 100 }, width, height, 12);
export function boardPlacement(asset: BoardAsset, count: number): GarmentPlacement {
  const ratio = (asset.content?.sourceRect?.width || asset.image?.width || 3) / (asset.content?.sourceRect?.height || asset.image?.height || 4);
  const width = Math.min(count === 1 ? 65 : 44, (count === 1 ? 75 : 60) * ratio);
  return { centerX: 0, centerY: 0, width, height: width / ratio };
}
export function boardTargets(assets: BoardAsset[], board: OutfitBoardItem[]): GestureTarget[] {
  return [...board].sort((a, b) => a.zIndex - b.zIndex).flatMap((item) => {
    const asset = assets.find((entry) => entry.item.garmentId === item.garmentId);
    return asset ? [{ garmentId: item.garmentId, placement: boardPlacement(asset, assets.length),
      transform: { offsetX: item.x, offsetY: item.y, scale: item.scale, rotationDeg: item.rotationDeg } }] : [];
  });
}
export function drawOutfitBoard(canvas: WechatMiniprogram.Canvas, width: number, height: number, pixelRatio: number,
  assets: BoardAsset[], board: OutfitBoardItem[], activeId = ''): void {
  const w = Math.max(1, Math.round(width * pixelRatio)), h = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== w) canvas.width = w; if (canvas.height !== h) canvas.height = h;
  const context = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, width, height);
  context.fillStyle = '#FAF9F5'; context.fillRect(0, 0, width, height);
  const fit = boardCanvasFit(width, height); context.save(); context.translate(fit.translateX, fit.translateY); context.scale(fit.scale, fit.scale);
  context.beginPath(); context.rect(0, 0, 100, 100); context.clip();
  context.fillStyle = '#E2E7DD';
  for (let x = 5; x < 100; x += 5) for (let y = 5; y < 100; y += 5) { context.beginPath(); context.arc(x, y, .13, 0, Math.PI * 2); context.fill(); }
  for (const target of boardTargets(assets, board)) {
    const asset = assets.find((item) => item.item.garmentId === target.garmentId)!;
    const box = target.placement, t = target.transform;
    context.save(); context.translate(t.offsetX, t.offsetY); context.rotate(t.rotationDeg * Math.PI / 180); context.scale(t.scale, t.scale);
    if (asset.image) {
      const rect = asset.content?.sourceRect;
      if (rect) context.drawImage(asset.image, rect.x, rect.y, rect.width, rect.height, -box.width / 2, -box.height / 2, box.width, box.height);
      else context.drawImage(asset.image, -box.width / 2, -box.height / 2, box.width, box.height);
    } else {
      context.fillStyle = '#E9EEE6'; context.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
      context.fillStyle = '#7A857D'; context.font = '3px sans-serif'; context.textAlign = 'center'; context.fillText('图片无法显示', 0, 0);
    }
    if (target.garmentId === activeId) { context.strokeStyle = '#B6684D'; context.lineWidth = .5 / t.scale;
      context.setLineDash([1.5 / t.scale, 1.5 / t.scale]); context.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height); }
    context.restore();
  }
  context.restore();
}
