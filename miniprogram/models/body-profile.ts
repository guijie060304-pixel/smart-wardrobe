export type BodyTemplate = 'masculine' | 'feminine';

/** 保存原始输入值；Canvas 坐标在渲染时另行计算。 */
export interface BodyProfile {
  template: BodyTemplate;
  heightCm: number;
  weightKg: number;
  bustCm: number;
  waistCm: number;
  hipCm: number;
  /** 选填的实测长度，缺省时只在渲染中估算；旧记录仍可直接读取。 */
  shoulderWidthCm?: number;
  torsoLengthCm?: number;
  inseamCm?: number;
  underBustCm?: number;
  updatedAt: string;
}

export type BodyMeasurements = Omit<BodyProfile, 'updatedAt'>;
export type BodyMeasurementField = 'heightCm' | 'weightKg' | 'bustCm' | 'waistCm' | 'hipCm'
  | 'shoulderWidthCm' | 'torsoLengthCm' | 'inseamCm' | 'underBustCm';
