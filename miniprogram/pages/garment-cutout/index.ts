import { CutoutMask, limitedSize, resizeMask, type PixelPoint, type PixelRect } from '../../utils/cutout-mask';
import { CutoutCancelled, segmentGarment } from '../../utils/cutout-segmentation';
import { imagePoint, pinchView, drawCutoutPreview, viewScale, type CutoutView } from '../../rendering/cutout-editor';
import { CanvasImageCache } from '../../rendering/garment-images';
import { getCutoutSource, closeCutoutSession, deliverCutoutResult } from '../../services/cutout-session';
import { exportCutout } from '../../services/cutout-export';

interface Pointer extends PixelPoint { identifier: number }
interface State {
  id: string; source: string; version: number; alive: boolean; canvas?: WechatMiniprogram.Canvas; work?: WechatMiniprogram.Canvas; output?: WechatMiniprogram.Canvas;
  pixels?: Uint8ClampedArray; raster?: WechatMiniprogram.ImageData; editor?: CutoutMask; view?: CutoutView;
  rect?: PixelRect; previousRect?: PixelRect; polygon: PixelPoint[]; pointer?: Pointer; last?: PixelPoint; pinch?: Pointer[]; waiting: boolean; frame?: number; maskDirty: boolean;
}
const states = new WeakMap<object, State>();
const points = (event: WechatMiniprogram.TouchCanvas): Pointer[] => Array.from(event.touches || [], (p) => ({ x: p.x, y: p.y, identifier: p.identifier }));
const warning = () => { if (typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '抠图尚未应用，离开会丢失本次修改。' }); };

Page({
  data: { loading: true, ready: false, error: '', tool: 'rect', brush: 24, checker: true, busy: false, exporting: false, canUndo: false, hasRect: false, hasResult: false },
  onLoad(query: { session?: string }) {
    const id = query.session || '', source = getCutoutSource(id) || '';
    states.set(this, { id, source, version: 0, alive: true, polygon: [], waiting: false, maskDirty: true });
    if (!source) this.setData({ loading: false, error: '图片编辑已过期，请返回衣物页重新打开。' });
  },
  onReady() { this.initialize(); },
  onResize() { this.onTouchCancel(); this.measure(); },
  onHide() { this.cancelEstimate(); this.onTouchCancel(); },
  onUnload() {
    const state = states.get(this); if (state) { state.alive = false; state.version++; closeCutoutSession(state.id); if (state.frame !== undefined) state.canvas?.cancelAnimationFrame(state.frame); }
    states.delete(this); if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  },
  initialize() {
    const state = states.get(this); if (!state?.source) return;
    const version = ++state.version;
    this.createSelectorQuery().select('#cutoutCanvas').fields({ node: true, size: true }).select('#workCanvas').fields({ node: true })
      .select('#exportCanvas').fields({ node: true }).exec(async (results: unknown[]) => {
        if (!state.alive || version !== state.version) return;
        const [visible, work, output] = results as Array<{ node?: WechatMiniprogram.Canvas; width?: number; height?: number }>;
        try {
          if (!visible?.node || !visible.width || !visible.height || !work?.node || !output?.node) throw new Error('当前设备无法初始化画布，请返回后重试。');
          state.canvas = visible.node; state.work = work.node; state.output = output.node;
          const image = await new CanvasImageCache(work.node).load(state.source);
          if (!state.alive || version !== state.version) return;
          const size = limitedSize(image.width, image.height, 1024);
          work.node.width = size.width; work.node.height = size.height;
          const context = work.node.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
          context.drawImage(image, 0, 0, size.width, size.height);
          const raster = context.getImageData(0, 0, size.width, size.height); state.raster = raster; state.pixels = raster.data.slice();
          state.editor = new CutoutMask(size.width, size.height);
          state.view = { width: visible.width, height: visible.height, imageWidth: size.width, imageHeight: size.height, zoom: 1, panX: 0, panY: 0 };
          this.setData({ loading: false, ready: true, error: '' }); this.draw();
        } catch (error) { if (state.alive && version === state.version) this.setData({ loading: false, error: error instanceof Error ? error.message : '照片无法处理，请返回重选。' }); }
      });
  },
  measure() {
    const state = states.get(this); if (!state?.view) return;
    this.createSelectorQuery().select('#cutoutCanvas').fields({ size: true }).exec((results: unknown[]) => {
      const size = results[0] as { width?: number; height?: number } | undefined;
      if (!state.alive || !state.view || !size?.width || !size.height) return;
      state.view = { ...state.view, width: size.width, height: size.height, zoom: 1, panX: 0, panY: 0 }; this.draw();
    });
  },
  draw() {
    const state = states.get(this); if (!state?.canvas || !state.work || !state.view || !state.raster || !state.pixels || !state.editor) return;
    if (state.maskDirty) {
      for (let i = 0; i < state.editor.mask.length; i++) state.raster.data[i * 4 + 3] = Math.round(state.pixels[i * 4 + 3] * state.editor.mask[i] / 255);
      (state.work.getContext('2d') as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D).putImageData(state.raster, 0, 0); state.maskDirty = false;
    }
    drawCutoutPreview(state.canvas, state.work, state.view, wx.getWindowInfo().pixelRatio, this.data.checker, this.data.tool === 'rect' ? state.rect : undefined, state.polygon);
  },
  scheduleDraw() {
    const state = states.get(this); if (!state?.canvas || state.frame !== undefined) return;
    state.frame = state.canvas.requestAnimationFrame(() => { state.frame = undefined; if (state.alive) this.draw(); });
  },
  changed() {
    const state = states.get(this); if (!state?.editor) return;
    state.maskDirty = true; this.setData({ canUndo: state.editor.canUndo, hasResult: true, error: '' }); warning(); this.scheduleDraw();
  },
  selectTool(event: { currentTarget: { dataset: { tool: string } } }) {
    if (this.data.busy) return; const tool = event.currentTarget.dataset.tool;
    if (!['rect', 'polygon', 'keep', 'erase'].includes(tool)) return;
    this.onTouchCancel(); this.setData({ tool }); this.draw();
  },
  changeBrush(event: { detail: { value: number } }) { this.setData({ brush: Math.max(4, Math.min(64, event.detail.value)) }); },
  toggleBackground() { this.setData({ checker: !this.data.checker }); this.draw(); },
  resetView() { const state = states.get(this); if (state?.view) { state.view = { ...state.view, zoom: 1, panX: 0, panY: 0 }; this.draw(); } },
  undo() { if (this.data.busy) return; this.onTouchCancel(); states.get(this)?.editor?.undo(); this.changed(); },
  reset() {
    if (this.data.busy) return;
    wx.showModal({ title: '重新处理', content: '恢复完整照片，重新框选或圈选？当前结果可以通过撤销找回。', success: (result) => {
      const state = states.get(this); if (!result.confirm || !state?.alive || this.data.busy) return;
      this.onTouchCancel(); state.editor?.reset(); state.rect = undefined; this.setData({ hasRect: false }); this.changed(); this.setData({ tool: 'rect', hasResult: false }); this.draw();
    } });
  },
  onTouchStart(event: WechatMiniprogram.TouchCanvas) {
    const state = states.get(this); if (!state?.view || !state.editor || this.data.busy) return;
    const touches = points(event);
    if (touches.length >= 2) {
      if (state.pointer && this.data.tool === 'rect') state.rect = state.previousRect;
      state.editor.cancel(); state.maskDirty = true; state.pointer = undefined; state.last = undefined; state.polygon = []; state.pinch = touches.slice(0, 2); state.waiting = true; this.scheduleDraw(); return;
    }
    if (state.waiting || touches.length !== 1) return;
    state.pointer = touches[0]; const point = imagePoint(touches[0], state.view); state.last = point;
    if (point.x < 0 || point.y < 0 || point.x >= state.editor.width || point.y >= state.editor.height) { state.pointer = undefined; return; }
    if (this.data.tool === 'rect') { state.previousRect = state.rect; state.rect = { x: point.x, y: point.y, width: 0, height: 0 }; }
    else if (this.data.tool === 'polygon') state.polygon = [point];
    else { state.editor.begin(); state.editor.stroke(point, point, this.data.brush / (2 * viewScale(state.view)), this.data.tool === 'keep'); state.maskDirty = true; }
    this.scheduleDraw();
  },
  onTouchMove(event: WechatMiniprogram.TouchCanvas) {
    const state = states.get(this); if (!state?.view || !state.editor || this.data.busy) return;
    const touches = points(event);
    if (touches.length >= 2) {
      if (!state.pinch) { this.onTouchStart(event); return; }
      const ordered = state.pinch.map((p) => touches.find((t) => t.identifier === p.identifier));
      if (ordered.every((p): p is Pointer => !!p)) { state.view = pinchView(state.view, state.pinch, ordered); state.pinch = ordered; this.scheduleDraw(); } return;
    }
    if (state.waiting || !state.pointer || !state.last || touches.length !== 1 || touches[0].identifier !== state.pointer.identifier) return;
    const raw = imagePoint(touches[0], state.view), point = { x: Math.max(0, Math.min(state.editor.width, raw.x)), y: Math.max(0, Math.min(state.editor.height, raw.y)) };
    if (this.data.tool === 'rect') {
      const start = imagePoint(state.pointer, state.view); state.rect = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
    } else if (this.data.tool === 'polygon') { if (Math.hypot(point.x - state.last.x, point.y - state.last.y) >= 1) state.polygon.push(point); }
    else { state.editor.stroke(state.last, point, this.data.brush / (2 * viewScale(state.view)), this.data.tool === 'keep'); state.maskDirty = true; }
    state.last = point; this.scheduleDraw();
  },
  onTouchEnd(event: WechatMiniprogram.TouchCanvas) {
    const state = states.get(this); if (!state?.editor) return;
    if (points(event).length) { state.waiting = true; state.pinch = undefined; return; }
    if (!state.waiting && state.pointer) {
      if (this.data.tool === 'polygon' && state.polygon.length >= 3) { state.editor.polygon(state.polygon); this.changed(); }
      else if (this.data.tool === 'keep' || this.data.tool === 'erase') { state.editor.commit(); this.changed(); }
      else if (this.data.tool === 'rect') { this.setData({ hasRect: !!state.rect && state.rect.width >= 2 && state.rect.height >= 2 }); warning(); }
    }
    state.pointer = undefined; state.last = undefined; state.pinch = undefined; state.waiting = false; state.polygon = []; this.scheduleDraw();
  },
  onTouchCancel() {
    const state = states.get(this); if (!state) return;
    if (state.pointer && this.data.tool === 'rect') state.rect = state.previousRect;
    state.editor?.cancel(); state.maskDirty = true; state.pointer = undefined; state.last = undefined; state.pinch = undefined; state.waiting = false; state.polygon = []; this.scheduleDraw();
  },
  cancelEstimate() { const state = states.get(this); if (state && this.data.busy && !this.data.exporting) { state.version++; this.setData({ busy: false }); } },
  async estimate() {
    const state = states.get(this); if (!state?.editor || !state.pixels || !state.rect || this.data.busy) return;
    this.onTouchCancel(); const version = ++state.version, editor = state.editor, size = limitedSize(editor.width, editor.height, 256);
    const pixels = new Uint8ClampedArray(size.width * size.height * 4);
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
      const from = (Math.min(editor.height - 1, Math.floor(y * editor.height / size.height)) * editor.width + Math.min(editor.width - 1, Math.floor(x * editor.width / size.width))) * 4;
      pixels.set(state.pixels.subarray(from, from + 4), (y * size.width + x) * 4);
    }
    const rect = { x: state.rect.x * size.width / editor.width, y: state.rect.y * size.height / editor.height,
      width: state.rect.width * size.width / editor.width, height: state.rect.height * size.height / editor.height };
    this.setData({ busy: true, error: '' });
    try {
      const result = await segmentGarment({ pixels, ...size, rect, seeds: resizeMask(editor.seeds, editor.width, editor.height, size.width, size.height), cancelled: () => !state.alive || state.version !== version });
      if (!state.alive || state.version !== version) return;
      const mask = resizeMask(result, size.width, size.height, editor.width, editor.height);
      // 小图估算不能覆盖高分辨率画笔留下的硬标记。
      for (let i = 0; i < mask.length; i++) if (editor.seeds[i]) mask[i] = editor.seeds[i] === 1 ? 255 : 0;
      editor.replace(mask); this.setData({ tool: 'erase' }); this.changed();
    } catch (error) { if (state.alive && state.version === version && !(error instanceof CutoutCancelled)) this.setData({ error: error instanceof Error ? error.message : '估算失败，请手动圈选。' }); }
    finally { if (state.alive && state.version === version) { this.setData({ busy: false }); this.measure(); } }
  },
  async apply() {
    const state = states.get(this); if (!state?.editor || !state.pixels || !state.output || !this.data.hasResult || this.data.busy) return;
    this.onTouchCancel(); const version = ++state.version; this.setData({ busy: true, exporting: true, error: '' });
    try {
      const path = await exportCutout(state.output, state.pixels, state.editor.mask, state.editor.width, state.editor.height);
      if (!state.alive || state.version !== version) return;
      if (!deliverCutoutResult(state.id, path)) throw new Error('原照片或衣物已修改，请返回重新打开抠图。');
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      this.setData({ hasResult: false }); wx.navigateBack({ fail: () => { if (state.alive) this.setData({ error: '结果已应用，请手动返回衣物页面保存。' }); } });
    } catch (error) { if (state.alive && version === state.version) this.setData({ error: error instanceof Error ? error.message : '图片生成失败，请重试。' }); }
    finally { if (state.alive && version === state.version) this.setData({ busy: false, exporting: false }); }
  },
});
