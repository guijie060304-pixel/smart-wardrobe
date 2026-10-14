import type { BodyMeasurements } from '../models/body-profile';
import { assertBodyMeasurements } from '../utils/body-validation';

export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export type PathCommand =
  | { type: 'move' | 'line'; x: number; y: number }
  | { type: 'cubic'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'quadratic'; cx: number; cy: number; x: number; y: number }
  | { type: 'close' };

export interface BodyPart { id: string; commands: PathCommand[] }
export interface BodyModel {
  height: number;
  template: BodyMeasurements['template'];
  dimensions: { shoulderWidth: number; chestWidth: number; underBustWidth: number; waistWidth: number; hipWidth: number; torsoLength: number; inseam: number };
  bounds: Bounds;
  parts: BodyPart[];
  anchors: { shoulderLeft: Point; shoulderRight: Point; chest: Point; waist: Point; hip: Point; hipLeft: Point; hipRight: Point; crotch: Point; knee: Point };
}

const move = (x: number, y: number): PathCommand => ({ type: 'move', x, y });
const line = (x: number, y: number): PathCommand => ({ type: 'line', x, y });
const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): PathCommand => ({ type: 'cubic', x1, y1, x2, y2, x, y });
const quadratic = (cx: number, cy: number, x: number, y: number): PathCommand => ({ type: 'quadratic', cx, cy, x, y });
const close = (): PathCommand => ({ type: 'close' });
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function mirror(commands: PathCommand[]): PathCommand[] {
  return commands.map((command) => {
    switch (command.type) {
      case 'move': case 'line': return { ...command, x: -command.x };
      case 'cubic': return { ...command, x: -command.x, x1: -command.x1, x2: -command.x2 };
      case 'quadratic': return { ...command, x: -command.x, cx: -command.cx };
      case 'close': return { ...command };
    }
  });
}

export function commandPoints(command: PathCommand): Point[] {
  if (command.type === 'close') return [];
  if (command.type === 'cubic') return [
    { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y },
  ];
  if (command.type === 'quadratic') return [{ x: command.cx, y: command.cy }, { x: command.x, y: command.y }];
  return [{ x: command.x, y: command.y }];
}

/** 使用曲线控制点的包围盒，范围保守包含完整轮廓。 */
function calculateBounds(parts: BodyPart[]): Bounds {
  const points = parts.flatMap((part) => part.commands.flatMap(commandPoints));
  return {
    left: Math.min(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)), bottom: Math.max(...points.map((point) => point.y)),
  };
}

/** 正面陈列模特。逻辑单位为 cm；选填长度优先，缺省比例只用于视觉估算。 */
export function buildBodyModel(input: BodyMeasurements): BodyModel {
  assertBodyMeasurements(input);
  const h = input.heightCm;
  const feminine = input.template === 'feminine';
  // 对推算比例设限，正数原始输入可任意大；先截断后运算，防止溢出。
  const mass = clamp(Math.cbrt(Math.min(input.weightKg, h * h) / ((h / 100) ** 2 * 22)), 0.72, 1.5);
  const auxiliary = 1 + (mass - 1) * 0.08;
  // 围度不等于正面宽度，使用椭圆截面的视觉近似；不能用来判断服装尺码。
  const circumferenceWidth = (value: number, ratio: number): number => clamp(Math.min(value, h * 3) / ratio, h * 0.115, h * 0.38) * auxiliary;
  const bust = circumferenceWidth(input.bustCm, feminine ? 2.8 : 2.9) / 2;
  const waist = circumferenceWidth(input.waistCm, 2.85) / 2;
  const hip = circumferenceWidth(input.hipCm, feminine ? 2.7 : 2.85) / 2;
  const underBust = feminine ? clamp(input.underBustCm === undefined ? bust * 0.9 : circumferenceWidth(input.underBustCm, 2.85) / 2, bust * 0.7, bust) : bust * 0.97;
  const shoulder = clamp(input.shoulderWidthCm ?? Math.max(h * (feminine ? 0.222 : 0.242), bust * 2.18), h * 0.16, h * 0.38) / 2;
  const inseam = clamp(input.inseamCm ?? h * (feminine ? 0.465 : 0.455), h * 0.34, h * 0.52);
  const crotchY = h - inseam;
  const shoulderY = h * 0.175;
  const waistY = Math.min(shoulderY + clamp(input.torsoLengthCm ?? h * (feminine ? 0.235 : 0.23), h * 0.16, h * 0.29), crotchY - h * 0.075);
  const chestY = shoulderY + (waistY - shoulderY) * 0.37;
  const hipY = waistY + (crotchY - waistY) * 0.64;
  const kneeY = crotchY + inseam * 0.46;
  const neck = h * (feminine ? 0.021 : 0.024);
  const arm = h * (feminine ? 0.018 : 0.021) * mass;
  const knee = h * 0.018 * mass;
  const calf = h * 0.024 * mass;
  const ankle = h * 0.012 * mass;
  const legCenter = hip * 0.49;
  const calfY = kneeY + (h * 0.95 - kneeY) * 0.4;

  const rightLeg: PathCommand[] = [
    move(hip * 0.72, hipY),
    cubic(hip * 1.03, hipY + h * 0.025, hip * 0.95, crotchY + inseam * 0.22, legCenter + knee, kneeY),
    cubic(legCenter + knee * 0.9, kneeY + h * 0.02, legCenter + calf, calfY - h * 0.025, legCenter + calf, calfY),
    cubic(legCenter + calf, calfY + h * 0.04, legCenter + ankle, h * 0.91, legCenter + ankle, h * 0.95),
    cubic(legCenter + ankle * 1.1, h * 0.967, legCenter + ankle * 1.65, h * 0.975, legCenter + ankle * 1.55, h * 0.99),
    quadratic(legCenter + ankle * 1.45, h, legCenter + ankle * 0.8, h),
    line(legCenter - ankle * 0.9, h), quadratic(legCenter - ankle * 1.35, h * 0.997, legCenter - ankle * 1.25, h * 0.981),
    line(legCenter - ankle, h * 0.95),
    cubic(legCenter - ankle, h * 0.91, legCenter - calf * 0.82, calfY + h * 0.03, legCenter - calf * 0.82, calfY),
    cubic(legCenter - calf * 0.82, calfY - h * 0.03, legCenter - knee, kneeY + h * 0.02, legCenter - knee, kneeY),
    cubic(legCenter - knee, kneeY - h * 0.04, h * 0.008, crotchY + h * 0.045, h * 0.008, crotchY + h * 0.015),
    quadratic(h * 0.008, crotchY - h * 0.02, hip * 0.72, hipY), close(),
  ];
  const rightArm: PathCommand[] = [
    move(shoulder - arm * 0.8, shoulderY),
    cubic(shoulder + arm * 0.5, shoulderY - h * 0.006, shoulder + arm * 1.1, h * 0.205, shoulder + arm, h * 0.235),
    cubic(shoulder + arm * 1.1, h * 0.27, shoulder + h * 0.024 + arm * 0.75, h * 0.30, shoulder + h * 0.026 + arm * 0.7, h * 0.34),
    cubic(shoulder + h * 0.029 + arm, h * 0.365, shoulder + h * 0.04 + arm * 0.5, h * 0.44, shoulder + h * 0.04 + arm * 0.42, h * 0.485),
    cubic(shoulder + h * 0.046 + arm * 0.8, h * 0.51, shoulder + h * 0.052 + arm * 0.6, h * 0.535, shoulder + h * 0.04, h * 0.55),
    quadratic(shoulder + h * 0.029, h * 0.551, shoulder + h * 0.028, h * 0.53),
    line(shoulder + h * 0.024 - arm * 0.45, h * 0.504),
    quadratic(shoulder + h * 0.015 - arm * 0.55, h * 0.51, shoulder + h * 0.018 - arm * 0.62, h * 0.489),
    cubic(shoulder + h * 0.021 - arm * 0.6, h * 0.44, shoulder + h * 0.024 - arm * 0.8, h * 0.38, shoulder + h * 0.023 - arm * 0.65, h * 0.34),
    cubic(shoulder + h * 0.018 - arm, h * 0.29, shoulder - arm, h * 0.25, shoulder - arm * 0.8, shoulderY), close(),
  ];
  const torso: PathCommand[] = [
    move(-neck, h * 0.113), line(neck, h * 0.113),
    cubic(neck, h * 0.134, neck * 0.85, h * 0.145, neck * 1.4, h * 0.151),
    cubic(shoulder * 0.55, h * 0.161, shoulder * 0.88, h * 0.16, shoulder, shoulderY),
    cubic(shoulder * 0.99, shoulderY + h * 0.025, bust * 0.98, chestY - h * 0.025, bust, chestY),
    cubic(bust * 1.015, chestY + h * 0.025, underBust, chestY + h * 0.045, underBust, chestY + h * 0.06),
    cubic(underBust, waistY - h * 0.035, waist, waistY - h * 0.035, waist, waistY),
    cubic(waist, waistY + h * 0.035, hip, hipY - h * 0.035, hip, hipY),
    cubic(hip, hipY + h * 0.035, hip * 0.69, crotchY + h * 0.012, hip * 0.28, crotchY + h * 0.014),
    quadratic(0, crotchY + h * 0.028, -hip * 0.28, crotchY + h * 0.014),
    cubic(-hip * 0.69, crotchY + h * 0.012, -hip, hipY + h * 0.035, -hip, hipY),
    cubic(-hip, hipY - h * 0.035, -waist, waistY + h * 0.035, -waist, waistY),
    cubic(-waist, waistY - h * 0.035, -underBust, waistY - h * 0.035, -underBust, chestY + h * 0.06),
    cubic(-underBust, chestY + h * 0.045, -bust * 1.015, chestY + h * 0.025, -bust, chestY),
    cubic(-bust * 0.98, chestY - h * 0.025, -shoulder * 0.99, shoulderY + h * 0.025, -shoulder, shoulderY),
    cubic(-shoulder * 0.88, h * 0.16, -shoulder * 0.55, h * 0.161, -neck * 1.4, h * 0.151),
    cubic(-neck * 0.85, h * 0.145, -neck, h * 0.134, -neck, h * 0.113), close(),
  ];
  const headWidth = h * (feminine ? 0.037 : 0.039);
  const head = [move(0, 0), cubic(headWidth * 0.85, 0, headWidth, h * 0.025, headWidth, h * 0.052),
    cubic(headWidth * 1.04, h * 0.071, headWidth * 0.78, h * 0.1, headWidth * 0.5, h * 0.114),
    quadratic(0, h * 0.132, -headWidth * 0.5, h * 0.114),
    cubic(-headWidth * 0.78, h * 0.1, -headWidth * 1.04, h * 0.071, -headWidth, h * 0.052),
    cubic(-headWidth, h * 0.025, -headWidth * 0.85, 0, 0, 0), close()];
  const parts: BodyPart[] = [
    { id: 'left-leg', commands: mirror(rightLeg) }, { id: 'right-leg', commands: rightLeg },
    { id: 'left-arm', commands: mirror(rightArm) }, { id: 'right-arm', commands: rightArm },
    { id: 'torso', commands: torso },
    { id: 'head', commands: head },
  ];
  const bounds = calculateBounds(parts);
  // 白色基础衣裤比人体略宽，极端围度时也必须完整处于画布适配范围。
  const clothedWidth = Math.max(hip * 1.12, bust * 1.15, waist * 1.13);
  bounds.left = Math.min(bounds.left, -clothedWidth); bounds.right = Math.max(bounds.right, clothedWidth);
  return {
    height: h, template: input.template, parts, bounds,
    dimensions: { shoulderWidth: shoulder * 2, chestWidth: bust * 2, underBustWidth: underBust * 2, waistWidth: waist * 2, hipWidth: hip * 2,
      torsoLength: waistY - shoulderY, inseam },
    anchors: {
      shoulderLeft: { x: -shoulder, y: shoulderY }, shoulderRight: { x: shoulder, y: shoulderY },
      chest: { x: 0, y: chestY }, waist: { x: 0, y: waistY }, hip: { x: 0, y: hipY },
      hipLeft: { x: -hip, y: hipY }, hipRight: { x: hip, y: hipY },
      crotch: { x: 0, y: crotchY }, knee: { x: 0, y: kneeY },
    },
  };
}
