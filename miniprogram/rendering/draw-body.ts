import { BODY_PALETTE } from '../config/body';
import { commandPoints, type BodyModel, type PathCommand } from './body-model';
import { fitBodyToCanvas, type CanvasTransform } from './canvas-fit';
import { drawMannequinSurface, setMannequinAtlas } from './mannequin-surface';
import type { MannequinAtlas } from './mannequin-atlas';
import type { MannequinBaseLayers } from './mannequin-mesh';

type Context = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
function trace(context: Context, commands: PathCommand[]): void {
  context.beginPath();
  for (const command of commands) {
    switch (command.type) {
      case 'move': context.moveTo(command.x, command.y); break;
      case 'line': context.lineTo(command.x, command.y); break;
      case 'cubic': context.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y); break;
      case 'quadratic': context.quadraticCurveTo(command.cx, command.cy, command.x, command.y); break;
      case 'close': context.closePath(); break;
    }
  }
}

/** 用柔和的椭圆光斑表达树脂模特表面；不依赖图片或外部服务。 */
function spot(context: Context, x: number, y: number, rx: number, ry: number, color: string): void {
  context.save();
  context.translate(x, y); context.scale(rx, ry);
  const light = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  light.addColorStop(0, color); light.addColorStop(1, 'rgba(180,170,150,0)');
  context.fillStyle = light;
  context.beginPath(); context.arc(0, 0, 1, 0, Math.PI * 2); context.fill();
  context.restore();
}

/** 本地三维白模固定正投影；像素 API 不支持时保留曲线绘制降级。 */
export function drawBody(context: Context, model: BodyModel, onlyParts?: string[], base?: MannequinBaseLayers): void {
  const h = model.height, d = model.dimensions;
  const chestY = model.anchors.chest.y, waistY = model.anchors.waist.y;
  if (!onlyParts) {
    const radius = Math.max(d.hipWidth * 0.7, d.shoulderWidth * 0.63);
    context.save(); context.fillStyle = '#D8E0EA'; context.beginPath(); context.ellipse(0, h * 0.996, radius, h * 0.004, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#FDFEFF'; context.beginPath(); context.ellipse(0, h * 0.991, radius, h * 0.004, 0, 0, Math.PI * 2); context.fill(); context.restore();
    spot(context, 0, h * 0.989, d.hipWidth * 0.46, h * 0.004, 'rgba(89,109,133,0.19)');
  }
  if (drawMannequinSurface(context, model, onlyParts, base)) return;
  context.strokeStyle = BODY_PALETTE.outline;
  context.lineWidth = BODY_PALETTE.strokeWidth;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const part of model.parts) {
    if (onlyParts && !onlyParts.includes(part.id)) continue;
    const points = part.commands.flatMap(commandPoints);
    const left = Math.min(...points.map((p) => p.x)), right = Math.max(...points.map((p) => p.x));
    const surface = context.createLinearGradient(left, 0, right, 0);
    surface.addColorStop(0, BODY_PALETTE.shadow);
    surface.addColorStop(0.16, '#D4CCBE'); surface.addColorStop(0.34, BODY_PALETTE.highlight);
    surface.addColorStop(0.55, '#E4DED2'); surface.addColorStop(0.8, '#C9C0B0'); surface.addColorStop(1, '#A99F8E');
    context.fillStyle = surface;
    trace(context, part.commands); context.fill(); context.stroke();
    context.save(); trace(context, part.commands); context.clip();
    if (part.id === 'torso') {
      // 颈根、锁骨、肩部与腹部都沿同一组人体锚点绘制。
      spot(context, 0, h * 0.15, h * 0.034, h * 0.014, 'rgba(90,75,55,0.22)');
      for (const sign of [-1, 1]) {
        spot(context, sign * d.shoulderWidth * 0.35, h * 0.182, h * 0.026, h * 0.021, 'rgba(255,255,249,0.48)');
        const feminine = model.template === 'feminine';
        const projection = feminine ? Math.max(0.08, Math.min(0.23, (d.chestWidth - d.underBustWidth) / d.chestWidth + 0.08)) : 0.1;
        spot(context, sign * d.chestWidth * 0.23, chestY + h * (feminine ? 0.019 : 0.03),
          d.chestWidth * 0.26, h * 0.028, `rgba(100,79,51,${projection})`);
        spot(context, sign * d.chestWidth * 0.22 - h * 0.004, chestY - h * 0.004,
          d.chestWidth * 0.24, h * (feminine ? 0.03 : 0.022), 'rgba(255,255,250,0.48)');
        spot(context, sign * d.waistWidth * 0.46, waistY, h * 0.022, h * 0.07, 'rgba(113,95,68,0.16)');
      }
      spot(context, -h * 0.012, waistY - h * 0.015, d.waistWidth * 0.35, h * 0.07, 'rgba(255,255,250,0.3)');
      spot(context, 0, chestY + h * 0.015, h * 0.007, h * 0.065, 'rgba(115,98,72,0.08)');
      context.strokeStyle = 'rgba(134,119,94,0.22)'; context.lineWidth = h * 0.001;
      for (const sign of [-1, 1]) {
        context.beginPath(); context.moveTo(sign * h * 0.009, h * 0.167);
        context.quadraticCurveTo(sign * d.shoulderWidth * 0.2, h * 0.158, sign * d.shoulderWidth * 0.35, h * 0.176); context.stroke();
      }
    } else if (part.id.includes('leg')) {
      const center = (left + right) / 2;
      spot(context, center - h * 0.006, model.anchors.knee.y, h * 0.016, h * 0.024, 'rgba(255,255,250,0.4)');
      spot(context, center, model.anchors.knee.y + h * 0.025, h * 0.018, h * 0.012, 'rgba(102,85,59,0.14)');
    } else if (part.id === 'head') {
      spot(context, -h * 0.007, h * 0.032, h * 0.028, h * 0.039, 'rgba(255,255,250,0.5)');
      spot(context, h * 0.009, h * 0.079, h * 0.011, h * 0.023, 'rgba(109,91,66,0.13)');
      spot(context, -h * 0.002, h * 0.072, h * 0.006, h * 0.024, 'rgba(255,255,250,0.42)');
      spot(context, 0, h * 0.117, h * 0.02, h * 0.009, 'rgba(101,83,56,0.14)');
    }
    context.restore();
    context.strokeStyle = BODY_PALETTE.outline;
  }
}

/** 保留袖口外的手部和领口上方的颈部；不会把整条手臂重画到袖子外。 */
export function drawBodyForeground(context: Context, model: BodyModel, base?: MannequinBaseLayers): void {
  const h = model.height;
  context.save(); context.beginPath(); context.rect(model.bounds.left - 1, h * 0.505, model.bounds.right - model.bounds.left + 2, h * 0.085); context.clip();
  drawBody(context, model, ['left-arm', 'right-arm'], base); context.restore();
  context.save(); context.beginPath(); context.rect(-h * 0.023, h * 0.112, h * 0.046, h * 0.04); context.clip();
  drawBody(context, model, ['torso'], base); context.restore();
}

export function bodyCanvasTransform(model: BodyModel, width: number, height: number): CanvasTransform {
  // 把描边也计入适配范围，头脚边缘不会被裁掉。
  const stroke = BODY_PALETTE.strokeWidth / 2;
  return fitBodyToCanvas({
    left: model.bounds.left - stroke, right: model.bounds.right + stroke,
    top: model.bounds.top - stroke, bottom: model.bounds.bottom + stroke,
  }, width, height);
}

export function renderBodyCanvas(canvas: WechatMiniprogram.Canvas, width: number, height: number,
  pixelRatio: number, model: BodyModel,
  drawOverlays?: (context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D) => void, base?: MannequinBaseLayers, atlas?: MannequinAtlas): void {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error('设备像素比无效。');
  const transform = bodyCanvasTransform(model, width, height);
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  setMannequinAtlas(context, atlas);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  const backdrop = context.createRadialGradient(width * 0.42, height * 0.3, 0, width * 0.5, height * 0.43, Math.max(width, height) * 0.7);
  backdrop.addColorStop(0, '#F8FAFD'); backdrop.addColorStop(0.65, BODY_PALETTE.background); backdrop.addColorStop(1, '#E4EAF3');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(transform.translateX, transform.translateY);
  context.scale(transform.scale, transform.scale);
  drawBody(context, model, undefined, base);
  drawOverlays?.(context);
  context.restore();
}
