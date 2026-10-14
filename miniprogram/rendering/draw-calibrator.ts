import type { GarmentFitting, FittingPointKey } from '../models/garment-fitting';
import { fittingKeys } from '../utils/garment-fitting';

export interface CalibrationView { scale: number; x: number; y: number; width: number; height: number }
export function calibrationView(imageWidth: number, imageHeight: number, width: number, height: number): CalibrationView {
  const scale = Math.min((width - 36) / imageWidth, (height - 36) / imageHeight);
  return { scale, x: (width - imageWidth * scale) / 2, y: (height - imageHeight * scale) / 2, width: imageWidth, height: imageHeight };
}
export function calibrationPoint(x: number, y: number, view: CalibrationView): { x: number; y: number } {
  return { x: Math.max(0, Math.min(1, (x - view.x) / view.scale / view.width)), y: Math.max(0, Math.min(1, (y - view.y) / view.scale / view.height)) };
}
export function calibrationHandle(fitting: GarmentFitting, x: number, y: number, view: CalibrationView): FittingPointKey | undefined {
  return fittingKeys(fitting.kind, fitting.sleeve).map((key) => ({ key, point: fitting.points[key]! }))
    .map(({ key, point }) => ({ key, distance: Math.hypot(x - (view.x + point.x * view.width * view.scale), y - (view.y + point.y * view.height * view.scale)) }))
    .filter((entry) => entry.distance <= 20).sort((a, b) => a.distance - b.distance)[0]?.key;
}
export function drawCalibration(canvas: WechatMiniprogram.Canvas, image: WechatMiniprogram.Image, width: number, height: number, dpr: number,
  fitting?: GarmentFitting, active = ''): CalibrationView {
  const pw = Math.max(1, Math.round(width * dpr)), ph = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const c = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, width, height);
  c.fillStyle = '#EEEDE7'; c.fillRect(0, 0, width, height); c.fillStyle = '#E4E3DC';
  for (let y = 0; y < height; y += 16) for (let x = 0; x < width; x += 16) if ((x / 16 + y / 16) % 2 === 0) c.fillRect(x, y, 16, 16);
  const view = calibrationView(image.width, image.height, width, height);
  c.drawImage(image, view.x, view.y, image.width * view.scale, image.height * view.scale);
  if (!fitting || fitting.mode === 'original') return view;
  const point = (key: FittingPointKey) => { const p = fitting.points[key]!; return { x: view.x + p.x * image.width * view.scale, y: view.y + p.y * image.height * view.scale }; };
  const lines: FittingPointKey[][] = fitting.kind === 'upper' || fitting.kind === 'dress'
    ? [['shoulderLeft', 'neckLeft', 'neckRight', 'shoulderRight', 'armpitRight',
      ...(fitting.kind === 'dress' ? ['waistRight', 'hipRight'] as FittingPointKey[] : []), 'hemRight', 'hemLeft',
      ...(fitting.kind === 'dress' ? ['hipLeft', 'waistLeft'] as FittingPointKey[] : []), 'armpitLeft', 'shoulderLeft'],
      ...(fitting.sleeve !== 'none' ? [['shoulderLeft', 'cuffLeftOuter', 'cuffLeftInner', 'armpitLeft'],
        ['shoulderRight', 'cuffRightOuter', 'cuffRightInner', 'armpitRight']] as FittingPointKey[][] : [])]
    : fitting.kind === 'skirt' ? [['waistLeft', 'waistRight', 'hipRight', 'hemRight', 'hemLeft', 'hipLeft', 'waistLeft']]
      : [['waistLeft', 'waistRight', 'hipRight', 'ankleRightOuter', 'ankleRightInner', 'crotch', 'ankleLeftInner', 'ankleLeftOuter', 'hipLeft', 'waistLeft']];
  c.strokeStyle = '#315F4A'; c.lineWidth = 1.2; c.setLineDash([4, 3]);
  for (const line of lines) {
    c.beginPath(); line.forEach((key, i) => { const p = point(key); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
  }
  c.setLineDash([]); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 10px sans-serif';
  fittingKeys(fitting.kind, fitting.sleeve).forEach((key, i) => {
    const p = point(key); c.beginPath(); c.arc(p.x, p.y, key === active ? 10 : 8, 0, Math.PI * 2);
    c.fillStyle = key === active ? '#B6684D' : '#28483B'; c.fill(); c.strokeStyle = '#FFFEFA'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#FFFFFF'; c.fillText(String(i + 1), p.x, p.y);
  });
  return view;
}
