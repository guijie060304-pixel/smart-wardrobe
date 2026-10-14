import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_BODIES } from '../miniprogram/config/body.ts';
import { buildBodyModel } from '../miniprogram/rendering/body-model.ts';
import { rasterizeMannequin, MANNEQUIN_PARTS } from '../miniprogram/rendering/mannequin-raster.ts';

// 开发时离线生成，手机不运行三维软件光栅化。调用：node --import tsx scripts/generate-mannequin-assets.mjs <@napi-rs/canvas 模块路径>
const require = createRequire(import.meta.url), { createCanvas } = require(process.argv[2] || '@napi-rs/canvas');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'miniprogram/assets/mannequin');
fs.mkdirSync(output, { recursive: true });
for (const [template, profile] of Object.entries(SAMPLE_BODIES)) {
  const model = buildBodyModel(profile), scale = 640 / model.height, bare = { top: false, bottom: false };
  const full = rasterizeMannequin(model, scale, bare), atlas = createCanvas(full.width * 3, full.height * 3), context = atlas.getContext('2d');
  for (const [i, part] of MANNEQUIN_PARTS.entries()) {
    const raster = ['head', 'hair'].includes(part) ? full : rasterizeMannequin(model, scale, { top: true, bottom: true }, [part]);
    const image = context.createImageData(full.width, full.height); image.data.set(raster.pixels);
    if (['head', 'hair'].includes(part)) for (let p = 0; p < raster.parts.length; p++) if (raster.parts[p] !== i + 1) image.data[p * 4 + 3] = 0;
    context.putImageData(image, (i % 3) * full.width, Math.floor(i / 3) * full.height);
  }
  const filename = template === 'masculine' ? 'white-male.png' : 'white-female.png';
  fs.writeFileSync(path.join(output, filename), atlas.toBuffer('image/png'));
  console.log(`${filename}: ${atlas.width} x ${atlas.height}, ${(fs.statSync(path.join(output, filename)).size / 1024).toFixed(1)} KiB`);
}
