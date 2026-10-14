import type { CategoryPath } from './category';
import type { GarmentFitting } from './garment-fitting';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface GarmentImage {
  /** 抠图前的本地原照片，供重新处理和恢复。 */
  originalPath?: string;
  /** 微信用户文件目录中的持久路径。 */
  displayPath: string;
  /** 用于试衣的可选透明背景贴图。 */
  overlayPath?: string;
}

export interface Garment {
  id: string;
  name: string;
  category: CategoryPath;
  image: GarmentImage;
  fitting?: GarmentFitting;
  color?: string;
  seasons?: Season[];
  style?: string;
  fit?: string;
  material?: string;
  brand?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  note?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}
