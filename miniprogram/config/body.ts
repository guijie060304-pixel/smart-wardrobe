import type { BodyMeasurements, BodyTemplate } from '../models/body-profile';

export const BODY_TEMPLATES: Array<{ id: BodyTemplate; name: string }> = [
  { id: 'masculine', name: '男模' },
  { id: 'feminine', name: '女模' },
];

export const HEIGHT_RANGE = { min: 150, max: 200 };

/** 只用于未设置身材时的示例，不自动写入用户记录。 */
export const SAMPLE_BODY: BodyMeasurements = {
  template: 'masculine', heightCm: 175, weightKg: 65, bustCm: 92, waistCm: 76, hipCm: 96,
};
export const SAMPLE_BODIES: Record<BodyTemplate, BodyMeasurements> = {
  masculine: SAMPLE_BODY,
  feminine: { template: 'feminine', heightCm: 165, weightKg: 55, bustCm: 86, waistCm: 68, hipCm: 92 },
};

export const BODY_PALETTE = {
  background: '#EEF2F7',
  body: '#E8ECF1',
  outline: '#CBD2DB',
  highlight: '#FFFFFF',
  shadow: '#ADB9C9',
  strokeWidth: 0.18,
};
