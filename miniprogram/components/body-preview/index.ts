import { SAMPLE_BODY } from '../../config/body';
import type { BodyMeasurements } from '../../models/body-profile';
import { buildBodyModel, type BodyModel } from '../../rendering/body-model';
import { bodyCanvasTransform, renderBodyCanvas } from '../../rendering/draw-body';
import { drawGarments, loadedPlacement } from '../../rendering/draw-garments';
import { CanvasImageCache, loadGarmentImages, type LoadedGarment } from '../../rendering/garment-images';
import { sortTryOnGarments, type TryOnGarment } from '../../rendering/garment-layout';
import { GarmentGestures, type GesturePoint } from '../../rendering/garment-gestures';
import { buildGarmentMesh } from '../../rendering/garment-mesh';
import { createMeshSurface } from '../../rendering/draw-garment-mesh';
import { mannequinBaseLayers } from '../../rendering/mannequin-mesh';
import { loadMannequinAtlas, type MannequinAtlas } from '../../rendering/mannequin-atlas';

interface CanvasQueryResult { node: WechatMiniprogram.Canvas; width: number; height: number }
interface PreviewState {
  version: number; canvas?: WechatMiniprogram.Canvas; cache?: CanvasImageCache; gestures: GarmentGestures;
  body?: { key: string; model: BodyModel };
  bodyCache?: CanvasImageCache; atlas?: MannequinAtlas;
  scene?: { model: BodyModel; loaded: LoadedGarment[]; width: number; height: number; assets: string };
}
const states = new WeakMap<object, PreviewState>();
const assetKey = (items: TryOnGarment[]) => JSON.stringify(items.map(({ garmentId, garment, layer }) =>
  [garmentId, layer, garment.name, garment.category, garment.image, garment.fitting, garment.fit]));
const touchPoints = (touches: WechatMiniprogram.TouchCanvas['touches']): GesturePoint[] =>
  touches.map((touch, index) => ({ x: touch.x, y: touch.y, identifier: touch.identifier ?? index }));

Component({
  properties: {
    profile: { type: Object, value: { ...SAMPLE_BODY } },
    items: { type: Array, value: [] as TryOnGarment[] },
    activeId: { type: String, value: '' },
    interactive: { type: Boolean, value: false },
  },
  data: { renderError: '', warnings: [] as string[], loading: false, gestureLocked: false, gestureHint: '' },
  observers: {
    profile() { this.cancelGesture(); this.refresh(); },
    interactive() { this.cancelGesture(); },
    items() { if (!this.drawCurrent()) { this.cancelGesture(); this.refresh(); } },
    activeId() {
      const gestures = states.get(this)?.gestures;
      if (gestures?.garmentId && gestures.garmentId !== this.properties.activeId) this.cancelGesture();
      this.drawCurrent();
    },
  },
  lifetimes: {
    ready() { states.set(this, { version: 0, gestures: new GarmentGestures() }); this.refresh(); },
    detached() { states.get(this)?.cache?.clear(); states.get(this)?.bodyCache?.clear(); states.delete(this); },
  },
  pageLifetimes: {
    show() { this.refresh(); },
    hide() { const state = states.get(this); if (state) state.version += 1; this.cancelGesture(); },
    resize() { this.cancelGesture(); this.refresh(); },
  },
  methods: {
    /** 画布容器布局发生变化时可由调用方请求重新测量。 */
    refresh() {
      const state = states.get(this);
      if (!state) return;
      const version = ++state.version;
      state.scene = undefined;
      this.createSelectorQuery().select('#bodyCanvas').fields({ node: true, size: true })
        .exec(async (results: unknown[]) => {
          if (states.get(this) !== state || version !== state.version) return;
          const result = results[0] as CanvasQueryResult | null;
          if (!result?.node || !result.width || !result.height) return;
          try {
            const profile = (this.properties.profile || SAMPLE_BODY) as BodyMeasurements;
            const bodyKey = JSON.stringify(profile);
            if (state.body?.key !== bodyKey) state.body = { key: bodyKey, model: buildBodyModel(profile) };
            const model = state.body.model;
            const items = this.properties.items as TryOnGarment[];
            if (state.canvas !== result.node) {
              state.cache?.clear(); state.bodyCache?.clear(); state.canvas = result.node;
              state.cache = new CanvasImageCache(result.node); state.bodyCache = new CanvasImageCache(result.node);
            }
            this.setData({ loading: true, renderError: '' });
            const atlas = await loadMannequinAtlas(state.bodyCache!, profile.template);
            if (states.get(this) !== state || version !== state.version) return;
            state.atlas = atlas;
            renderBodyCanvas(result.node, result.width, result.height, wx.getWindowInfo().pixelRatio, model, undefined, mannequinBaseLayers(items.map((item) => item.layer)), atlas);
            const { loaded, warnings } = await loadGarmentImages(state.cache!, items);
            if (states.get(this) !== state || version !== state.version) return;
            if (!atlas) warnings.push('白模资源无法读取，已使用基础模特。');
            for (const entry of loaded) {
              entry.mesh = buildGarmentMesh(model, entry);
              if (entry.mesh) entry.surface = createMeshSurface(entry.image, entry.mesh);
              else if (entry.item.garment.fitting?.mode === 'adapt') warnings.push(`${entry.item.garment.name}：当前校准无法安全变形，已使用原图，请重新校准。`);
            }
            state.scene = { model, loaded, width: result.width, height: result.height, assets: assetKey(items) };
            this.drawCurrent();
            this.setData({ warnings, loading: false, renderError: '' });
          } catch (error) {
            if (states.get(this) === state && version === state.version) {
              this.setData({ renderError: error instanceof Error ? error.message : '人体预览暂时无法绘制，请重试。', loading: false });
            }
          }
        });
    },
    /** 只改参数时复用节点和已解码图片，避免每一帧重新测量与异步加载。 */
    drawCurrent(): boolean {
      const state = states.get(this), scene = state?.scene;
      const items = this.properties.items as TryOnGarment[];
      if (!state?.canvas || !scene || scene.assets !== assetKey(items)) return false;
      scene.loaded = scene.loaded.map((entry) => ({ ...entry, item: items.find((item) => item.garmentId === entry.item.garmentId)! }));
      renderBodyCanvas(state.canvas, scene.width, scene.height, wx.getWindowInfo().pixelRatio, scene.model,
        (context) => drawGarments(context, scene.model, scene.loaded, this.properties.activeId), mannequinBaseLayers(scene.loaded.map(({ item }) => item.layer)), state.atlas);
      return true;
    },
    retry() { this.cancelGesture(); const state = states.get(this); state?.cache?.clear(); state?.bodyCache?.clear(); this.refresh(); },
    syncGesture() {
      const gestures = states.get(this)?.gestures;
      const gestureLocked = gestures?.locked || false;
      const gestureHint = gestures?.mode === 'drag' ? '移动衣物中 · 松手完成'
        : gestures?.mode === 'pinch' ? '双指缩放 / 旋转 · 松手完成' : '';
      if (this.data.gestureLocked !== gestureLocked || this.data.gestureHint !== gestureHint) this.setData({ gestureLocked, gestureHint });
    },
    cancelGesture() { states.get(this)?.gestures.cancel(); this.syncGesture(); },
    onTouchStart(event: WechatMiniprogram.TouchCanvas) {
      const state = states.get(this);
      const scene = state?.scene;
      if (!state || !scene || this.data.loading || !this.properties.interactive) return;
      const targets = sortTryOnGarments(scene.loaded.map(({ item }) => item)).map((item) => {
        const entry = scene.loaded.find((entry) => entry.item.garmentId === item.garmentId)!;
        return { garmentId: item.garmentId, transform: item.transform,
          placement: loadedPlacement(scene.model, entry), triangles: entry.mesh?.triangles.map((triangle) => triangle.map((v) => v.target) as [typeof triangle[0]['target'], typeof triangle[0]['target'], typeof triangle[0]['target']]) };
      });
      state.gestures.start(touchPoints(event.touches), targets, bodyCanvasTransform(scene.model, scene.width, scene.height), this.properties.activeId);
      this.syncGesture();
      if (state.gestures.locked) this.triggerEvent('garmentselect', { garmentId: state.gestures.garmentId });
    },
    onLongPress() {
      const gestures = states.get(this)?.gestures;
      if (!gestures?.longPress()) return;
      this.syncGesture();
      this.triggerEvent('garmentraise', { garmentId: gestures.garmentId });
      this.triggerEvent('garmentselect', { garmentId: gestures.garmentId });
    },
    onTouchMove(event: WechatMiniprogram.TouchCanvas) {
      const change = states.get(this)?.gestures.move(touchPoints(event.touches));
      this.syncGesture();
      if (change) this.triggerEvent('transformchange', { garmentId: change.garmentId, ...change.transform });
    },
    onTouchEnd(event?: WechatMiniprogram.TouchCanvas) {
      const id = states.get(this)?.gestures.end(touchPoints(event?.touches || []));
      this.syncGesture();
      if (id) this.triggerEvent('garmentselect', { garmentId: id });
    },
    onTouchCancel() { this.cancelGesture(); },
  },
});
