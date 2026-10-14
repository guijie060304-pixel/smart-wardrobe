import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mannequinSourceY, mannequinSection, ATLAS_PARTS } from '../miniprogram/rendering/mannequin-warp.ts';
import { SAMPLE_BODIES } from '../miniprogram/config/body.ts';
import { buildBodyModel } from '../miniprogram/rendering/body-model.ts';
import { buildMannequinSurfaces, mannequinBaseLayers } from '../miniprogram/rendering/mannequin-mesh.ts';
import { rasterizeMannequin, MANNEQUIN_PARTS } from '../miniprogram/rendering/mannequin-raster.ts';
import { drawMannequinSurface, setMannequinAtlas } from '../miniprogram/rendering/mannequin-surface.ts';

const bare = { top: false, bottom: false };
const indexAt = (r, x, y) => Math.floor((y - r.bounds.top) / (r.bounds.bottom - r.bounds.top) * r.height) * r.width
  + Math.floor((x - r.bounds.left) / (r.bounds.right - r.bounds.left) * r.width);
const partAt = (r, x, y) => MANNEQUIN_PARTS[r.parts[indexAt(r, x, y)] - 1];

test('三维白模包含实际深度/单位法线，男女发型不同，极端身材完整位于适配范围且不改输入/锚点', () => {
  for (const template of ['masculine', 'feminine']) {
    for (const change of [{}, {heightCm:150,weightKg:0.001,bustCm:0.001,waistCm:0.001,hipCm:0.001},
      {heightCm:200,weightKg:Number.MAX_VALUE,bustCm:Number.MAX_VALUE,waistCm:Number.MAX_VALUE,hipCm:Number.MAX_VALUE,inseamCm:1,shoulderWidthCm:1}]) {
      const input = Object.freeze({...SAMPLE_BODIES[template],...change}), model=buildBodyModel(input), before=structuredClone(model);
      const surfaces=buildMannequinSurfaces(model), points=surfaces.flatMap(s=>s.vertices);
      assert.ok(points.every(p=>[p.x,p.y,p.z,p.normal.x,p.normal.y,p.normal.z].every(Number.isFinite)));
      assert.ok(points.some(p=>p.z>model.height*.025)&&points.some(p=>p.z<-model.height*.02),'真实三维坐标');
      for(const p of points){
        assert.ok(p.x>=model.bounds.left-1e-6&&p.x<=model.bounds.right+1e-6,'横向不裁切');
        assert.ok(p.y>=model.bounds.top-1e-6&&p.y<=model.bounds.bottom+1e-6,'头脚不裁切');
        const n=Math.hypot(p.normal.x,p.normal.y,p.normal.z);assert.ok(n<1e-8||Math.abs(n-1)<1e-6);
      }
      assert.deepEqual(model,before);assert.equal(input.heightCm,change.heightCm||SAMPLE_BODIES[template].heightCm);
    }
  }
  const hair=template=>buildMannequinSurfaces(buildBodyModel(SAMPLE_BODIES[template])).find(s=>s.part==='hair').vertices;
  assert.notDeepEqual(hair('masculine'),hair('feminine'));
});

test('正面投影深度遮挡与透明背景正确，基础衣裤隐藏后露出人体，头发不盖住面部', () => {
  for(const profile of Object.values(SAMPLE_BODIES)){
    const model=buildBodyModel(profile), h=model.height, dressed=rasterizeMannequin(model,2), naked=rasterizeMannequin(model,2,bare);
    assert.equal(partAt(dressed,0,model.anchors.chest.y),'base-top');
    assert.equal(partAt(naked,0,model.anchors.chest.y),'torso');
    assert.equal(partAt(dressed,0,h*.03),'hair');assert.equal(partAt(dressed,0,h*.078),'head');
    assert.equal(dressed.pixels[3],0);assert.ok(dressed.pixels.some((v,i)=>i%4===3&&v===255));
    assert.ok(dressed.triangles>1000);assert.equal(naked.parts.includes(MANNEQUIN_PARTS.indexOf('base-top')+1),false);
    assert.equal(naked.parts.includes(MANNEQUIN_PARTS.indexOf('base-bottom')+1),false);
  }
});

test('基础衣裤只是预览占位，选中上/下装、外套和连体装分别隐藏，未选时恢复', () => {
  assert.deepEqual(mannequinBaseLayers([]),{top:true,bottom:true});
  assert.deepEqual(mannequinBaseLayers(['top']),{top:false,bottom:true});
  assert.deepEqual(mannequinBaseLayers(['bottom']),{top:true,bottom:false});
  assert.deepEqual(mannequinBaseLayers(['outer']),{top:false,bottom:true});
  assert.deepEqual(mannequinBaseLayers(['top','bottom']),bare);
  assert.deepEqual(mannequinBaseLayers(['one-piece']),bare);
});

test('纹理尺寸有上限，渲染确定且不读写本地数据，非法比例明确失败', () => {
  const model=buildBodyModel(SAMPLE_BODIES.feminine), a=rasterizeMannequin(model,1,bare), b=rasterizeMannequin(model,1,bare);
  assert.deepEqual(a.pixels,b.pixels);assert.deepEqual(a.parts,b.parts);
  const large=rasterizeMannequin(model,Number.MAX_VALUE,bare);assert.ok(large.width<=1000&&large.height<=1000);
  for(const scale of [0,-1,NaN,Infinity])assert.throws(()=>rasterizeMannequin(model,scale),/比例/);
});

function graphics(){
  const prepared=[];let allocations=0;
  globalThis.wx={createOffscreenCanvas({width,height}){
    allocations++;const draws=[];prepared.push(draws);return {width,height,getContext:()=>({scale(){},translate(){},drawImage:(...args)=>draws.push(args)})};
  }};
  return {prepared,get allocations(){return allocations}};
}
const atlasFor=model=>({image:{width:714,height:1920},model,frameWidth:238,frameHeight:640});
test('白模和手颈纹理缓存复用，连续衣物变换不重复适配；前景只绘指定部件',()=>{
  const env=graphics(),model=buildBodyModel(SAMPLE_BODIES.feminine),draws=[],dest={drawImage:(...args)=>draws.push(args)};
  setMannequinAtlas(dest,atlasFor(model));assert.equal(drawMannequinSurface(dest,model,undefined,bare),true);const first=env.allocations;
  for(let i=0;i<50;i++)assert.equal(drawMannequinSurface(dest,model,undefined,bare),true);
  assert.equal(env.allocations,first);assert.equal(draws.length,51);assert.equal(env.prepared[0].length,7);
  assert.equal(drawMannequinSurface(dest,model,['left-arm','right-arm'],bare),true);
  const selected=env.prepared.at(-1).map(args=>Math.round(args[2]/640)*3+Math.round(args[1]/238));
  assert.deepEqual(selected,[2,3]);assert.equal(selected.includes(ATLAS_PARTS.indexOf('torso')),false);
  assert.equal(drawMannequinSurface(dest,model,undefined,{top:true,bottom:true}),true);assert.equal(env.prepared.at(-1).length,9);
  const edited=buildBodyModel({...SAMPLE_BODIES.feminine,waistCm:85});assert.equal(drawMannequinSurface(dest,edited,undefined,bare),true);assert.ok(env.prepared.at(-1).length>7);
});
test('离屏失败只尝试一次并直接适配本地白模；资源缺失降级，恢复资源可重试',()=>{
  let calls=0,draws=0;globalThis.wx={createOffscreenCanvas(){calls++;throw Error('不支持离屏')}};
  const model=buildBodyModel(SAMPLE_BODIES.masculine),dest={drawImage(){draws++}};
  assert.equal(drawMannequinSurface(dest,model),false);setMannequinAtlas(dest,atlasFor(model));
  for(let i=0;i<10;i++)assert.equal(drawMannequinSurface(dest,model),true);assert.equal(calls,1);assert.ok(draws>10);
  const env=graphics();assert.equal(drawMannequinSurface(dest,model),true);assert.equal(env.allocations,1);
  setMannequinAtlas(dest);assert.equal(drawMannequinSurface(dest,model),false);
});
test('预渲染白模按腰/臀/裆/膝重映射，肩位与围度分别驱动适配',()=>{
  const source=buildBodyModel(SAMPLE_BODIES.feminine),target=buildBodyModel({...SAMPLE_BODIES.feminine,shoulderWidthCm:42,torsoLengthCm:39,inseamCm:72,waistCm:85});
  for(const anchor of ['chest','waist','hip','crotch'])assert.ok(Math.abs(mannequinSourceY(target.anchors[anchor].y,source,target,'torso')-source.anchors[anchor].y)<1e-8);
  for(const anchor of ['hip','crotch','knee'])assert.ok(Math.abs(mannequinSourceY(target.anchors[anchor].y,source,target,'left-leg')-source.anchors[anchor].y)<1e-8);
  assert.ok(mannequinSection(target,'torso',target.anchors.waist.y).radius>mannequinSection(source,'torso',source.anchors.waist.y).radius);
  assert.ok(mannequinSection(target,'right-arm',target.height*.51).center>mannequinSection(source,'right-arm',source.height*.51).center);
  const left=mannequinSection(target,'left-arm',target.height*.51),right=mannequinSection(target,'right-arm',target.height*.51);assert.equal(left.center,-right.center);
});
test('本地男女白模资源与九格契约一致，运行时不依赖生成器或网络',()=>{
  for(const name of ['white-male','white-female']){
    const bytes=fs.readFileSync(new URL('../miniprogram/assets/mannequin/'+name+'.png',import.meta.url));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16)%3,0);assert.equal(bytes.readUInt32BE(20),1920);assert.ok(bytes.length<100*1024);
  }
  assert.equal(ATLAS_PARTS.length,9);
});
