import type { GarmentFitting, FittingPointKey } from '../../models/garment-fitting';
import { CanvasImageCache } from '../../rendering/garment-images';
import { calibrationHandle, calibrationPoint, drawCalibration, type CalibrationView } from '../../rendering/draw-calibrator';

interface State { version: number; canvas?: WechatMiniprogram.Canvas; cache?: CanvasImageCache; image?: WechatMiniprogram.Image;
  width: number; height: number; view?: CalibrationView; reportedPath: string;
  pointer?: { id: number; key?: FittingPointKey; x: number; y: number; moved: boolean } }
const states = new WeakMap<object, State>();
Component({
  properties: { imagePath: { type: String, value: '' }, fitting: { type: Object }, active: { type: String, value: '' } },
  data: { dragging: false, error: '' },
  observers: { imagePath() { this.onTouchCancel(); this.refresh(); }, fitting() { this.draw(); }, active() { this.draw(); } },
  lifetimes: {
    ready() { states.set(this, { version: 0, width: 0, height: 0, reportedPath: '' }); this.refresh(); },
    detached() { states.get(this)?.cache?.clear(); states.delete(this); },
  },
  pageLifetimes: { hide() { this.onTouchCancel(); }, resize() { this.onTouchCancel(); this.refresh(); } },
  methods: {
    refresh() {
      const state = states.get(this); if (!state || !this.properties.imagePath) return;
      const version = ++state.version, path = this.properties.imagePath;
      this.createSelectorQuery().select('#calibrationCanvas').fields({ node: true, size: true }).exec(async (results: unknown[]) => {
        const result = results[0] as { node?: WechatMiniprogram.Canvas; width: number; height: number } | null;
        if (!result?.node || !result.width || !result.height || states.get(this) !== state || state.version !== version) return;
        try {
          if (state.canvas !== result.node) { state.cache?.clear(); state.canvas = result.node; state.cache = new CanvasImageCache(result.node); }
          state.cache!.retain([path]);
          const image = await state.cache!.load(path);
          if (states.get(this) !== state || state.version !== version) return;
          state.image = image; state.width = result.width; state.height = result.height;
          const content = state.cache!.describe(image);
          this.setData({ error: '' }); this.draw();
          if (state.reportedPath !== path) { state.reportedPath = path; this.triggerEvent('imageinfo', { width: image.width, height: image.height, content }); }
        } catch (error) {
          if (states.get(this) === state && state.version === version) { state.image = undefined; this.setData({ error: error instanceof Error ? error.message : '图片读取失败。' }); this.triggerEvent('imageerror'); }
        }
      });
    },
    draw() {
      const state = states.get(this); if (!state?.canvas || !state.image) return;
      state.view = drawCalibration(state.canvas, state.image, state.width, state.height, wx.getWindowInfo().pixelRatio,
        this.properties.fitting as GarmentFitting | undefined, this.properties.active);
    },
    movePoint(key: FittingPointKey, x: number, y: number) {
      const view = states.get(this)?.view; if (!view) return;
      this.triggerEvent('pointchange', { key, point: calibrationPoint(x, y, view) });
    },
    onTouchStart(event: WechatMiniprogram.TouchCanvas) {
      if (event.touches.length !== 1) { this.onTouchCancel(); return; }
      const state = states.get(this), fitting = this.properties.fitting as GarmentFitting | null;
      if (!state?.view || !fitting || fitting.mode === 'original' || event.touches.length !== 1 || state.pointer) return;
      const p = event.touches[0], key = calibrationHandle(fitting, p.x, p.y, state.view);
      state.pointer = { id: p.identifier, key, x: p.x, y: p.y, moved: false };
      this.setData({ dragging: !!key });
      if (key) this.triggerEvent('pointselect', { key });
    },
    onTouchMove(event: WechatMiniprogram.TouchCanvas) {
      const pointer = states.get(this)?.pointer; if (!pointer) return;
      if (event.touches.length !== 1 || event.touches[0].identifier !== pointer.id) { this.onTouchCancel(); return; }
      const p = event.touches[0]; if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > 8) pointer.moved = true;
      if (pointer.key) this.movePoint(pointer.key, p.x, p.y);
    },
    onTouchEnd(event: WechatMiniprogram.TouchCanvas) {
      const state = states.get(this), pointer = state?.pointer;
      if (pointer && !pointer.key && !pointer.moved && !event.touches?.length && this.properties.active) this.movePoint(this.properties.active as FittingPointKey, pointer.x, pointer.y);
      this.onTouchCancel();
    },
    onTouchCancel() { const state = states.get(this); if (state) state.pointer = undefined; if (this.data.dragging) this.setData({ dragging: false }); },
  },
});
