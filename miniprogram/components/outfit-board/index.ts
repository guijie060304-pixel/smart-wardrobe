import type { OutfitBoardItem } from '../../models/outfit';
import type { TryOnGarment } from '../../rendering/garment-layout';
import { CanvasImageCache } from '../../rendering/garment-images';
import { GarmentGestures, type GesturePoint } from '../../rendering/garment-gestures';
import { boardCanvasFit, boardTargets, drawOutfitBoard, type BoardAsset } from '../../rendering/outfit-board';
import { completeBoard } from '../../utils/outfit-board';

interface State { version: number; gestures: GarmentGestures; canvas?: WechatMiniprogram.Canvas; cache?: CanvasImageCache;
  scene?: { assets: BoardAsset[]; key: string; width: number; height: number } }
const states = new WeakMap<object, State>();
const assetKey = (items: TryOnGarment[]) => JSON.stringify(items.map((item) => [item.garmentId, item.garment.name, item.garment.image.displayPath]));
const points = (touches: WechatMiniprogram.TouchCanvas['touches']): GesturePoint[] => touches.map((touch, index) => ({ x: touch.x, y: touch.y, identifier: touch.identifier ?? index }));

Component({
  properties: { items: { type: Array, value: [] as TryOnGarment[] }, layout: { type: Array, value: [] as OutfitBoardItem[] },
    activeId: { type: String, value: '' }, interactive: { type: Boolean, value: true }, compact: { type: Boolean, value: false } },
  data: { loading: false, renderError: '', warnings: [] as string[], gestureLocked: false },
  observers: {
    items() { if (!this.drawCurrent()) { this.cancelGesture(); this.refresh(); } },
    layout() { this.drawCurrent(); },
    activeId() { const gesture = states.get(this)?.gestures; if (gesture?.garmentId && gesture.garmentId !== this.properties.activeId) this.cancelGesture(); this.drawCurrent(); },
    interactive() { this.cancelGesture(); },
  },
  lifetimes: {
    ready() { states.set(this, { version: 0, gestures: new GarmentGestures() }); this.refresh(); },
    detached() { this.cancelGesture(); states.get(this)?.cache?.clear(); states.delete(this); },
  },
  pageLifetimes: { show() { this.refresh(); }, hide() { const state = states.get(this); if (state) state.version++; this.cancelGesture(); }, resize() { this.cancelGesture(); this.refresh(); } },
  methods: {
    refresh() {
      const state = states.get(this); if (!state) return;
      const version = ++state.version; state.scene = undefined;
      this.createSelectorQuery().select('#outfitCanvas').fields({ node: true, size: true }).exec(async (results: unknown[]) => {
        if (states.get(this) !== state || version !== state.version) return;
        const result = results[0] as { node?: WechatMiniprogram.Canvas; width: number; height: number } | null;
        if (!result?.node || !result.width || !result.height) return;
        try {
          if (state.canvas !== result.node) { state.cache?.clear(); state.canvas = result.node; state.cache = new CanvasImageCache(result.node); }
          const items = this.properties.items as TryOnGarment[], key = assetKey(items);
          state.cache!.retain(items.map((item) => item.garment.image.displayPath)); this.setData({ loading: true, renderError: '' });
          const warnings: string[] = [];
          const assets: BoardAsset[] = await Promise.all(items.map(async (item) => {
            try { const image = await state.cache!.load(item.garment.image.displayPath); return { item, image, content: state.cache!.describe(image) }; }
            catch { warnings.push(`${item.garment.name}：图片无法读取，已保留画布位置。`); return { item }; }
          }));
          if (states.get(this) !== state || version !== state.version) return;
          state.scene = { assets, key, width: result.width, height: result.height }; this.drawCurrent(); this.setData({ loading: false, renderError: '', warnings });
        } catch (error) { if (states.get(this) === state && version === state.version) this.setData({ loading: false, renderError: error instanceof Error ? error.message : '画布暂时无法绘制。' }); }
      });
    },
    drawCurrent(): boolean {
      const state = states.get(this), scene = state?.scene, items = this.properties.items as TryOnGarment[];
      if (!state?.canvas || !scene || scene.key !== assetKey(items)) return false;
      drawOutfitBoard(state.canvas, scene.width, scene.height, wx.getWindowInfo().pixelRatio, scene.assets,
        completeBoard(items, this.properties.layout as OutfitBoardItem[]), this.properties.interactive ? this.properties.activeId : ''); return true;
    },
    retry() { this.cancelGesture(); states.get(this)?.cache?.clear(); this.refresh(); },
    syncGesture() { const locked = states.get(this)?.gestures.locked || false; if (locked !== this.data.gestureLocked) { this.setData({ gestureLocked: locked }); this.triggerEvent('gesturestate', { locked }); } },
    cancelGesture() { states.get(this)?.gestures.cancel(); this.syncGesture(); },
    onTouchStart(event: WechatMiniprogram.TouchCanvas) {
      const state = states.get(this), scene = state?.scene;
      if (!state || !scene || !this.properties.interactive || this.data.loading) return;
      state.gestures.start(points(event.touches), boardTargets(scene.assets, completeBoard(this.properties.items as TryOnGarment[], this.properties.layout as OutfitBoardItem[])),
        boardCanvasFit(scene.width, scene.height), this.properties.activeId); this.syncGesture();
      if (state.gestures.locked) this.triggerEvent('itemselect', { garmentId: state.gestures.garmentId });
    },
    onLongPress() { const gesture = states.get(this)?.gestures; if (!gesture?.longPress()) return; this.syncGesture();
      this.triggerEvent('itemraise', { garmentId: gesture.garmentId }); this.triggerEvent('itemselect', { garmentId: gesture.garmentId }); },
    onTouchMove(event: WechatMiniprogram.TouchCanvas) {
      const change = states.get(this)?.gestures.move(points(event.touches)); this.syncGesture();
      if (change) this.triggerEvent('layoutchange', { garmentId: change.garmentId, x: change.transform.offsetX, y: change.transform.offsetY, scale: change.transform.scale, rotationDeg: change.transform.rotationDeg });
    },
    onTouchEnd(event?: WechatMiniprogram.TouchCanvas) { const id = states.get(this)?.gestures.end(points(event?.touches || [])); this.syncGesture(); if (id) this.triggerEvent('itemselect', { garmentId: id }); },
    onTouchCancel() { this.cancelGesture(); },
  },
});
