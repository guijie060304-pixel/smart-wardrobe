export interface FittingPoint { x: number; y: number }
export type FittingKind = 'upper' | 'pants' | 'skirt' | 'dress';
export type FittingEase = 'fitted' | 'regular' | 'loose';
export type SleeveLength = 'none' | 'short' | 'long';
export type FittingLength = 'short' | 'regular' | 'long';
export type FittingPointKey = 'neckLeft' | 'neckRight' | 'shoulderLeft' | 'shoulderRight'
  | 'armpitLeft' | 'armpitRight' | 'waistLeft' | 'waistRight' | 'hipLeft' | 'hipRight'
  | 'hemLeft' | 'hemRight' | 'cuffLeftOuter' | 'cuffLeftInner' | 'cuffRightOuter' | 'cuffRightInner'
  | 'crotch' | 'ankleLeftOuter' | 'ankleLeftInner' | 'ankleRightInner' | 'ankleRightOuter';

/** 原图归一化坐标，与图片及品类绑定；不保存人体坐标或复制图片。 */
export interface GarmentFitting {
  version: 1;
  imagePath: string;
  typeId: string;
  kind: FittingKind;
  mode: 'adapt' | 'original';
  ease: FittingEase;
  sleeve: SleeveLength;
  length: FittingLength;
  points: Partial<Record<FittingPointKey, FittingPoint>>;
}
