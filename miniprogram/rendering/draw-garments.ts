import type { BodyModel } from './body-model';
import type { LoadedGarment } from './garment-images';
import { placeGarment, sortTryOnGarments } from './garment-layout';
import { drawGarmentMesh } from './draw-garment-mesh';
import { drawBodyForeground } from './draw-body';
import { mannequinBaseLayers } from './mannequin-mesh';

export const loadedPlacement = (body: BodyModel, entry: LoadedGarment) => entry.mesh?.placement
  || placeGarment(body, entry.item.garment, entry.image.width, entry.image.height, entry.content);

export function drawGarments(context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  body: BodyModel, loaded: LoadedGarment[], activeId: string): void {
  const ordered = sortTryOnGarments(loaded.map((entry) => entry.item));
  for (const item of ordered) {
    const entry = loaded.find((entry) => entry.item.garmentId === item.garmentId)!;
    const image = entry.image;
    const placement = loadedPlacement(body, entry);
    const { offsetX, offsetY, scale, rotationDeg } = item.transform;
    context.save();
    context.translate(placement.centerX + offsetX, placement.centerY + offsetY);
    context.rotate(rotationDeg * Math.PI / 180);
    context.scale(scale, scale);
    if (entry.mesh) {
      context.translate(-placement.centerX, -placement.centerY);
      if (entry.surface) {
        const b = entry.surface.bounds;
        context.drawImage(entry.surface.canvas, b.left, b.top, b.right - b.left, b.bottom - b.top);
      } else drawGarmentMesh(context, image, entry.mesh);
    } else {
      const rect = entry.content?.sourceRect;
      if (rect) context.drawImage(image, rect.x, rect.y, rect.width, rect.height, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
      else context.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
    }
    context.restore();
  }
  if (loaded.some((entry) => entry.mesh)) drawBodyForeground(context, body, mannequinBaseLayers(loaded.map(({ item }) => item.layer)));
  // 选中框最后绘制，外套覆盖内搭时也能看清当前调整对象。
  const active = loaded.find((entry) => entry.item.garmentId === activeId);
  if (!active) return;
  const box = loadedPlacement(body, active);
  const transform = active.item.transform;
  context.save();
  context.translate(box.centerX + transform.offsetX, box.centerY + transform.offsetY);
  context.rotate(transform.rotationDeg * Math.PI / 180);
  context.scale(transform.scale, transform.scale);
  context.strokeStyle = '#B6684D';
  context.lineWidth = 0.5 / transform.scale;
  context.setLineDash([1.5 / transform.scale, 1.5 / transform.scale]);
  context.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
  context.restore();
}
