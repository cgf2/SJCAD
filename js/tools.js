/* 手机CAD · 工具集（绘图 / 编辑 / 查询 / 视图） */
(function (global) {
  'use strict';
  const Geo = global.Geo;
  let App = null;

  function fmt(n) {
    if (!isFinite(n)) return '-';
    const v = Math.round(n * 100) / 100;
    return String(v);
  }

  function degFmt(r) { return fmt(Geo.deg(r)) + '°'; }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  function baseTool(def) {
    return Object.assign({
      dragType: 'pan',
      points: [],
      hover: null,
      prompt: '',
      params: function () { return []; },
      activate: function () { this.reset(); },
      deactivate: function () { this.reset(); },
      reset: function () { this.points = []; this.hover = null; },
      onTap: function () {},
      onDragStart: function () {},
      onDragMove: function () {},
      onDragEnd: function () {},
      onDragCancel: function () {},
      onHover: function (p) { this.hover = p; },
      onRender: function () {}
    }, def);
  }

  function addEntities(list) {
    if (!list || !list.length) return;
    App.begin();
    list.forEach(function (e) { App.model.add(e); });
    App.end();
  }

  function clampRadius(r) {
    return Math.max(r, 0.01);
  }

  function sameP(a, b) {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  }

  function unitOf(v) {
    const L = Math.hypot(v.x, v.y);
    return L < 1e-9 ? null : { x: v.x / L, y: v.y / L };
  }

  /** 判断两个图元几何是否完全重合（用于过滤重复生成的等距线） */
  function sameEntity(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'line') return sameP(a.p1, b.p1) && sameP(a.p2, b.p2);
    if (a.type === 'point') return sameP(a.p, b.p);
    if (a.type === 'circle') return sameP(a.c, b.c) && Math.abs(a.r - b.r) < 1e-6;
    if (a.type === 'arc') {
      return sameP(a.c, b.c) && Math.abs(a.r - b.r) < 1e-6 &&
        Geo.arcSweep(a) > 1e-9 && Geo.arcSweep(b) > 1e-9 &&
        Math.abs(Geo.normAngle(a.a0 - b.a0)) < 1e-6 &&
        Math.abs(Geo.normAngle(a.a1 - b.a1)) < 1e-6 &&
        !!a.ccw === !!b.ccw;
    }
    return false;
  }

  function existsIn(list, ent) {
    for (let i = 0; i < list.length; i++) if (sameEntity(list[i], ent)) return true;
    return false;
  }

  /** 图元按遍历方向的起点/终点（rev=true 表示反向遍历） */
  function entEnds(e, rev) {
    if (e.type === 'line') return rev ? [e.p2, e.p1] : [e.p1, e.p2];
    const s = Geo.arcStart(e), t = Geo.arcEnd(e);
    return rev ? [t, s] : [s, t];
  }

  /** 将直线与圆弧按端点连通关系整理为首尾相连的链 */
  function connectChains(ents) {
    const tol = 1e-5;
    const keyOf = function (p) { return Math.round(p.x / tol) + ',' + Math.round(p.y / tol); };
    const list = ents.filter(function (e) { return e.type === 'line' || e.type === 'arc'; });
    const used = list.map(function () { return false; });
    const adj = {};
    list.forEach(function (e, i) {
      entEnds(e, false).forEach(function (p) {
        const k = keyOf(p);
        (adj[k] = adj[k] || []).push(i);
      });
    });
    function nextAt(key) {
      const arr = adj[key] || [];
      for (let i = 0; i < arr.length; i++) if (!used[arr[i]]) return arr[i];
      return -1;
    }
    const chains = [];
    for (let s = 0; s < list.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      const items = [{ ent: list[s], rev: false }];
      let closed = false;
      let endNode = entEnds(list[s], false)[1];
      const firstNode = keyOf(entEnds(list[s], false)[0]);
      for (;;) {
        const idx = nextAt(keyOf(endNode));
        if (idx < 0) break;
        const e = list[idx];
        const rev = keyOf(entEnds(e, false)[0]) !== keyOf(endNode);
        items.push({ ent: e, rev: rev });
        used[idx] = true;
        endNode = entEnds(e, rev)[1];
        if (keyOf(endNode) === firstNode) { closed = true; break; }
      }
      if (!closed) {
        for (;;) {
          const startNode = entEnds(items[0].ent, items[0].rev)[0];
          const idx = nextAt(keyOf(startNode));
          if (idx < 0) break;
          const e = list[idx];
          // 需要让该图元遍历终点落在 startNode 上
          const rev = keyOf(entEnds(e, false)[1]) !== keyOf(startNode);
          items.unshift({ ent: e, rev: rev });
          used[idx] = true;
        }
      }
      chains.push({ items: items, closed: closed });
    }
    return chains;
  }

  /** 单条图元沿链方向的左侧偏移 */
  function chainOffsetEnt(ent, d, rev) {
    if (ent.type === 'line') return Geo.offsetEntity(ent, rev ? -d : d);
    const effCcw = rev ? !ent.ccw : ent.ccw;
    return Geo.offsetEntity(ent, effCcw ? -d : d);
  }

  function chainJoinPoint(o1, o2, near) {
    let pts = [];
    if (o1.type === 'line' && o2.type === 'line') {
      const q = Geo.lineIntersectInfinite(o1.p1, o1.p2, o2.p1, o2.p2);
      if (q) pts = [q];
    } else if (o1.type === 'line') {
      pts = Geo.lineCircleInfinite(o1.p1, o1.p2, o2.c, o2.r);
    } else if (o2.type === 'line') {
      pts = Geo.lineCircleInfinite(o2.p1, o2.p2, o1.c, o1.r);
    } else {
      pts = Geo.circleCircleIntersect(o1.c, o1.r, o2.c, o2.r);
    }
    let best = null, bestD = Infinity;
    pts.forEach(function (q) {
      const d = Geo.dist(q, near);
      if (d < bestD) { bestD = d; best = q; }
    });
    return best;
  }

  function setChainEnd(off, item, pt) {
    if (item.ent.type === 'line') {
      if (item.rev) off.p1 = { x: pt.x, y: pt.y };
      else off.p2 = { x: pt.x, y: pt.y };
    } else {
      const ang = Math.atan2(pt.y - off.c.y, pt.x - off.c.x);
      if (item.rev) off.a0 = ang; else off.a1 = ang;
    }
  }

  function setChainStart(off, item, pt) {
    if (item.ent.type === 'line') {
      if (item.rev) off.p2 = { x: pt.x, y: pt.y };
      else off.p1 = { x: pt.x, y: pt.y };
    } else {
      const ang = Math.atan2(pt.y - off.c.y, pt.x - off.c.x);
      if (item.rev) off.a1 = ang; else off.a0 = ang;
    }
  }

  /** 批量等距：直线 + 圆弧按连通链整体偏移，拐角斜接为一条连续的线 */
  function offsetTargets(targets, dist, signs) {
    const outs = [];
    let skipped = 0;
    const chains = connectChains(targets);
    const circles = targets.filter(function (t) { return t.type === 'circle'; });
    targets.forEach(function (t) {
      if (t.type !== 'line' && t.type !== 'arc' && t.type !== 'circle') skipped++;
    });
    signs.forEach(function (s) {
      const d = s * dist;
      chains.forEach(function (ch) {
        if (ch.items.length === 1) {
          const o = Geo.offsetEntity(ch.items[0].ent, d);
          if (o) outs.push(o); else skipped++;
          return;
        }
        const offs = [];
        const items = [];
        let lost = 0;
        ch.items.forEach(function (it) {
          const o = chainOffsetEnt(it.ent, d, it.rev);
          if (!o) { lost++; return; }
          offs.push(o);
          items.push(it);
        });
        // 某段偏移后半径无效时只跳过该段，其余相邻段继续斜接，避免整侧等距线全部丢失
        skipped += lost;
        if (!offs.length) return;
        const n = items.length;
        const closed = ch.closed && lost === 0;
        const joins = closed ? n : n - 1;
        for (let i = 0; i < joins; i++) {
          const A = items[i], B = items[(i + 1) % n];
          const oa = offs[i], ob = offs[(i + 1) % n];
          const P = entEnds(A.ent, A.rev)[1];
          const jp = chainJoinPoint(oa, ob, P);
          if (jp) {
            setChainEnd(oa, A, jp);
            setChainStart(ob, B, jp);
          }
        }
        offs.forEach(function (o) { outs.push(o); });
      });
      circles.forEach(function (c) {
        const o = Geo.offsetEntity(c, d);
        if (o) outs.push(o); else skipped++;
      });
    });
    return { outs: outs, skipped: skipped };
  }

  /* ================= 选择 ================= */
  const selectTool = baseTool({
    id: 'select', name: '选择', cat: 'edit', icon: '⌖', dragType: 'tool',
    prompt: function () {
      if (App.params.cont) return '连续选择：逐个点按累加/取消，拖动框选为追加';
      if (App.params.chain) return '关联选择：点按任一图元，自动带出相连图形';
      return '点按拾取，单指拖动框选';
    },
    params: function () {
      return [
        { key: 'cont', type: 'toggle', label: '连续选择', def: false, group: '选择模式' },
        { key: 'chain', type: 'toggle', label: '关联选择', def: false, group: '选择模式' }
      ];
    },
    onTap: function (p) {
      const e = App.pick(p);
      const sel = App.model.selected;
      if (!e) {
        sel.clear();
        App.afterSelectionChange();
        App.updatePrompt();
        this.reset();
        return;
      }
      if (App.params.cont) {
        if (sel.has(e.id)) sel.delete(e.id);
        else {
          sel.add(e.id);
          this._chainInto(e, sel);
        }
      } else {
        sel.clear();
        sel.add(e.id);
        this._chainInto(e, sel);
      }
      App.afterSelectionChange();
      App.updatePrompt();
      this.reset();
    },
    _chainInto: function (e, sel) {
      if (!App.params.chain) return;
      const set = App.model.chain(e, App.worldTol(6));
      set.forEach(function (id) { sel.add(id); });
    },
    onDragStart: function (p) {
      this.band = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      if (!App.params.cont) {
        App.model.selected.clear();
        App.afterSelectionChange();
      }
    },
    onDragMove: function (p) {
      if (!this.band) return;
      this.band.x2 = p.x; this.band.y2 = p.y;
      App.refresh();
    },
    onDragEnd: function (p) {
      if (!this.band) return;
      this.band.x2 = p.x; this.band.y2 = p.y;
      const r = Geo.normalizeRect(this.band.x1, this.band.y1, this.band.x2, this.band.y2);
      const list = App.model.entitiesInRect(r, true);
      if (!App.params.cont) App.model.selected.clear();
      list.forEach(function (e) { App.model.selected.add(e.id); });
      this.band = null;
      App.afterSelectionChange();
    },
    onDragCancel: function () { this.band = null; },
    onRender: function (ctx, R) {
      if (!this.band) return;
      R.previewRect(Geo.normalizeRect(this.band.x1, this.band.y1, this.band.x2, this.band.y2));
    }
  });

  /* ================= 删除 ================= */
  const deleteTool = baseTool({
    id: 'delete', name: '删除', cat: 'edit', icon: '⌫', dragType: 'pan',
    prompt: '点按要删除的图形',
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('未拾取到图形'); return; }
      App.begin();
      App.model.remove(e.id);
      App.end();
      App.toast('已删除');
    }
  });

  /* ================= 绘图：直线 ================= */
  const lineTool = baseTool({
    id: 'line', name: '直线', cat: 'draw', icon: '╱', dragType: 'preview',
    prompt: function () {
      if (!this.points.length) {
        const base = '点按起点，或直接输入起点/终点坐标后确定';
        return App.params.ortho ? base + '（正交：仅水平/垂直）' : base;
      }
      if (this.snapMode) return '捕捉：' + this.snapMode + '（F3 或按住 Shift 可临时关闭捕捉）';
      if (!this._snapEnabled()) return '捕捉已关闭（F3 或松开 Shift 恢复）';
      if (App.params.tangent) return '拖动确定切线终点，或输入终点坐标后确定';
      if (App.params.perp) return '沿垂直方向拖动确定终点，或输入终点坐标后确定';
      const base = '点按终点，靠近圆弧自动吸附切点、靠近直线自动吸附垂足';
      return App.params.ortho ? base + '（正交：仅水平/垂直）' : base;
    },
    params: function () {
      return [
        { key: 'ortho', type: 'toggle', label: '正交', def: false, group: '模式' },
        {
          key: 'tangent', type: 'toggle', label: '相切', def: false, group: '对象约束',
          when: function (p) { return p.lref === 'circle'; }
        },
        {
          key: 'perp', type: 'toggle', label: '垂直', def: false, group: '对象约束',
          when: function (p) { return p.lref === 'line'; }
        },
        { key: 'asnap', type: 'toggle', label: '自动捕捉', def: true, group: '捕捉' },
        {
          key: 'stol', type: 'choice', label: '捕捉阈值', def: '18', group: '捕捉', options: [
            { v: '12', label: '12px' }, { v: '18', label: '18px' },
            { v: '24', label: '24px' }, { v: '36', label: '36px' }
          ]
        },
        { key: 'x1', label: 'X', def: 0, group: '起点' },
        { key: 'y1', label: 'Y', def: 0, group: '起点' },
        { key: 'x2', label: 'X', def: 100, group: '终点' },
        { key: 'y2', label: 'Y', def: 0, group: '终点' }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.refId = null;
      this.startRef = null;
      this.hoverRef = null;
      this.snapMode = null;
      this.snapPt = null;
      App.params.lref = '';
      App.params.tangent = false;
      App.params.perp = false;
      if (App.updateParams) App.updateParams();
    },
    activate: function () {
      this.snapOff = false;
      this.snapHold = false;
      this._bindSnapKeys();
      this.reset();
    },
    deactivate: function () {
      this._unbindSnapKeys();
      this.snapOff = false;
      this.snapHold = false;
      this.reset();
    },
    /** 快捷键：F3 切换捕捉开关，按住 Shift 临时关闭捕捉 */
    _bindSnapKeys: function () {
      if (this._snapKeyDown) return;
      const self = this;
      this._snapKeyDown = function (e) {
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Shift') {
          if (self.snapHold) return;
          self.snapHold = true;
          self._setSnap(null, null);
          if (App.toast) App.toast('临时关闭捕捉（松开 Shift 恢复）');
          if (App.updatePrompt) App.updatePrompt();
          if (App.refresh) App.refresh();
        } else if (e.key === 'F3') {
          e.preventDefault();
          self.snapOff = !self.snapOff;
          self._setSnap(null, null);
          if (App.toast) App.toast(self.snapOff ? '捕捉已关闭（F3 恢复）' : '捕捉已开启');
          if (App.updatePrompt) App.updatePrompt();
          if (App.refresh) App.refresh();
        }
      };
      this._snapKeyUp = function (e) {
        if (e.key !== 'Shift' || !self.snapHold) return;
        self.snapHold = false;
        if (App.updatePrompt) App.updatePrompt();
        if (App.refresh) App.refresh();
      };
      window.addEventListener('keydown', this._snapKeyDown);
      window.addEventListener('keyup', this._snapKeyUp);
    },
    _unbindSnapKeys: function () {
      if (this._snapKeyDown) window.removeEventListener('keydown', this._snapKeyDown);
      if (this._snapKeyUp) window.removeEventListener('keyup', this._snapKeyUp);
      this._snapKeyDown = null;
      this._snapKeyUp = null;
    },
    _snapEnabled: function () {
      return App.params.asnap !== false && !this.snapOff && !this.snapHold;
    },
    _setSnap: function (type, pt) {
      const changed = this.snapMode !== type;
      this.snapMode = type;
      this.snapPt = pt;
      if (changed && App.updatePrompt) App.updatePrompt();
    },
    /** 终点自动捕捉：靠近圆弧吸附切点，靠近直线吸附垂足（阈值可配置） */
    _autoSnap: function (p0, p) {
      if (!this._snapEnabled()) { this._setSnap(null, null); return null; }
      // 端点 / 中点 / 交点 / 圆心等标准捕捉优先，避免冲突
      if (App.snapInfo && App.snapInfo.p && Geo.dist(p, App.snapInfo.p) < 1e-6) {
        this._setSnap(null, null);
        return null;
      }
      const tol = App.worldTol(Number(App.params.stol) || 18);
      let best = null, bestD = Infinity;
      App.model.entities.forEach(function (e) {
        if (e.type !== 'line' && e.type !== 'circle' && e.type !== 'arc') return;
        if (e.type === 'point') return;
        const d = Geo.hitDistance(e, p);
        if (d > tol || d >= bestD) return;
        const q = this._snapOnEntity(e, p0, p);
        if (!q) return;
        best = { p: q, type: e.type === 'line' ? '垂足' : '切点' };
        bestD = d;
      }, this);
      if (best) { this._setSnap(best.type, best.p); return best.p; }
      this._setSnap(null, null);
      return null;
    },
    /** 单个图元上的捕捉点：直线取垂足，圆/圆弧取离光标较近的切点 */
    _snapOnEntity: function (e, p0, p) {
      if (e.type === 'line') {
        const u = unitOf(Geo.sub(e.p2, e.p1));
        if (!u) return null;
        const t = (p0.x - e.p1.x) * u.x + (p0.y - e.p1.y) * u.y;
        const q = { x: e.p1.x + u.x * t, y: e.p1.y + u.y * t };
        return Geo.dist(q, p0) < 1e-9 ? null : q;
      }
      const d = Geo.dist(p0, e.c);
      if (d <= e.r + 1e-7) return null; // 起点在圆上或圆内，无切点
      const pts = Geo.circleCircleIntersect(e.c, e.r, p0, Math.sqrt(d * d - e.r * e.r));
      if (!pts.length) return null;
      let pick = null, bestD = Infinity;
      pts.forEach(function (q) {
        if (e.type === 'arc' && !Geo.angleOnArc(Math.atan2(q.y - e.c.y, q.x - e.c.x), e)) return;
        const dd = Geo.dist(q, p);
        if (dd < bestD) { bestD = dd; pick = q; }
      });
      return pick;
    },
    onHover: function (p) {
      this.hover = p;
      if (this.points.length > 1) return;
      this._scanRef(p);
    },
    /** 起点落在圆/圆弧或直线上时，自动提供相切/垂直约束 */
    _detectRef: function (p0) {
      let e = App.pick(p0);
      if (!e && this.hover) e = App.pick(this.hover);
      const kind = e && (e.type === 'circle' || e.type === 'arc') ? 'circle'
        : e && e.type === 'line' ? 'line' : '';
      this.startRef = e && kind ? { id: e.id, kind: kind } : null;
      this.hoverRef = null;
      this._applyRef();
    },
    /** 绘制过程中光标经过图形时同步约束选项：圆弧→相切，直线→垂直 */
    _scanRef: function (p) {
      const e = App.pick(p);
      const kind = e && (e.type === 'circle' || e.type === 'arc') ? 'circle'
        : e && e.type === 'line' ? 'line' : '';
      const next = e && kind ? { id: e.id, kind: kind } : null;
      const cur = this.hoverRef;
      if (!next ? !cur : (cur && next.id === cur.id && next.kind === cur.kind)) return;
      this.hoverRef = next;
      this._applyRef();
    },
    /** 当前参考优先取光标下的图形，其次回退到起点所在图形 */
    _applyRef: function () {
      const ref = this.hoverRef || this.startRef;
      this.refId = ref ? ref.id : null;
      const kind = ref ? ref.kind : '';
      if (App.params.lref === kind) return;
      App.params.lref = kind;
      if (App.updateParams) App.updateParams();
    },
    _snap: function (p0, p) {
      if (!App.params.ortho) return p;
      return Math.abs(p.x - p0.x) >= Math.abs(p.y - p0.y)
        ? { x: p.x, y: p0.y }
        : { x: p0.x, y: p.y };
    },
    /** 相切/垂直约束下的终点；返回 null 表示不约束，返回 {error} 表示无解 */
    _constrain: function (p0, p) {
      if (!this.refId) return null;
      const ref = App.model.findById(this.refId);
      if (!ref) return null;
      if (App.params.tangent && (ref.type === 'circle' || ref.type === 'arc')) {
        return this._tangentEnd(ref, p0, p);
      }
      if (App.params.perp && ref.type === 'line') {
        return this._perpEnd(ref, p0, p);
      }
      return null;
    },
    _tangentEnd: function (ref, p0, p) {
      const dirHover = unitOf(Geo.sub(p, p0));
      if (!dirHover) return null;
      const d = Geo.dist(p0, ref.c);
      if (d < ref.r - 1e-7) return { error: '起点在圆内，无法作切线' };
      if (Math.abs(d - ref.r) <= 1e-7) {
        // 起点在圆/圆弧上：切线方向垂直于半径，长度取拖动距离
        const u = unitOf(Geo.sub(p0, ref.c));
        if (!u) return { error: '半径过小，无法作切线' };
        const tx = -u.y, ty = u.x;
        const sign = tx * dirHover.x + ty * dirHover.y >= 0 ? 1 : -1;
        const L = Geo.dist(p0, p);
        return { p: { x: p0.x + tx * sign * L, y: p0.y + ty * sign * L } };
      }
      // 圆外一点：两切点中选与拖动方向更接近的一个
      const pts = Geo.circleCircleIntersect(ref.c, ref.r, p0, Math.sqrt(d * d - ref.r * ref.r));
      if (!pts.length) return { error: '无法作切线' };
      let best = null, bestScore = -Infinity;
      pts.forEach(function (q) {
        const v = unitOf(Geo.sub(q, p0));
        const score = v ? v.x * dirHover.x + v.y * dirHover.y : -Infinity;
        if (score > bestScore) { bestScore = score; best = q; }
      });
      return best ? { p: best } : { error: '无法作切线' };
    },
    _perpEnd: function (ref, p0, p) {
      const u = unitOf(Geo.sub(ref.p2, ref.p1));
      if (!u) return null;
      const nx = -u.y, ny = u.x;
      const t = (p.x - p0.x) * nx + (p.y - p0.y) * ny;
      return { p: { x: p0.x + nx * t, y: p0.y + ny * t } };
    },
    /** 计算终点：对象约束 → 自动切点/垂足捕捉 → 正交 */
    _endPoint: function (p0, p) {
      const c = this._constrain(p0, p);
      if (c && c.error) { this._setSnap(null, null); return c; }
      if (c && c.p) { this._setSnap(null, null); return { p: c.p }; }
      const a = this._autoSnap(p0, p);
      if (a) return { p: a };
      return { p: this._snap(p0, p) };
    },
    onTap: function (p) {
      if (!this.points.length) {
        this.points.push(Geo.cloneP(p));
        App.params.x1 = round3(p.x);
        App.params.y1 = round3(p.y);
        this._detectRef(p);
        App.updateParams && App.updateParams();
        App.updatePrompt();
        return;
      }
      const res = this._endPoint(this.points[0], p);
      if (res.error) { App.toast(res.error); return; }
      const q = res.p;
      if (Geo.dist(q, this.points[0]) < 1e-9) {
        App.toast('请拖动确定终点'); return;
      }
      addEntities([{ type: 'line', p1: Geo.cloneP(this.points[0]), p2: { x: q.x, y: q.y } }]);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      const x1 = Number(App.params.x1), y1 = Number(App.params.y1);
      let x2 = Number(App.params.x2), y2 = Number(App.params.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) {
        App.toast('请输入有效的坐标数值'); return;
      }
      if (App.params.ortho) {
        if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) y2 = y1; else x2 = x1;
      }
      if (Geo.dist({ x: x1, y: y1 }, { x: x2, y: y2 }) < 1e-6) {
        App.toast('起点与终点不能重合'); return;
      }
      if (App.params.ortho) {
        App.params.x2 = round3(x2);
        App.params.y2 = round3(y2);
        if (App.updateParams) App.updateParams();
      }
      addEntities([{ type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } }]);
      this.reset();
      App.updatePrompt();
    },
    onRender: function (ctx, R) {
      if (this.points.length !== 1) return;
      const p0 = this.points[0];
      let p1 = this.hover;
      if (!p1) {
        const x2 = Number(App.params.x2), y2 = Number(App.params.y2);
        p1 = isFinite(x2) && isFinite(y2) ? { x: x2, y: y2 } : { x: p0.x + 100, y: p0.y };
      }
      const res = this._endPoint(p0, p1);
      if (res.error) { R.previewLine(p0, p1); return; }
      R.previewLine(p0, res.p);
      if (this.snapMode && this.snapPt) R.previewMarker(this.snapPt, '捕捉' + this.snapMode);
      if (App.params.tangent) R.previewLabel('相切', res.p);
      else if (App.params.perp) R.previewLabel('垂直', res.p);
    }
  });

  /* ================= 绘图：圆 ================= */
  const circleTool = baseTool({
    id: 'circle', name: '圆', cat: 'draw', icon: '○', dragType: 'preview',
    prompt: function () {
      return this.points.length ? '点按确定半径，或输入半径后确定' : '点按圆心，或输入圆心坐标/半径后确定';
    },
    params: function () {
      return [
        { key: 'cx', label: 'X', def: 0, group: '圆心' },
        { key: 'cy', label: 'Y', def: 0, group: '圆心' },
        { key: 'r', label: '半径', def: 50, group: '半径', positive: true }
      ];
    },
    onTap: function (p) {
      if (!this.points.length) {
        this.points.push(Geo.cloneP(p));
        App.params.cx = round3(p.x);
        App.params.cy = round3(p.y);
        if (App.updateParams) App.updateParams();
        App.updatePrompt();
        return;
      }
      const r = clampRadius(Geo.dist(this.points[0], p));
      addEntities([{ type: 'circle', c: Geo.cloneP(this.points[0]), r: r }]);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      const cx = Number(App.params.cx), cy = Number(App.params.cy);
      const r = Number(App.params.r);
      if (!isFinite(cx) || !isFinite(cy)) { App.toast('请输入有效的圆心坐标'); return; }
      if (!(r > 0)) { App.toast('半径需大于 0'); return; }
      addEntities([{ type: 'circle', c: { x: cx, y: cy }, r: r }]);
      this.reset();
      App.updatePrompt();
    },
    onRender: function (ctx, R) {
      if (this.points.length !== 1) return;
      const c = this.points[0];
      let r = this.hover ? Geo.dist(c, this.hover) : Number(App.params.r) || 50;
      if (r < 0.01) r = 0.01;
      R.previewCircle(c, r);
      R.previewLine(c, this.hover || Geo.polar(c, r, Math.PI / 4));
    }
  });

  /* ================= 绘图：圆弧（两点 + 半径） ================= */
  const arcTool = baseTool({
    id: 'arc', name: '圆弧', cat: 'draw', icon: '◜', dragType: 'preview',
    prompt: function () {
      if (!this.points.length) return '点按圆弧起点（也可输入两端点坐标）';
      if (this.points.length === 1) return '点按圆弧终点';
      return '输入半径后确定，或直接点按画布生成（可切换劣弧/优弧）';
    },
    params: function () {
      return [
        { key: 'x1', label: 'X', def: 0, group: '起点' },
        { key: 'y1', label: 'Y', def: 0, group: '起点' },
        { key: 'x2', label: 'X', def: 100, group: '终点' },
        { key: 'y2', label: 'Y', def: 0, group: '终点' },
        { key: 'r', label: '半径', def: 80, group: '半径', positive: true },
        {
          key: 'amode', type: 'choice', label: '弧向', def: 'minor', group: '弧向',
          options: [{ v: 'minor', label: '劣弧' }, { v: 'major', label: '优弧' }]
        }
      ];
    },
    _ends: function () {
      if (this.points.length === 2) return [this.points[0], this.points[1]];
      const x1 = Number(App.params.x1), y1 = Number(App.params.y1);
      const x2 = Number(App.params.x2), y2 = Number(App.params.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return null;
      return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    },
    /** 按两点+半径构造圆弧；半径不足弦长一半时自动按半圆适配 */
    _build: function (p1, p2) {
      const d = Geo.dist(p1, p2);
      if (d < 1e-6) return { error: '起点与终点不能重合' };
      let r = Number(App.params.r);
      if (!isFinite(r) || !(r > 0)) return { error: '半径需为大于 0 的数值' };
      if (r < d / 2 - 1e-9) r = d / 2;
      const arc = Geo.arcFromChord(p1, p2, r, App.params.amode === 'major');
      if (!arc) return { error: '无法生成圆弧，请调整半径' };
      return { arc: arc, clamped: r !== Number(App.params.r) };
    },
    onTap: function (p) {
      if (this.points.length < 2) {
        if (this.points.length === 1 && Geo.dist(this.points[0], p) < 1e-6) {
          App.toast('起点与终点不能重合'); return;
        }
        this.points.push(Geo.cloneP(p));
        if (this.points.length === 1) {
          App.params.x1 = round3(p.x);
          App.params.y1 = round3(p.y);
        } else {
          App.params.x2 = round3(p.x);
          App.params.y2 = round3(p.y);
        }
        if (App.updateParams) App.updateParams();
        App.updatePrompt();
        return;
      }
      this._commit();
    },
    _commit: function () {
      const ends = this._ends();
      if (!ends) { App.toast('请输入有效的端点坐标'); return; }
      const res = this._build(ends[0], ends[1]);
      if (res.error) { App.toast(res.error); return; }
      addEntities([res.arc]);
      if (res.clamped) App.toast('半径小于弦长一半，已按半圆生成');
      this.reset();
      App.updateParams && App.updateParams();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      this._commit();
    },
    onRender: function (ctx, R) {
      if (!this.points.length) return;
      if (this.points.length === 1) {
        const p1 = this.points[0];
        const p2 = this.hover;
        if (p2) {
          R.previewLine(p1, p2);
          R.previewLabel('点按终点', p2);
        }
        return;
      }
      const p1 = this.points[0], p2 = this.points[1];
      const res = this._build(p1, p2);
      if (res.error) return;
      R.previewLine(p1, p2);
      R.previewArc(res.arc);
      R.previewLabel('R' + fmt(res.arc.r), Geo.entityMidpoint(res.arc));
    }
  });

  /* ================= 绘图：点 ================= */
  const pointTool = baseTool({
    id: 'point', name: '点', cat: 'draw', icon: '•', dragType: 'preview',
    prompt: '点按放置点（靠近圆/圆弧时自动捕捉圆心），或输入 X / Y 坐标后确定',
    params: function () {
      return [
        { key: 'x', label: 'X', def: 0, group: '坐标' },
        { key: 'y', label: 'Y', def: 0, group: '坐标' }
      ];
    },
    /** 命中圆/圆弧或靠近圆心时，返回圆心坐标 */
    _centerAt: function (p) {
      const e = App.pick(p);
      if (e && (e.type === 'circle' || e.type === 'arc')) return Geo.cloneP(e.c);
      const tol = App.worldTol ? App.worldTol(20) : 0;
      let best = null, bestD = tol;
      App.model.entities.forEach(function (ent) {
        if (ent.type !== 'circle' && ent.type !== 'arc') return;
        const d = Geo.dist(p, ent.c);
        if (d < bestD) { bestD = d; best = Geo.cloneP(ent.c); }
      });
      return best;
    },
    onTap: function (p) {
      const c = this._centerAt(p);
      addEntities([{ type: 'point', p: c || Geo.cloneP(p) }]);
      App.toast(c ? '已捕捉圆心并生成点' : '已放置点');
      App.refresh();
    },
    onRender: function (ctx, R) {
      if (!this.hover) return;
      const c = this._centerAt(this.hover);
      if (c) R.previewMarker(c, '圆心');
    },
    applyParams: function () {
      const x = Number(App.params.x), y = Number(App.params.y);
      if (!isFinite(x) || !isFinite(y)) { App.toast('请输入有效的坐标数值'); return; }
      addEntities([{ type: 'point', p: { x: x, y: y } }]);
      App.toast('已生成点 (' + fmt(x) + ', ' + fmt(y) + ')');
      App.updatePrompt();
    }
  });

  /* ================= 绘图：角度线 ================= */
  const angleLineTool = baseTool({
    id: 'angle', name: '角度线', cat: 'draw', icon: '∠', dragType: 'preview',
    prompt: function () {
      return this.points.length ? '点按确认（按输入角度/长度生成）' : '点按起点';
    },
    params: function () {
      return [
        { key: 'ang', label: '角度°', def: 45 },
        { key: 'len', label: '长度', def: 100 }
      ];
    },
    onTap: function (p) {
      if (!this.points.length) {
        this.points.push(Geo.cloneP(p));
        App.updatePrompt();
        return;
      }
      this._create();
    },
    _create: function () {
      const p0 = this.points[0];
      const L = Number(App.params.len) || 0;
      const a = Geo.rad(Number(App.params.ang) || 0);
      if (L <= 0) { App.toast('长度需大于 0'); return; }
      addEntities([{ type: 'line', p1: Geo.cloneP(p0), p2: { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L } }]);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      if (this.points.length !== 1) { App.toast('请先点按起点'); return; }
      this._create();
    },
    onRender: function (ctx, R) {
      if (this.points.length !== 1) return;
      const p0 = this.points[0];
      const L = Number(App.params.len) || 100;
      const a = Geo.rad(Number(App.params.ang) || 0);
      const p1 = { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L };
      R.previewLine(p0, p1);
      R.previewLabel((Number(App.params.ang) || 0) + '°', Geo.polar(p0, L * 0.6, a));
    }
  });

  /* ================= 绘图：平行线 ================= */
  const parallelTool = baseTool({
    id: 'parallel', name: '平行线', cat: 'draw', icon: '∥', dragType: 'preview',
    prompt: function () {
      if (!this.refId) return '点按一条参考直线';
      if (App.params.pside === 'both') return '可点按任意一侧或“确定”，双侧各生成一条平行线';
      return '点按基准线任意一侧生成，或输入偏移距离后确定';
    },
    params: function () {
      return [
        { key: 'poff', label: '偏移距离', def: 20, group: '偏移', positive: true },
        {
          key: 'pside', type: 'choice', label: '位置', def: 'left', group: '生成位置',
          options: [{ v: 'left', label: '左侧' }, { v: 'right', label: '右侧' }, { v: 'both', label: '双侧' }]
        }
      ];
    },
    activate: function () {
      this.reset();
      this.refId = null;
    },
    reset: function () {
      this.points = [];
      this.refId = null;
      this.hover = null;
    },
    _sides: function () {
      const s = App.params.pside || 'left';
      if (s === 'both') return [1, -1];
      return [s === 'right' ? -1 : 1];
    },
    onTap: function (p) {
      if (!this.refId) {
        const e = App.pick(p);
        if (!e || e.type !== 'line') { App.toast('请拾取一条直线'); return; }
        this.refId = e.id;
        App.model.selected.clear();
        App.model.selected.add(e.id);
        App.afterSelectionChange();
        App.updatePrompt();
        return;
      }
      const ref = App.model.findById(this.refId);
      if (!ref) { this.reset(); return; }
      const dist = Number(App.params.poff);
      const outs = [];
      if (App.params.pside === 'both') {
        if (!(dist > 0)) { App.toast('偏移距离需大于 0'); return; }
        this._sides().forEach(function (s) {
          const off = Geo.offsetEntity(ref, s * dist);
          if (off && !existsIn(outs, off)) outs.push(off);
        });
      } else {
        // 单侧：按点按位置所在侧生成（保持原有操作习惯）
        const n = this._normal(ref);
        const d = (p.x - ref.p1.x) * n.x + (p.y - ref.p1.y) * n.y;
        if (Math.abs(d) < (App.worldTol ? App.worldTol(6) : 1e-9)) {
          App.toast('请在基准线两侧点按'); return;
        }
        outs.push(Geo.offsetEntity(ref, d));
      }
      if (!outs.length) { App.toast('偏移失败'); return; }
      addEntities(outs);
      this.reset();
      App.updatePrompt();
      App.toast(App.params.pside === 'both' ? '已在基准线两侧各生成一条平行线' : '已生成平行线');
    },
    _normal: function (line) {
      const dx = line.p2.x - line.p1.x, dy = line.p2.y - line.p1.y;
      const L = Math.hypot(dx, dy) || 1;
      return { x: -dy / L, y: dx / L };
    },
    applyParams: function () {
      if (!this.refId) { App.toast('请先拾取一条参考直线'); return; }
      const ref = App.model.findById(this.refId);
      if (!ref) { this.reset(); App.toast('参考直线已不存在'); return; }
      const dist = Number(App.params.poff);
      if (!(dist > 0)) { App.toast('偏移距离需大于 0'); return; }
      const outs = [];
      this._sides().forEach(function (s) {
        const off = Geo.offsetEntity(ref, s * dist);
        if (off && !existsIn(outs, off)) outs.push(off);
      });
      if (!outs.length) { App.toast('偏移失败'); return; }
      addEntities(outs);
      this.reset();
      App.updatePrompt();
      App.toast(outs.length > 1
        ? '已在基准线两侧生成平行线，距离 ' + fmt(dist)
        : '已生成平行线，距离 ' + fmt(dist));
    },
    onRender: function (ctx, R) {
      if (!this.refId) return;
      const ref = App.model.findById(this.refId);
      if (!ref) return;
      const dist = Number(App.params.poff);
      if (App.params.pside === 'both') {
        if (!(dist > 0)) return;
        this._sides().forEach(function (s) {
          const off = Geo.offsetEntity(ref, s * dist);
          if (off) R.ghostEntity(off);
        });
        return;
      }
      if (!this.hover) {
        if (!(dist > 0)) return;
        const off = Geo.offsetEntity(ref, this._sides()[0] * dist);
        if (off) R.ghostEntity(off);
        return;
      }
      const n = this._normal(ref);
      const d = (this.hover.x - ref.p1.x) * n.x + (this.hover.y - ref.p1.y) * n.y;
      const off = Geo.offsetEntity(ref, d);
      if (off) R.ghostEntity(off);
    }
  });

  /* ================= 绘图：等距线（偏移） ================= */
  const offsetTool = baseTool({
    id: 'offset', name: '等距线', cat: 'draw', icon: '⇉', dragType: 'preview',
    prompt: function () {
      const n = App.model.selected.size;
      if (this.refId) return '点按偏移侧快速生成，或输入距离/方向后确定';
      return n ? '已选 ' + n + ' 个，输入距离与方向后确定' : '点按要偏移的图形（可先用选择工具多选）';
    },
    params: function () {
      return [
        { key: 'dist', label: '距离', def: 10, group: '偏移距离', positive: true },
        { key: 'oside', type: 'choice', label: '位置', def: 'both', group: '生成位置', options: [
          { v: 'left', label: '左侧' }, { v: 'right', label: '右侧' }, { v: 'both', label: '双侧' }
        ] }
      ];
    },
    _signs: function () {
      const s = App.params.oside || 'left';
      if (s === 'both') return [1, -1];
      return [s === 'right' ? -1 : 1];
    },
    _targets: function () {
      let list = App.model.selectedEntities ? App.model.selectedEntities() : [];
      const seen = {};
      list = list.filter(function (e) {
        if (e.type === 'point' || seen[e.id]) return false;
        seen[e.id] = true;
        return true;
      });
      if (!list.length && this.refId) {
        const r = App.model.findById(this.refId);
        if (r && r.type !== 'point') list = [r];
      }
      return list;
    },
    applyParams: function () {
      const dist = Number(App.params.dist);
      if (!(dist > 0)) { App.toast('偏移距离需大于 0'); return; }
      const targets = this._targets();
      if (!targets.length) { App.toast('请先选中要偏移的图形'); return; }
      const signs = this._signs();
      const res = offsetTargets(targets, dist, signs);
      const outs = [];
      let dup = 0;
      res.outs.forEach(function (off) {
        // 与已有图形或本批结果完全重合时跳过，避免重复/多余线条
        if (existsIn(App.model.entities, off) || existsIn(outs, off)) { dup++; return; }
        outs.push(off);
      });
      const skipped = res.skipped;
      if (!outs.length) {
        App.toast(dup ? '等距线已存在，未重复生成' : '偏移后半径无效，请减小距离');
        return;
      }
      addEntities(outs);
      // 结果不参与选中，避免预览再次偏移结果而出现多余虚线
      App.model.selected.clear();
      this.refId = null;
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已生成 ' + outs.length + ' 条等距线' +
        (skipped ? '，' + skipped + ' 条因半径无效跳过' : '') +
        (dup ? '，' + dup + ' 条重合已跳过' : ''));
    },
    activate: function () {
      this.reset();
      this.refId = null;
    },
    reset: function () {
      this.points = [];
      this.refId = null;
      this.hover = null;
    },
    onTap: function (p) {
      const e = App.pick(p);
      if (!this.refId) {
        if (!e) { App.toast('请拾取直线、圆或圆弧'); return; }
        if (e.type === 'point') { App.toast('点不支持偏移'); return; }
        this.refId = e.id;
        App.model.selected.clear();
        App.model.selected.add(e.id);
        App.afterSelectionChange();
        App.updatePrompt();
        return;
      }
      const ref = App.model.findById(this.refId);
      if (!ref) { this.reset(); return; }
      const d = this._signedDist(ref, p);
      const dist = Number(App.params.dist);
      if (!(dist > 0)) { App.toast('距离需大于 0'); return; }
      const off = Geo.offsetEntity(ref, d >= 0 ? dist : -dist);
      if (!off) { App.toast('偏移后半径无效'); return; }
      if (existsIn(App.model.entities, off)) {
        App.toast('该位置已存在等距线');
        this.refId = null;
        App.model.selected.clear();
        App.afterSelectionChange();
        App.updatePrompt();
        return;
      }
      addEntities([off]);
      this.refId = null;
      App.model.selected.clear();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已生成等距线');
    },
    _signedDist: function (ent, p) {
      if (ent.type === 'line') {
        const dx = ent.p2.x - ent.p1.x, dy = ent.p2.y - ent.p1.y;
        const L = Math.hypot(dx, dy) || 1;
        return ((p.x - ent.p1.x) * (-dy / L) + (p.y - ent.p1.y) * (dx / L));
      }
      return Geo.dist(p, ent.c) - ent.r;
    },
    onRender: function (ctx, R) {
      const dist = Number(App.params.dist);
      if (!(dist > 0)) return;
      const targets = this._targets();
      if (!targets.length) return;
      const res = offsetTargets(targets, dist, this._signs());
      res.outs.forEach(function (off) { R.ghostEntity(off); });
    }
  });

  /* ================= 编辑：裁剪 ================= */
  const trimTool = baseTool({
    id: 'trim', name: '裁剪', cat: 'edit', icon: '✂', dragType: 'pan',
    prompt: '点按要删除的线段部分（需与其他图形相交）',
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('未拾取到图形'); return; }
      const others = App.model.entities.filter(function (o) { return o.id !== e.id; });
      const result = Geo.trimEntity(e, p, others);
      if (!result || !result.length) { App.toast('该图形没有可裁剪的相交点'); return; }
      App.begin();
      App.model.remove(e.id);
      result.forEach(function (n) { App.model.add(n); });
      App.end();
      App.toast('已裁剪');
    }
  });

  /* ================= 编辑：圆弧过渡（倒圆角） ================= */
  const filletTool = baseTool({
    id: 'fillet', name: '圆弧过渡', cat: 'edit', icon: '◠', dragType: 'pan',
    prompt: function () {
      if (!this.l1Id) return '点按第一条直线或圆弧（或选中两个图形后确定）';
      if (!this.l2Id) return '点按第二条直线或圆弧（相交或相邻）';
      return '修改半径与裁剪选项后点“确定”生成过渡圆弧';
    },
    params: function () {
      return [
        { key: 'fr', label: '半径', def: 10, group: '过渡圆弧', positive: true },
        { key: 'trim', type: 'toggle', label: '裁剪', def: true, group: '过渡圆弧' }
      ];
    },
    activate: function () { this.reset(); },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.l1Id = null;
      this.l2Id = null;
      this.pick1 = null;
      this.pick2 = null;
    },
    onTap: function (p) {
      const e = App.pick(p);
      const okType = e && (e.type === 'line' || e.type === 'circle' || e.type === 'arc');
      if (!okType) { App.toast('请拾取直线或圆弧'); return; }
      if (!this.l1Id) {
        this.l1Id = e.id;
        this.pick1 = Geo.cloneP(p);
        App.model.selected.clear();
        App.model.selected.add(e.id);
        App.afterSelectionChange();
        App.updatePrompt();
        return;
      }
      if (e.id === this.l1Id) { App.toast('请选择另一个图形'); return; }
      this.l2Id = e.id;
      this.pick2 = Geo.cloneP(p);
      App.model.selected.add(e.id);
      App.afterSelectionChange();
      this._apply();
    },
    applyParams: function () {
      if (!this.l1Id || !this.l2Id) {
        const sel = App.model.selectedEntities ? App.model.selectedEntities() : [];
        const ok = function (e) { return e.type === 'line' || e.type === 'circle' || e.type === 'arc'; };
        if (sel.length === 2 && ok(sel[0]) && ok(sel[1])) {
          this.l1Id = sel[0].id; this.l2Id = sel[1].id;
          this.pick1 = Geo.entityMidpoint(sel[0]);
          this.pick2 = Geo.entityMidpoint(sel[1]);
        } else {
          App.toast('请先点按或选中两个直线/圆弧图形');
          return;
        }
      }
      this._apply();
    },
    _apply: function () {
      const l1 = App.model.findById(this.l1Id);
      const l2 = App.model.findById(this.l2Id);
      if (!l1 || !l2) { this.reset(); App.toast('图形已不存在'); return; }
      const r = Number(App.params.fr);
      if (!(r > 0)) { App.toast('半径需大于 0'); return; }
      const res = Geo.filletCurves(l1, l2, r, this.pick1, this.pick2);
      if (res.error) { App.toast(res.error); return; }
      const doTrim = App.params.trim !== false;
      App.begin();
      if (doTrim) {
        Geo.copyShape(l1, res.ent1);
        Geo.copyShape(l2, res.ent2);
      }
      const arcEnt = App.model.add(res.arc);
      App.model.selected.clear();
      if (arcEnt) App.model.selected.add(arcEnt.id);
      this.reset();
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已生成 R' + fmt(r) + ' 过渡圆弧' + (doTrim ? '' : '（保留原图形）'));
    },
    onRender: function (ctx, R) {
      if (!this.l1Id) return;
      const l1 = App.model.findById(this.l1Id);
      if (!l1) return;
      if (!this.l2Id) {
        R.previewMarker(Geo.entityMidpoint(l1), '参考');
        return;
      }
      const l2 = App.model.findById(this.l2Id);
      const r = Number(App.params.fr);
      if (!l2 || !(r > 0)) return;
      const res = Geo.filletCurves(l1, l2, r, this.pick1, this.pick2);
      if (res.error) return;
      R.ghostEntity(res.arc);
      R.previewMarker(res.tangent1, '切点');
      R.previewMarker(res.tangent2, '切点');
    }
  });

  /* ================= 编辑：拉伸 ================= */
  const stretchTool = baseTool({
    id: 'stretch', name: '拉伸', cat: 'edit', icon: '⇱', dragType: 'tool',
    prompt: '拖动直线端点沿原方向伸缩；拖动圆弧端点调整弧长（圆心固定）',
    onDragStart: function (p) {
      const e = App.pick(p);
      if (!e) return;
      this.entId = e.id;
      this.clone = JSON.parse(JSON.stringify(e));
      this.mode = 'vertex';
      if (e.type === 'line') {
        this.mode = Geo.dist(p, e.p1) <= Geo.dist(p, e.p2) ? 'p1' : 'p2';
        const fixed = this.mode === 'p1' ? e.p2 : e.p1;
        const moved = this.mode === 'p1' ? e.p1 : e.p2;
        const L = Geo.dist(fixed, moved);
        this.fixed = Geo.cloneP(fixed);
        this.dir = L < 1e-9 ? { x: 1, y: 0 } : { x: (moved.x - fixed.x) / L, y: (moved.y - fixed.y) / L };
      } else if (e.type === 'arc') {
        this.mode = Geo.dist(p, Geo.arcStart(e)) <= Geo.dist(p, Geo.arcEnd(e)) ? 'a0' : 'a1';
      } else if (e.type === 'circle') {
        this.mode = 'radius';
      } else {
        this.mode = 'move';
      }
      App.begin();
      this.active = true;
    },
    onDragMove: function (p) {
      if (!this.active) return;
      const e = App.model.findById(this.entId);
      if (!e) return;
      if (e.type === 'line') {
        const k = this.mode === 'p1' ? 'p1' : 'p2';
        const proj = (p.x - this.fixed.x) * this.dir.x + (p.y - this.fixed.y) * this.dir.y;
        const len = Math.max(proj, 1e-3);
        e[k].x = this.fixed.x + this.dir.x * len;
        e[k].y = this.fixed.y + this.dir.y * len;
      } else if (e.type === 'circle') {
        e.r = clampRadius(Geo.dist(e.c, p));
      } else if (e.type === 'arc') {
        const ang = Geo.angleOf(e.c, p);
        if (this.mode === 'a1') e.a1 = ang; else e.a0 = ang;
      } else if (e.type === 'point') {
        e.p.x = p.x; e.p.y = p.y;
      }
      App.refresh();
    },
    onDragEnd: function () {
      if (!this.active) return;
      this.active = false;
      App.end();
    },
    onDragCancel: function () {
      if (!this.active) return;
      const e = App.model.findById(this.entId);
      if (e) Geo.copyShape(e, this.clone);
      this.active = false;
      App.abort();
    },
    onRender: function (ctx, R) {
      if (!this.active) return;
      R.previewLabel('拉伸中', this.hover || { x: 0, y: 0 });
    }
  });

  /* ================= 编辑：平移 ================= */
  const moveTool = baseTool({
    id: 'move', name: '平移', cat: 'edit', icon: '↔', dragType: 'tool',
    prompt: function () {
      if (App.params.multi) {
        const n = App.model.selected.size;
        return n ? '已选 ' + n + ' 个，继续点选，输入 X/Y 偏移后确定' : '点按图形连续选择（可多选），输入偏移后确定';
      }
      return '拖动图形平移，或输入 X/Y 偏移后确定';
    },
    params: function () {
      return [
        { key: 'multi', type: 'toggle', label: '连续选择', def: false, group: '选择' },
        { key: 'mx', label: 'X 偏移', def: 0, group: '偏移量' },
        { key: 'my', label: 'Y 偏移', def: 0, group: '偏移量' }
      ];
    },
    onTap: function (p) {
      const e = App.pick(p);
      if (!App.params.multi) {
        if (e && !App.model.selected.size) {
          App.model.selected.add(e.id);
          App.afterSelectionChange();
          App.updatePrompt();
        }
        return;
      }
      const sel = App.model.selected;
      if (!e) { sel.clear(); }
      else if (sel.has(e.id)) { sel.delete(e.id); }
      else { sel.add(e.id); }
      App.afterSelectionChange();
      App.updatePrompt();
    },
    applyParams: function () {
      const dx = Number(App.params.mx), dy = Number(App.params.my);
      if (!isFinite(dx) || !isFinite(dy)) { App.toast('请输入有效的偏移数值'); return; }
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) { App.toast('X/Y 偏移量不能同时为 0'); return; }
      const list = App.model.selectedEntities();
      if (!list.length) { App.toast('请先选中一个或多个图形'); return; }
      App.begin();
      list.forEach(function (e) { Geo.translateEntity(e, dx, dy); });
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已平移 ' + list.length + ' 个图元（ΔX ' + fmt(dx) + '，ΔY ' + fmt(dy) + '）');
    },
    onDragStart: function (p) {
      if (App.params.multi) return;
      if (!App.model.selected.size) {
        const e = App.pick(p);
        if (!e) { this.panning = true; this.last = p; return; }
        App.model.selected.add(e.id);
        App.afterSelectionChange();
      }
      this.clones = App.model.cloneSelected();
      this.origin = Geo.cloneP(p);
      this.last = p;
      App.begin();
      this.active = true;
    },
    onDragMove: function (p) {
      if (this.panning) {
        const dx = (p.x - this.last.x) * App.view.scale;
        const dy = -(p.y - this.last.y) * App.view.scale;
        App.view.pan(dx, dy);
        this.last = p;
        App.refresh();
        return;
      }
      if (!this.active) return;
      const dx = p.x - this.origin.x, dy = p.y - this.origin.y;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (!e) return;
        Geo.copyShape(e, c);
        Geo.translateEntity(e, dx, dy);
      });
      App.refresh();
    },
    onDragEnd: function () {
      if (this.panning) { this.panning = false; return; }
      if (!this.active) return;
      this.active = false;
      App.end();
    },
    onDragCancel: function () {
      if (this.panning) { this.panning = false; return; }
      if (!this.active) return;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (e) Geo.copyShape(e, c);
      });
      this.active = false;
      App.abort();
      App.refresh();
    }
  });

  /* ================= 编辑：阵列 ================= */
  const arrayTool = baseTool({
    id: 'array', name: '阵列', cat: 'edit', icon: '▦', dragType: 'pan',
    _polar: function () { return App.params.amode === 'polar'; },
    prompt: function () {
      const n = App.model.selected.size;
      if (this._polar()) {
        const base = App.params.pcenter
          ? '输入圆心坐标，或点按画布空白处拾取圆心'
          : '默认绕包围盒中心（可打开自定义圆心）';
        const tail = '，设置数量与总角度后确定';
        return (n ? '已选 ' + n + ' 个，' : '点按图形选择（可多选），') + base + tail;
      }
      const tail = '设置行列与间距后确定';
      return n ? '已选 ' + n + ' 个，' + tail : '点按图形选择（可多选），' + tail;
    },
    params: function () {
      const rect = function (p) { return p.amode !== 'polar'; };
      const polar = function (p) { return p.amode === 'polar'; };
      const custom = function (p) { return p.amode === 'polar' && !!p.pcenter; };
      return [
        {
          key: 'amode', type: 'choice', label: '阵型', def: 'rect', group: '阵列类型',
          options: [{ v: 'rect', label: '矩形' }, { v: 'polar', label: '环形' }]
        },
        { key: 'rows', label: '行数', def: 2, group: '阵列数量', positive: true, when: rect },
        { key: 'cols', label: '列数', def: 3, group: '阵列数量', positive: true, when: rect },
        { key: 'rgap', label: '行距', def: 40, group: '阵列间距', when: rect },
        { key: 'cgap', label: '列距', def: 40, group: '阵列间距', when: rect },
        { key: 'pcount', label: '数量', def: 6, group: '环形数量', positive: true, when: polar },
        { key: 'pangle', label: '总角度°', def: 360, group: '环形角度', when: polar },
        { key: 'pcenter', type: 'toggle', label: '自定义圆心', def: false, group: '环形中心', when: polar },
        { key: 'pcx', label: '圆心 X', def: 0, group: '环形中心', when: custom },
        { key: 'pcy', label: '圆心 Y', def: 0, group: '环形中心', when: custom }
      ];
    },
    onTap: function (p) {
      const e = App.pick(p);
      const sel = App.model.selected;
      if (!e && this._polar() && App.params.pcenter) {
        App.params.pcx = round3(p.x);
        App.params.pcy = round3(p.y);
        if (App.updateParams) App.updateParams();
        App.updatePrompt();
        App.toast('圆心已设为 (' + fmt(p.x) + ', ' + fmt(p.y) + ')');
        return;
      }
      if (!e) sel.clear();
      else if (sel.has(e.id)) sel.delete(e.id);
      else sel.add(e.id);
      App.afterSelectionChange();
      App.updatePrompt();
    },
    _plan: function () {
      const targets = App.model.selectedEntities();
      if (!targets.length) return { error: '请先选中要阵列的图形' };
      if (this._polar()) {
        const count = Number(App.params.pcount), angle = Number(App.params.pangle);
        if (!isFinite(count) || count < 2) return { error: '环形数量需为不小于 2 的整数' };
        if (Math.abs(count - Math.round(count)) > 1e-9) return { error: '环形数量需为整数' };
        if (!isFinite(angle) || Math.abs(angle) < 1e-6) return { error: '总角度不能为 0' };
        if ((Math.round(count) - 1) * targets.length > 400) {
          return { error: '阵列数量过多（上限 400 个副本）' };
        }
        let center = null;
        if (App.params.pcenter) {
          const cxRaw = App.params.pcx, cyRaw = App.params.pcy;
          const cx = Number(cxRaw), cy = Number(cyRaw);
          if (cxRaw === '' || cyRaw === '' || cxRaw == null || cyRaw == null ||
            !isFinite(cx) || !isFinite(cy)) {
            return { error: '圆心坐标需为有效数值' };
          }
          center = { x: cx, y: cy };
        }
        return { mode: 'polar', count: Math.round(count), angle: angle, center: center, targets: targets };
      }
      const rows = Number(App.params.rows), cols = Number(App.params.cols);
      const rgap = Number(App.params.rgap), cgap = Number(App.params.cgap);
      if (!isFinite(rows) || !isFinite(cols) || rows < 1 || cols < 1) {
        return { error: '行列数需为不小于 1 的整数' };
      }
      if (Math.abs(rows - Math.round(rows)) > 1e-9 || Math.abs(cols - Math.round(cols)) > 1e-9) {
        return { error: '行列数需为整数' };
      }
      if (!isFinite(rgap) || !isFinite(cgap)) return { error: '间距需为有效数值' };
      if (Math.round(rows) === 1 && Math.round(cols) === 1) {
        return { error: '行数与列数不能同时为 1' };
      }
      if (Math.round(rows) * Math.round(cols) * targets.length > 400) {
        return { error: '阵列数量过多（上限 400 个副本）' };
      }
      return {
        mode: 'rect', rows: Math.round(rows), cols: Math.round(cols),
        rgap: rgap, cgap: cgap, targets: targets
      };
    },
    _copies: function (plan) {
      const outs = [];
      if (plan.mode === 'polar') {
        if (!plan.center) {
          const box = Geo.bboxOf(plan.targets);
          plan.center = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
        }
        const full = Math.abs(plan.angle) >= 360;
        const total = full ? (plan.angle < 0 ? -360 : 360) : plan.angle;
        const step = total / (full ? plan.count : plan.count - 1);
        plan.targets.forEach(function (t) {
          for (let i = 1; i < plan.count; i++) {
            const c = JSON.parse(JSON.stringify(t));
            delete c.id;
            Geo.rotateEntity(c, plan.center, Geo.rad(step * i));
            outs.push(c);
          }
        });
        return outs;
      }
      plan.targets.forEach(function (t) {
        for (let i = 0; i < plan.rows; i++) {
          for (let j = 0; j < plan.cols; j++) {
            if (i === 0 && j === 0) continue;
            const c = JSON.parse(JSON.stringify(t));
            delete c.id;
            Geo.translateEntity(c, j * plan.cgap, i * plan.rgap);
            outs.push(c);
          }
        }
      });
      return outs;
    },
    applyParams: function () {
      const plan = this._plan();
      if (plan.error) { App.toast(plan.error); return; }
      const outs = this._copies(plan);
      addEntities(outs);
      App.model.selected.clear();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast(plan.mode === 'polar'
        ? '已生成 ' + outs.length + ' 个环形阵列副本（数量 ' + plan.count + '，总角度 ' + fmt(plan.angle) + '°）'
        : '已生成 ' + outs.length + ' 个阵列副本（' + plan.rows + ' 行 × ' + plan.cols + ' 列）');
    },
    onRender: function (ctx, R) {
      if (!App.model.selected.size) return;
      const plan = this._plan();
      if (plan.error) return;
      this._copies(plan).forEach(function (c) { R.ghostEntity(c); });
    }
  });

  /* ================= 编辑：镜像 ================= */
  const mirrorTool = baseTool({
    id: 'mirror', name: '镜像', cat: 'edit', icon: '⇋', dragType: 'pan',
    prompt: function () {
      const n = App.model.selected.size;
      if (App.params.axisPick === false) {
        return n ? '已选 ' + n + ' 个：关闭“点按轴线”时可继续点选图形，打开后点按直线即完成镜像'
          : '点按选择要镜像的图形（可多选）';
      }
      if (!n) return '点按选择要镜像的图形（可多选），再点按一条直线作为镜像轴';
      return '已选 ' + n + ' 个：点按一条直线作为镜像轴，立即生成镜像';
    },
    params: function () {
      return [
        { key: 'axisPick', type: 'toggle', label: '点按轴线', def: true, group: '镜像轴' },
        { key: 'x1', label: 'X', def: 0, group: '轴起点' },
        { key: 'y1', label: 'Y', def: 0, group: '轴起点' },
        { key: 'x2', label: 'X', def: 0, group: '轴终点' },
        { key: 'y2', label: 'Y', def: 100, group: '轴终点' }
      ];
    },
    activate: function () { this.reset(); },
    reset: function () {
      this.hover = null;
    },
    onTap: function (p) {
      const e = App.pick(p);
      const sel = App.model.selected;
      if (!e) {
        if (!sel.size) App.toast('请先选择要镜像的图形');
        return;
      }
      // 已选图形后点按直线：直接完成镜像
      if (sel.size && App.params.axisPick !== false && e.type === 'line') {
        this._mirrorAbout(e.p1, e.p2);
        return;
      }
      if (sel.has(e.id)) sel.delete(e.id);
      else sel.add(e.id);
      App.afterSelectionChange();
      App.updatePrompt();
    },
    _axis: function () {
      const x1 = Number(App.params.x1), y1 = Number(App.params.y1);
      const x2 = Number(App.params.x2), y2 = Number(App.params.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return null;
      return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    },
    _mirrorAbout: function (a, b) {
      if (!App.model.selected.size) { App.toast('请先选中要镜像的图形'); return; }
      if (Geo.dist(a, b) < 1e-6) { App.toast('镜像轴两点不能重合'); return; }
      const outs = this._copies(a, b);
      if (!outs.length) { App.toast('镜像结果与已有图形重合，未生成副本'); return; }
      addEntities(outs);
      App.model.selected.clear();
      App.afterSelectionChange();
      this.reset();
      App.updatePrompt();
      App.toast('已生成 ' + outs.length + ' 个镜像副本');
    },
    _copies: function (a, b) {
      const outs = [];
      App.model.selectedEntities().forEach(function (t) {
        const src = JSON.parse(JSON.stringify(t));
        delete src.id;
        const c = Geo.mirrorEntity(src, a, b);
        if (!c) return;
        // 跳过与已有图形或本批结果完全重合的副本
        if (existsIn(App.model.entities, c) || existsIn(outs, c)) return;
        outs.push(c);
      });
      return outs;
    },
    applyParams: function () {
      const axis = this._axis();
      if (!axis) { App.toast('请输入有效的镜像轴端点坐标'); return; }
      this._mirrorAbout(axis[0], axis[1]);
    },
    onRender: function (ctx, R) {
      if (!App.model.selected.size) return;
      let axis = null;
      if (this.hover) {
        const h = App.pick(this.hover);
        if (h && h.type === 'line' && App.params.axisPick !== false) {
          axis = [h.p1, h.p2];
          R.previewMarker(Geo.entityMidpoint(h), '镜像轴');
        }
      }
      if (!axis) axis = this._axis();
      if (!axis || Geo.dist(axis[0], axis[1]) < 1e-6) return;
      R.previewLine(axis[0], axis[1]);
      this._copies(axis[0], axis[1]).forEach(function (c) { R.ghostEntity(c); });
    }
  });

  /* ================= 编辑：旋转 ================= */
  const rotateTool = baseTool({
    id: 'rotate', name: '旋转', cat: 'edit', icon: '⟳', dragType: 'tool',
    prompt: function () {
      return this.base ? '绕基点拖动旋转（或输入角度点确定）' : '点按旋转基点';
    },
    params: function () { return [{ key: 'rot', label: '角度°', def: 90 }]; },
    activate: function () { this.reset(); },
    reset: function () {
      this.points = [];
      this.base = null;
      this.active = false;
    },
    onTap: function (p) {
      if (!App.model.selected.size) {
        const e = App.pick(p);
        if (!e) { App.toast('请先选择要旋转的图形'); return; }
        App.model.selected.add(e.id);
        App.afterSelectionChange();
      }
      this.base = Geo.cloneP(p);
      App.updatePrompt();
      App.refresh();
    },
    onDragStart: function (p) {
      if (!this.base) return;
      this.clones = App.model.cloneSelected();
      this.startAngle = Geo.angleOf(this.base, p);
      App.begin();
      this.active = true;
    },
    onDragMove: function (p) {
      if (!this.active) return;
      const ang = Geo.angleOf(this.base, p) - this.startAngle;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (!e) return;
        Geo.copyShape(e, c);
        Geo.rotateEntity(e, Geo.cloneP(this.base), ang);
      }, this);
      App.refresh();
    },
    onDragEnd: function () {
      if (!this.active) return;
      this.active = false;
      App.end();
    },
    onDragCancel: function () {
      if (!this.active) return;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (e) Geo.copyShape(e, c);
      });
      this.active = false;
      App.abort();
      App.refresh();
    },
    applyParams: function () {
      if (!this.base) { App.toast('请先点按旋转基点'); return; }
      if (!App.model.selected.size) { App.toast('请先选择图形'); return; }
      const a = Geo.rad(Number(App.params.rot) || 0);
      App.begin();
      App.model.selectedEntities().forEach(function (e) {
        Geo.rotateEntity(e, Geo.cloneP(this.base), a);
      }, this);
      App.end();
      App.toast('已旋转 ' + fmt(Number(App.params.rot) || 0) + '°');
    },
    onRender: function (ctx, R) {
      if (!this.base) return;
      R.previewMarker(this.base, '基点');
      if (this.hover) {
        R.previewLine(this.base, this.hover);
        R.previewLabel(degFmt(Geo.angleOf(this.base, this.hover)), this.hover);
      }
    }
  });

  /* ================= 编辑：链拾取 ================= */
  const chainTool = baseTool({
    id: 'chain', name: '链拾取', cat: 'edit', icon: '⛓', dragType: 'pan',
    prompt: '点按任意图形，自动选中连续相连的整条链',
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('未拾取到图形'); return; }
      const tol = App.worldTol(6);
      const set = App.model.chain(e, tol);
      App.model.selected = set;
      App.afterSelectionChange();
      let total = 0;
      set.forEach(function (id) {
        const ent = App.model.findById(id);
        if (ent) total += Geo.entityLength(ent);
      });
      App.showInfo('链拾取结果',
        '<div class="big">' + set.size + ' 个图元</div>' +
        '<div class="row"><span class="k">总长度</span><span class="v">' + fmt(total) + '</span></div>' +
        '<div class="hint">已自动识别端点相连的连续图形，可切换“平移/旋转/删除”继续操作。</div>');
    }
  });

  /* ================= 查询：长度 ================= */
  const measureLengthTool = baseTool({
    id: 'mlen', name: '长度', cat: 'query', icon: 'L', dragType: 'pan',
    prompt: '点按图形测量长度、半径或弧长',
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('未拾取到图形'); return; }
      App.model.selected.clear();
      App.model.selected.add(e.id);
      App.afterSelectionChange();
      let html = '';
      let label = '';
      if (e.type === 'line') {
        const L = Geo.dist(e.p1, e.p2);
        label = fmt(L);
        html = '<div class="big">' + fmt(L) + '</div>' +
          '<div class="row"><span class="k">水平差 ΔX</span><span class="v">' + fmt(Math.abs(e.p2.x - e.p1.x)) + '</span></div>' +
          '<div class="row"><span class="k">垂直差 ΔY</span><span class="v">' + fmt(Math.abs(e.p2.y - e.p1.y)) + '</span></div>' +
          '<div class="row"><span class="k">倾角</span><span class="v">' + degFmt(Geo.lineAngle(e)) + '</span></div>';
        App.setOverlay({ type: 'length', at: Geo.entityMidpoint(e), text: 'L=' + fmt(L) });
      } else if (e.type === 'circle') {
        html = '<div class="big">' + fmt(e.r * 2) + '</div>' +
          '<div class="row"><span class="k">半径 R</span><span class="v">' + fmt(e.r) + '</span></div>' +
          '<div class="row"><span class="k">直径 D</span><span class="v">' + fmt(e.r * 2) + '</span></div>' +
          '<div class="row"><span class="k">周长 C</span><span class="v">' + fmt(Geo.TAU * e.r) + '</span></div>';
        App.setOverlay({ type: 'length', at: Geo.entityMidpoint(e), text: 'R=' + fmt(e.r) });
      } else if (e.type === 'arc') {
        const sw = Geo.arcSweep(e);
        html = '<div class="big">' + fmt(sw * e.r) + '</div>' +
          '<div class="row"><span class="k">半径 R</span><span class="v">' + fmt(e.r) + '</span></div>' +
          '<div class="row"><span class="k">圆心角</span><span class="v">' + fmt(Geo.deg(sw)) + '°</span></div>' +
          '<div class="row"><span class="k">弧长</span><span class="v">' + fmt(sw * e.r) + '</span></div>';
        App.setOverlay({ type: 'length', at: Geo.entityMidpoint(e), text: '弧长=' + fmt(sw * e.r) });
      } else {
        const info = App.entityInfo(e);
        html = '<div class="big">点</div>' + info;
        label = '点';
      }
      App.showInfo('长度测量', html, e.type === 'line' ? '长度' : (e.type === 'arc' ? '弧长' : (e.type === 'circle' ? '直径' : '点')));
      App.refresh();
    }
  });

  /* ================= 查询：角度 ================= */
  const measureAngleTool = baseTool({
    id: 'mangle', name: '角度', cat: 'query', icon: '∠', dragType: 'pan',
    prompt: function () {
      return this.firstId ? '再点按第二条直线' : '点按第一条直线';
    },
    activate: function () { this.reset(); },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.firstId = null;
    },
    onTap: function (p) {
      const e = App.pick(p);
      if (!e || e.type !== 'line') { App.toast('请拾取一条直线'); return; }
      if (!this.firstId) {
        this.firstId = e.id;
        App.model.selected.clear();
        App.model.selected.add(e.id);
        App.afterSelectionChange();
        App.updatePrompt();
        App.refresh();
        return;
      }
      const l1 = App.model.findById(this.firstId);
      if (!l1) { this.reset(); return; }
      App.model.selected.clear();
      App.model.selected.add(l1.id);
      App.model.selected.add(e.id);
      App.afterSelectionChange();
      const ang = Geo.angleBetweenLines(l1, e);
      let extra = '';
      const ip = Geo.lineLineIntersect(l1.p1, l1.p2, e.p1, e.p2);
      if (ip.length) extra = '<div class="row"><span class="k">交点</span><span class="v">(' + fmt(ip[0].x) + ', ' + fmt(ip[0].y) + ')</span></div>';
      App.showInfo('角度测量',
        '<div class="big">' + fmt(ang) + '°</div>' +
        '<div class="row"><span class="k">夹角（锐角）</span><span class="v">' + fmt(ang) + '°</span></div>' +
        '<div class="row"><span class="k">补角</span><span class="v">' + fmt(180 - ang) + '°</span></div>' + extra,
        '夹角');
      this.reset();
      App.updatePrompt();
      App.refresh();
    }
  });

  /* ================= 查询：距离 ================= */
  const measureDistTool = baseTool({
    id: 'mdist', name: '距离', cat: 'query', icon: '↔', dragType: 'pan',
    prompt: function () {
      return this.points.length ? '点按第二点' : '点按第一点';
    },
    onTap: function (p) {
      if (!this.points.length) {
        this.points.push(Geo.cloneP(p));
        App.updatePrompt();
        return;
      }
      const a = this.points[0], b = p;
      const d = Geo.dist(a, b);
      App.setOverlay({ type: 'dim', a: a, b: b, text: fmt(d) });
      App.showInfo('距离测量',
        '<div class="big">' + fmt(d) + '</div>' +
        '<div class="row"><span class="k">ΔX</span><span class="v">' + fmt(b.x - a.x) + '</span></div>' +
        '<div class="row"><span class="k">ΔY</span><span class="v">' + fmt(b.y - a.y) + '</span></div>' +
        '<div class="row"><span class="k">方位角</span><span class="v">' + fmt(Geo.deg(Geo.normAngle(Geo.angleOf(a, b)))) + '°</span></div>' +
        '<div class="row"><span class="k">起点</span><span class="v">(' + fmt(a.x) + ', ' + fmt(a.y) + ')</span></div>' +
        '<div class="row"><span class="k">终点</span><span class="v">(' + fmt(b.x) + ', ' + fmt(b.y) + ')</span></div>',
        '距离');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    onRender: function (ctx, R) {
      if (!this.points.length) return;
      R.previewMarker(this.points[0], 'A');
      if (this.hover) {
        R.previewLine(this.points[0], this.hover);
        R.previewLabel(fmt(Geo.dist(this.points[0], this.hover)), this.hover);
      }
    }
  });

  /* ================= 查询：坐标点集合 ================= */
  const measureCoordTool = baseTool({
    id: 'mcoord', name: '坐标点', cat: 'query', icon: '⌗', dragType: 'pan',
    prompt: function () {
      return this.collected.length
        ? '继续点选特征点（已收集 ' + this.collected.length + ' 个）'
        : '点按端点 / 中点 / 交点 / 圆心等特征点';
    },
    activate: function () { this.collected = []; this.hover = null; this._cache = null; },
    reset: function () { this.collected = []; this.hover = null; this._cache = null; },
    _candidates: function () {
      const out = [];
      function push(p, type) {
        for (let i = 0; i < out.length; i++) if (Geo.dist(out[i].p, p) < 1e-7) return;
        out.push({ p: { x: p.x, y: p.y }, type: type });
      }
      App.model.entities.forEach(function (e) {
        if (e.type === 'line') {
          push(e.p1, '端点'); push(e.p2, '端点');
          push(Geo.lerp(e.p1, e.p2, 0.5), '中点');
        } else if (e.type === 'circle') {
          push(e.c, '圆心');
          for (let i = 0; i < 4; i++) push(Geo.polar(e.c, e.r, i * Math.PI / 2), '象限点');
        } else if (e.type === 'arc') {
          push(e.c, '圆心');
          push(Geo.arcStart(e), '端点');
          push(Geo.arcEnd(e), '端点');
          push(Geo.entityMidpoint(e), '中点');
        } else if (e.type === 'point') {
          push(e.p, '点');
        }
      });
      const list = App.model.entities;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          Geo.intersections(list[i], list[j]).forEach(function (p) { push(p, '交点'); });
        }
      }
      return out;
    },
    _all: function () {
      if (!this._cache || this._cacheN !== App.model.entities.length) {
        this._cache = this._candidates();
        this._cacheN = App.model.entities.length;
      }
      return this._cache;
    },
    _nearest: function (p) {
      const tol = App.worldTol(14);
      let best = null, bestD = tol;
      this._all().forEach(function (c) {
        const d = Geo.dist(p, c.p);
        if (d < bestD) { bestD = d; best = c; }
      });
      return best;
    },
    onTap: function (p) {
      const hit = this._nearest(p);
      if (!hit) { App.toast('未找到特征点，请靠近端点/中点/交点/圆心'); return; }
      const dupTol = App.worldTol(6);
      for (let i = 0; i < this.collected.length; i++) {
        if (Geo.dist(this.collected[i].p, hit.p) < dupTol) {
          App.toast('该坐标点已收集'); return;
        }
      }
      this.collected.push(hit);
      this._render();
      App.updatePrompt();
      App.toast('已收集第 ' + this.collected.length + ' 个坐标点');
    },
    _render: function () {
      let html = '<div class="big">' + this.collected.length + ' 个坐标点</div>';
      this.collected.forEach(function (c, i) {
        html += '<div class="row"><span class="k">P' + (i + 1) + ' · ' + c.type + '</span>' +
          '<span class="v">(' + fmt(c.p.x) + ', ' + fmt(c.p.y) + ')</span></div>';
      });
      html += '<div class="hint">继续点选可追加坐标；再次点按“坐标点”工具可清空重选。</div>';
      App.showInfo('坐标点集合', html);
    },
    onRender: function (ctx, R) {
      this.collected.forEach(function (c, i) {
        R.previewMarker(c.p, 'P' + (i + 1));
      });
    }
  });

  /* ================= 查询：属性 ================= */
  const propsTool = baseTool({
    id: 'props', name: '属性', cat: 'query', icon: 'ℹ', dragType: 'pan',
    prompt: '点按图形查看并编辑属性',
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('未拾取到图形'); return; }
      App.model.selected.clear();
      App.model.selected.add(e.id);
      App.afterSelectionChange();
      if (App.showProps) App.showProps(e);
      else App.showInfo('图形属性', App.entityInfo(e, true), '属性');
      App.refresh();
    }
  });

  /* ================= 视图：平移 ================= */
  const panTool = baseTool({
    id: 'pan', name: '平移视图', cat: 'view', icon: '✥', dragType: 'tool',
    prompt: '单指拖动平移视图',
    onDragStart: function (p) { this.last = p; this.active = true; },
    onDragMove: function (p) {
      if (!this.active) return;
      App.view.pan((p.x - this.last.x) * App.view.scale, -(p.y - this.last.y) * App.view.scale);
      this.last = p;
      App.refresh();
    },
    onDragEnd: function () { this.active = false; }
  });

  const list = [
    lineTool, circleTool, arcTool, pointTool, angleLineTool, parallelTool, offsetTool,
    selectTool, deleteTool, trimTool, filletTool, stretchTool, moveTool, arrayTool, mirrorTool, rotateTool, chainTool,
    measureLengthTool, measureAngleTool, measureDistTool, measureCoordTool, propsTool,
    panTool
  ];

  global.CADTools = {
    init: function (app) { App = app; },
    app: function () { return App; },
    list: list,
    byId: function (id) {
      for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    panTool: panTool
  };
})(typeof window !== 'undefined' ? window : globalThis);
