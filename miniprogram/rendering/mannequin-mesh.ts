import { type BodyModel, type BodyPart, type PathCommand, type Point } from './body-model';

export interface Vector3 { x: number; y: number; z: number }
export interface MannequinVertex extends Vector3 { normal: Vector3 }
export interface MannequinSurface { part: string; material: 'resin' | 'hair' | 'cloth'; vertices: MannequinVertex[]; indices: number[] }
export interface MannequinBaseLayers { top: boolean; bottom: boolean }
export const mannequinBaseLayers = (layers: string[]): MannequinBaseLayers => ({
  top: !layers.some((layer) => ['top', 'outer', 'one-piece'].includes(layer)),
  bottom: !layers.some((layer) => ['bottom', 'one-piece'].includes(layer)),
});
const TAU = Math.PI * 2;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const gaussian = (n: number, center: number, width: number) => Math.exp(-(((n - center) / width) ** 2));

/** 取原人体轮廓，保证三维正投影与既有校准、身材锚点一致。 */
function polygon(commands: PathCommand[]): Point[] {
  const result: Point[] = []; let from = { x: 0, y: 0 };
  for (const c of commands) {
    if (c.type === 'close') continue;
    if (c.type === 'move' || c.type === 'line') { from = { x: c.x, y: c.y }; result.push(from); continue; }
    if (c.type !== 'quadratic' && c.type !== 'cubic') continue;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      result.push(c.type === 'quadratic' ? { x: u * u * from.x + 2 * u * t * c.cx + t * t * c.x,
        y: u * u * from.y + 2 * u * t * c.cy + t * t * c.y }
        : { x: u ** 3 * from.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x,
          y: u ** 3 * from.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y });
    }
    from = { x: c.x, y: c.y };
  }
  return result;
}

interface Section { x: number; y: number; radius: number }
function sections(part: BodyPart, rows: number, maxY = Infinity): Section[] {
  const points = polygon(part.commands), low = Math.min(...points.map((p) => p.y));
  const high = Math.min(maxY, Math.max(...points.map((p) => p.y))), result: Section[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = low + (high - low) * clamp(i / rows, 0.00001, 0.99999), xs: number[] = [];
    for (let j = 0; j < points.length; j++) {
      const a = points[j], b = points[(j + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
    }
    if (xs.length >= 2) { const left = Math.min(...xs), right = Math.max(...xs); result.push({ x: (left + right) / 2, y, radius: Math.max(0.00001, (right - left) / 2) }); }
  }
  return result;
}

/** 参数曲面法线由三维切向量计算；不把每条身体轮廓画成一根渐变柱。 */
function surface(part: string, material: MannequinSurface['material'], rows: number, columns: number,
  at: (u: number, v: number) => Vector3): MannequinSurface {
  const vertices: MannequinVertex[] = [], indices: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    const u = c / columns, v = r / rows, p = at(u, v), e = 0.0001;
    const a = at(u + e, v), b = at(u - e, v), d = at(u, clamp(v + e, 0.00001, 0.99999)), f = at(u, clamp(v - e, 0.00001, 0.99999));
    const du = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }, dv = { x: d.x - f.x, y: d.y - f.y, z: d.z - f.z };
    // v 自上向下，u 绕截面；dv × du 为外法线。
    const normal = { x: dv.y * du.z - dv.z * du.y, y: dv.z * du.x - dv.x * du.z, z: dv.x * du.y - dv.y * du.x };
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    normal.x /= length; normal.y /= length; normal.z /= length;
    vertices.push({ ...p, normal });
    if (r < rows && c < columns) { const i = r * (columns + 1) + c; indices.push(i, i + 1, i + columns + 2, i, i + columns + 2, i + columns + 1); }
  }
  return { part, material, vertices, indices };
}

function loft(part: string, rings: Section[], depthRatio: number, sculpt?: (p: Vector3, angle: number) => Vector3): MannequinSurface {
  return surface(part, 'resin', Math.max(40, rings.length - 1), 48, (u, v) => {
    const index = clamp(v, 0, 1) * (rings.length - 1), a = rings[Math.floor(index)], b = rings[Math.min(rings.length - 1, Math.floor(index) + 1)], t = index % 1;
    const smooth = (key: 'x' | 'radius') => {
      if (rings.length >= 20) return a[key] + (b[key] - a[key]) * t;
      const previous = rings[Math.max(0, Math.floor(index) - 1)], next = rings[Math.min(rings.length - 1, Math.floor(index) + 2)];
      const value = (2 * t ** 3 - 3 * t * t + 1) * a[key] + (t ** 3 - 2 * t * t + t) * (b[key] - previous[key]) / 2
        + (-2 * t ** 3 + 3 * t * t) * b[key] + (t ** 3 - t * t) * (next[key] - a[key]) / 2;
      return clamp(value, Math.min(a[key], b[key]), Math.max(a[key], b[key]));
    };
    const x = smooth('x'), y = a.y + (b.y - a.y) * t, radius = smooth('radius');
    const angle = u * TAU, p = { x: x + radius * Math.cos(angle), y, z: radius * depthRatio * Math.sin(angle) };
    return sculpt ? sculpt(p, angle) : p;
  });
}

function ellipsoid(part: string, center: Vector3, radius: Vector3, rows = 20): MannequinSurface {
  return surface(part, 'resin', rows, 32, (u, v) => {
    const angle = u * TAU, polar = clamp(v, 0.00001, 0.99999) * Math.PI;
    return { x: center.x + radius.x * Math.sin(polar) * Math.cos(angle), y: center.y - radius.y * Math.cos(polar),
      z: center.z + radius.z * Math.sin(polar) * Math.sin(angle) };
  });
}

/** 本地参数化三维白模；当前仅使用固定正面的正交投影，不提供转身。 */
export function buildMannequinSurfaces(model: BodyModel, base: MannequinBaseLayers = { top: true, bottom: true }): MannequinSurface[] {
  const h = model.height, feminine = model.template === 'feminine', result: MannequinSurface[] = [];
  for (const part of model.parts) {
    const arm = part.id.includes('arm'), head = part.id === 'head', torso = part.id === 'torso';
    const rings = sections(part, head ? 64 : torso ? 100 : arm ? 64 : 100, arm ? h * 0.502 : Infinity);
    if (rings.length < 2) continue;
    if (arm) for (const ring of rings) {
      const t = clamp((ring.y / h - 0.42) / 0.082, 0, 1), sign = part.id === 'left-arm' ? -1 : 1;
      ring.radius = ring.radius * (1 - t) + h * 0.009 * t;
      ring.x = ring.x * (1 - t) + sign * (model.dimensions.shoulderWidth / 2 + h * 0.036) * t;
    }
    result.push(loft(part.id, rings, head ? 0.87 : torso ? 0.67 : 0.94, (p, angle) => {
      const front = Math.max(0, Math.sin(angle)), x = p.x / h, y = p.y / h;
      if (head) {
        // 雕塑式面部：鼻梁/鼻尖、眼窝、颧骨和下巴；不绘制卡通五官。
        const nose = 0.0065 * gaussian(x, 0, 0.0045) * gaussian(y, 0.078, 0.009)
          + 0.0035 * gaussian(x, 0, 0.0035) * gaussian(y, 0.064, 0.013);
        const sockets = -0.0019 * (gaussian(x, -0.014, 0.007) + gaussian(x, 0.014, 0.007)) * gaussian(y, 0.058, 0.0045);
        const cheeks = 0.0014 * (gaussian(x, -0.019, 0.01) + gaussian(x, 0.019, 0.01)) * gaussian(y, 0.076, 0.012);
        const lips = 0.0008 * gaussian(x, 0, 0.012) * (gaussian(y, 0.097, 0.002) - 0.45 * gaussian(y, 0.1, 0.001));
        return { x: p.x, y: h * 0.003 + p.y * 0.975, z: p.z + h * (nose + sockets + cheeks + lips) * front ** 5 };
      }
      if (torso) {
        const chest = model.anchors.chest.y / h;
        const breast = feminine ? 0.009 * (gaussian(x, -model.dimensions.chestWidth / h * 0.23, 0.027)
          + gaussian(x, model.dimensions.chestWidth / h * 0.23, 0.027)) * gaussian(y, chest + 0.006, 0.029) : 0.0025 * gaussian(y, chest, 0.035);
        const collar = 0.0018 * gaussian(y, 0.168 + Math.abs(x) * 0.15, 0.004) * gaussian(x, 0, 0.07);
        return { ...p, z: p.z + h * (breast + collar) * front ** 3 };
      }
      return p;
    }));
    if (arm) {
      const sign = part.id === 'left-arm' ? -1 : 1, shoulder = model.dimensions.shoulderWidth / 2;
      result.push(ellipsoid(part.id, { x: sign * (shoulder + h * 0.036), y: h * 0.514, z: h * 0.001 }, { x: h * 0.015, y: h * 0.021, z: h * 0.007 }));
      // 四指长度错落，拇指略向内侧；仍位于原手部预留范围。
      for (let i = 0; i < 4; i++) {
        const length = [0.038, 0.044, 0.041, 0.032][i];
        result.push(ellipsoid(part.id, { x: sign * (shoulder + h * (0.024 + i * 0.008)), y: h * (0.531 + length / 2), z: h * 0.002 },
          { x: h * 0.0031, y: h * length / 2, z: h * 0.0031 }, 16));
      }
      result.push(ellipsoid(part.id, { x: sign * (shoulder + h * 0.019), y: h * 0.518, z: h * 0.004 }, { x: h * 0.0045, y: h * 0.017, z: h * 0.004 }));
    }
  }
  for (const sign of [-1, 1]) result.push(ellipsoid('head', { x: sign * h * (feminine ? 0.037 : 0.039), y: h * 0.071, z: -h * 0.001 }, { x: h * 0.0045, y: h * 0.014, z: h * 0.006 }));
  for (const sign of [-1, 1]) {
    const center = sign * model.dimensions.hipWidth * 0.245;
    result.push(ellipsoid(sign < 0 ? 'left-leg' : 'right-leg', { x: center, y: h * 0.975, z: h * 0.006 },
      { x: h * 0.015, y: h * 0.022, z: h * 0.018 }));
    for (let i = 0; i < 5; i++) result.push(ellipsoid(sign < 0 ? 'left-leg' : 'right-leg',
      { x: center + sign * h * (-0.011 + i * 0.0055), y: h * (0.994 - i * 0.001), z: h * 0.021 },
      { x: h * (i ? 0.0026 : 0.0034), y: h * 0.005, z: h * 0.004 }, 12));
  }
  result.push(surface('hair', 'hair', 52, 80, (u, v) => {
    const angle = u * TAU, front = Math.max(0, Math.sin(angle)), side = Math.cos(angle);
    // 女模短发与男模侧分；发束是曲面起伏，不能用整张头像缩放替代。
    const end = feminine ? 2.7 - Math.sqrt(front) * (1.32 + 0.12 * Math.cos(angle * 3))
      : 1.85 - front ** 2 * (0.55 + 0.28 * side);
    const polar = 0.00001 + v * end, strand = 1 + (feminine ? 0.014 : 0.024) * Math.cos(angle * (feminine ? 18 : 10) + polar * (feminine ? 2 : 6));
    const rx = h * (feminine ? 0.0425 : 0.0415), ry = h * (feminine ? 0.063 : 0.056), cy = ry;
    return { x: rx * Math.sin(polar) * Math.cos(angle) * strand,
      y: cy - ry * Math.cos(polar), z: h * 0.036 * Math.sin(polar) * Math.sin(angle) * strand + h * 0.001 };
  }));
  const d = model.dimensions;
  if (base.top) {
    const neckY = h * 0.151, shoulderY = model.anchors.shoulderLeft.y, chestY = model.anchors.chest.y + h * 0.018;
    const hemY = model.anchors.hip.y + h * 0.025, waistY = model.anchors.waist.y;
    const rings: Section[] = [
      { x: 0, y: neckY, radius: h * 0.029 },
      { x: 0, y: shoulderY, radius: d.shoulderWidth * 0.48 },
      { x: 0, y: chestY, radius: Math.max(d.chestWidth * 0.565, d.shoulderWidth * 0.43) },
      { x: 0, y: waistY, radius: Math.max(d.waistWidth * 0.56, d.chestWidth * 0.535) },
      { x: 0, y: hemY, radius: Math.max(d.hipWidth * 0.545, d.chestWidth * 0.54) },
    ].filter((r, i, all) => i === 0 || r.y > all[i - 1].y);
    const shirt = loft('base-top', rings, 0.69, (p, angle) => ({ ...p,
      y: p.y + Math.max(0, Math.sin(angle)) * h * 0.005 * gaussian(p.y, neckY, h * 0.01), z: p.z + h * 0.004 }));
    shirt.material = 'cloth'; result.push(shirt);
    for (const sign of [-1, 1]) {
      const sleeve = loft('base-top', [
        { x: sign * (d.shoulderWidth / 2 - h * 0.005), y: h * 0.174, radius: h * 0.002 },
        { x: sign * (d.shoulderWidth / 2 + h * 0.002), y: h * 0.192, radius: h * 0.0215 },
        { x: sign * (d.shoulderWidth / 2 + h * 0.012), y: h * 0.225, radius: h * 0.022 },
        { x: sign * (d.shoulderWidth / 2 + h * 0.022), y: h * 0.285, radius: h * 0.0195 },
      ], 1, (p) => ({ ...p, z: p.z + h * 0.002 })); sleeve.material = 'cloth'; result.push(sleeve);
    }
  }
  if (base.bottom) {
    const waistY = model.anchors.waist.y, hipY = model.anchors.hip.y, crotchY = model.anchors.crotch.y;
    const pelvis = loft('base-bottom', [{ x: 0, y: waistY, radius: d.waistWidth * 0.55 },
      { x: 0, y: hipY, radius: d.hipWidth * 0.55 }, { x: 0, y: crotchY + h * 0.008, radius: d.hipWidth * 0.49 }], 0.7,
      (p) => ({ ...p, z: p.z + h * 0.004 })); pelvis.material = 'cloth'; result.push(pelvis);
    for (const sign of [-1, 1]) {
      const leg = loft('base-bottom', [{ x: sign * d.hipWidth * 0.245, y: crotchY - h * 0.025, radius: d.hipWidth * 0.245 },
        { x: sign * d.hipWidth * 0.245, y: Math.max(crotchY + h * 0.075, h * 0.655), radius: d.hipWidth * 0.235 }], 0.92,
        (p) => ({ ...p, z: p.z + h * 0.004 })); leg.material = 'cloth'; result.push(leg);
    }
  }
  return result;
}
