import type { BodyModel, Bounds } from './body-model';
import { buildMannequinSurfaces, type MannequinBaseLayers, type Vector3 } from './mannequin-mesh';

export interface MannequinRaster { width: number; height: number; pixels: Uint8ClampedArray; parts: Uint8Array; bounds: Bounds; triangles: number }
export const MANNEQUIN_PARTS = ['left-leg', 'right-leg', 'left-arm', 'right-arm', 'torso', 'head', 'hair', 'base-top', 'base-bottom'];
const normalize = (v: Vector3): Vector3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const light = normalize({ x: -0.5, y: -0.65, z: 1 }), half = normalize({ x: light.x, y: light.y, z: light.z + 1 });
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 固定正面正交投影。深度缓冲负责身体部件互相遮挡，法线负责漫反射和柔和高光。 */
export function rasterizeMannequin(model: BodyModel, scale = 4, base?: MannequinBaseLayers, onlyParts?: string[]): MannequinRaster {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('模特渲染比例无效。');
  const bounds = { ...model.bounds }, w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
  const factor = Math.min(scale, 1000 / h, 1000 / w), width = Math.max(1, Math.ceil(w * factor)), height = Math.max(1, Math.ceil(h * factor));
  const pixels = new Uint8ClampedArray(width * height * 4), parts = new Uint8Array(width * height), depth = new Float32Array(width * height).fill(-Infinity);
  let triangles = 0;
  for (const mesh of buildMannequinSurfaces(model, base)) {
    if (onlyParts && !onlyParts.includes(mesh.part)) continue;
    const id = MANNEQUIN_PARTS.indexOf(mesh.part) + 1;
    const vertices = mesh.vertices.map((p) => {
      const diffuse = Math.max(0, dot(p.normal, light)), specular = Math.max(0, dot(p.normal, half)) ** 38;
      let value = Math.min(1.045, 0.73 + diffuse * 0.23 + Math.max(0, p.normal.z) * 0.025 + specular * (mesh.material === 'cloth' ? 0.015 : 0.08));
      if (mesh.material === 'cloth') {
        const hem = mesh.part === 'base-top' ? model.anchors.hip.y + model.height * 0.025 : Math.max(model.anchors.crotch.y + model.height * 0.075, model.height * 0.655);
        const seam = Math.exp(-(((p.y - hem) / (model.height * 0.0015)) ** 2));
        value *= 1 - seam * 0.045;
      }
      return { x: (p.x - bounds.left) * width / w, y: (p.y - bounds.top) * height / h, z: p.z,
        shade: value * (mesh.material === 'hair' ? 0.98 : 1), normal: p.normal };
    });
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = vertices[mesh.indices[i]], b = vertices[mesh.indices[i + 1]], c = vertices[mesh.indices[i + 2]];
      if (a.normal.z + b.normal.z + c.normal.z < -0.01) continue;
      const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(area) < 1e-8) continue;
      triangles++;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const u = ((b.y - c.y) * (x + 0.5 - c.x) + (c.x - b.x) * (y + 0.5 - c.y)) / area;
        const v = ((c.y - a.y) * (x + 0.5 - c.x) + (a.x - c.x) * (y + 0.5 - c.y)) / area, t = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || t < -1e-6) continue;
        const z = a.z * u + b.z * v + c.z * t, index = y * width + x;
        if (z <= depth[index]) continue;
        depth[index] = z; parts[index] = id;
        const shade = a.shade * u + b.shade * v + c.shade * t, offset = index * 4;
        pixels[offset] = 245 * shade; pixels[offset + 1] = 247 * shade; pixels[offset + 2] = 250 * shade; pixels[offset + 3] = 255;
      }
    }
  }
  return { width, height, pixels, parts, bounds, triangles };
}
