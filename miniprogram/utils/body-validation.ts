import { HEIGHT_RANGE } from '../config/body';
import type { BodyMeasurementField, BodyMeasurements } from '../models/body-profile';

export type BodyValidationErrors = Partial<Record<BodyMeasurementField | 'template', string>>;
const fields: Array<{ key: BodyMeasurementField; name: string; optional?: boolean }> = [
  { key: 'heightCm', name: '身高' }, { key: 'weightKg', name: '体重' },
  { key: 'bustCm', name: '胸围' }, { key: 'waistCm', name: '腰围' }, { key: 'hipCm', name: '臀围' },
  { key: 'shoulderWidthCm', name: '肩宽', optional: true }, { key: 'torsoLengthCm', name: '上身长', optional: true },
  { key: 'inseamCm', name: '内侧腿长', optional: true }, { key: 'underBustCm', name: '下胸围', optional: true },
];

export function validateBodyMeasurements(input: BodyMeasurements): BodyValidationErrors {
  const errors: BodyValidationErrors = {};
  if (input.template !== 'masculine' && input.template !== 'feminine') errors.template = '请选择男模或女模。';
  for (const { key, name, optional } of fields) {
    if (optional && input[key] === undefined) continue;
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] <= 0) {
      errors[key] = `${name}请输入大于零的有效数字。`;
    }
  }
  if (!errors.heightCm && (input.heightCm < HEIGHT_RANGE.min || input.heightCm > HEIGHT_RANGE.max)) {
    errors.heightCm = `身高需在 ${HEIGHT_RANGE.min}–${HEIGHT_RANGE.max}cm 之间。`;
  }
  return errors;
}

export function assertBodyMeasurements(input: BodyMeasurements): void {
  const message = Object.values(validateBodyMeasurements(input))[0];
  if (message) throw new Error(message);
}
