/* 手机CAD · Canvas 渲染 */
(function (global) {
  'use strict';
  const Geo = global.Geo;

  const COLORS = {
    bg: '#0d1117',
    grid: 'rgba(120, 150, 180, 0.075)',
    gridMajor: 'rgba(120, 150, 180, 0.13)',
    axis: 'rgba(120, 150, 180, 0.30)',
    entity: '#dbe7f0',
    selected: '#37c8ff',
    preview: '#ffb020',
    snap: '#37c8ff',
    label: '#9fb3c8',
    text: '#dbe7f0'
  };

  function Renderer(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.grid = true;
  }

  Renderer.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.W = W; this.H = H; this.dpr = dpr;
    return { W: W, H: H };
  };

  Renderer.prototype.screen = function (p) {
    return this.app.view.toScreen(p);
  };

  Renderer.prototype.draw = function () {
    const ctx = this.ctx;
    const app = this.app;
    const view = app.view;
    const W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    if (this.grid) this.drawGrid(W, H);

    // 坐标轴
    const o = this.screen({ x: 0, y: 0 });
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, o.y + 0.5); ctx.lineTo(W, o.y + 0.5);
    ctx.moveTo(o.x + 0.5, 0); ctx.lineTo(o.x + 0.5, H);
    ctx.stroke();

    // 图元
    const ents = app.model.entities;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < ents.length; i++) {
      if (!app.model.selected.has(ents[i].id)) this.strokeEntity(ents[i], COLORS.entity, 1.6, false);
    }
    // 选中高亮
    app.model.entities.forEach(function (e) {
      if (!app.model.selected.has(e.id)) return;
      this.strokeEntity(e, COLORS.selected, 2.4, true);
    }, this);

    // 测量标注
    if (app.overlay) this.drawOverlay(app.overlay);

    // 工具预览
    if (app.tool && app.tool.onRender) {
      ctx.save();
      app.tool.onRender(ctx, this);
      ctx.restore();
    }

    // 捕捉标记
    if (app.snapInfo && performance.now() - app.snapInfo.t < 1400) {
      this.drawSnap(app.snapInfo);
    }
  };

  Renderer.prototype.drawGrid = function (W, H) {
    const view = this.app.view;
    let step = Math.pow(10, Math.floor(Math.log10(64 / view.scale)));
    const mult = [1, 2, 5, 10];
    for (let i = 0; i < mult.length; i++) {
      if (step * mult[i] * view.scale >= 56) { step *= mult[i]; break; }
    }
    const ctx = this.ctx;
    const x1 = view.toWorld({ x: 0, y: 0 }).x;
    const x2 = view.toWorld({ x: W, y: 0 }).x;
    const y1 = view.toWorld({ x: 0, y: H }).y;
    const y2 = view.toWorld({ x: 0, y: 0 }).y;
    const startX = Math.floor(x1 / step) * step;
    const startY = Math.floor(y1 / step) * step;
    if ((x2 - x1) / step > 400 || (y2 - y1) / step > 400) return;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= x2; x += step) {
      const s = this.screen({ x: x, y: 0 }).x;
      const major = Math.abs(x / step) % 5 < 1e-6;
      if (major) continue;
      ctx.moveTo(Math.round(s) + 0.5, 0);
      ctx.lineTo(Math.round(s) + 0.5, H);
    }
    for (let y = startY; y <= y2; y += step) {
      const s = this.screen({ x: 0, y: y }).y;
      const major = Math.abs(y / step) % 5 < 1e-6;
      if (major) continue;
      ctx.moveTo(0, Math.round(s) + 0.5);
      ctx.lineTo(W, Math.round(s) + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.gridMajor;
    ctx.beginPath();
    for (let x = startX; x <= x2; x += step) {
      if (Math.abs(x / step) % 5 >= 1e-6) continue;
      const s = this.screen({ x: x, y: 0 }).x;
      ctx.moveTo(Math.round(s) + 0.5, 0);
      ctx.lineTo(Math.round(s) + 0.5, H);
    }
    for (let y = startY; y <= y2; y += step) {
      if (Math.abs(y / step) % 5 >= 1e-6) continue;
      const s = this.screen({ x: 0, y: y }).y;
      ctx.moveTo(0, Math.round(s) + 0.5);
      ctx.lineTo(W, Math.round(s) + 0.5);
    }
    ctx.stroke();
  };

  Renderer.prototype.pathEntity = function (ent) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (ent.type === 'line') {
      const a = this.screen(ent.p1), b = this.screen(ent.p2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return true;
    }
    if (ent.type === 'point') {
      const p = this.screen(ent.p);
      const r = 4.5;
      ctx.moveTo(p.x - r - 2, p.y); ctx.lineTo(p.x + r + 2, p.y);
      ctx.moveTo(p.x, p.y - r - 2); ctx.lineTo(p.x, p.y + r + 2);
      return true;
    }
    if (ent.type === 'circle' || ent.type === 'arc') {
      const sw = ent.type === 'arc' ? Geo.arcSweep(ent) : Geo.TAU;
      if (sw < 1e-9) return false;
      const rPx = ent.r * this.app.view.scale;
      const n = Geo.clamp(Math.ceil(sw * rPx / 6), 24, 360);
      const start = ent.type === 'arc' ? ent.a0 : 0;
      for (let i = 0; i <= n; i++) {
        const a = ent.ccw === false ? start - sw * i / n : start + sw * i / n;
        const p = this.screen(Geo.polar(ent.c, ent.r, a));
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      if (ent.type === 'circle') ctx.closePath();
      return true;
    }
    return false;
  };

  Renderer.prototype.strokeEntity = function (ent, color, width, glow) {
    const ctx = this.ctx;
    if (ent.type === 'point') {
      const p = this.screen(ent.p);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Geo.TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (!this.pathEntity(ent)) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 7;
    }
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.ghostEntity = function (ent) {
    const ctx = this.ctx;
    if (!this.pathEntity(ent)) return;
    ctx.save();
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.previewLine = function (a, b) {
    const ctx = this.ctx;
    const sa = this.screen(a), sb = this.screen(b);
    ctx.save();
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.previewCircle = function (c, r) {
    const ctx = this.ctx;
    const s = this.screen(c);
    ctx.save();
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(0.5, r * this.app.view.scale), 0, Geo.TAU);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.previewArc = function (arc) {
    const ctx = this.ctx;
    const sw = Geo.arcSweep(arc);
    if (sw < 1e-9) return;
    const rPx = arc.r * this.app.view.scale;
    const n = Geo.clamp(Math.ceil(sw * rPx / 6), 16, 240);
    ctx.save();
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = arc.ccw ? arc.a0 + sw * i / n : arc.a0 - sw * i / n;
      const p = this.screen(Geo.polar(arc.c, arc.r, a));
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.previewRect = function (rect) {
    const ctx = this.ctx;
    const a = this.screen({ x: rect.x1, y: rect.y2 });
    const b = this.screen({ x: rect.x2, y: rect.y1 });
    ctx.save();
    ctx.fillStyle = 'rgba(55, 200, 255, 0.08)';
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  };

  Renderer.prototype.previewMarker = function (p, text) {
    const ctx = this.ctx;
    const s = this.screen(p);
    ctx.save();
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Geo.TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
    ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10);
    ctx.stroke();
    if (text) this.label(text, { x: s.x + 12, y: s.y - 12 }, COLORS.preview);
    ctx.restore();
  };

  Renderer.prototype.previewLabel = function (text, worldPt) {
    const s = this.screen(worldPt);
    this.label(text, { x: s.x + 12, y: s.y - 12 }, COLORS.preview);
  };

  Renderer.prototype.drawSnap = function (info) {
    const s = this.screen(info.p);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.snap;
    ctx.fillStyle = 'rgba(55, 200, 255, 0.15)';
    ctx.lineWidth = 1.6;
    if (info.type === '圆心') {
      // 圆心捕捉：圆圈 + 十字，和端点/中点标记区分
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x - 12, s.y); ctx.lineTo(s.x + 12, s.y);
      ctx.moveTo(s.x, s.y - 12); ctx.lineTo(s.x, s.y + 12);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 8);
      ctx.lineTo(s.x + 8, s.y);
      ctx.lineTo(s.x, s.y + 8);
      ctx.lineTo(s.x - 8, s.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (info.type) this.label(info.type, { x: s.x + 12, y: s.y + 18 }, COLORS.snap);
    ctx.restore();
  };

  Renderer.prototype.label = function (text, screenPt, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px -apple-system, "PingFang SC", system-ui, sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
    ctx.strokeStyle = 'rgba(42, 52, 65, 0.9)';
    ctx.lineWidth = 1;
    const x = screenPt.x, y = screenPt.y;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x - 4, y - 13, w + 10, 18, 5);
    } else {
      ctx.rect(x - 4, y - 13, w + 10, 18);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color || COLORS.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 1, y - 3);
    ctx.restore();
  };

  Renderer.prototype.drawOverlay = function (ov) {
    const ctx = this.ctx;
    if (ov.type === 'length') {
      const p = this.screen(ov.at);
      this.label(ov.text, { x: p.x + 10, y: p.y - 14 }, COLORS.selected);
      return;
    }
    if (ov.type === 'dim') {
      const a = this.screen(ov.a), b = this.screen(ov.b);
      ctx.save();
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      [[a.x, a.y], [b.x, b.y]].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.5, 0, Geo.TAU);
        ctx.fillStyle = COLORS.selected;
        ctx.fill();
      });
      ctx.restore();
      const mid = { x: (a.x + b.x) / 2 + 10, y: (a.y + b.y) / 2 - 12 };
      this.label(ov.text, mid, COLORS.selected);
    }
  };

  global.CADRenderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
