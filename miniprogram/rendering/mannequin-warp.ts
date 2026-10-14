import type { BodyModel } from './body-model';
import type { MannequinAtlas } from './mannequin-atlas';
import type { MannequinBaseLayers } from './mannequin-mesh';
type Context = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
export const ATLAS_PARTS = ['left-leg', 'right-leg', 'left-arm', 'right-arm', 'torso', 'head', 'hair', 'base-top', 'base-bottom'];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function interpolate(y: number, knots: Array<[number, number]>): number {
  if (y <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) if (y <= knots[i][0]) return mix(knots[i - 1][1], knots[i][1], clamp((y - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]), 0, 1));
  return knots[knots.length - 1][1];
}
function landmarks(m: BodyModel, part: string): number[] {
  const h = m.height, a = m.anchors;
  if (part.includes('arm') || part === 'head' || part === 'hair') return [0, h];
  if (part.includes('leg') || part === 'base-bottom') return [0, a.waist.y, a.hip.y, a.crotch.y, a.knee.y, h * 0.95, h];
  return [0, h * 0.151, a.shoulderLeft.y, a.chest.y, a.waist.y, a.hip.y, a.crotch.y, h];
}
export function mannequinSourceY(y: number, source: BodyModel, target: BodyModel, part: string): number {
  const old = landmarks(source, part), current = landmarks(target, part);
  return interpolate(y, current.map((n, i) => [n, old[i]]));
}
/** 运行时只适配二维投影；体块光照、发型和手足已在开发阶段离线渲染。 */
export function mannequinSection(m: BodyModel, part: string, y: number): { center: number; radius: number } {
  const h = m.height, d = m.dimensions, a = m.anchors, sign = part.startsWith('left') ? -1 : 1;
  const feminine = m.template === 'feminine', neck = h * (feminine ? 0.021 : 0.024);
  if (part === 'base-top') return { center: 0, radius: interpolate(y, [[h * 0.151, h * 0.029], [a.shoulderLeft.y, d.shoulderWidth * 0.48],
    [a.chest.y + h * 0.018, Math.max(d.chestWidth * 0.565, d.shoulderWidth * 0.43)],
    [a.waist.y, Math.max(d.waistWidth * 0.56, d.chestWidth * 0.535)], [a.hip.y + h * 0.025, Math.max(d.hipWidth * 0.545, d.chestWidth * 0.54)]]) };
  if (part === 'base-bottom') return { center: 0, radius: interpolate(y, [[a.waist.y, d.waistWidth * 0.55], [a.hip.y, d.hipWidth * 0.55], [a.crotch.y, d.hipWidth * 0.49]]) };
  if (part === 'torso') return { center: 0, radius: interpolate(y, [[h * 0.113, neck], [h * 0.151, neck * 1.4], [a.shoulderLeft.y, d.shoulderWidth / 2],
    [a.chest.y, d.chestWidth / 2], [Math.min(a.chest.y + h * 0.04, a.waist.y - h * 0.01), d.underBustWidth / 2],
    [a.waist.y, d.waistWidth / 2], [a.hip.y, d.hipWidth / 2], [a.crotch.y + h * 0.02, d.hipWidth * 0.14]]) };
  const first = m.parts.find((p) => p.id === 'right-arm')!.commands[0] as { x: number };
  const arm = (d.shoulderWidth / 2 - first.x) / 0.8, mass = arm / (h * (feminine ? 0.018 : 0.021));
  if (part.includes('arm')) return { center: sign * (d.shoulderWidth / 2 + interpolate(y / h, [[0.175, 0], [0.235, 0.002], [0.34, 0.026], [0.42, 0.033], [0.502, 0.036]]) * h),
    radius: y >= h * 0.502 ? h * 0.015 : interpolate(y / h, [[0.175, arm * 0.7], [0.235, arm], [0.34, arm * 0.88], [0.42, arm * 0.8], [0.502, h * 0.009]]) };
  const calfY = a.knee.y + (h * 0.95 - a.knee.y) * 0.4;
  return { center: sign * d.hipWidth * 0.245, radius: interpolate(y, [[a.hip.y, d.hipWidth * 0.2], [a.crotch.y + d.inseam * 0.12, d.hipWidth * 0.23],
    [a.knee.y, h * 0.018 * mass], [calfY, h * 0.024 * mass], [h * 0.95, h * 0.012 * mass], [h * 0.98, h * 0.015], [h, h * 0.015]]) };
}
export function drawMannequinAtlas(context: Context, atlas: MannequinAtlas, target: BodyModel, onlyParts?: string[], base: MannequinBaseLayers = { top: true, bottom: true }): void {
  const source = atlas.model, sb = source.bounds, sourceWidth = sb.right - sb.left, hScale = target.height / source.height;
  const uniform = target.height === source.height && JSON.stringify(target.parts) === JSON.stringify(source.parts);
  for (const [i, part] of ATLAS_PARTS.entries()) {
    if (onlyParts && !onlyParts.includes(part)) continue;
    if ((part === 'base-top' && !base.top) || (part === 'base-bottom' && !base.bottom)) continue;
    const frameX = i % 3 * atlas.frameWidth, frameY = Math.floor(i / 3) * atlas.frameHeight;
    if (uniform || part === 'head' || part === 'hair') {
      context.drawImage(atlas.image, frameX, frameY, atlas.frameWidth, atlas.frameHeight, sb.left * hScale, 0, sourceWidth * hScale, target.height); continue;
    }
    const low = part.includes('arm') ? target.height * 0.172 : part.includes('leg') ? target.anchors.hip.y - target.height * 0.02
      : part === 'torso' ? target.height * 0.112 : part === 'base-top' ? target.height * 0.15 : target.anchors.waist.y;
    const high = part.includes('arm') ? target.height * 0.578 : part.includes('leg') ? target.height
      : part === 'torso' ? target.anchors.crotch.y + target.height * 0.032 : part === 'base-top' ? target.anchors.hip.y + target.height * 0.03
        : Math.max(target.anchors.crotch.y + target.height * 0.08, target.height * 0.66);
    const rows = Math.max(1, Math.ceil((high - low) / target.height * 160));
    for (let row = 0; row < rows; row++) {
      const y0 = mix(low, high, row / rows), y1 = mix(low, high, (row + 1) / rows);
      const sy0 = clamp(mannequinSourceY(y0, source, target, part), 0, source.height), sy1 = clamp(mannequinSourceY(y1, source, target, part), 0, source.height);
      if (sy1 <= sy0) continue;
      const old = mannequinSection(source, part, (sy0 + sy1) / 2), current = mannequinSection(target, part, (y0 + y1) / 2);
      const ratio = clamp(current.radius / old.radius, hScale * 0.2, hScale * 5);
      const cropY = frameY + sy0 / source.height * atlas.frameHeight, cropHeight = (sy1 - sy0) / source.height * atlas.frameHeight;
      if (part === 'base-top' && y0 < target.height * 0.29) {
        const oldCuts = [sb.left, -old.radius, old.radius, sb.right];
        const shoulderShift = (target.dimensions.shoulderWidth - source.dimensions.shoulderWidth * hScale) / 2;
        const outer = Math.max(sb.right * hScale + shoulderShift, current.radius + target.height * 0.025);
        const cuts = [-outer, -current.radius, current.radius, outer];
        for (let band = 0; band < 3; band++) {
          const width = oldCuts[band + 1] - oldCuts[band]; if (width <= 0 || cuts[band + 1] <= cuts[band]) continue;
          context.drawImage(atlas.image, frameX + (oldCuts[band] - sb.left) / sourceWidth * atlas.frameWidth, cropY,
            width / sourceWidth * atlas.frameWidth, cropHeight, cuts[band], y0, cuts[band + 1] - cuts[band], y1 - y0 + 0.3);
        }
      } else context.drawImage(atlas.image, frameX, cropY, atlas.frameWidth, cropHeight,
        current.center + (sb.left - old.center) * ratio, y0, sourceWidth * ratio, y1 - y0 + 0.3);
    }
  }
}
