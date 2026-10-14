import { SAMPLE_BODIES } from '../config/body';
import type { BodyTemplate } from '../models/body-profile';
import { buildBodyModel, type BodyModel } from './body-model';
import type { CanvasImageCache } from './garment-images';
export interface MannequinAtlas { image: WechatMiniprogram.Image; model: BodyModel; frameWidth: number; frameHeight: number }
const sources = { masculine: buildBodyModel(SAMPLE_BODIES.masculine), feminine: buildBodyModel(SAMPLE_BODIES.feminine) };
export async function loadMannequinAtlas(cache: CanvasImageCache, template: BodyTemplate): Promise<MannequinAtlas | undefined> {
  const path = `/assets/mannequin/white-${template === 'masculine' ? 'male' : 'female'}.png`;
  cache.retain([path]);
  try { const image = await cache.load(path); if (image.width % 3 || image.height % 3) return;
    return { image, model: sources[template], frameWidth: image.width / 3, frameHeight: image.height / 3 };
  } catch { return; }
}
