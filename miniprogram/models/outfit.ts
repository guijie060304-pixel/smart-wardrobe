export type OutfitLayer = 'bottom' | 'top' | 'outer' | 'one-piece' | 'accessory';

/** 调整量使用人体逻辑坐标；缩放为等比例倍数，旋转单位为角度。 */
export interface GarmentTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotationDeg: number;
}

export interface OutfitItem {
  garmentId: string;
  layer: OutfitLayer;
  transform: GarmentTransform;
  /** 可选手动叠放顺序；旧记录仍使用衣物图层顺序。 */
  zIndex?: number;
}

export interface OutfitBoardItem {
  garmentId: string;
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  zIndex: number;
}

export interface Outfit {
  id: string;
  name: string;
  items: OutfitItem[];
  createdAt: string;
  updatedAt: string;
  /** 用于拒绝过期页面覆盖新版本。 */
  revision: number;
  kind?: 'free' | 'try-on';
  /** 独立于模特坐标的 0–100 搭配画布。 */
  board?: OutfitBoardItem[];
  /** 删除后保留在回收站，可恢复。 */
  deletedAt?: string;
}
