import { getTryOnLayer, LAYER_ORDER, type TryOnLayer } from '../config/try-on';
import type { Garment } from '../models/garment';
import type { OutfitItem } from '../models/outfit';
import type { BodyModel } from './body-model';
import type { GarmentImageContent } from './image-content';

export interface TryOnGarment extends OutfitItem { garment: Garment }
export interface GarmentPlacement { centerX: number; centerY: number; width: number; height: number }

export function sortTryOnGarments(items: TryOnGarment[]): TryOnGarment[] {
  return [...items].sort((a, b) => (a.zIndex ?? LAYER_ORDER[a.layer as TryOnLayer]) - (b.zIndex ?? LAYER_ORDER[b.layer as TryOnLayer]));
}

/** 按锚点确定默认区域，图片始终保留原始宽高比。 */
export function placeGarment(body: BodyModel, garment: Garment, imageWidth: number, imageHeight: number, content?: GarmentImageContent): GarmentPlacement {
  const layer = getTryOnLayer(garment);
  if (!layer || ![imageWidth, imageHeight].every((value) => Number.isFinite(value) && value > 0)) throw new Error('衣物贴图尺寸无效。');
  const h = body.height;
  const shoulderWidth = body.anchors.shoulderRight.x - body.anchors.shoulderLeft.x;
  const hipWidth = body.anchors.hipRight.x - body.anchors.hipLeft.x;
  const source = content?.sourceRect;
  const ratio = (source?.width || imageWidth) / (source?.height || imageHeight);
  let top = body.anchors.shoulderLeft.y - h * 0.022;
  let bottom = body.anchors.hip.y + h * 0.025;
  const bodyRatio = content?.bodyWidthRatio || (ratio > 1.15 ? 0.58 : 0.82);
  let width = Math.max(body.dimensions.chestWidth, body.dimensions.waistWidth, shoulderWidth * 0.78) * 1.08 / bodyRatio;
  if (layer === 'bottom') {
    top = body.anchors.waist.y;
    bottom = /skirt/.test(garment.category.typeId) ? h * 0.81 : garment.category.typeId === 'shorts' ? h * 0.66 : h * 0.965;
    width = /skirt/.test(garment.category.typeId) || garment.category.typeId === 'shorts' ? hipWidth * 1.25 : Math.min((bottom - top) * ratio, hipWidth * 1.6);
  } else if (layer === 'one-piece') {
    bottom = h * 0.94;
    width = Math.max(shoulderWidth * 1.12, hipWidth * 1.35);
  } else if (layer === 'outer') {
    bottom = ['trench', 'coat'].includes(garment.category.typeId) ? h * 0.79 : body.anchors.hip.y + h * 0.055;
    width *= 1.15;
  }
  const availableHeight = bottom - top;
  const renderedWidth = Math.min(width, availableHeight * ratio);
  return { centerX: 0, centerY: top + renderedWidth / ratio / 2, width: renderedWidth, height: renderedWidth / ratio };
}
