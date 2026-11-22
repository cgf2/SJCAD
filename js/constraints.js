/* 手机CAD · 尺寸标注（智能标注 / 尺寸驱动）与几何约束 */
(function (global) {
  'use strict';
  const Geo = global.Geo;

  const TYPE_NAME = { line: '直线', circle: '圆', arc: '圆弧', point: '点', rect: '矩形', poly: '多边形' };
  const DIM_COLOR = '#37c8ff';
  const CON_COLOR = '#ffb020';

  function fmt(n) {
    if (!isFinite(n)) return '-';
    return String(Math.round(n * 100) / 100);
  }
  function num(n) { return String(Math.round(n * 1000) / 1000); }
  function unit(v) {
    const L = Math.hypot(v.x, v.y);
    return L < 1e-9 ? null : { x: v.x / L, y: v.y / L };
  }
  function isCircleLike(e) { return !!e && (e.type === 'circle' || e.type === 'arc'); }
  function row(k, v) {
    return '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  /** 带符号的角度差，范围 (-π, π] */
  function signedAngle(a) {
    a = a % Geo.TAU;
    if (a > Math.PI) a -= Geo.TAU;
    if (a <= -Math.PI) a += Geo.TAU;
    return a;
  }

  /** 圆 / 圆弧在指定点的切线方向 */
  function tangentDir(e, p) {
    const u = unit(Geo.sub(p, e.c));
    return u ? { x: -u.y, y: u.x } : null;
  }

  /** 直线从交点指向线段远端的方向 */
  function lineRay(e, v) {
    const d1 = Geo.dist(v, e.p1), d2 = Geo.dist(v, e.p2);
    let target = d1 >= d2 ? e.p1 : e.p2;
    if (d1 < 1e-9 && d2 > 1e-9) target = e.p2;
    if (d2 < 1e-9 && d1 > 1e-9) target = e.p1;
    return unit(Geo.sub(target, v));
  }

  /** 两条直线 / 圆弧在交点处的夹角几何：顶点、两条射线方向、较小夹角 */
  function angleAtEntities(a, b) {
    let v = null, d1 = null, d2 = null;
    if (a.type === 'line' && b.type === 'line') {
      v = Geo.lineIntersectInfinite(a.p1, a.p2, b.p1, b.p2);
      if (!v) return null;
      d1 = lineRay(a, v);
      d2 = lineRay(b, v);
    } else if (a.type === 'line' || b.type === 'line') {
      const line = a.type === 'line' ? a : b;
      const cir = a.type === 'line' ? b : a;
      if (!isCircleLike(cir)) return null;
      let pts = Geo.lineCircleInfinite(line.p1, line.p2, cir.c, cir.r);
      if (cir.type === 'arc') {
        pts = pts.filter(function (p) { return Geo.angleOnArc(Geo.angleOf(cir.c, p), cir); });
      }
      if (!pts.length) return null;
      v = pts[0];
      const dl = unit(Geo.sub(line.p2, line.p1));
      const dc = tangentDir(cir, v);
      if (!dl || !dc) return null;
      d1 = a.type === 'line' ? dl : dc;
      d2 = a.type === 'line' ? dc : dl;
    } else if (isCircleLike(a) && isCircleLike(b)) {
      let pts = Geo.circleCircleIntersect(a.c, a.r, b.c, b.r);
      if (a.type === 'arc') {
        pts = pts.filter(function (p) { return Geo.angleOnArc(Geo.angleOf(a.c, p), a); });
      }
      if (b.type === 'arc') {
        pts = pts.filter(function (p) { return Geo.angleOnArc(Geo.angleOf(b.c, p), b); });
      }
      if (!pts.length) return null;
      v = pts[0];
      d1 = tangentDir(a, v);
      d2 = tangentDir(b, v);
    } else {
      return null;
    }
    if (!v || !d1 || !d2) return null;
    const aa = Math.atan2(d1.y, d1.x);
    const ab = Math.atan2(d2.y, d2.x);
    const diff = Geo.normAngle(ab - aa);
    let ccw = true, sweep = diff;
    if (diff > Math.PI) { ccw = false; sweep = Geo.TAU - diff; }
    if (sweep < 1e-6) return null;
    return { v: v, a1: aa, a2: ab, sweep: sweep, ccw: ccw, deg: Geo.deg(sweep) };
  }

  /** 角度标注的实时几何（标注 id 变化时重新计算） */
  function angleGeomFor(model, dim) {
    if (!dim || dim.kind !== 'angle' || !dim.ids || dim.ids.length < 2) return null;
    const a = model.findById(dim.ids[0]);
    const b = model.findById(dim.ids[1]);
    if (!a || !b) return null;
    return angleAtEntities(a, b);
  }

  /* ================= 平行距离标注 ================= */
  /** 平行判定容差：两条直线夹角的正弦值，约 0.57° */
  const PARALLEL_SIN_TOL = 0.01;

  function segDir(l) {
    const L = Geo.dist(l.p1, l.p2);
    if (!(L > 1e-9)) return null;
    return { u: { x: (l.p2.x - l.p1.x) / L, y: (l.p2.y - l.p1.y) / L }, L: L };
  }

  /** 校验两条线段是否平行；不平行 / 重合时返回明确提示 */
  function parallelCheck(a, b) {
    if (!a || !b || a.type !== 'line' || b.type !== 'line') {
      return { ok: false, error: '平行距离标注仅支持两条直线' };
    }
    const da = segDir(a), db = segDir(b);
    if (!da || !db) return { ok: false, error: '线段长度无效，无法标注平行距离' };
    const cross = da.u.x * db.u.y - da.u.y * db.u.x;
    if (Math.abs(cross) > PARALLEL_SIN_TOL) {
      return { ok: false, error: '两条线段不平行，无法标注平行距离' };
    }
    const n = { x: -da.u.y, y: da.u.x };
    const d = Math.abs((b.p1.x - a.p1.x) * n.x + (b.p1.y - a.p1.y) * n.y);
    if (!(d > 1e-6)) return { ok: false, error: '两条线段重合，距离为 0' };
    return { ok: true, d: d };
  }

  /**
   * 平行距离标注几何：以第一条线为基准方向 u、法向 n，计算两线垂直距离 d。
   * 尺寸线默认落在两条线段投影的有效重叠区间中点；延长线平行（无重叠）时，
   * 取最近端点之间的有效平行区间，保证标注落在可测量的区间内。
   */
  function parallelGeomFor(model, dim) {
    if (!dim || dim.kind !== 'pdist' || !dim.ids || dim.ids.length < 2) return null;
    const a = model.findById(dim.ids[0]);
    const b = model.findById(dim.ids[1]);
    if (!a || !b || a.type !== 'line' || b.type !== 'line') return null;
    const da = segDir(a), db = segDir(b);
    if (!da || !db) return null;
    const cross = da.u.x * db.u.y - da.u.y * db.u.x;
    if (Math.abs(cross) > PARALLEL_SIN_TOL) return null;
    const u = da.u;
    const n = { x: -u.y, y: u.x };
    const proj = function (p) { return (p.x - a.p1.x) * u.x + (p.y - a.p1.y) * u.y; };
    const t1 = proj(b.p1), t2 = proj(b.p2);
    const tbLo = Math.min(t1, t2), tbHi = Math.max(t1, t2);
    const dSigned = (b.p1.x - a.p1.x) * n.x + (b.p1.y - a.p1.y) * n.y;
    const d = Math.abs(dSigned);
    const oLo = Math.max(0, tbLo), oHi = Math.min(da.L, tbHi);
    let s0, s1, mode;
    if (oHi - oLo > 1e-6) {
      mode = 'overlap';
      s0 = oLo; s1 = oHi;
    } else {
      mode = 'extend';
      if (tbLo >= da.L) { s0 = da.L; s1 = tbLo; }
      else { s0 = tbHi; s1 = 0; }
      if (s1 < s0) { const tmp = s0; s0 = s1; s1 = tmp; }
      if (!(s1 - s0 > 1e-9)) { s0 = (oLo + oHi) / 2; s1 = s0; }
    }
    const mid = (s0 + s1) / 2;
    const lo = Math.min(0, tbLo), hi = Math.max(da.L, tbHi);
    let t = Number(dim.param);
    if (!isFinite(t)) t = mid;
    t = Math.max(lo, Math.min(hi, t));
    const pa = { x: a.p1.x + u.x * t, y: a.p1.y + u.y * t };
    const pb = { x: pa.x + n.x * dSigned, y: pa.y + n.y * dSigned };
    const bLoPt = t1 <= t2 ? b.p1 : b.p2;
    const bHiPt = t1 <= t2 ? b.p2 : b.p1;
    return {
      a: a, b: b, u: u, n: n, d: d, dSigned: dSigned,
      t: t, lo: lo, hi: hi, s0: s0, s1: s1, mid: mid, mode: mode,
      La: da.L, tbLo: tbLo, tbHi: tbHi, bLoPt: bLoPt, bHiPt: bHiPt,
      pa: pa, pb: pb,
      insideA: t >= 0 && t <= da.L,
      insideB: t >= tbLo && t <= tbHi
    };
  }

  /* ---- 标注文字样式 ---- */
  const FONT_MAP = {
    system: '-apple-system, "PingFang SC", system-ui, sans-serif',
    mono: 'ui-monospace, Menlo, Consolas, monospace',
    serif: 'Georgia, "Songti SC", "SimSun", serif'
  };

  function dimStyle(dim) {
    const s = (dim && dim.style) || {};
    return {
      font: FONT_MAP[s.font] || FONT_MAP.system,
      size: s.size > 0 ? s.size : 11,
      color: s.color || DIM_COLOR,
      dash: !!s.dash
    };
  }

  /* ================= 尺寸标注 ================= */
  const CADDims = {
    kindOf: function (ent) {
      if (!ent) return null;
      if (ent.type === 'line') return 'length';
      if (ent.type === 'circle') return 'diameter';
      if (ent.type === 'arc') return 'radius';
      return null;
    },
    nameOf: function (kind) {
      return {
        length: '线性尺寸', diameter: '直径标注', radius: '半径标注',
        angle: '角度标注', pdist: '平行距离标注'
      }[kind] || '标注';
    },
    prefix: function (kind) {
      return kind === 'diameter' ? '⌀' : kind === 'radius' ? 'R' : '';
    },
    findFor: function (model, entId, kind) {
      for (let i = 0; i < model.dims.length; i++) {
        if (model.dims[i].entId === entId && model.dims[i].kind === kind) return model.dims[i];
      }
      return null;
    },
    /** 查找同一对图形的角度标注（顺序无关） */
    findAngleFor: function (model, idA, idB) {
      for (let i = 0; i < model.dims.length; i++) {
        const d = model.dims[i];
        if (d.kind !== 'angle' || !d.ids || d.ids.length !== 2) continue;
        if ((d.ids[0] === idA && d.ids[1] === idB) || (d.ids[0] === idB && d.ids[1] === idA)) return d;
      }
      return null;
    },
    angleGeomFor: angleGeomFor,
    circleGeomFor: circleGeomFor,
    parallelGeomFor: parallelGeomFor,
    parallelCheck: parallelCheck,
    /** 查找同一对直线的平行距离标注（顺序无关） */
    findParallelFor: function (model, idA, idB) {
      for (let i = 0; i < model.dims.length; i++) {
        const d = model.dims[i];
        if (d.kind !== 'pdist' || !d.ids || d.ids.length !== 2) continue;
        if ((d.ids[0] === idA && d.ids[1] === idB) || (d.ids[0] === idB && d.ids[1] === idA)) return d;
      }
      return null;
    },
    /** 修改标注样式：字体 / 字号 / 文字颜色 / 尺寸线样式 */
    setStyle: function (dim, key, value) {
      if (!dim) return { ok: false, error: '标注不存在' };
      const st = dim.style || (dim.style = {});
      if (key === 'font') {
        if (!FONT_MAP[value]) return { ok: false, error: '不支持的字体' };
        st.font = value;
      } else if (key === 'size') {
        const v = Number(value);
        if (!isFinite(v) || v < 8 || v > 48) return { ok: false, error: '字号需在 8~48 之间' };
        st.size = Math.round(v);
      } else if (key === 'color') {
        if (!/^#[0-9a-f]{6}$/i.test(String(value))) return { ok: false, error: '颜色格式需为 #RRGGBB' };
        st.color = String(value).toLowerCase();
      } else if (key === 'dash') {
        st.dash = value === 'dash' || value === true;
      } else {
        return { ok: false, error: '未知样式项' };
      }
      return { ok: true };
    },
    valueOf: function (model, dim, ortho) {
      if (dim.kind === 'angle') {
        const g = angleGeomFor(model, dim);
        return g ? g.deg : null;
      }
      if (dim.kind === 'pdist') {
        const g = parallelGeomFor(model, dim);
        return g ? g.d : null;
      }
      const e = model.findById(dim.entId);
      if (!e) return null;
      if (dim.kind === 'length' && e.type === 'line') {
        return ortho ? orthoValue(e, dim) : Geo.dist(e.p1, e.p2);
      }
      if (dim.kind === 'diameter' && e.type === 'circle') return e.r * 2;
      if (dim.kind === 'radius' && e.type === 'arc') return e.r;
      return null;
    },
    /** 尺寸驱动：把标注数值写回图元；dryRun=true 只校验；ortho=true 按正交坐标差驱动 */
    setValue: function (model, dim, raw, dryRun, ortho) {
      if (!dim) return { ok: false, error: '标注不存在' };
      if (raw === '' || raw == null) return { ok: false, error: '请输入数值' };
      const v = Number(raw);
      if (!isFinite(v)) return { ok: false, error: '请输入有效数字' };
      if (dim.kind === 'pdist') {
        if (!(v > 0)) return { ok: false, error: '距离需大于 0' };
        const g = parallelGeomFor(model, dim);
        if (!g) return { ok: false, error: '两条直线不再平行或已被删除' };
        const delta = (g.dSigned >= 0 ? v : -v) - g.dSigned;
        if (Math.abs(delta) < 1e-12) return { ok: true };
        if (dryRun) return { ok: true };
        // 第一条直线保持不动，沿法线平移第二条直线，使垂直距离精确等于输入值
        g.b.p1 = { x: g.b.p1.x + g.n.x * delta, y: g.b.p1.y + g.n.y * delta };
        g.b.p2 = { x: g.b.p2.x + g.n.x * delta, y: g.b.p2.y + g.n.y * delta };
        return { ok: true };
      }
      if (dim.kind === 'angle') {
        if (!(v > 0 && v < 180)) return { ok: false, error: '角度需在 0~180° 之间' };
        const g = angleGeomFor(model, dim);
        if (!g) return { ok: false, error: '两条图元没有有效交点' };
        const e1 = model.findById(dim.ids[0]);
        const e2 = model.findById(dim.ids[1]);
        if (!e1 || !e2) return { ok: false, error: '标注对象已删除' };
        if (e1.type !== 'line' || e2.type !== 'line') {
          return { ok: false, error: '角度驱动仅支持两条直线' };
        }
        if (dryRun) return { ok: true };
        const cur = signedAngle(g.a2 - g.a1);
        const sign = cur >= 0 ? 1 : -1;
        Geo.rotateEntity(e2, g.v, sign * Geo.rad(v) - cur);
        return { ok: true };
      }
      if (!(v > 0)) return { ok: false, error: '尺寸需大于 0' };
      const e = model.findById(dim.entId);
      if (!e) return { ok: false, error: '标注对象已删除' };
      if (dim.kind === 'length' && e.type === 'line') {
        const L = Geo.dist(e.p1, e.p2);
        if (L < 1e-9) return { ok: false, error: '直线长度无效' };
        if (dryRun) return { ok: true };
        if (ortho) {
          // 正交驱动：按当前正交方向调整终点坐标，使对应坐标差等于输入值
          if (orthoAxisOf(e, dim) === 'h') {
            const sign = e.p2.x >= e.p1.x ? 1 : -1;
            e.p2 = { x: e.p1.x + sign * v, y: e.p2.y };
          } else {
            const sign = e.p2.y >= e.p1.y ? 1 : -1;
            e.p2 = { x: e.p2.x, y: e.p1.y + sign * v };
          }
          return { ok: true };
        }
        const u = { x: (e.p2.x - e.p1.x) / L, y: (e.p2.y - e.p1.y) / L };
        e.p2 = { x: e.p1.x + u.x * v, y: e.p1.y + u.y * v };
        return { ok: true };
      }
      if (dim.kind === 'diameter' && e.type === 'circle') {
        if (dryRun) return { ok: true };
        e.r = v / 2;
        return { ok: true };
      }
      if (dim.kind === 'radius' && e.type === 'arc') {
        if (dryRun) return { ok: true };
        e.r = v;
        return { ok: true };
      }
      return { ok: false, error: '标注对象类型不匹配' };
    },
    /** 角度标注是否可尺寸驱动（仅两条直线） */
    canDrive: function (model, dim) {
      if (dim.kind !== 'angle') return true;
      if (!dim.ids || dim.ids.length < 2) return false;
      const a = model.findById(dim.ids[0]);
      const b = model.findById(dim.ids[1]);
      return !!(a && b && a.type === 'line' && b.type === 'line');
    },
    infoHtml: function (model, dim, ortho) {
      if (dim.kind === 'pdist') return parallelInfoHtml(model, dim);
      const isAngle = dim.kind === 'angle';
      const e = isAngle ? null : model.findById(dim.entId);
      if (!isAngle && !e) return '<div class="hint">标注对象已删除，请重新标注。</div>';
      const v = this.valueOf(model, dim, ortho);
      const field = dim.kind === 'length' ? (ortho ? '正交长度' : '长度')
        : dim.kind === 'diameter' ? '直径'
        : dim.kind === 'radius' ? '半径' : '角度';
      const suffix = isAngle ? '°' : '';
      const disp = v == null ? '-' : this.prefix(dim.kind) + fmt(v) + suffix;
      let targets = '';
      if (isAngle) {
        targets = (dim.ids || []).map(function (id) {
          const ent = model.findById(id);
          return '#' + id + ' · ' + (ent ? (TYPE_NAME[ent.type] || ent.type) : '已删除');
        }).join(' 与 ');
      } else {
        targets = '#' + dim.entId + ' · ' + (TYPE_NAME[e.type] || e.type);
      }
      const hint = isAngle
        ? (this.canDrive(model, dim)
          ? '修改角度后第二条直线绕交点旋转（0~180°）；可撤销。'
          : '当前角度标注仅支持测量显示，尺寸驱动需两条相交直线。')
        : (ortho && dim.kind === 'length'
          ? '正交标注显示主方向的水平 / 垂直坐标差；修改数值会沿该方向移动终点；可撤销。'
          : '修改数值后图形自动同步（尺寸驱动）：直线保持起点伸缩，圆 / 圆弧改变半径；可撤销。');
      const inputRow = isAngle && !this.canDrive(model, dim) ? '' :
        '<div class="row edit"><span class="k">' + field + '</span>' +
        '<input class="prop-input" type="number" inputmode="decimal" step="any" data-dim="' + dim.id +
        '" value="' + (v == null ? '' : num(v)) + '" aria-label="' + field + '"></div>';
      return '<div class="big" data-out="dimval">' + disp + '</div>' +
        row('标注类型', this.nameOf(dim.kind)) +
        row('标注对象', targets) +
        inputRow +
        '<div class="hint">' + hint + '</div>' +
        '<div id="propError" class="prop-error hidden"></div>' +
        '<div class="hint"><button class="mini danger" data-dim-del="' + dim.id + '">删除标注</button></div>';
    },
    updateOutputs: function (body, model, dim, ortho) {
      if (!body) return;
      const el = body.querySelector('[data-out="dimval"]');
      if (!el) return;
      const v = this.valueOf(model, dim, ortho);
      el.textContent = this.prefix(dim.kind) + fmt(v) + (dim.kind === 'angle' ? '°' : '');
    },
    /* ---------- 绘制 ---------- */
    draw: function (R, app) {
      if (app.params && app.params.dshow === false) return;
      const model = app.model;
      if (!model || !model.dims) return;
      for (const k in lineCache) delete lineCache[k];
      for (const k in labelCache) delete labelCache[k];
      const ortho = !!(app.params && app.params.dortho);
      model.dims.forEach(function (dim) {
        if (dim.kind === 'angle') { drawAngle(R, app, dim); return; }
        if (dim.kind === 'pdist') { drawParallel(R, app, dim); return; }
        const e = model.findById(dim.entId);
        if (!e) return;
        if (dim.kind === 'length' && e.type === 'line') drawLinear(R, app, e, dim, ortho);
        else if (dim.kind === 'diameter' && e.type === 'circle') drawDiameter(R, app, e, dim);
        else if (dim.kind === 'radius' && e.type === 'arc') drawRadius(R, app, e, dim);
      });
      void self;
    },
    /** 标签在屏幕上的缓存位置（渲染后可用），供联动拖拽与测试使用 */
    labelInfo: function (id) {
      const c = labelCache[id];
      if (!c) return null;
      return { x: c.x, y: c.y, text: c.text, angle: c.angle, hasPos: c.hasPos };
    },
    /** 命中最靠近的标注线，pt 为画布屏幕坐标；无命中返回 null */
    hitLine: function (app, pt, tol) {
      if (!app || !app.model || !app.model.dims) return null;
      if (app.params && app.params.dshow === false) return null;
      if (!pt) return null;
      tol = tol == null ? 6 : tol;
      let best = null, bestD = Infinity;
      app.model.dims.forEach(function (dim) {
        const c = lineCache[dim.id];
        if (!c || !c.segs.length) return;
        let d = Infinity;
        for (let i = 0; i < c.segs.length; i++) {
          const s = c.segs[i];
          const dd = segDist(pt, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by });
          if (dd < d) d = dd;
        }
        if (d <= tol + 3 && d < bestD) { bestD = d; best = dim; }
      });
      return best;
    },
    /** 命中已生成标注的数值文本（信息框只在点中数值本身时弹出） */
    hitLabel: function (app, pt, tol) {
      if (!app || !app.model || !app.model.dims) return null;
      if (app.params && app.params.dshow === false) return null;
      if (!pt) return null;
      const t = tol == null ? 4 : tol;
      const ctx = app.renderer && app.renderer.ctx;
      for (const id in labelCache) {
        const c = labelCache[id];
        const dim = app.model.findDim(id);
        if (!dim) continue;
        const st = dimStyle(dim);
        let w;
        if (ctx && ctx.measureText) {
          ctx.save();
          ctx.font = st.size + 'px ' + st.font;
          w = ctx.measureText(c.text).width;
          ctx.restore();
        } else {
          w = String(c.text).length * st.size * 0.62;
        }
        if (c.angle) {
          const r = Math.max(w / 2 + 6, st.size / 2 + 5) + t;
          if (Math.hypot(pt.x - c.x, pt.y - c.y) <= r) return dim;
        } else {
          const x1 = c.x - 4 - t, y1 = c.y - st.size - 2 - t;
          const x2 = c.x + w + 6 + t, y2 = c.y + 5 + t;
          if (pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2) return dim;
        }
      }
      return null;
    },
    /**
     * 拖动标注线：线性标注调整偏移距离、角度标注调整圆弧半径；
     * 直径 / 半径标注记录拖动落点（anchor），方向随鼠标变化，
     * 箭头端点始终锚定在轮廓与圆心，数值位置不受冻结。
     */
    moveLine: function (app, dim, w) {
      if (!app || !app.model || !dim || !w) return false;
      const model = app.model;
      const scale = (app.view && app.view.scale) || 1;
      if (dim.kind === 'length') {
        const e = model.findById(dim.entId);
        if (!e || e.type !== 'line') return false;
        const p1 = e.p1, p2 = e.p2;
        const L = Geo.dist(p1, p2);
        if (L < 1e-6) return false;
        let off;
        if (app.params && app.params.dortho) {
          // 正交标注：沿箭头方向拖出投影端点约 30px 后，水平 / 垂直方向自动互换
          let axis = orthoAxisOf(e, dim);
          const dd = app.dimDrag;
          if (!(dd && dd.orthoFlipLock)) {
            const bound = 30 / scale;
            const flip = function () {
              axis = axis === 'h' ? 'v' : 'h';
              dim.orthoAxis = axis;
              if (dd) dd.orthoFlipLock = true;
            };
            if (axis === 'h') {
              const lo = Math.min(p1.x, p2.x) - bound, hi = Math.max(p1.x, p2.x) + bound;
              if (w.x < lo || w.x > hi) flip();
            } else {
              const lo = Math.min(p1.y, p2.y) - bound, hi = Math.max(p1.y, p2.y) + bound;
              if (w.y < lo || w.y > hi) flip();
            }
          }
          const horizontal = axis === 'h';
          const base = horizontal ? Math.max(p1.y, p2.y) : Math.max(p1.x, p2.x);
          off = horizontal ? w.y - base : w.x - base;
        } else {
          const nx = -(p2.y - p1.y) / L, ny = (p2.x - p1.x) / L;
          off = (w.x - p1.x) * nx + (w.y - p1.y) * ny;
        }
        const minOff = 8 / scale;
        if (Math.abs(off) < minOff) off = off < 0 ? -minOff : minOff;
        dim.offset = off;
        return true;
      }
      if (dim.kind === 'angle') {
        const g = angleGeomFor(model, dim);
        if (!g) return false;
        dim.offset = Math.max(12 / scale, Geo.dist(g.v, w));
        return true;
      }
      if (dim.kind === 'pdist') {
        const g = parallelGeomFor(model, dim);
        if (!g) return false;
        const t = (w.x - g.a.p1.x) * g.u.x + (w.y - g.a.p1.y) * g.u.y;
        dim.param = Math.max(g.lo, Math.min(g.hi, t));
        return true;
      }
      if (dim.kind === 'diameter' || dim.kind === 'radius') {
        const e = model.findById(dim.entId);
        if (!e) return false;
        dim.anchor = { x: w.x, y: w.y };
        return true;
      }
      return false;
    }
  };

  function arrow(ctx, tip, from) {
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const s = 7, w = 2.6;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * s - uy * w, tip.y - uy * s + ux * w);
    ctx.lineTo(tip.x - ux * s + uy * w, tip.y - uy * s - ux * w);
    ctx.closePath();
    ctx.fill();
  }

  /** 旋转文字标签（垂直正交标注使用） */
  function rotLabel(ctx, text, x, y, color, angle, st) {
    const size = st && st.size > 0 ? st.size : 11;
    const font = (st && st.font) || '-apple-system, "PingFang SC", system-ui, sans-serif';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = size + 'px ' + font;
    const w = ctx.measureText(text).width;
    const h = size + 7;
    ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
    ctx.strokeStyle = 'rgba(42, 52, 65, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2 - 5, -h / 2, w + 10, h, 5);
    else ctx.rect(-w / 2 - 5, -h / 2, w + 10, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ---------- 标注线与标签缓存（查询模块中标注线可拖动） ---------- */
  const labelCache = {};
  const lineCache = {};
  const HOT_COLOR = '#8fe6ff';

  /** 标注线是否处于悬停 / 拖动状态 */
  function isHot(app, dim) {
    return !!((app.dimDrag && app.dimDrag.id === dim.id) || app.dimHoverId === dim.id);
  }

  /** 标注线描边样式：悬停 / 拖动时加粗提亮 */
  function setDimStroke(ctx, hot) {
    ctx.strokeStyle = hot ? HOT_COLOR : DIM_COLOR;
    ctx.fillStyle = hot ? HOT_COLOR : DIM_COLOR;
    ctx.lineWidth = hot ? 2.2 : 1.1;
  }

  /** 屏幕坐标点到线段的距离 */
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 1e-9 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  /** 记录标注线的屏幕线段，供命中检测使用 */
  function recordLine(dim, segs) {
    lineCache[dim.id] = { kind: dim.kind, segs: segs };
  }

  /**
   * 绘制标注文字：默认跟随标注线位置；若标注带有 labelPos（拖动标注线时冻结的世界坐标），
   * 则始终绘制在保存位置，并用虚线牵引到标注线，保持数值与标注线的关联。
   */
  function drawDimLabel(R, app, dim, defPt, text, angle) {
    let pt = defPt;
    const hasPos = dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y);
    if (hasPos) {
      pt = R.screen(dim.labelPos);
      if (Math.hypot(pt.x - defPt.x, pt.y - defPt.y) > 12) {
        const ctx = R.ctx;
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 165, 205, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(defPt.x, defPt.y - 3);
        ctx.lineTo(pt.x, pt.y - 3);
        ctx.stroke();
        ctx.restore();
      }
    }
    labelCache[dim.id] = {
      x: pt.x, y: pt.y, text: text, angle: angle || 0, baseAngle: angle || 0,
      def: { x: defPt.x, y: defPt.y }, hasPos: hasPos
    };
    const st = dimStyle(dim);
    if (angle) rotLabel(R.ctx, text, pt.x, pt.y, st.color, angle, st);
    else R.label(text, pt, st.color, { font: st.font, size: st.size });
  }

  /** 正交标注方向：拖动切换后使用固定方向，否则按线段主方向自动判定 */
  function orthoAxisOf(e, dim) {
    if (dim && (dim.orthoAxis === 'h' || dim.orthoAxis === 'v')) return dim.orthoAxis;
    return Math.abs(e.p2.x - e.p1.x) >= Math.abs(e.p2.y - e.p1.y) ? 'h' : 'v';
  }

  /** 正交标注值：按当前正交方向取对应坐标差 */
  function orthoValue(e, dim) {
    return orthoAxisOf(e, dim) === 'h'
      ? Math.abs(e.p2.x - e.p1.x)
      : Math.abs(e.p2.y - e.p1.y);
  }

  function drawLinear(R, app, e, dim, ortho) {
    const p1 = e.p1, p2 = e.p2;
    const L = Geo.dist(p1, p2);
    if (L < 1e-6) return;
    const scale = app.view.scale;
    const off = Math.abs(dim.offset) > 1e-6 ? dim.offset : 28 / scale;
    const gap = 4 / scale, over = 6 / scale;
    const ctx = R.ctx;
    const hot = isHot(app, dim);

    if (ortho) {
      const horizontal = orthoAxisOf(e, dim) === 'h';
      const ov = orthoValue(e, dim);
      let q1, q2, e1s, e1e, e2s, e2e;
      if (horizontal) {
        const y = Math.max(p1.y, p2.y) + off;
        q1 = { x: p1.x, y: y }; q2 = { x: p2.x, y: y };
        e1s = R.screen({ x: p1.x, y: p1.y + (y > p1.y ? gap : -gap) });
        e1e = R.screen({ x: p1.x, y: y + (y > p1.y ? over : -over) });
        e2s = R.screen({ x: p2.x, y: p2.y + (y > p2.y ? gap : -gap) });
        e2e = R.screen({ x: p2.x, y: y + (y > p2.y ? over : -over) });
      } else {
        const x = Math.max(p1.x, p2.x) + off;
        q1 = { x: x, y: p1.y }; q2 = { x: x, y: p2.y };
        e1s = R.screen({ x: p1.x + (x > p1.x ? gap : -gap), y: p1.y });
        e1e = R.screen({ x: x + (x > p1.x ? over : -over), y: p1.y });
        e2s = R.screen({ x: p2.x + (x > p2.x ? gap : -gap), y: p2.y });
        e2e = R.screen({ x: x + (x > p2.x ? over : -over), y: p2.y });
      }
      const a = R.screen(q1), b = R.screen(q2);
      ctx.save();
      setDimStroke(ctx, hot);
      ctx.beginPath();
      ctx.moveTo(e1s.x, e1s.y); ctx.lineTo(e1e.x, e1e.y);
      ctx.moveTo(e2s.x, e2s.y); ctx.lineTo(e2e.x, e2e.y);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      arrow(ctx, a, b);
      arrow(ctx, b, a);
      ctx.restore();
      recordLine(dim, [{ ax: a.x, ay: a.y, bx: b.x, by: b.y }]);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (horizontal) {
        drawDimLabel(R, app, dim, { x: mid.x + 6, y: mid.y - 8 }, fmt(ov), 0);
      } else {
        drawDimLabel(R, app, dim, { x: mid.x + 10, y: mid.y }, fmt(ov), -Math.PI / 2);
      }
      return;
    }

    const u = { x: (p2.x - p1.x) / L, y: (p2.y - p1.y) / L };
    const n = { x: -u.y, y: u.x };
    const q1 = { x: p1.x + n.x * off, y: p1.y + n.y * off };
    const q2 = { x: p2.x + n.x * off, y: p2.y + n.y * off };
    const a = R.screen(q1), b = R.screen(q2);
    const e1s = R.screen({ x: p1.x + n.x * gap, y: p1.y + n.y * gap });
    const e1e = R.screen({ x: q1.x + n.x * over, y: q1.y + n.y * over });
    const e2s = R.screen({ x: p2.x + n.x * gap, y: p2.y + n.y * gap });
    const e2e = R.screen({ x: q2.x + n.x * over, y: q2.y + n.y * over });
    ctx.save();
    setDimStroke(ctx, hot);
    ctx.beginPath();
    ctx.moveTo(e1s.x, e1s.y); ctx.lineTo(e1e.x, e1e.y);
    ctx.moveTo(e2s.x, e2s.y); ctx.lineTo(e2e.x, e2e.y);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    arrow(ctx, a, b);
    arrow(ctx, b, a);
    ctx.restore();
    recordLine(dim, [{ ax: a.x, ay: a.y, bx: b.x, by: b.y }]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drawDimLabel(R, app, dim, { x: mid.x + 8, y: mid.y - 6 }, fmt(L), 0);
  }

  /** 角度标注：顶点引出两条界线 + 圆弧 + 双向箭头 + 角度数值 */
  function drawAngle(R, app, dim) {
    const g = angleGeomFor(app.model, dim);
    if (!g) return;
    const scale = app.view.scale;
    const rad = Math.abs(dim.offset) > 1e-6 ? dim.offset : 42 / scale;
    const ctx = R.ctx;
    const hot = isHot(app, dim);
    const v = R.screen(g.v);
    const ext = rad + 10 / scale;
    const e1 = R.screen(Geo.polar(g.v, ext, g.a1));
    const e2 = R.screen(Geo.polar(g.v, ext, g.a2));

    ctx.save();
    setDimStroke(ctx, hot);
    ctx.beginPath();
    ctx.moveTo(v.x, v.y); ctx.lineTo(e1.x, e1.y);
    ctx.moveTo(v.x, v.y); ctx.lineTo(e2.x, e2.y);
    ctx.stroke();

    const rPx = rad * scale;
    const n = Math.max(10, Math.ceil(g.sweep * rPx / 6));
    let prev = null, first = null, last = null, beforeLast = null;
    const arcPts = [];
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const ang = g.ccw ? g.a1 + g.sweep * i / n : g.a1 - g.sweep * i / n;
      const p = R.screen(Geo.polar(g.v, rad, ang));
      arcPts.push(p);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      if (i === 0) first = p;
      if (i === 1) prev = p;
      if (i === n - 1) beforeLast = p;
      if (i === n) last = p;
    }
    ctx.stroke();

    // 两端箭头沿圆弧指向外侧
    if (first && prev) arrow(ctx, first, prev);
    if (last && beforeLast) arrow(ctx, last, beforeLast);
    ctx.restore();

    const segs = [];
    for (let i = 1; i < arcPts.length; i++) {
      segs.push({ ax: arcPts[i - 1].x, ay: arcPts[i - 1].y, bx: arcPts[i].x, by: arcPts[i].y });
    }
    recordLine(dim, segs);

    const midAng = g.ccw ? g.a1 + g.sweep / 2 : g.a1 - g.sweep / 2;
    const lp = R.screen(Geo.polar(g.v, rad + 14 / scale, midAng));
    drawDimLabel(R, app, dim, { x: lp.x + 6, y: lp.y - 4 }, fmt(g.deg) + '°', 0);
  }

  /** 圆弧中点方向角 */
  function arcMidAngle(e) {
    const sw = Geo.arcSweep(e);
    return e.ccw === false ? e.a0 - sw / 2 : e.a0 + sw / 2;
  }

  /** 把角度限制在圆弧范围内：弧外的角度取最近的弧端点，保证箭头始终落在弧上 */
  function clampArcAngle(e, ang) {
    const sw = Geo.arcSweep(e);
    if (!(sw > 1e-9) || sw >= Geo.TAU - 1e-9) return ang;
    if (Geo.angleOnArc(ang, e)) return ang;
    const aEnd = e.a0 + (e.ccw === false ? -sw : sw);
    const d0 = Math.abs(signedAngle(ang - e.a0));
    const d1 = Math.abs(signedAngle(ang - aEnd));
    return d0 <= d1 ? e.a0 : aEnd;
  }

  /**
   * 圆 / 圆弧标注的锚定几何：
   * tip 永远在轮廓上、c 永远是圆心；anchor 为拖动落点（世界坐标），只决定标注方向。
   * 圆弧方向会被限制在弧范围内，圆内落点则切换为穿过圆心的双向直径样式。
   */
  function circleGeomFor(app, e, dim) {
    const scale = (app && app.view && app.view.scale) || 1;
    const raw = dim && dim.anchor;
    const anchor = raw && isFinite(raw.x) && isFinite(raw.y) ? { x: raw.x, y: raw.y } : null;
    let ang;
    if (anchor && (Math.abs(anchor.x - e.c.x) > 1e-9 || Math.abs(anchor.y - e.c.y) > 1e-9)) {
      ang = Math.atan2(anchor.y - e.c.y, anchor.x - e.c.x);
    } else {
      ang = e.type === 'arc' ? arcMidAngle(e) : Math.PI / 4;
    }
    if (e.type === 'arc') ang = clampArcAngle(e, ang);
    const u = { x: Math.cos(ang), y: Math.sin(ang) };
    return {
      c: e.c, r: e.r, scale: scale, ang: ang, u: u,
      tip: { x: e.c.x + u.x * e.r, y: e.c.y + u.y * e.r },
      back: { x: e.c.x - u.x * e.r, y: e.c.y - u.y * e.r },
      inside: e.type === 'circle' && !!anchor && Geo.dist(anchor, e.c) <= e.r,
      anchor: anchor
    };
  }

  /** 圆心十字标记 */
  function drawCenterMark(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y); ctx.lineTo(c.x + 4, c.y);
    ctx.moveTo(c.x, c.y - 4); ctx.lineTo(c.x, c.y + 4);
    ctx.stroke();
  }

  /** 引线末端（数值放置处）的屏幕坐标：有落点时用落点，否则沿标注方向外扩 30px */
  function leaderEnd(R, g) {
    const w = g.anchor || Geo.polar(g.c, g.r + 30 / g.scale, g.ang);
    return R.screen(w);
  }

  function drawDiameter(R, app, e, dim) {
    if (!(e.r > 0)) return;
    const g = circleGeomFor(app, e, dim);
    const ctx = R.ctx;
    const hot = isHot(app, dim);
    const c = R.screen(g.c);
    const tip = R.screen(g.tip);
    ctx.save();
    setDimStroke(ctx, hot);

    if (g.inside) {
      // 圆内标注：穿过圆心的完整双向箭头，两端分别指向圆的两侧轮廓
      const back = R.screen(g.back);
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      arrow(ctx, tip, c);
      arrow(ctx, back, c);
      drawCenterMark(ctx, c);
      ctx.restore();
      recordLine(dim, [{ ax: back.x, ay: back.y, bx: tip.x, by: tip.y }]);
      const lp = R.screen(g.anchor || g.c);
      drawDimLabel(R, app, dim, { x: lp.x + 8, y: lp.y - 8 }, '⌀' + fmt(g.r * 2), 0);
      return;
    }

    // 圆外标注：圆心 -> 轮廓（箭头固定在轮廓上），引线延伸到落点放置数值
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    arrow(ctx, tip, c);
    drawCenterMark(ctx, c);
    const end = leaderEnd(R, g);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
    recordLine(dim, [
      { ax: c.x, ay: c.y, bx: tip.x, by: tip.y },
      { ax: tip.x, ay: tip.y, bx: end.x, by: end.y }
    ]);
    drawDimLabel(R, app, dim, { x: end.x + 6, y: end.y - 8 }, '⌀' + fmt(g.r * 2), 0);
  }

  function drawRadius(R, app, e, dim) {
    if (!(Geo.arcSweep(e) > 1e-9) || !(e.r > 0)) return;
    const g = circleGeomFor(app, e, dim);
    const ctx = R.ctx;
    const hot = isHot(app, dim);
    const c = R.screen(g.c);
    const tip = R.screen(g.tip);
    ctx.save();
    setDimStroke(ctx, hot);
    // 半径线：圆心 -> 弧上轮廓（箭头恒在轮廓上，圆弧方向被限制在弧范围内）
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    arrow(ctx, tip, c);
    drawCenterMark(ctx, c);
    const end = leaderEnd(R, g);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
    recordLine(dim, [
      { ax: c.x, ay: c.y, bx: tip.x, by: tip.y },
      { ax: tip.x, ay: tip.y, bx: end.x, by: end.y }
    ]);
    drawDimLabel(R, app, dim, { x: end.x + 6, y: end.y - 8 }, 'R' + fmt(e.r), 0);
  }

  /**
   * 平行距离标注：尺寸线垂直于两条平行线，两端箭头分别指向两条线，
   * 两端绘制沿平行方向的延伸定位线；延长线平行时用细虚线补齐未覆盖部分。
   */
  function drawParallel(R, app, dim) {
    const g = parallelGeomFor(app.model, dim);
    if (!g) return;
    const ctx = R.ctx;
    const st = dimStyle(dim);
    const hot = isHot(app, dim);
    const A = R.screen(g.pa);
    const B = R.screen(g.pb);
    // 世界方向 u 映射到屏幕（Y 轴反向），已是单位向量
    const ux = g.u.x, uy = -g.u.y;

    ctx.save();
    setDimStroke(ctx, hot);
    if (st.dash) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    // 两端延伸定位线：沿平行线方向的短刻度
    const tick = 7;
    ctx.beginPath();
    ctx.moveTo(A.x - ux * tick, A.y - uy * tick);
    ctx.lineTo(A.x + ux * tick, A.y + uy * tick);
    ctx.moveTo(B.x - ux * tick, B.y - uy * tick);
    ctx.lineTo(B.x + ux * tick, B.y + uy * tick);
    ctx.stroke();
    // 箭头固定指向两条平行线
    arrow(ctx, A, B);
    arrow(ctx, B, A);
    ctx.restore();

    // 延长线平行：把线段未覆盖的部分用细虚线补到定位点
    if (!g.insideA || !g.insideB) {
      ctx.save();
      ctx.strokeStyle = 'rgba(125, 165, 205, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (!g.insideA) {
        const q = R.screen(g.t < 0 ? g.a.p1 : g.a.p2);
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(A.x, A.y);
      }
      if (!g.insideB) {
        const q = R.screen(Math.abs(g.t - g.tbLo) <= Math.abs(g.t - g.tbHi) ? g.bLoPt : g.bHiPt);
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    recordLine(dim, [{ ax: A.x, ay: A.y, bx: B.x, by: B.y }]);
    const mid = { x: (A.x + B.x) / 2 + ux * 12, y: (A.y + B.y) / 2 + uy * 12 };
    drawDimLabel(R, app, dim, mid, fmt(g.d), 0);
  }

  /** 平行距离标注的属性面板 */
  function parallelInfoHtml(model, dim) {
    const g = parallelGeomFor(model, dim);
    const a = model.findById(dim.ids[0]);
    const b = model.findById(dim.ids[1]);
    if (!g || !a || !b) return '<div class="hint">标注对象已删除或不再平行，请重新标注。</div>';
    const sraw = dim.style || {};
    const st = dimStyle(dim);
    const ref = ' data-dim-ref="' + dim.id + '"';
    const fontVal = FONT_MAP[sraw.font] ? sraw.font : 'system';
    return '<div class="big" data-out="dimval">' + fmt(g.d) + '</div>' +
      row('标注类型', '平行距离标注') +
      row('标注对象', '#' + a.id + ' 与 #' + b.id + ' · 直线') +
      row('平行区间', g.mode === 'overlap' ? '线段重叠区间' : '延长线有效区间') +
      '<div class="row edit"><span class="k">距离</span>' +
      '<input class="prop-input" type="number" inputmode="decimal" step="any" min="0.01" data-dim="' + dim.id +
      '" value="' + fmt(g.d) + '"></div>' +
      '<div class="row edit"><span class="k">字体</span><select class="prop-input" data-dim-style="font"' + ref + '>' +
      '<option value="system"' + (fontVal === 'system' ? ' selected' : '') + '>系统</option>' +
      '<option value="mono"' + (fontVal === 'mono' ? ' selected' : '') + '>等宽</option>' +
      '<option value="serif"' + (fontVal === 'serif' ? ' selected' : '') + '>衬线</option>' +
      '</select></div>' +
      '<div class="row edit"><span class="k">字号</span>' +
      '<input class="prop-input" type="number" min="8" max="48" step="1" data-dim-style="size"' + ref +
      ' value="' + st.size + '"></div>' +
      '<div class="row edit"><span class="k">文字颜色</span>' +
      '<input class="prop-input" type="color" data-dim-style="color"' + ref +
      ' value="' + st.color + '"></div>' +
      '<div class="row edit"><span class="k">尺寸线</span><select class="prop-input" data-dim-style="dash"' + ref + '>' +
      '<option value="solid"' + (st.dash ? '' : ' selected') + '>实线</option>' +
      '<option value="dash"' + (st.dash ? ' selected' : '') + '>虚线</option>' +
      '</select></div>' +
      '<div class="hint">修改距离值会保持第一条直线不动、沿法线平移第二条直线，使垂直距离精确等于输入值（尺寸驱动，可撤销）；拖动尺寸线只调整显示位置，不改变距离；字体、字号、颜色与线型修改立即生效。</div>' +
      '<div id="propError" class="prop-error hidden"></div>' +
      '<div class="hint"><button class="mini danger" data-dim-del="' + dim.id + '">删除标注</button></div>';
  }

  /* ================= 几何约束 ================= */
  const TYPES = {
    horizontal: { name: '水平', icon: 'H', need: 1 },
    vertical: { name: '垂直', icon: 'V', need: 1 },
    symmetric: { name: '对称', icon: '⇋', need: 3 },
    collinear: { name: '共线', icon: '≡', need: 2 },
    tangent: { name: '相切', icon: 'T', need: 2 },
    distance: { name: '距离', icon: '↔', need: 2 },
    parallel: { name: '平行', icon: '∥', need: 2 },
    fixed: { name: '固定', icon: '⚓', need: 1 },
    angle: { name: '角度', icon: '∠', need: 2 },
    onLine: { name: '点在线上', icon: '⌖', need: 2 },
    overlap: { name: '重叠', icon: '⧉', need: 2 },
    coincident: { name: '重合', icon: '⊙', need: 2 },
    halign: { name: '水平对齐', icon: '⇔', need: 2 },
    valign: { name: '垂直对齐', icon: '⇕', need: 2 },
    vrel: { name: '相对垂直', icon: '⇳', need: 2 },
    equal: { name: '等长', icon: '=', need: 2 }
  };

  function lineDir(line) {
    const L = Geo.dist(line.p1, line.p2);
    if (L < 1e-9) return null;
    return { u: { x: (line.p2.x - line.p1.x) / L, y: (line.p2.y - line.p1.y) / L }, L: L };
  }

  function repPoint(e) {
    if (!e) return null;
    if (e.type === 'line') return Geo.lerp(e.p1, e.p2, 0.5);
    if (isCircleLike(e)) return { x: e.c.x, y: e.c.y };
    if (e.type === 'point') return { x: e.p.x, y: e.p.y };
    if (e.type === 'rect' || e.type === 'poly' || e.type === 'spline') {
      const b = Geo.entityBBox(e);
      return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    }
    // 兼容以边界框描述的元素（文本框 / 图片 / 容器 / 自定义组件）
    const fb = bboxSafe(e);
    return fb ? { x: (fb.x1 + fb.x2) / 2, y: (fb.y1 + fb.y2) / 2 } : null;
  }

  /* ---------- 对齐参考点（点对齐） ---------- */
  const ALIGN_POINTS = {
    lt: '左上角', center: '中心点', rt: '右上角',
    lb: '左下角', rb: '右下角', custom: '指定锚点'
  };

  /** 安全包围盒：优先使用元素自带边界框，兼容文本框 / 图片 / 容器 / 自定义组件 */
  function bboxSafe(e) {
    if (!e) return null;
    if (typeof e.x1 === 'number' && typeof e.y1 === 'number' &&
        typeof e.x2 === 'number' && typeof e.y2 === 'number') {
      return {
        x1: Math.min(e.x1, e.x2), y1: Math.min(e.y1, e.y2),
        x2: Math.max(e.x1, e.x2), y2: Math.max(e.y1, e.y2)
      };
    }
    const b = Geo.entityBBox(e);
    return b && isFinite(b.x1) ? b : null;
  }

  /**
   * 元素的对齐参考点；ptype=bounds 时沿用原有代表点，
   * 其余按包围盒四角 / 中心取点（世界坐标 y 向上）
   */
  function alignPointOf(e, ptype) {
    if (!e) return null;
    if (!ptype || ptype === 'bounds' || ptype === 'custom') return repPoint(e);
    const b = bboxSafe(e);
    if (!b) return repPoint(e);
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    if (ptype === 'lt') return { x: b.x1, y: b.y2 };
    if (ptype === 'rt') return { x: b.x2, y: b.y2 };
    if (ptype === 'lb') return { x: b.x1, y: b.y1 };
    if (ptype === 'rb') return { x: b.x2, y: b.y1 };
    return { x: cx, y: cy };
  }

  /** 点对齐吸附阈值（像素），默认 5 */
  function snapTolOf(c) {
    const n = Number(c && c.snap);
    return isFinite(n) && n >= 0 ? n : 5;
  }

  /* ---------- 重叠约束：基于包围盒的重叠区域 ---------- */
  function isClosedShape(e) {
    return !!e && (e.type === 'circle' || e.type === 'rect' || e.type === 'poly' || (e.type === 'spline' && e.closed));
  }
  function bboxArea(b) { return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1); }
  function bboxCenter(b) { return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }; }
  function bboxSame(a, b) {
    return Math.abs(a.x1 - b.x1) < 1e-6 && Math.abs(a.y1 - b.y1) < 1e-6 &&
      Math.abs(a.x2 - b.x2) < 1e-6 && Math.abs(a.y2 - b.y2) < 1e-6;
  }
  function bboxIntersectArea(a, b) {
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    return w > 0 && h > 0 ? w * h : 0;
  }
  /** 第二个图形落在第一个图形包围盒内的面积比例（0~1） */
  function overlapRatio(aBox, bBox) {
    const area = bboxArea(aBox);
    return area > 1e-12 ? Math.min(1, bboxIntersectArea(aBox, bBox) / area) : 0;
  }
  function scaleAboutPoint(p, base, k) {
    return { x: base.x + (p.x - base.x) * k, y: base.y + (p.y - base.y) * k };
  }
  function scaleEntityAbout(e, base, k) {
    if (e.type === 'circle') {
      e.r *= k;
      e.c.x = base.x + (e.c.x - base.x) * k;
      e.c.y = base.y + (e.c.y - base.y) * k;
    } else if (e.type === 'rect') {
      const p1 = scaleAboutPoint({ x: e.x1, y: e.y1 }, base, k);
      const p2 = scaleAboutPoint({ x: e.x2, y: e.y2 }, base, k);
      e.x1 = Math.min(p1.x, p2.x); e.x2 = Math.max(p1.x, p2.x);
      e.y1 = Math.min(p1.y, p2.y); e.y2 = Math.max(p1.y, p2.y);
    } else if (e.type === 'poly') {
      e.pts = (e.pts || []).map(function (q) { return scaleAboutPoint(q, base, k); });
    }
  }
  /** 把第二个图形的包围盒调整到目标包围盒（用于完全重叠） */
  function setEntityBBox(e, box) {
    const c = bboxCenter(box);
    if (e.type === 'circle') {
      e.c = { x: c.x, y: c.y };
      e.r = Math.max(1e-6, Math.min(box.x2 - box.x1, box.y2 - box.y1) / 2);
      return;
    }
    if (e.type === 'rect') {
      e.x1 = box.x1; e.y1 = box.y1; e.x2 = box.x2; e.y2 = box.y2;
      return;
    }
    if (e.type === 'poly') {
      const b = Geo.entityBBox(e);
      const sw = b.x2 - b.x1, sh = b.y2 - b.y1;
      if (sw < 1e-9 || sh < 1e-9) {
        Geo.translateEntity(e, c.x - b.x1, c.y - b.y1);
        return;
      }
      e.pts = (e.pts || []).map(function (q) {
        return {
          x: box.x1 + (q.x - b.x1) / sw * (box.x2 - box.x1),
          y: box.y1 + (q.y - b.y1) / sh * (box.y2 - box.y1)
        };
      });
    }
  }

  function solveOverlap(model, c) {
    if (!c.ids || c.ids.length < 2) return false;
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b || a.id === b.id || !isClosedShape(a) || !isClosedShape(b)) return false;
    const A = Geo.entityBBox(a);
    let B = Geo.entityBBox(b);
    const areaA = bboxArea(A);
    if (areaA < 1e-9) return false;

    if (c.mode !== 'ratio') {
      if (bboxSame(A, B)) return false;
      const before = JSON.stringify(b);
      setEntityBBox(b, A);
      return JSON.stringify(b) !== before;
    }

    let ratio = Number(c.value) / 100;
    if (!(ratio > 0)) ratio = 0.5;
    ratio = Math.min(1, ratio);
    let areaB = bboxArea(B);
    if (areaB < 1e-9) return false;
    const ca = bboxCenter(A), cb = bboxCenter(B);

    // 重叠过多时沿中心连线向外移动，恢复到指定比例
    if (overlapRatio(A, B) > ratio + 1e-4) {
      let dx = cb.x - ca.x, dy = cb.y - ca.y;
      if (dx * dx + dy * dy < 1e-12) {
        dx = (A.x2 - A.x1) / 2 + (B.x2 - B.x1) / 2;
        dy = 0;
      }
      const shiftOut = function (t) {
        return { x1: B.x1 + dx * t, y1: B.y1 + dy * t, x2: B.x2 + dx * t, y2: B.y2 + dy * t };
      };
      if (overlapRatio(A, shiftOut(1)) > ratio) {
        Geo.translateEntity(b, dx, dy);
        return true;
      }
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (overlapRatio(A, shiftOut(mid)) > ratio) lo = mid; else hi = mid;
      }
      const t = (lo + hi) / 2;
      if (t < 1e-9) return false;
      Geo.translateEntity(b, dx * t, dy * t);
      return true;
    }

    const need = areaA * ratio;
    if (areaB < need - 1e-6) {
      const k = Math.sqrt(need / areaB);
      const bc = bboxCenter(B);
      scaleEntityAbout(b, bc, k);
      B = Geo.entityBBox(b);
      areaB = bboxArea(B);
    }
    if (overlapRatio(A, B) >= ratio - 1e-4) return false;

    const ca2 = bboxCenter(A), cb2 = bboxCenter(B);
    const shiftBox = function (t) {
      const dx = (ca2.x - cb2.x) * t, dy = (ca2.y - cb2.y) * t;
      return { x1: B.x1 + dx, y1: B.y1 + dy, x2: B.x2 + dx, y2: B.y2 + dy };
    };
    // 重叠面积随第二个图形向第一个图形平移单调增加，二分求临界位置
    if (overlapRatio(A, shiftBox(1)) < ratio) {
      Geo.translateEntity(b, ca2.x - cb2.x, ca2.y - cb2.y);
      return true;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (overlapRatio(A, shiftBox(mid)) < ratio) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    if (t < 1e-9) return false;
    Geo.translateEntity(b, (ca2.x - cb2.x) * t, (ca2.y - cb2.y) * t);
    return true;
  }

  function solveHorizontal(model, c) {
    let ok = false;
    c.ids.forEach(function (id) {
      const e = model.findById(id);
      if (!e || e.type !== 'line') return;
      const d = lineDir(e);
      if (!d) return;
      const sign = d.u.x >= 0 ? 1 : -1;
      e.p2 = { x: e.p1.x + sign * d.L, y: e.p1.y };
      ok = true;
    });
    return ok;
  }

  function solveVertical(model, c) {
    let ok = false;
    c.ids.forEach(function (id) {
      const e = model.findById(id);
      if (!e || e.type !== 'line') return;
      const d = lineDir(e);
      if (!d) return;
      const sign = d.u.y >= 0 ? 1 : -1;
      e.p2 = { x: e.p1.x, y: e.p1.y + sign * d.L };
      ok = true;
    });
    return ok;
  }

  function solveSymmetric(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    const axis = c.axisId ? model.findById(c.axisId) : null;
    if (!a || !b || !axis || axis.type !== 'line') return false;
    if (a.id === axis.id || b.id === axis.id) return false;
    const mirrored = Geo.mirrorEntity(a, axis.p1, axis.p2);
    if (!mirrored || mirrored.type !== b.type) return false;
    Geo.copyShape(b, mirrored);
    return true;
  }

  function solveCollinear(model, c) {
    if (!c.ids || c.ids.length < 2) return false;
    const ref = model.findById(c.ids[0]);
    if (!ref || ref.type !== 'line') return false;
    const rd = lineDir(ref);
    if (!rd) return false;
    let ok = false;
    for (let i = 1; i < c.ids.length; i++) {
      const e = model.findById(c.ids[i]);
      if (!e) continue;
      if (e.type === 'line') {
        const d = lineDir(e);
        const L = d ? d.L : Geo.dist(e.p1, e.p2);
        if (L < 1e-9) continue;
        const t = (e.p1.x - ref.p1.x) * rd.u.x + (e.p1.y - ref.p1.y) * rd.u.y;
        const q = { x: ref.p1.x + rd.u.x * t, y: ref.p1.y + rd.u.y * t };
        const sign = d && (d.u.x * rd.u.x + d.u.y * rd.u.y) < 0 ? -1 : 1;
        e.p1 = q;
        e.p2 = { x: q.x + rd.u.x * sign * L, y: q.y + rd.u.y * sign * L };
        ok = true;
      } else if (e.type === 'point') {
        const t = (e.p.x - ref.p1.x) * rd.u.x + (e.p.y - ref.p1.y) * rd.u.y;
        e.p = { x: ref.p1.x + rd.u.x * t, y: ref.p1.y + rd.u.y * t };
        ok = true;
      } else if (isCircleLike(e)) {
        // 圆形 / 圆弧：自动以圆心作为约束参考点，平移到基准线上
        const t = (e.c.x - ref.p1.x) * rd.u.x + (e.c.y - ref.p1.y) * rd.u.y;
        const q = { x: ref.p1.x + rd.u.x * t, y: ref.p1.y + rd.u.y * t };
        const dx = q.x - e.c.x, dy = q.y - e.c.y;
        if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) Geo.translateEntity(e, dx, dy);
        ok = true;
      }
    }
    return ok;
  }

  function tangentLineCircle(circle, line) {
    const ld = lineDir(line);
    if (!ld) return false;
    const n = { x: -ld.u.y, y: ld.u.x };
    const s = (circle.c.x - line.p1.x) * n.x + (circle.c.y - line.p1.y) * n.y;
    const target = s >= 0 ? circle.r : -circle.r;
    const delta = target - s;
    if (Math.abs(delta) < 1e-12) return true;
    circle.c.x += n.x * delta;
    circle.c.y += n.y * delta;
    return true;
  }

  function tangentCircles(a, b) {
    const d0 = Geo.dist(a.c, b.c);
    const u = d0 > 1e-9
      ? { x: (b.c.x - a.c.x) / d0, y: (b.c.y - a.c.y) / d0 }
      : { x: 1, y: 0 };
    const external = d0 >= Math.max(a.r, b.r) - 1e-9;
    const target = external ? a.r + b.r : Math.abs(a.r - b.r);
    if (!(target > 1e-9)) return false;
    b.c.x = a.c.x + u.x * target;
    b.c.y = a.c.y + u.y * target;
    return true;
  }

  function solveTangent(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b) return false;
    if (a.type === 'line' && isCircleLike(b)) return tangentLineCircle(b, a);
    if (isCircleLike(a) && b.type === 'line') return tangentLineCircle(a, b);
    if (isCircleLike(a) && isCircleLike(b)) return tangentCircles(a, b);
    return false;
  }

  function solveDistance(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b) return false;
    const v = Number(c.value);
    if (!(v > 0)) return false;
    const pa = repPoint(a), pb = repPoint(b);
    if (!pa || !pb) return false;
    const d0 = Geo.dist(pa, pb);
    const u = d0 > 1e-9
      ? { x: (pb.x - pa.x) / d0, y: (pb.y - pa.y) / d0 }
      : { x: 1, y: 0 };
    const target = { x: pa.x + u.x * v, y: pa.y + u.y * v };
    const dx = target.x - pb.x, dy = target.y - pb.y;
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return true;
    if (b.type === 'point') {
      b.p.x += dx;
      b.p.y += dy;
    } else {
      Geo.translateEntity(b, dx, dy);
    }
    return true;
  }

  function solveParallel(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b || a.type !== 'line' || b.type !== 'line') return false;
    const da = lineDir(a), db = lineDir(b);
    if (!da || !db) return false;
    const diff = signedAngle(Math.atan2(db.u.y, db.u.x) - Math.atan2(da.u.y, da.u.x));
    if (Math.abs(diff) < 1e-9) return false;
    const mid = Geo.lerp(b.p1, b.p2, 0.5);
    Geo.rotateEntity(b, mid, -diff);
    return true;
  }

  /** 固定约束本身不移动图形；由 solve() 在每轮求解后恢复其几何 */
  function solveFixed() {
    return false;
  }

  function solveAngleConstraint(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b || a.type !== 'line' || b.type !== 'line') return false;
    const v = Number(c.value);
    if (!(v > 0 && v < 180)) return false;
    const da = lineDir(a), db = lineDir(b);
    if (!da || !db) return false;
    const cur = signedAngle(Math.atan2(db.u.y, db.u.x) - Math.atan2(da.u.y, da.u.x));
    const sign = cur >= 0 ? 1 : -1;
    const delta = sign * Geo.rad(v) - cur;
    if (Math.abs(delta) < 1e-9) return false;
    const ip = Geo.lineIntersectInfinite(a.p1, a.p2, b.p1, b.p2);
    const base = ip || { x: b.p1.x, y: b.p1.y };
    Geo.rotateEntity(b, base, delta);
    return true;
  }

  function solveOnLine(model, c) {
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b) return false;
    let ptEnt = a, lineEnt = b;
    if (a.type === 'line' && b.type !== 'line') { ptEnt = b; lineEnt = a; }
    if (lineEnt.type !== 'line' || ptEnt.type === 'line') return false;
    const p = repPoint(ptEnt);
    const u = unit(Geo.sub(lineEnt.p2, lineEnt.p1));
    if (!p || !u) return false;
    const t = (p.x - lineEnt.p1.x) * u.x + (p.y - lineEnt.p1.y) * u.y;
    const q = { x: lineEnt.p1.x + u.x * t, y: lineEnt.p1.y + u.y * t };
    const dx = q.x - p.x, dy = q.y - p.y;
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return false;
    if (ptEnt.type === 'point') {
      ptEnt.p.x += dx;
      ptEnt.p.y += dy;
    } else {
      Geo.translateEntity(ptEnt, dx, dy);
    }
    return true;
  }

  /* ---------- 端点重合约束：所有带端点的图形（直线 / 圆弧 / 矩形 / 多边形 / 点） ---------- */
  /** 取图元第 idx 个端点；索引非法或图元无端点时返回 null */
  function endpointPoint(e, idx) {
    if (!e) return null;
    const pts = Geo.entityEndpoints(e);
    const i = Math.floor(Number(idx));
    if (!(i >= 0 && i < pts.length)) return null;
    return pts[i];
  }

  /** 两个图元之间是否已存在端点重合约束（顺序无关） */
  function hasCoincidentBetween(model, aId, bId) {
    return (model.constraints || []).some(function (c) {
      if (c.type !== 'coincident' || !c.ids || c.ids.length < 2) return false;
      return (c.ids[0] === aId && c.ids[1] === bId) || (c.ids[0] === bId && c.ids[1] === aId);
    });
  }

  /**
   * 自动检测端点重合：端点距离不超过 threshold 的两个图元自动建立重合约束。
   * 每对图元只建立一条（取最近的一对端点），已有重合约束的图元对不会重复添加。
   * 返回本次新建的约束数组。
   */
  function autoDetectEndpoints(model, threshold) {
    const added = [];
    if (!model || !model.entities || !(Number(threshold) > 0)) return added;
    const lim = Number(threshold);
    const ents = model.entities.filter(function (e) { return Geo.entityEndpoints(e).length > 0; });
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      const ae = Geo.entityEndpoints(a);
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j];
        if (a.id === b.id) continue;
        if (hasCoincidentBetween(model, a.id, b.id)) continue;
        const be = Geo.entityEndpoints(b);
        let best = null;
        for (let ai = 0; ai < ae.length; ai++) {
          for (let bi = 0; bi < be.length; bi++) {
            const d = Geo.dist(ae[ai], be[bi]);
            if (d <= lim && (!best || d < best.d)) best = { ai: ai, bi: bi, d: d };
          }
        }
        if (!best) continue;
        added.push(model.addConstraint({
          type: 'coincident', ids: [a.id, b.id], aIdx: best.ai, bIdx: best.bi
        }));
      }
    }
    return added;
  }

  /** 求解端点重合：平移跟随图形，使指定端点与基准端点重合 */
  function solveCoincident(model, c) {
    if (!c.ids || c.ids.length < 2) return false;
    const a = model.findById(c.ids[0]);
    const b = model.findById(c.ids[1]);
    if (!a || !b || a.id === b.id) return false;
    const pa = endpointPoint(a, c.aIdx);
    const pb = endpointPoint(b, c.bIdx);
    if (!pa || !pb) return false;
    const dx = pa.x - pb.x, dy = pa.y - pb.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
    if (b.type === 'point') {
      b.p.x += dx;
      b.p.y += dy;
    } else {
      Geo.translateEntity(b, dx, dy);
    }
    return true;
  }

  /** 仅固定端点时的锚点：圆没有端点，以圆心作为参考点 */
  function fixedAnchorPoints(e) {
    const pts = Geo.entityEndpoints(e);
    if (pts.length) return pts.map(function (p) { return { x: p.x, y: p.y }; });
    if (e.type === 'circle') return [{ x: e.c.x, y: e.c.y }];
    return [];
  }

  function fixedSnapshot(model) {
    const out = {};
    if (!model.constraints) return out;
    model.constraints.forEach(function (c) {
      if (c.type !== 'fixed') return;
      (c.ids || []).forEach(function (id) {
        if (out[id]) return;
        const e = model.findById(id);
        if (!e) return;
        if (c.onlyEndpoints) out[id] = { onlyEndpoints: true, type: e.type, pts: fixedAnchorPoints(e) };
        else out[id] = JSON.parse(JSON.stringify(e));
      });
    });
    return out;
  }

  /** 圆弧仅固定端点：保持半径不变，圆心取到两端点距离均为半径的交点 */
  function pinArcEndpoints(e, p1, p2) {
    const d = Geo.dist(p1, p2);
    if (d < 1e-9) return;
    let c = null;
    if (e.r >= d / 2 - 1e-9) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const ux = (p2.x - p1.x) / d, uy = (p2.y - p1.y) / d;
      const h = Math.sqrt(Math.max(0, e.r * e.r - d * d / 4));
      const c1 = { x: mid.x - uy * h, y: mid.y + ux * h };
      const c2 = { x: mid.x + uy * h, y: mid.y - ux * h };
      c = Geo.dist(c1, e.c) <= Geo.dist(c2, e.c) ? c1 : c2;
    } else {
      // 当前半径小于半弦长时退化为半圆，保证端点仍精确落位
      e.r = d / 2;
      c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }
    e.c = c;
    e.a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
    e.a1 = Math.atan2(p2.y - c.y, p2.x - c.x);
  }

  function restoreFixed(model, snap) {
    Object.keys(snap).forEach(function (id) {
      const e = model.findById(id);
      if (!e) return;
      const s = snap[id];
      if (!s.onlyEndpoints) { Geo.copyShape(e, s); return; }
      const pts = s.pts || [];
      if (!pts.length) return;
      if (e.type === 'line' && pts.length >= 2) {
        e.p1 = { x: pts[0].x, y: pts[0].y };
        e.p2 = { x: pts[1].x, y: pts[1].y };
      } else if (e.type === 'point' || e.type === 'circle') {
        const p = { x: pts[0].x, y: pts[0].y };
        if (e.type === 'point') e.p = p;
        else e.c = p;
      } else if (e.type === 'arc' && pts.length >= 2) {
        pinArcEndpoints(e, pts[0], pts[1]);
      } else if ((e.type === 'rect' || e.type === 'poly') && pts.length) {
        // 角点固定：整体平移使角点回到原位，形状与方向保持当前值
        const cur = fixedAnchorPoints(e);
        if (cur.length) {
          const dx = pts[0].x - cur[0].x, dy = pts[0].y - cur[0].y;
          if (dx || dy) Geo.translateEntity(e, dx, dy);
        }
      }
    });
  }

  /** 对齐参考点：点对齐取包围盒角点 / 中心，指定锚点直接作为目标 */
  function alignPointFor(model, c, e) {
    if (c.pmode !== 'point') return repPoint(e);
    if (c.ptype === 'custom') return repPoint(e);
    return alignPointOf(e, c.ptype || 'center');
  }

  function alignRefOf(model, c) {
    if (c.pmode === 'point' && c.ptype === 'custom' && c.anchor &&
        isFinite(c.anchor.x) && isFinite(c.anchor.y)) {
      return { x: c.anchor.x, y: c.anchor.y };
    }
    const ids = c.ids || [];
    for (let i = 0; i < ids.length; i++) {
      const p = alignPointFor(model, c, model.findById(ids[i]));
      if (p) return p;
    }
    return null;
  }

  /** 水平 / 垂直对齐：以第一个可测图形为基准，平移其余图形的对齐参考点 */
  function solveAxisAlign(model, c, axis) {
    const ids = (c.ids || []).filter(function (id) { return !!model.findById(id); });
    if (ids.length < 2) return false;
    const ref = alignRefOf(model, c);
    if (!ref) return false;
    let moved = false;
    ids.forEach(function (id) {
      const e = model.findById(id);
      const p = alignPointFor(model, c, e);
      if (!p) return;
      const dx = axis === 'x' ? ref.x - p.x : 0;
      const dy = axis === 'y' ? ref.y - p.y : 0;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
      Geo.translateEntity(e, dx, dy);
      moved = true;
    });
    return moved;
  }
  function solveHAlign(model, c) { return solveAxisAlign(model, c, 'y'); }
  function solveVAlign(model, c) { return solveAxisAlign(model, c, 'x'); }

  /* ---------- 相对垂直：目标元素相对参考元素顶部 / 中部 / 底部 + 偏移 ---------- */
  const VREL_ANCHORS = { top: '顶部', middle: '中部', bottom: '底部' };

  function vrelAnchorY(b, anchor) {
    if (anchor === 'top') return b.y2;
    if (anchor === 'bottom') return b.y1;
    return (b.y1 + b.y2) / 2;
  }

  /**
   * 校验相对垂直约束，返回错误文案；合法时返回 null
   * @param {Object} model 文档模型
   * @param {Object} c 约束对象 { type:'vrel', ids:[目标, 参考], anchor, offset }
   */
  function validateVerticalRelative(model, c) {
    if (!model || !model.findById) return '约束模型不可用';
    if (!c || !Array.isArray(c.ids) || c.ids.length < 2) return '需要同时指定目标元素与参考元素';
    if (String(c.ids[0]) === String(c.ids[1])) return '目标元素与参考元素不能相同';
    const moving = model.findById(c.ids[0]);
    const ref = model.findById(c.ids[1]);
    if (!moving) return '目标元素不存在';
    if (!ref) return '参考元素不存在';
    if (!bboxSafe(ref)) return '参考元素没有可用的边界范围';
    if (!repPoint(moving)) return '目标元素不支持相对垂直定位';
    if (c.anchor != null && !VREL_ANCHORS[c.anchor]) return '参考位置只能是顶部 / 中部 / 底部';
    const off = Number(c.offset);
    if (!isFinite(off)) return '垂直偏移必须是有效数值';
    if (Math.abs(off) > 1000000) return '垂直偏移超出允许范围（±1000000）';
    return null;
  }

  /** 计算目标元素应对齐到的 Y 坐标；参数非法时抛出明确错误 */
  function verticalRelativeY(model, c) {
    const err = validateVerticalRelative(model, c);
    if (err) throw new Error('相对垂直约束：' + err);
    const b = bboxSafe(model.findById(c.ids[1]));
    return vrelAnchorY(b, c.anchor || 'middle') + Number(c.offset);
  }

  function solveVerticalRelative(model, c) {
    if (validateVerticalRelative(model, c)) return false;
    const moving = model.findById(c.ids[0]);
    const p = repPoint(moving);
    if (!p) return false;
    const dy = verticalRelativeY(model, c) - p.y;
    if (Math.abs(dy) < 1e-9) return false;
    Geo.translateEntity(moving, 0, dy);
    return true;
  }

  /**
   * 创建相对垂直约束（对外 API，参数非法时抛出 Error）
   * 与水平 / 垂直对齐保持一致：约束对象使用 type + ids，额外字段描述定位方式
   * @param {Object} model 文档模型
   * @param {{ids:string[], anchor?:string, offset?:number}} cfg
   * @returns {Object} 已创建的约束对象
   */
  function addVerticalRelative(model, cfg) {
    if (!model || !model.addConstraint) throw new Error('相对垂直约束：约束模型不可用');
    const ids = cfg && cfg.ids ? cfg.ids.slice() : [];
    const con = model.addConstraint({
      type: 'vrel',
      ids: ids.map(String),
      anchor: cfg && cfg.anchor ? cfg.anchor : 'middle',
      offset: Number(cfg && cfg.offset != null ? cfg.offset : 0)
    });
    const err = validateVerticalRelative(model, con);
    if (err) {
      model.removeConstraint(con.id);
      throw new Error('相对垂直约束：' + err);
    }
    solveVerticalRelative(model, con);
    return con;
  }

  /** 等长：所有直线以第一条直线长度为基准，绕各自中点缩放 */
  function solveEqual(model, c) {
    const ids = (c.ids || []).filter(function (id) { return !!model.findById(id); });
    if (ids.length < 2) return false;
    let refLen = null;
    for (let i = 0; i < ids.length; i++) {
      const e = model.findById(ids[i]);
      if (e && e.type === 'line') {
        const L = Geo.entityLength(e);
        if (L > 1e-9) { refLen = L; break; }
      }
    }
    if (!(refLen > 1e-9)) return false;
    let moved = false;
    ids.forEach(function (id) {
      const e = model.findById(id);
      if (!e || e.type !== 'line') return;
      const cur = Geo.dist(e.p1, e.p2);
      if (cur < 1e-9 || Math.abs(cur - refLen) < 1e-9) return;
      const mid = Geo.lerp(e.p1, e.p2, 0.5);
      const ux = (e.p2.x - e.p1.x) / cur;
      const uy = (e.p2.y - e.p1.y) / cur;
      e.p1 = { x: mid.x - ux * refLen / 2, y: mid.y - uy * refLen / 2 };
      e.p2 = { x: mid.x + ux * refLen / 2, y: mid.y + uy * refLen / 2 };
      moved = true;
    });
    return moved;
  }

  /** 约束偏差（世界单位）；无法度量时返回 null */
  function deviationOf(model, c) {
    const ids = (c.ids || []).filter(function (id) { return !!model.findById(id); });
    let max = 0, count = 0;
    if (c.type === 'halign' || c.type === 'valign') {
      const axis = c.type === 'halign' ? 'y' : 'x';
      const custom = c.pmode === 'point' && c.ptype === 'custom' && c.anchor &&
        isFinite(c.anchor.x) && isFinite(c.anchor.y);
      const ref = custom ? { x: c.anchor.x, y: c.anchor.y } : alignRefOf(model, c);
      if (!ref) return null;
      ids.forEach(function (id) {
        const p = alignPointFor(model, c, model.findById(id));
        if (!p) return;
        max = Math.max(max, Math.abs(p[axis] - ref[axis]));
        count++;
      });
    } else if (c.type === 'vrel') {
      if (validateVerticalRelative(model, c)) return null;
      const p = repPoint(model.findById(c.ids[0]));
      if (!p) return null;
      max = Math.abs(p.y - verticalRelativeY(model, c));
      count = 1;
    } else if (c.type === 'equal') {
      let ref = null;
      ids.forEach(function (id) {
        const e = model.findById(id);
        if (!e || e.type !== 'line') return;
        const L = Geo.entityLength(e);
        if (!ref) { ref = L; return; }
        max = Math.max(max, Math.abs(L - ref));
        count++;
      });
    } else {
      return null;
    }
    return count ? max : null;
  }

  const SOLVERS = {
    horizontal: solveHorizontal,
    vertical: solveVertical,
    symmetric: solveSymmetric,
    collinear: solveCollinear,
    tangent: solveTangent,
    distance: solveDistance,
    parallel: solveParallel,
    fixed: solveFixed,
    angle: solveAngleConstraint,
    onLine: solveOnLine,
    overlap: solveOverlap,
    coincident: solveCoincident,
    halign: solveHAlign,
    valign: solveVAlign,
    vrel: solveVerticalRelative,
    equal: solveEqual
  };

  /**
   * @typedef {Object} VerticalRelativeConstraint
   * @property {'vrel'} type 约束类型
   * @property {string[]} ids [目标元素 id, 参考元素 id]，顺序固定
   * @property {'top'|'middle'|'bottom'} anchor 参考元素上的对齐位置：顶部 / 中部 / 底部
   * @property {number} offset 垂直偏移量（世界坐标，正值向上，负值向下，范围 ±1e6）
   */

  const CADConstraints = {
    TYPES: TYPES,
    nameOf: function (type) { return (TYPES[type] || {}).name || type; },
    iconOf: function (type) { return (TYPES[type] || {}).icon || '?'; },
    repPoint: repPoint,
    alignPointOf: alignPointOf,
    alignPoints: ALIGN_POINTS,
    snapTol: snapTolOf,
    vrelAnchors: VREL_ANCHORS,
    validateVerticalRelative: validateVerticalRelative,
    verticalRelativeY: verticalRelativeY,
    addVerticalRelative: addVerticalRelative,
    deviation: deviationOf,
    isClosedShape: isClosedShape,
    overlapRatio: overlapRatio,
    endpointPoint: endpointPoint,
    autoDetectEndpoints: autoDetectEndpoints,
    solveOne: function (model, c) {
      const fn = SOLVERS[c.type];
      if (!fn) return false;
      try { return fn(model, c); } catch (err) { return false; }
    },
    /** 迭代求解，兼容多条约束共同作用；固定约束的图形每轮保持不动 */
    solve: function (model) {
      if (!model || !model.constraints || !model.constraints.length) return 0;
      const fixed = fixedSnapshot(model);
      let passes = 0;
      for (let pass = 0; pass < 3; pass++) {
        let any = false;
        for (let i = 0; i < model.constraints.length; i++) {
          if (this.solveOne(model, model.constraints[i])) any = true;
        }
        restoreFixed(model, fixed);
        if (!any) break;
        passes++;
      }
      return passes;
    },
    /** 约束预览：在副本上求解，返回需要以虚影绘制的图元 */
    preview: function (model, draft) {
      if (!draft || !draft.ids) return [];
      const ids = draft.ids.slice();
      if (draft.axisId) ids.push(draft.axisId);
      const map = {};
      const clones = [];
      ids.forEach(function (id) {
        const e = model.findById(id);
        if (!e) return;
        const c = JSON.parse(JSON.stringify(e));
        map[c.id] = c;
        clones.push(c);
      });
      const fake = {
        entities: clones,
        findById: function (id) { return map[id] || null; }
      };
      if (!this.solveOne(fake, draft)) return [];
      const out = [];
      clones.forEach(function (c) {
        const orig = model.findById(c.id);
        if (orig && JSON.stringify(orig) !== JSON.stringify(c)) out.push(c);
      });
      return out;
    },
    anchorOf: function (model, c) {
      if (c.type === 'halign' || c.type === 'valign') {
        const ref = alignRefOf(model, c);
        if (ref) return ref;
      }
      if (c.type === 'vrel') {
        const p = repPoint(model.findById((c.ids || [])[0]));
        if (p) return p;
      }
      if (c.type === 'coincident') {
        const e = model.findById((c.ids || [])[0]);
        const p = endpointPoint(e, c.aIdx);
        if (p) return p;
      }
      const pts = [];
      (c.ids || []).forEach(function (id) {
        const p = repPoint(model.findById(id));
        if (p) pts.push(p);
      });
      if (c.axisId) {
        const axis = model.findById(c.axisId);
        if (axis && axis.type === 'line') pts.push(Geo.lerp(axis.p1, axis.p2, 0.5));
      }
      if (!pts.length) return null;
      let x = 0, y = 0;
      pts.forEach(function (p) { x += p.x; y += p.y; });
      return { x: x / pts.length, y: y / pts.length };
    },
    targetLabel: function (model, id) {
      const e = model.findById(id);
      if (!e) return '已删除';
      return (TYPE_NAME[e.type] || e.type) + ' ' + id;
    },
    listHtml: function (model) {
      const self = this;
      const cs = model.constraints || [];
      let html = '<div class="big">' + cs.length + ' 个约束</div>';
      if (!cs.length) {
        html += '<div class="hint">在“约束”页选择类型后点按图形即可添加：水平 / 垂直直接点一条直线；对称依次点两个图形和一条对称轴；共线先点基准线再点其它线 / 点 / 圆；相切点两个圆或圆与直线；距离点两个图形后按输入值固定间距；平行点两条直线；固定点一个图形使其保持不动，勾选“仅固定端点”时只固定端点 / 圆心位置、形状与方向仍可调整；角度点两条直线后按面板角度固定夹角；点在线上点一个点 / 圆 / 圆弧再点一条直线；重叠先点基准图形，再点要重叠的矩形 / 多边形 / 圆，默认完全重叠，也可按比例自动调整第二个图形；重合先点一个带端点的图形（直线 / 圆弧 / 矩形 / 多边形 / 点），再点另一个图形，自动选取最近的一对端点使其重合；也可在“约束设置”开启端点自动重合，端点距离小于阈值时自动建立约束。圆与圆弧会自动以圆心作为参考点。</div>';
        return html;
      }
      cs.forEach(function (c) {
        const targets = (c.ids || []).map(function (id) { return self.targetLabel(model, id); }).join(' · ');
        let axis = '';
        if (c.axisId) axis = ' ｜ 轴 ' + self.targetLabel(model, c.axisId);
        let value = '';
        if (c.type === 'distance' || c.type === 'angle') {
          const isAngle = c.type === 'angle';
          value = '<input class="prop-input con-input" type="number" inputmode="decimal" step="any" ' +
            'data-con-value="' + c.id + '" value="' + (isFinite(c.value) ? num(c.value) : '') + '" aria-label="' +
            (isAngle ? '约束角度' : '约束距离') + '">' + (isAngle ? '°' : '');
        } else if (c.type === 'overlap') {
          value = c.mode === 'ratio'
            ? '<input class="prop-input con-input" type="number" inputmode="decimal" step="any" min="1" max="100" ' +
              'data-con-value="' + c.id + '" value="' + (isFinite(c.value) ? num(c.value) : '50') + '" aria-label="重叠比例">%'
            : '<span class="con-mode">完全重叠</span>';
        } else if (c.type === 'coincident') {
          value = '<span class="con-mode">端点 ' + ((Number(c.aIdx) || 0) + 1) + ' ↔ ' +
            ((Number(c.bIdx) || 0) + 1) + '</span>';
        } else if (c.type === 'fixed') {
          value = '<span class="con-mode">' + (c.onlyEndpoints ? '仅端点' : '整体') + '</span>';
        } else if ((c.type === 'halign' || c.type === 'valign') && c.pmode === 'point') {
          let label = ALIGN_POINTS[c.ptype] || '中心点';
          if (c.ptype === 'custom' && c.anchor) {
            label += ' ' + num(c.anchor.x) + ', ' + num(c.anchor.y);
          }
          value = '<span class="con-mode">' + label + ' · 吸附 ' + snapTolOf(c) + 'px</span>';
        } else if (c.type === 'vrel') {
          const off = Number(c.offset);
          value = '<span class="con-mode">' + (VREL_ANCHORS[c.anchor] || '中部') + ' ' +
            (off >= 0 ? '+' : '') + num(off) + '</span>';
        }
        html += '<div class="con-row" data-con-sel="' + c.id + '">' +
          '<div class="con-main">' +
          '<span class="con-type">' + self.nameOf(c.type) + '</span>' +
          '<span class="con-targets">' + targets + axis + '</span>' +
          (value ? '<span class="con-value">' + value + '</span>' : '') +
          '</div>' +
          '<button class="mini danger" data-con-del="' + c.id + '">删除</button>' +
          '</div>';
      });
      html += '<div class="hint">点按约束行可高亮对应图形；距离 / 角度 / 重叠比例约束可直接修改数值；重合约束在图形拖动后自动保持端点一致；固定约束的图形在后续求解中保持不动（“仅端点”模式只固定端点 / 圆心）；水平 / 垂直对齐可在面板切换“边界对齐 / 点对齐”，点对齐支持左上 / 中心 / 右上 / 左下 / 右下与指定锚点，并可用数字键 1~5、0 快速切换；删除后约束解除。</div>';
      return html;
    },
    drawMarks: function (R, app) {
      if (app.params && app.params.cshow === false) return;
      const model = app.model;
      if (!model || !model.constraints || !model.constraints.length) return;
      const ctx = R.ctx;
      model.constraints.forEach(function (c, i) {
        const anchor = CADConstraints.anchorOf(model, c);
        if (!anchor) return;
        const s = R.screen(anchor);
        let extra = '';
        if (c.type === 'distance') extra = ' ' + fmt(c.value);
        else if (c.type === 'angle') extra = ' ' + fmt(c.value) + '°';
        else if (c.type === 'vrel') {
          const off = Number(c.offset);
          extra = ' ' + (VREL_ANCHORS[c.anchor] || '中部') + ' ' + (off >= 0 ? '+' : '') + fmt(off);
        }
        else if (c.type === 'overlap') extra = c.mode === 'ratio' ? ' ' + fmt(c.value) + '%' : ' 完全';
        else if (c.type === 'coincident') extra = ' 重合';
        const dev = CADConstraints.deviation(model, c);
        const pointMode = (c.type === 'halign' || c.type === 'valign') && c.pmode === 'point';
        if (pointMode) {
          extra += ' ' + (ALIGN_POINTS[c.ptype] || '中心点') + ' ' + CADConstraints.snapTol(c) + 'px';
        }
        const tolPx = pointMode ? CADConstraints.snapTol(c) : 2;
        const tol = tolPx / (app.view && app.view.scale ? app.view.scale : 1);
        const state = dev == null ? null : dev <= tol;
        const color = state === true ? '#3ddc97' : (state === false ? '#ff7a6b' : CON_COLOR);
        const text = CADConstraints.iconOf(c.type) + extra + (state === true ? ' ✓' : (state === false ? ' !' : ''));
        if (pointMode) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(s.x - 5, s.y);
          ctx.lineTo(s.x + 5, s.y);
          ctx.moveTo(s.x, s.y - 5);
          ctx.lineTo(s.x, s.y + 5);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.font = '10px -apple-system, "PingFang SC", system-ui, sans-serif';
        const w = ctx.measureText(text).width;
        const x = s.x + 10;
        const y = s.y - 16 - (i % 3) * 17;
        ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y - 10, w + 10, 16, 5);
        else ctx.rect(x, y - 10, w + 10, 16);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 5, y - 2);
        ctx.restore();
      });
    }
  };

  global.CADDims = CADDims;
  global.CADConstraints = CADConstraints;
})(typeof window !== 'undefined' ? window : globalThis);
