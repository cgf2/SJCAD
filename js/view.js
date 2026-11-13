/* 手机CAD · 视图变换与手势数学 */
(function (global) {
  'use strict';

  const MIN_SCALE = 0.02;
  const MAX_SCALE = 400;

  function View() {
    this.scale = 1.6;   // 像素 / 世界单位
    this.tx = 0;        // 世界原点在屏幕上的 x
    this.ty = 0;        // 世界原点在屏幕上的 y
  }

  View.prototype.toScreen = function (w) {
    return { x: w.x * this.scale + this.tx, y: this.ty - w.y * this.scale };
  };

  View.prototype.toWorld = function (s) {
    return { x: (s.x - this.tx) / this.scale, y: (this.ty - s.y) / this.scale };
  };

  View.prototype.pan = function (dx, dy) {
    this.tx += dx;
    this.ty += dy;
  };

  View.prototype.zoomAt = function (screenPt, factor) {
    const before = this.toWorld(screenPt);
    const next = Geo2.clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    this.scale = next;
    this.tx = screenPt.x - before.x * next;
    this.ty = screenPt.y + before.y * next;
  };

  /** 以画布中心缩放 */
  View.prototype.zoomCenter = function (factor, W, H) {
    this.zoomAt({ x: W / 2, y: H / 2 }, factor);
  };

  /** 视口自适应 */
  View.prototype.fit = function (box, W, H, pad) {
    pad = pad == null ? 56 : pad;
    const bw = Math.max(box.x2 - box.x1, 1e-6);
    const bh = Math.max(box.y2 - box.y1, 1e-6);
    const aw = Math.max(W - pad * 2, 40);
    const ah = Math.max(H - pad * 2, 40);
    let s = Math.min(aw / bw, ah / bh);
    if (!isFinite(s) || s <= 0) s = 1.6;
    s = Geo2.clamp(s, MIN_SCALE, MAX_SCALE);
    const cx = (box.x1 + box.x2) / 2;
    const cy = (box.y1 + box.y2) / 2;
    this.scale = s;
    this.tx = W / 2 - cx * s;
    this.ty = H / 2 + cy * s;
  };

  /**
   * 双指手势：start = {scale, tx, ty, dist, mid:{x,y}}，mid/dist 为当前值。
   * 保持起始中点下的世界坐标不动。
   */
  View.prototype.applyPinch = function (start, mid, distNow) {
    if (!start || start.dist <= 0) return;
    const anchor = {
      x: (start.mid.x - start.tx) / start.scale,
      y: (start.ty - start.mid.y) / start.scale
    };
    let s = start.scale * (distNow / start.dist);
    s = Geo2.clamp(s, MIN_SCALE, MAX_SCALE);
    this.scale = s;
    this.tx = mid.x - anchor.x * s;
    this.ty = mid.y + anchor.y * s;
  };

  /** 初始视图：原点居中 */
  View.prototype.reset = function (W, H) {
    this.scale = 1.6;
    this.tx = W / 2;
    this.ty = H / 2;
  };

  const Geo2 = {
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  };

  global.CADView = { View: View, MIN_SCALE: MIN_SCALE, MAX_SCALE: MAX_SCALE };
})(typeof window !== 'undefined' ? window : globalThis);
