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

  function addEntities(list, after) {
    if (!list || !list.length) return [];
    App.begin();
    list.forEach(function (e) { App.model.add(e); });
    if (typeof after === 'function') after(list);
    App.end();
    return list;
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

  /* ================= 绘图：中心线（点划线） ================= */
  function centerExt() {
    let ext = Number(App.params.cext);
    if (!isFinite(ext) || ext < 0) ext = 0;
    return ext;
  }

  function centerLine(p1, p2) {
    return { type: 'line', p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y }, style: 'center' };
  }

  /** 过圆心的水平 / 垂直十字中心线 */
  function crossCenterlines(e, ext) {
    const h = e.r + ext;
    return [
      centerLine({ x: e.c.x - h, y: e.c.y }, { x: e.c.x + h, y: e.c.y }),
      centerLine({ x: e.c.x, y: e.c.y - h }, { x: e.c.x, y: e.c.y + h })
    ];
  }

  /** 两条直线：平行取等距中线，不平行取角平分线 */
  function centerlineBetween(a, b, ext) {
    const ua = unitOf({ x: a.p2.x - a.p1.x, y: a.p2.y - a.p1.y });
    const ub = unitOf({ x: b.p2.x - b.p1.x, y: b.p2.y - b.p1.y });
    if (!ua || !ub) return { error: '直线长度为零，无法生成中心线' };
    const sin = Math.abs(ua.x * ub.y - ua.y * ub.x);
    if (sin <= 0.01) {
      const n = { x: -ua.y, y: ua.x };
      const dSigned = (b.p1.x - a.p1.x) * n.x + (b.p1.y - a.p1.y) * n.y;
      if (Math.abs(dSigned) < 1e-6) return { error: '两条直线重合，无法生成中心线' };
      const mid = { x: a.p1.x + n.x * dSigned / 2, y: a.p1.y + n.y * dSigned / 2 };
      let lo = Infinity, hi = -Infinity;
      [a.p1, a.p2, b.p1, b.p2].forEach(function (p) {
        const t = (p.x - mid.x) * ua.x + (p.y - mid.y) * ua.y;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      });
      return {
        line: centerLine(
          { x: mid.x + ua.x * (lo - ext), y: mid.y + ua.y * (lo - ext) },
          { x: mid.x + ua.x * (hi + ext), y: mid.y + ua.y * (hi + ext) })
      };
    }
    const ip = Geo.lineIntersectInfinite(a.p1, a.p2, b.p1, b.p2);
    if (!ip) return { error: '两条直线没有交点，无法生成中心线' };
    let u2 = ub;
    if (ua.x * ub.x + ua.y * ub.y < 0) u2 = { x: -ub.x, y: -ub.y };
    const v = unitOf({ x: ua.x + u2.x, y: ua.y + u2.y });
    if (!v) return { error: '无法确定角平分线方向' };
    let reach = 0;
    [a.p1, a.p2, b.p1, b.p2].forEach(function (p) {
      const d = Geo.dist(p, ip);
      if (d > reach) reach = d;
    });
    const L = reach + ext;
    return {
      line: centerLine(
        { x: ip.x - v.x * L, y: ip.y - v.y * L },
        { x: ip.x + v.x * L, y: ip.y + v.y * L })
    };
  }

  const centerTool = baseTool({
    id: 'center', name: '中心线', cat: 'draw', icon: '╌', dragType: 'preview',
    prompt: function () {
      if (this.points.length) return '点按终点完成中心线（起点已确定）';
      if (this.picks.length) return '再点按另一条直线：平行生成等距中心线，不平行生成角平分线（点按空白取消）';
      return '点按圆 / 圆弧生成过圆心的十字中心线；点按两条直线生成等距中线 / 角平分线；点按空白处两点绘制中心线';
    },
    params: function () {
      return [
        { key: 'cext', label: '延伸长度', def: 6, min: 0, group: '中心线' }
      ];
    },
    reset: function () { this.points = []; this.picks = []; this.hover = null; },
    onTap: function (p) {
      if (this.points.length) {
        this._finishManual(p);
        return;
      }
      const e = App.pick(p);
      if (!e) {
        if (this.picks.length) {
          this.reset();
          App.updatePrompt();
          App.toast('已取消中心线选择');
          return;
        }
        const c = this._circleAt(p);
        if (c) { this._makeCross(c); return; }
        this.points = [{ x: p.x, y: p.y }];
        return;
      }
      if (e.type === 'circle' || e.type === 'arc') { this._makeCross(e); return; }
      if (e.type !== 'line') { App.toast('中心线支持直线、圆与圆弧'); return; }
      if (!this.picks.length) {
        this.picks = [e.id];
        App.toast('已选择直线：再点按另一条直线生成中心线');
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks[0] === e.id) { App.toast('请点按另一条直线'); return; }
      const a = App.model.findById(this.picks[0]);
      if (!a) { this.reset(); return; }
      const res = centerlineBetween(a, e, centerExt());
      if (res.error) { App.toast(res.error); return; }
      App.begin();
      App.model.add(res.line);
      App.end();
      this.reset();
      App.updatePrompt();
      App.toast('已生成中心线');
    },
    /** 点按圆内部时也能识别圆形对象 */
    _circleAt: function (p) {
      const tol = App.worldTol(10);
      let best = null;
      App.model.entities.forEach(function (e) {
        if (e.type !== 'circle') return;
        if (Geo.dist(p, e.c) <= e.r + tol && (!best || e.r < best.r)) best = e;
      });
      return best;
    },
    _makeCross: function (e) {
      const lines = crossCenterlines(e, centerExt());
      App.begin();
      lines.forEach(function (l) { App.model.add(l); });
      App.end();
      this.reset();
      App.updatePrompt();
      App.toast('已生成过圆心的水平 / 垂直中心线');
    },
    _finishManual: function (p) {
      const a = this.points[0];
      const b = { x: p.x, y: p.y };
      const u = unitOf({ x: b.x - a.x, y: b.y - a.y });
      if (!u) { App.toast('起点与终点不能重合'); return; }
      const ext = centerExt();
      App.begin();
      App.model.add(centerLine(
        { x: a.x - u.x * ext, y: a.y - u.y * ext },
        { x: b.x + u.x * ext, y: b.y + u.y * ext }));
      App.end();
      this.reset();
      App.updatePrompt();
      App.toast('已生成中心线');
    },
    onRender: function (ctx, R) {
      if (!this.points.length) {
        const self = this;
        this.picks.forEach(function (id) {
          const ent = App.model.findById(id);
          if (ent) R.ghostEntity(ent);
        });
        if (self.picks.length && self.hover) {
          const h = App.pick(self.hover);
          if (h && h.type === 'line' && self.picks.indexOf(h.id) < 0) R.ghostEntity(h);
        }
        return;
      }
      if (!this.hover) return;
      const a = this.points[0];
      const u = unitOf({ x: this.hover.x - a.x, y: this.hover.y - a.y });
      if (!u) return;
      const ext = centerExt();
      R.previewEntity({
        type: 'line',
        p1: { x: a.x - u.x * ext, y: a.y - u.y * ext },
        p2: { x: this.hover.x + u.x * ext, y: this.hover.y + u.y * ext },
        style: 'center'
      });
    }
  });

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
        let base = App.params.coord ? '点按起点，或勾选“坐标输入”后输入起点 / 终点坐标并确定' : '点按起点';
        if (App.params.ortho) base += '（正交：仅水平/垂直）';
        if (App.params.lchain) base += '（连续画线已开启' + (App.params.llink ? '，首尾自动链接' : '') + '）';
        return base;
      }
      if (this.snapMode) return '捕捉：' + this.snapMode + '（F3 或按住 Shift 可临时关闭捕捉）';
      if (!this._snapEnabled()) return '捕捉已关闭（F3 或松开 Shift 恢复）';
      if (this.startArcId && (App.params.lalign === 'normal' || App.params.lalign === 'tangent')) {
        return '沿圆弧' + (App.params.lalign === 'normal' ? '法线' : '切线') +
          '方向拖动确定终点，或输入终点坐标后确定';
      }
      if (App.params.tangent) return '拖动确定切线终点，或输入终点坐标后确定';
      if (App.params.perp) return '沿垂直方向拖动确定终点，或输入终点坐标后确定';
      let base = '点按终点，靠近圆弧自动吸附切点、靠近直线自动吸附垂足';
      if (App.params.ortho) base += '（正交：仅水平/垂直）';
      if (App.params.lchain) base += '（ESC / 右键退出连续画线）';
      if (App.params.lchain && App.params.llink) base += '（首尾自动链接已开启）';
      return base;
    },
    params: function () {
      // 实时校验：终点的绝对 / 增量坐标换算后不得与起点重合，且须为有效数字
      const coordValidate = function (v, p) {
        const x1 = Number(p.x1), y1 = Number(p.y1);
        const a = Number(p.x2), b = Number(p.y2);
        if (!isFinite(x1) || !isFinite(y1) || !isFinite(a) || !isFinite(b)) return '请输入有效数值';
        let ex = p.cmode === 'abs' ? a : x1 + a;
        let ey = p.cmode === 'abs' ? b : y1 + b;
        if (p.ortho) {
          if (Math.abs(ex - x1) >= Math.abs(ey - y1)) ey = y1; else ex = x1;
        }
        return (Math.abs(ex - x1) < 1e-6 && Math.abs(ey - y1) < 1e-6) ? '起点与终点不能重合' : '';
      };
      return [
        { key: 'ortho', type: 'toggle', label: '正交', def: false, group: '模式' },
        { key: 'lchain', type: 'toggle', label: '连续画线', def: false, group: '模式' },
        {
          key: 'llink', type: 'toggle', label: '线首尾自动链接', def: false, group: '模式',
          when: function (p) { return p.lchain === true; }
        },
        {
          key: 'lloop', type: 'toggle', label: '闭环', def: true, group: '模式',
          when: function (p) { return p.lchain === true && p.llink === true; }
        },
        {
          key: 'lalign', type: 'choice', label: '方向吸附', def: 'off', group: '对象约束',
          when: function (p) { return p.larc === true; },
          options: [
            { v: 'off', label: '关闭' }, { v: 'normal', label: '法线' }, { v: 'tangent', label: '切线' }
          ]
        },
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
        { key: 'coord', type: 'toggle', label: '坐标输入', def: false, group: '坐标输入' },
        {
          key: 'cmode', type: 'choice', label: '终点输入', def: 'rel', group: '坐标输入',
          when: function (p) { return p.coord === true; },
          options: [{ v: 'abs', label: '绝对坐标' }, { v: 'rel', label: '增量坐标' }]
        },
        {
          key: 'x1', label: 'X', def: 0, group: '起点',
          when: function (p) { return p.coord === true; }
        },
        {
          key: 'y1', label: 'Y', def: 0, group: '起点',
          when: function (p) { return p.coord === true; }
        },
        {
          key: 'x2', label: App.params.cmode === 'abs' ? 'X' : 'ΔX', def: 100,
          group: App.params.cmode === 'abs' ? '终点（绝对）' : '终点（增量）',
          when: function (p) { return p.coord === true; },
          validate: coordValidate
        },
        {
          key: 'y2', label: App.params.cmode === 'abs' ? 'Y' : 'ΔY', def: 0,
          group: App.params.cmode === 'abs' ? '终点（绝对）' : '终点（增量）',
          when: function (p) { return p.coord === true; },
          validate: coordValidate
        }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.refId = null;
      this.startRef = null;
      this.hoverRef = null;
      this.startArcId = null;
      this.snapMode = null;
      this.snapPt = null;
      this.chainLastId = null;
      this.chainFirstId = null;
      this._coordPreview = false;
      App.params.lref = '';
      App.params.larc = false;
      App.params.tangent = false;
      App.params.perp = false;
      if (App.updateParams) App.updateParams();
    },
    activate: function () {
      // 终点输入默认增量坐标（cmode 在坐标输入开启前是隐藏字段，需在此兜底）
      if (App.params.cmode !== 'abs' && App.params.cmode !== 'rel') App.params.cmode = 'rel';
      this.snapOff = false;
      this.snapHold = false;
      this._bindSnapKeys();
      this.reset();
    },
    deactivate: function () {
      // 退出工具前尝试闭环（用户直接切换到其他工具的场景）
      this._maybeCloseLoop(true);
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
        } else if (e.key === 'Escape') {
          if (!App.params.lchain && !self.points.length) return;
          e.preventDefault();
          self.onRightClick();
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
      this._coordPreview = false;
      if (this.points.length > 1) return;
      this._scanRef(p);
    },
    /** 起点落在圆/圆弧或直线上时，自动提供相切/垂直约束；圆弧上另提供法线/切线吸附 */
    _detectRef: function (p0) {
      let e = App.pick(p0);
      if (!e && this.hover) e = App.pick(this.hover);
      const kind = e && (e.type === 'circle' || e.type === 'arc') ? 'circle'
        : e && e.type === 'line' ? 'line' : '';
      this.startRef = e && kind ? { id: e.id, kind: kind } : null;
      this.hoverRef = null;
      this.startArcId = null;
      if (e && (e.type === 'circle' || e.type === 'arc')) {
        const tol = App.worldTol(12);
        const onCurve = Math.abs(Geo.dist(p0, e.c) - e.r) <= tol &&
          (e.type === 'circle' || Geo.angleOnArc(Geo.angleOf(e.c, p0), e));
        if (onCurve) this.startArcId = e.id;
      }
      const arc = !!this.startArcId;
      if (App.params.larc !== arc) App.params.larc = arc;
      this._applyRef();
      if (App.updateParams) App.updateParams();
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
    /** 起点在圆弧上时的法线 / 切线方向吸附 */
    _alignEnd: function (p0, p) {
      const mode = App.params.lalign;
      if (mode !== 'normal' && mode !== 'tangent') return null;
      const e = this.startArcId ? App.model.findById(this.startArcId) : null;
      if (!e || (e.type !== 'circle' && e.type !== 'arc')) return null;
      const u = unitOf(Geo.sub(p0, e.c));
      if (!u) return null;
      const dir = mode === 'normal' ? u : { x: -u.y, y: u.x };
      const t = (p.x - p0.x) * dir.x + (p.y - p0.y) * dir.y;
      if (Math.abs(t) < 1e-9) return null;
      return { p: { x: p0.x + dir.x * t, y: p0.y + dir.y * t }, mode: mode };
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
    /** 计算终点：对象约束 → 圆弧法线/切线吸附 → 自动切点/垂足捕捉 → 正交 */
    _endPoint: function (p0, p) {
      const c = this._constrain(p0, p);
      if (c && c.error) { this._setSnap(null, null); return c; }
      if (c && c.p) { this._setSnap(null, null); return { p: c.p }; }
      const al = this._alignEnd(p0, p);
      if (al) { this._setSnap(null, null); return { p: al.p, align: al.mode }; }
      const a = this._autoSnap(p0, p);
      if (a) return { p: a };
      return { p: this._snap(p0, p) };
    },
    /** 以 p 作为新的起点（连续画线时复用） */
    _startAt: function (p) {
      this.points = [Geo.cloneP(p)];
      App.params.x1 = round3(p.x);
      App.params.y1 = round3(p.y);
      this.snapMode = null;
      this.snapPt = null;
      this._detectRef(p);
      if (App.updateParams) App.updateParams();
      App.updatePrompt();
    },
    /** 新建直线；连续画线且开启“线首尾自动链接”时，与上一条直线端点建立重合约束 */
    _addLine: function (line) {
      const prevId = (App.params.lchain && App.params.llink) ? this.chainLastId : null;
      const created = addEntities([line], prevId ? function (list) {
        App.model.addConstraint({
          type: 'coincident', ids: [prevId, list[0].id], aIdx: 1, bIdx: 0
        });
      } : null);
      const createdId = created.length ? created[0].id : null;
      this.chainLastId = createdId;
      if (createdId && !this.chainFirstId) this.chainFirstId = createdId;
      return created[0] || null;
    },
    onParamChange: function (key, val) {
      // 编辑坐标类参数时切换到坐标预览（指针移回画布后恢复拖动预览）
      if (key === 'x1' || key === 'y1' || key === 'x2' || key === 'y2' ||
          key === 'cmode' || key === 'coord' || key === 'ortho') {
        this._coordPreview = App.params.coord === true;
      }
      if (key !== 'llink') return;
      App.toast(val
        ? '已开启线首尾自动链接：连续画线时相邻线段端点自动建立重合约束'
        : '已关闭线首尾自动链接');
    },
    onTap: function (p) {
      if (!this.points.length) {
        this._startAt(p);
        return;
      }
      const res = this._endPoint(this.points[0], p);
      if (res.error) { App.toast(res.error); return; }
      const q = res.p;
      if (Geo.dist(q, this.points[0]) < 1e-9) {
        App.toast('请拖动确定终点'); return;
      }
      this._addLine({ type: 'line', p1: Geo.cloneP(this.points[0]), p2: { x: q.x, y: q.y } });
      if (App.params.lchain) {
        this._startAt({ x: q.x, y: q.y });
        App.toast('连续画线：继续点按下一点，ESC / 右键退出');
      } else {
        this.reset();
        App.updatePrompt();
      }
      App.refresh();
    },
    /** 坐标输入换算为绝对起终点；start 传入时以该点作为起点（连续画线自动衔接上一条终点） */
    _coordEnd: function (start) {
      const x1 = start ? start.x : Number(App.params.x1);
      const y1 = start ? start.y : Number(App.params.y1);
      const a = Number(App.params.x2), b = Number(App.params.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(a) || !isFinite(b)) return null;
      let x2 = App.params.cmode === 'abs' ? a : x1 + a;
      let y2 = App.params.cmode === 'abs' ? b : y1 + b;
      if (App.params.ortho) {
        if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) y2 = y1; else x2 = x1;
      }
      return { x1: x1, y1: y1, x2: x2, y2: y2 };
    },
    applyParams: function () {
      if (App.params.coord !== true) { App.toast('请先勾选“坐标输入”再输入坐标'); return; }
      // 连续画线 + 坐标输入：起点强制取上一条已完成直线的终点
      const start = this.points.length ? this.points[0] : null;
      const c = this._coordEnd(start);
      if (!c) { App.toast('请输入有效的坐标数值'); return; }
      if (Geo.dist({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }) < 1e-6) {
        App.toast('起点与终点不能重合'); return;
      }
      this._addLine({ type: 'line', p1: { x: c.x1, y: c.y1 }, p2: { x: c.x2, y: c.y2 } });
      // 生成后终点输入清零，起点自动续接上一条终点，直接输入下一段终点即可
      App.params.x2 = 0;
      App.params.y2 = 0;
      if (App.params.lchain) {
        this._startAt({ x: c.x2, y: c.y2 });
        App.toast('已生成直线，起点已续接，终点输入已清零');
      } else {
        this.reset();
        App.updatePrompt();
      }
    },
    /** 闭环私有方法：在连续画线 + 首尾链接 + 闭环 都开启时，自动连接首尾并建立重合约束。
     *  被 onRightClick / onDragCancel / deactivate 统一调用。
     *  @param {boolean} silent 是否静默（deactivate 时不弹 toast）
     *  @returns {boolean} true 表示执行了闭环，false 表示因条件不满足而跳过
     */
    _maybeCloseLoop: function (silent) {
      // 防抖：正在执行中就别重入（快速连按 ESC / 切工具 等）
      if (this._closing) return false;
      // 条件检查
      if (!App.params.lchain || !App.params.llink || !App.params.lloop) return false;
      if (!this.chainFirstId || !this.chainLastId) return false;
      if (this.chainFirstId === this.chainLastId) return false; // 只有 1 条线没意义

      const first = App.model.findById(this.chainFirstId);
      const last = App.model.findById(this.chainLastId);
      if (!first || !last) return false;
      if (first.type !== 'line' || last.type !== 'line') return false;
      // 首尾端点重合就没必要再加闭合线了
      if (Geo.dist(last.p2, first.p1) < 1e-6) return false;

      this._closing = true;
      let ok = false;
      try {
        App.begin();
        const closedLine = { type: 'line', p1: Geo.cloneP(last.p2), p2: Geo.cloneP(first.p1) };
        const newEnt = App.model.add(closedLine);
        if (newEnt && newEnt.id) {
          const newId = String(newEnt.id);
          App.model.addConstraint({ type: 'coincident', ids: [last.id, newId], aIdx: 1, bIdx: 0 });
          App.model.addConstraint({ type: 'coincident', ids: [newId, first.id], aIdx: 1, bIdx: 0 });
          App.solveConstraints();
          ok = true;
        } else {
          App.abort();
        }
      } catch (e) {
        try { App.abort(); } catch (_) {}
        if (!silent && App.toast) App.toast('闭环失败：' + (e && e.message || '未知错误'));
      } finally {
        if (ok) App.end();
        this._closing = false;
      }

      if (ok && !silent && App.toast) App.toast('已自动闭环：添加闭合直线并建立重合约束');
      return ok;
    },
    /** 右键 / ESC：取消当前直线并退出连续画线 */
    onRightClick: function () {
      // 先触发闭环（此时 lchain 还是 true，条件检查能过）
      const didClose = this._maybeCloseLoop(false);

      const chain = !!App.params.lchain;
      App.params.lchain = false;

      this.reset();
      if (App.updateParams) App.updateParams();
      App.updatePrompt();
      App.refresh();
      if (chain && App.toast) App.toast('已退出连续画线模式');
      else if (App.toast) App.toast('已取消当前直线');
    },
    /** 拖动过程取消（触屏手势中断等）：也需要尝试闭环 */
    onDragCancel: function () {
      if (!App.params.lchain) return;
      this._maybeCloseLoop(true);
      App.params.lchain = false;
      this.reset();
      if (App.updateParams) App.updateParams();
      App.updatePrompt();
      App.refresh();
    },
    onRender: function (ctx, R) {
      // 坐标输入动态预览：面板正在编辑坐标时，预览“确定”后将生成的直线
      if (App.params.coord === true && this._coordPreview) {
        const c = this._coordEnd(this.points.length ? this.points[0] : null);
        if (c && Geo.dist({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }) >= 1e-6) {
          const p0 = { x: c.x1, y: c.y1 }, p1 = { x: c.x2, y: c.y2 };
          R.previewLine(p0, p1);
          R.previewMarker(p0, '起点');
          R.previewLabel('终点 ' + fmt(p1.x) + ', ' + fmt(p1.y), p1);
          return;
        }
      }
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
      if (res.align) {
        R.previewLabel(res.align === 'normal' ? '法线' : '切线', res.p);
        return;
      }
      if (this.snapMode && this.snapPt) R.previewMarker(this.snapPt, '捕捉' + this.snapMode);
      if (App.params.tangent) R.previewLabel('相切', res.p);
      else if (App.params.perp) R.previewLabel('垂直', res.p);
    }
  });

  /* ================= 绘图：圆（半径 / 直径输入切换） ================= */
  const circleTool = baseTool({
    id: 'circle', name: '圆', cat: 'draw', icon: '○', dragType: 'preview',
    prompt: function () {
      const dia = App.params.rmode === 'd';
      const unit = dia ? '直径' : '半径';
      return this.points.length
        ? '点按确定' + unit + '，或在面板输入' + unit + '后确定'
        : '点按圆心，或输入圆心坐标 /' + unit + '后确定';
    },
    params: function () {
      const dia = App.params.rmode === 'd';
      return [
        {
          key: 'rmode', type: 'choice', label: '尺寸方式', def: 'r', group: '尺寸',
          options: [{ v: 'r', label: '半径' }, { v: 'd', label: '直径' }]
        },
        { key: 'cx', label: 'X', def: 0, group: '圆心' },
        { key: 'cy', label: 'Y', def: 0, group: '圆心' },
        { key: 'r', label: dia ? '直径' : '半径', def: 50, group: '尺寸', positive: true }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this._rmode = App.params.rmode || 'r';
    },
    /** 半径 / 直径切换：同步换算面板数值，绘制流程不中断 */
    onParamChange: function (key, val) {
      if (key !== 'rmode') return;
      const next = String(val) === 'd' ? 'd' : 'r';
      const prev = this._rmode || 'r';
      if (next === prev) return;
      const v = Number(App.params.r);
      if (isFinite(v) && v > 0) App.params.r = round3(next === 'd' ? v * 2 : v / 2);
      App.params.rmode = next;
      this._rmode = next;
      if (App.toast) App.toast('已切换为输入' + (next === 'd' ? '直径' : '半径'));
    },
    _radius: function () {
      const v = Number(App.params.r);
      const r = App.params.rmode === 'd' ? v / 2 : v;
      return isFinite(r) && r > 0 ? r : 50;
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
      App.params.r = round3(App.params.rmode === 'd' ? r * 2 : r);
      if (App.updateParams) App.updateParams();
      addEntities([{ type: 'circle', c: Geo.cloneP(this.points[0]), r: r }]);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      const cx = Number(App.params.cx), cy = Number(App.params.cy);
      const v = Number(App.params.r);
      const dia = App.params.rmode === 'd';
      const r = dia ? v / 2 : v;
      if (!isFinite(cx) || !isFinite(cy)) { App.toast('请输入有效的圆心坐标'); return; }
      if (!(r > 0)) { App.toast((dia ? '直径' : '半径') + '需大于 0'); return; }
      addEntities([{ type: 'circle', c: { x: cx, y: cy }, r: r }]);
      this.reset();
      App.updatePrompt();
    },
    onRender: function (ctx, R) {
      if (this.points.length !== 1) return;
      const c = this.points[0];
      const r = this.hover ? Math.max(Geo.dist(c, this.hover), 0.01) : this._radius();
      const dia = App.params.rmode === 'd';
      R.previewCircle(c, r);
      R.previewLine(c, this.hover || Geo.polar(c, r, Math.PI / 4));
      R.previewLabel((dia ? '⌀' : 'R') + fmt(dia ? r * 2 : r), Geo.polar(c, r, Math.PI / 4));
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

  /* ================= 绘图：矩形 ================= */
  const rectTool = baseTool({
    id: 'rect', name: '矩形', cat: 'draw', icon: '▭', dragType: 'tool', hoverLive: true,
    prompt: function () {
      return this.points.length
        ? '拖动或点按对角点完成矩形；也可输入宽高后确定'
        : '拖动创建矩形，或点按第一个角点';
    },
    params: function () {
      return [
        { key: 'x1', label: 'X', def: 0, group: '起点' },
        { key: 'y1', label: 'Y', def: 0, group: '起点' },
        { key: 'w', label: '宽', def: 120, group: '尺寸', positive: true },
        { key: 'h', label: '高', def: 80, group: '尺寸', positive: true },
        {
          key: 'rstyle', type: 'choice', label: '边框', def: 'solid', group: '样式',
          options: [{ v: 'solid', label: '实线' }, { v: 'dashed', label: '虚线' }]
        },
        {
          key: 'rfill', type: 'choice', label: '填充', def: 'none', group: '样式',
          options: [
            { v: 'none', label: '无' }, { v: 'blue', label: '蓝' }, { v: 'green', label: '绿' },
            { v: 'orange', label: '橙' }, { v: 'purple', label: '紫' }
          ]
        }
      ];
    },
    _mk: function (a, b) {
      const r = Geo.normalizeRect(a.x, a.y, b.x, b.y);
      if (r.x2 - r.x1 < 1e-6 || r.y2 - r.y1 < 1e-6) return null;
      return {
        type: 'rect', x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2,
        style: App.params.rstyle || 'solid', fill: App.params.rfill || 'none'
      };
    },
    _commit: function (a, b) {
      const ent = this._mk(a, b);
      if (!ent) { App.toast('宽高需大于 0'); return false; }
      addEntities([ent]);
      this.reset();
      App.updateParams && App.updateParams();
      App.updatePrompt();
      App.refresh();
      return true;
    },
    onTap: function (p) {
      if (this.points.length === 1) { this._commit(this.points[0], p); return; }
      this.points = [Geo.cloneP(p)];
      App.params.x1 = round3(p.x);
      App.params.y1 = round3(p.y);
      App.updateParams && App.updateParams();
      App.updatePrompt();
    },
    onDragStart: function (p) {
      if (!this.points.length) this.points = [Geo.cloneP(p)];
      this.hover = Geo.cloneP(p);
    },
    onDragMove: function (p) {
      this.hover = Geo.cloneP(p);
      App.refresh();
    },
    onDragEnd: function (p) {
      if (!this.points.length) return;
      this._commit(this.points[0], p);
    },
    onDragCancel: function () {
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    onRender: function (ctx, R) {
      if (!this.points.length || !this.hover) return;
      const ent = this._mk(this.points[0], this.hover);
      if (!ent) return;
      R.previewEntity(ent);
      R.previewLabel(
        fmt(ent.x2 - ent.x1) + ' × ' + fmt(ent.y2 - ent.y1),
        { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2 }
      );
    },
    applyParams: function () {
      const x = Number(App.params.x1), y = Number(App.params.y1);
      const w = Number(App.params.w), h = Number(App.params.h);
      if (![x, y, w, h].every(isFinite)) { App.toast('请输入有效数值'); return; }
      if (!(w > 1e-6) || !(h > 1e-6)) { App.toast('宽高需大于 0'); return; }
      this._commit({ x: x, y: y }, { x: x + w, y: y + h });
    }
  });

  /* ================= 绘图：多边形 ================= */
  const polyTool = baseTool({
    id: 'poly', name: '多边形', cat: 'draw', icon: '⬠', dragType: 'tool', hoverLive: true,
    prompt: function () {
      if (App.params.pmode === 'edit') {
        return this.dragIdx >= 0 ? '拖动顶点调整，松手完成' : '点按多边形顶点后拖动调整';
      }
      const n = Number(App.params.psides) || 0;
      if (n >= 3) {
        return this.hover ? '点按中心生成 ' + n + ' 边形（半径按参数）' : '点按中心生成正多边形';
      }
      if (!this.points.length) return '依次点按顶点，回到起点或点“确定”闭合';
      return '继续点按添加顶点（已有 ' + this.points.length + ' 个），点回起点闭合';
    },
    params: function () {
      return [
        {
          key: 'pmode', type: 'choice', label: '模式', def: 'draw', group: '模式',
          options: [{ v: 'draw', label: '绘制' }, { v: 'edit', label: '编辑顶点' }]
        },
        {
          key: 'psides', type: 'choice', label: '边数预设', def: '0', group: '边数',
          options: [
            { v: '0', label: '自由' }, { v: '3', label: '3' }, { v: '5', label: '5' },
            { v: '6', label: '6' }, { v: '8', label: '8' }
          ]
        },
        {
          key: 'prad', label: '半径', def: 80, group: '边数', positive: true,
          when: function (p) { return String(p.psides) !== '0'; }
        },
        {
          key: 'pfill', type: 'choice', label: '填充', def: 'none', group: '样式',
          options: [
            { v: 'none', label: '无' }, { v: 'blue', label: '蓝' }, { v: 'green', label: '绿' },
            { v: 'orange', label: '橙' }, { v: 'purple', label: '紫' }
          ]
        }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.editId = null;
      this.dragIdx = -1;
      this.dragClone = null;
    },
    _mkPoly: function (pts) {
      if (!pts || pts.length < 3) return null;
      if (Math.abs(Geo.polyArea(pts)) < 1e-6) return null;
      return {
        type: 'poly', pts: pts.map(Geo.cloneP), closed: true,
        fill: App.params.pfill || 'none'
      };
    },
    _finish: function () {
      const ent = this._mkPoly(this.points);
      if (!ent) { App.toast('至少需要 3 个不共线顶点'); return false; }
      addEntities([ent]);
      this.reset();
      App.updateParams && App.updateParams();
      App.updatePrompt();
      App.refresh();
      return true;
    },
    _regular: function (center, r, n, a0) {
      if (!(r > 0)) return null;
      if (a0 == null) a0 = Math.PI / 2;
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(Geo.polar(center, r, a0 + i * Math.PI * 2 / n));
      return pts;
    },
    _select: function (id) {
      App.model.selected.clear();
      App.model.selected.add(id);
      if (App.afterSelectionChange) App.afterSelectionChange();
    },
    _vertexAt: function (p) {
      const tol = App.worldTol ? App.worldTol(16) : 0;
      let best = null, bestD = tol;
      App.model.entities.forEach(function (e) {
        if (e.type !== 'poly' || !e.pts) return;
        e.pts.forEach(function (q, i) {
          const d = Geo.dist(p, q);
          if (d < bestD) { bestD = d; best = { id: e.id, idx: i, ent: e }; }
        });
      });
      return best;
    },
    _editTap: function (p) {
      const hit = this._vertexAt(p);
      if (hit) {
        this.editId = hit.id;
        this.dragIdx = hit.idx;
        this._select(hit.id);
        App.toast('拖动顶点调整位置');
        App.refresh();
        return;
      }
      const e = App.pick(p);
      if (e && e.type === 'poly') {
        this.editId = e.id;
        this.dragIdx = -1;
        this._select(e.id);
        App.toast('点按顶点后拖动调整');
      } else {
        this.editId = null;
        this.dragIdx = -1;
      }
      App.refresh();
    },
    onTap: function (p) {
      if (App.params.pmode === 'edit') { this._editTap(p); return; }
      const n = Number(App.params.psides) || 0;
      if (n >= 3) {
        const r = Number(App.params.prad);
        if (!(r > 0)) { App.toast('半径需大于 0'); return; }
        const pts = this._regular(p, r, n, 0);
        const ent = this._mkPoly(pts);
        if (!ent) { App.toast('无法生成多边形'); return; }
        addEntities([ent]);
        this.reset();
        App.updateParams && App.updateParams();
        App.updatePrompt();
        return;
      }
      if (this.points.length >= 3 &&
          Geo.dist(p, this.points[0]) <= (App.worldTol ? App.worldTol(14) : 0)) {
        this._finish();
        return;
      }
      if (this.points.length && Geo.dist(p, this.points[this.points.length - 1]) < 1e-6) return;
      this.points.push(Geo.cloneP(p));
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      if (App.params.pmode === 'edit') { App.toast('编辑模式下直接拖动顶点'); return; }
      this._finish();
    },
    onDragStart: function (p) {
      if (App.params.pmode !== 'edit') return;
      const hit = this._vertexAt(p);
      if (!hit) { this.dragIdx = -1; return; }
      this.editId = hit.id;
      this.dragIdx = hit.idx;
      this.dragClone = Geo.copyShape({}, hit.ent);
      this._select(hit.id);
      App.begin();
    },
    onDragMove: function (p) {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      if (!e || !e.pts) return;
      e.pts[this.dragIdx] = { x: p.x, y: p.y };
      App.solveConstraints();
      App.refresh();
    },
    onDragEnd: function () {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      if (e && this.dragClone && Math.abs(Geo.polyArea(e.pts)) < 1e-6) {
        Geo.copyShape(e, this.dragClone);
        App.toast('顶点调整后多边形退化，已还原');
      } else {
        App.toast('顶点已调整');
      }
      this.dragIdx = -1;
      this.dragClone = null;
      App.end();
    },
    onDragCancel: function () {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      if (e && this.dragClone) Geo.copyShape(e, this.dragClone);
      this.dragIdx = -1;
      this.dragClone = null;
      if (App.abort) App.abort();
    },
    onRender: function (ctx, R) {
      if (App.params.pmode === 'edit') {
        const e = this.editId != null ? App.model.findById(this.editId) : null;
        if (!e || e.type !== 'poly' || !e.pts) return;
        e.pts.forEach(function (q, i) {
          const s = R.screen(q);
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, i === this.dragIdx ? 6 : 4.5, 0, Geo.TAU);
          ctx.fillStyle = i === this.dragIdx ? '#ffb020' : '#37c8ff';
          ctx.strokeStyle = '#0d1117';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }, this);
        return;
      }
      const n = Number(App.params.psides) || 0;
      if (n >= 3) {
        if (!this.hover) return;
        const r = Number(App.params.prad);
        const pts = this._regular(this.hover, r, n, 0);
        if (!pts) return;
        R.previewEntity({ type: 'poly', pts: pts, closed: true, fill: App.params.pfill });
        R.previewMarker(this.hover, n + ' 边形');
        return;
      }
      if (!this.points.length) return;
      for (let i = 0; i < this.points.length; i++) {
        const s = R.screen(this.points[i]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Geo.TAU);
        ctx.fillStyle = i === 0 ? '#ffb020' : '#37c8ff';
        ctx.fill();
        ctx.restore();
        if (i > 0) R.previewLine(this.points[i - 1], this.points[i]);
      }
      if (this.hover && this.points.length) {
        R.previewLine(this.points[this.points.length - 1], this.hover);
        if (this.points.length >= 3) R.previewLine(this.hover, this.points[0]);
      }
      if (this.points.length >= 3) R.previewLabel('点回起点闭合', this.points[0]);
    }
  });

  /* ================= 绘图：轮廓线 ================= */
  const contourTool = baseTool({
    id: 'contour', name: '轮廓线', cat: 'draw', icon: '⌇', dragType: 'tool', hoverLive: true,
    prompt: function () {
      if (App.params.cmode === 'edit') {
        if (this.dragIdx >= 0) return '拖动节点调整轮廓，松手完成';
        return '点按轮廓节点选中 / 再次点按删除；点按线段插入节点；拖动节点调整';
      }
      const n = this.points.length;
      if (!n) return '点按起点开始绘制轮廓';
      if (n >= 3) return '继续点按添加节点（已有 ' + n + ' 个）；点回起点闭合，或点“确定”按收尾设置完成';
      return '继续点按添加节点（已有 ' + n + ' 个）';
    },
    params: function () {
      return [
        {
          key: 'cmode', type: 'choice', label: '模式', def: 'draw', group: '模式',
          options: [{ v: 'draw', label: '绘制' }, { v: 'edit', label: '编辑节点' }]
        },
        {
          key: 'cend', type: 'choice', label: '收尾', def: 'auto', group: '轮廓', apply: true,
          when: function (p) { return p.cmode !== 'edit'; },
          options: [{ v: 'auto', label: '自动检测' }, { v: 'open', label: '开放' }, { v: 'closed', label: '闭合' }]
        }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.editId = null;
      this.selIdx = -1;
      this.dragIdx = -1;
      this.dragClone = null;
    },
    _select: function (id) {
      App.model.selected.clear();
      App.model.selected.add(id);
      if (App.afterSelectionChange) App.afterSelectionChange();
    },
    _finish: function (forceClosed) {
      let pts = this.points.slice();
      if (pts.length < 2) { App.toast('至少需要 2 个节点'); return false; }
      const tol = Math.max(App.worldTol ? App.worldTol(14) : 0, 1e-6);
      const mode = App.params.cend || 'auto';
      let closed = forceClosed === true || mode === 'closed';
      if (!closed && mode === 'auto') closed = Geo.contourClosure(pts, tol);
      if (closed) {
        if (pts.length < 3) { App.toast('闭合轮廓至少需要 3 个节点'); return false; }
        if (pts.length > 3 && Geo.dist(pts[0], pts[pts.length - 1]) <= tol) pts.pop();
      }
      addEntities([{ type: 'poly', pts: pts.map(Geo.cloneP), closed: closed }]);
      this.reset();
      App.toast(closed ? '已生成闭合轮廓' : '已生成开放轮廓');
      App.updateParams && App.updateParams();
      App.updatePrompt();
      App.refresh();
      return true;
    },
    _vertexAt: function (p) {
      const tol = App.worldTol ? App.worldTol(16) : 0;
      let best = null, bestD = tol;
      const list = App.model.entities.slice();
      const cur = list.findIndex(function (e) { return e.id === this.editId; }, this);
      if (cur > 0) list.unshift(list.splice(cur, 1)[0]);
      list.forEach(function (e) {
        if (e.type !== 'poly' || !e.pts) return;
        e.pts.forEach(function (q, i) {
          const d = Geo.dist(p, q);
          if (d < bestD) { bestD = d; best = { id: e.id, idx: i, ent: e }; }
        });
      });
      return best;
    },
    _segAt: function (p) {
      const tol = App.worldTol ? App.worldTol(14) : 0;
      let best = null, bestD = tol;
      const list = App.model.entities.slice();
      const cur = list.findIndex(function (e) { return e.id === this.editId; }, this);
      if (cur > 0) list.unshift(list.splice(cur, 1)[0]);
      list.forEach(function (e) {
        if (e.type !== 'poly' || !e.pts || e.pts.length < 2) return;
        const n = e.pts.length;
        const count = e.closed !== false ? n : n - 1;
        for (let i = 0; i < count; i++) {
          const r = Geo.closestOnSeg(p, e.pts[i], e.pts[(i + 1) % n]);
          if (r.dist < bestD && r.t > 0.02 && r.t < 0.98) {
            bestD = r.dist;
            best = { id: e.id, idx: i, point: r.point, ent: e };
          }
        }
      });
      return best;
    },
    _deleteNode: function (hit) {
      const e = hit.ent;
      const min = e.closed !== false ? 3 : 2;
      if (e.pts.length <= min) { App.toast('节点太少，无法删除（最少 ' + min + ' 个）'); return; }
      App.begin();
      e.pts.splice(hit.idx, 1);
      App.end();
      this.selIdx = -1;
      App.toast('已删除节点，相邻线段自动合并');
      App.updatePrompt();
      App.refresh();
    },
    _insertNode: function (seg) {
      App.begin();
      seg.ent.pts.splice(seg.idx + 1, 0, { x: seg.point.x, y: seg.point.y });
      App.end();
      this.editId = seg.id;
      this.selIdx = seg.idx + 1;
      this.dragIdx = -1;
      this._select(seg.id);
      App.toast('已在选中线段上插入节点');
      App.updatePrompt();
      App.refresh();
    },
    _editTap: function (p) {
      const hit = this._vertexAt(p);
      if (hit) {
        if (this.editId === hit.id && this.selIdx === hit.idx) {
          this._deleteNode(hit);
          return;
        }
        this.editId = hit.id;
        this.selIdx = hit.idx;
        this.dragIdx = -1;
        this._select(hit.id);
        App.toast('拖动调整节点；再次点按该节点删除');
        App.refresh();
        return;
      }
      const seg = this._segAt(p);
      if (seg) { this._insertNode(seg); return; }
      const e = App.pick(p);
      if (e && e.type === 'poly') {
        this.editId = e.id;
        this.selIdx = -1;
        this._select(e.id);
        App.toast('已选中轮廓，点按节点或线段进行编辑');
      } else {
        this.editId = null;
        this.selIdx = -1;
      }
      App.refresh();
    },
    onTap: function (p) {
      if (App.params.cmode === 'edit') { this._editTap(p); return; }
      if (this.points.length >= 3 &&
        Geo.dist(p, this.points[0]) <= (App.worldTol ? App.worldTol(14) : 0)) {
        this._finish(true);
        return;
      }
      if (this.points.length && Geo.dist(p, this.points[this.points.length - 1]) < 1e-6) return;
      this.points.push(Geo.cloneP(p));
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      if (App.params.cmode === 'edit') { App.toast('编辑模式下拖动节点调整，点按线段插入节点'); return; }
      this._finish(false);
    },
    onDragStart: function (p) {
      if (App.params.cmode !== 'edit') return;
      const hit = this._vertexAt(p);
      if (!hit) { this.dragIdx = -1; return; }
      this.editId = hit.id;
      this.selIdx = hit.idx;
      this.dragIdx = hit.idx;
      this.dragClone = Geo.copyShape({}, hit.ent);
      this._select(hit.id);
      App.begin();
    },
    onDragMove: function (p) {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      if (!e || !e.pts) return;
      e.pts[this.dragIdx] = { x: p.x, y: p.y };
      if (App.solveConstraints) App.solveConstraints();
      App.refresh();
    },
    onDragEnd: function () {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      let bad = false;
      if (e && e.pts) {
        const n = e.pts.length;
        for (let i = 0; i < n; i++) {
          if (Geo.dist(e.pts[i], e.pts[(i + 1) % n]) < 1e-9) { bad = true; break; }
        }
      }
      if (e && this.dragClone && bad) {
        Geo.copyShape(e, this.dragClone);
        App.toast('节点调整后轮廓退化，已还原');
      } else {
        App.toast('轮廓节点已调整');
      }
      this.dragIdx = -1;
      this.dragClone = null;
      App.end();
    },
    onDragCancel: function () {
      if (this.dragIdx < 0) return;
      const e = App.model.findById(this.editId);
      if (e && this.dragClone) Geo.copyShape(e, this.dragClone);
      this.dragIdx = -1;
      this.dragClone = null;
      if (App.abort) App.abort();
    },
    onRender: function (ctx, R) {
      if (App.params.cmode === 'edit') {
        const e = this.editId != null ? App.model.findById(this.editId) : null;
        if (!e || e.type !== 'poly' || !e.pts) return;
        e.pts.forEach(function (q, i) {
          const s = R.screen(q);
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, i === this.selIdx ? 6 : 4.5, 0, Geo.TAU);
          ctx.fillStyle = i === this.selIdx ? '#ffb020' : '#37c8ff';
          ctx.strokeStyle = '#0d1117';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }, this);
        return;
      }
      if (!this.points.length) return;
      for (let i = 0; i < this.points.length; i++) {
        const s = R.screen(this.points[i]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Geo.TAU);
        ctx.fillStyle = i === 0 ? '#ffb020' : '#37c8ff';
        ctx.fill();
        ctx.restore();
        if (i > 0) R.previewLine(this.points[i - 1], this.points[i]);
      }
      if (this.hover && this.points.length) {
        R.previewLine(this.points[this.points.length - 1], this.hover);
        if (App.params.cend !== 'open' && this.points.length >= 2) {
          R.previewLine(this.hover, this.points[0]);
        }
      }
      if (this.points.length >= 3 && App.params.cend !== 'open') {
        R.previewLabel('点回起点闭合', this.points[0]);
      }
    }
  });

  /* ================= 绘图：贝塞尔样条线 ================= */
  const splineTool = baseTool({
    id: 'spline', name: '样条线', cat: 'draw', icon: '∿', dragType: 'tool', hoverLive: true,
    prompt: function () {
      if (App.params.smode === 'edit') {
        if (this.dragKind) return '拖动手柄调整曲线，松手完成';
        return '点按样条线选中；拖动节点移动，拖动手柄端点调整曲率';
      }
      const n = this.points.length;
      if (!n) return '点按起点开始绘制贝塞尔样条线';
      return '继续点按添加节点（已有 ' + n + ' 个），点“确定”完成；平滑度可在面板调整';
    },
    params: function () {
      return [
        {
          key: 'smode', type: 'choice', label: '模式', def: 'draw', group: '模式',
          options: [{ v: 'draw', label: '绘制' }, { v: 'edit', label: '编辑手柄' }]
        },
        {
          key: 'smooth', label: '平滑度', def: 0.5, min: 0, max: 1, group: '曲线',
          when: function (p) { return p.smode !== 'edit'; }
        },
        {
          key: 'sclosed', type: 'toggle', label: '闭合曲线', def: false, group: '曲线',
          when: function (p) { return p.smode !== 'edit'; }
        }
      ];
    },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.editId = null;
      this.dragKind = null;
      this.dragIdx = -1;
      this.dragStart = null;
      this.dragClone = null;
    },
    _smooth: function () {
      let s = Number(App.params.smooth);
      if (!isFinite(s)) s = 0.5;
      return Math.max(0, Math.min(1, s));
    },
    _mkSpline: function (pts, closed) {
      if (!pts || pts.length < 2) return null;
      return {
        type: 'spline', pts: pts.map(Geo.cloneP), handles: [],
        smooth: this._smooth(), closed: !!closed
      };
    },
    _finish: function () {
      const closed = App.params.sclosed === true || (this.hover && this.points.length >= 3 &&
        Geo.dist(this.hover, this.points[0]) <= (App.worldTol ? App.worldTol(14) : 0));
      const ent = this._mkSpline(this.points, closed);
      if (!ent) { App.toast('至少需要 2 个节点'); return false; }
      addEntities([ent]);
      this.reset();
      App.toast(closed ? '已生成闭合样条线' : '已生成样条线');
      App.updateParams && App.updateParams();
      App.updatePrompt();
      App.refresh();
      return true;
    },
    _initHandles: function (e) {
      if (!e || e.type !== 'spline') return;
      if (e.handles && e.handles.length === e.pts.length) return;
      const nodes = Geo.splineControls(e);
      e.handles = nodes.map(function (n) {
        return { in: Geo.cloneP(n.in), out: Geo.cloneP(n.out) };
      });
    },
    _nodeAt: function (p) {
      const tol = App.worldTol ? App.worldTol(16) : 0;
      let best = null, bestD = tol;
      const list = App.model.entities.slice();
      const cur = list.findIndex(function (e) { return e.id === this.editId; }, this);
      if (cur > 0) list.unshift(list.splice(cur, 1)[0]);
      list.forEach(function (e) {
        if (e.type !== 'spline' || !e.pts) return;
        e.pts.forEach(function (q, i) {
          const d = Geo.dist(p, q);
          if (d < bestD) { bestD = d; best = { id: e.id, idx: i, ent: e }; }
        });
      });
      return best;
    },
    _handleAt: function (p) {
      const tol = App.worldTol ? App.worldTol(14) : 0;
      let best = null, bestD = tol;
      const list = App.model.entities.slice();
      const cur = list.findIndex(function (e) { return e.id === this.editId; }, this);
      if (cur > 0) list.unshift(list.splice(cur, 1)[0]);
      list.forEach(function (e) {
        if (e.type !== 'spline' || !e.pts) return;
        const nodes = Geo.splineControls(e);
        nodes.forEach(function (n, i) {
          const di = Geo.dist(p, n.in);
          if (di < bestD) { bestD = di; best = { id: e.id, idx: i, kind: 'in', ent: e }; }
          const dout = Geo.dist(p, n.out);
          if (dout < bestD) { bestD = dout; best = { id: e.id, idx: i, kind: 'out', ent: e }; }
        });
      });
      return best;
    },
    _select: function (id) {
      App.model.selected.clear();
      App.model.selected.add(id);
      if (App.afterSelectionChange) App.afterSelectionChange();
    },
    onTap: function (p) {
      if (App.params.smode === 'edit') {
        const e = App.pick(p);
        if (e && e.type === 'spline') {
          this.editId = e.id;
          this._select(e.id);
          App.toast('已选中样条线：拖动节点移动，拖动手柄调整曲率');
          App.refresh();
        } else {
          this.editId = null;
          App.refresh();
        }
        return;
      }
      if (this.points.length >= 3 &&
        Geo.dist(p, this.points[0]) <= (App.worldTol ? App.worldTol(14) : 0)) {
        this.hover = p;
        this._finish();
        return;
      }
      if (this.points.length && Geo.dist(p, this.points[this.points.length - 1]) < 1e-6) return;
      this.points.push(Geo.cloneP(p));
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      if (App.params.smode === 'edit') { App.toast('编辑模式下拖动节点或手柄调整'); return; }
      this._finish();
    },
    onParamChange: function (key, val) {
      if (key !== 'smooth' || App.params.smode === 'edit') return;
      App.refresh();
    },
    onDragStart: function (p) {
      if (App.params.smode !== 'edit') return;
      const node = this._nodeAt(p);
      const handle = this._handleAt(p);
      if (!node && !handle) return;
      const target = handle && (!node || Geo.dist(p, handle.kind === 'in' ? Geo.splineControls(handle.ent)[handle.idx].in : Geo.splineControls(handle.ent)[handle.idx].out) < Geo.dist(p, node.ent.pts[node.idx])) ? handle : null;
      const pick = target || node;
      if (!pick) return;
      this.editId = pick.id;
      this.dragIdx = pick.idx;
      this.dragKind = target ? target.kind : 'node';
      this.dragStart = { x: p.x, y: p.y };
      this.dragClone = JSON.parse(JSON.stringify(pick.ent));
      if (this.dragKind !== 'node') this._initHandles(pick.ent);
      this._select(pick.id);
      App.begin();
    },
    onDragMove: function (p) {
      if (!this.dragKind) return;
      const e = App.model.findById(this.editId);
      if (!e || e.type !== 'spline') return;
      if (this.dragKind === 'node') {
        const dx = p.x - this.dragStart.x, dy = p.y - this.dragStart.y;
        e.pts[this.dragIdx] = { x: p.x, y: p.y };
        if (e.handles && e.handles[this.dragIdx]) {
          const h = e.handles[this.dragIdx];
          if (h.in) { h.in.x += dx; h.in.y += dy; }
          if (h.out) { h.out.x += dx; h.out.y += dy; }
        }
        this.dragStart = { x: p.x, y: p.y };
      } else {
        this._initHandles(e);
        if (e.handles && e.handles[this.dragIdx]) {
          e.handles[this.dragIdx][this.dragKind] = { x: p.x, y: p.y };
        }
      }
      if (App.solveConstraints) App.solveConstraints();
      App.refresh();
    },
    onDragEnd: function () {
      if (!this.dragKind) return;
      App.toast(this.dragKind === 'node' ? '样条节点已调整' : '控制手柄已调整');
      this.dragKind = null;
      this.dragIdx = -1;
      this.dragStart = null;
      this.dragClone = null;
      App.end();
    },
    onDragCancel: function () {
      if (!this.dragKind) return;
      const e = App.model.findById(this.editId);
      if (e && this.dragClone) Geo.copyShape(e, this.dragClone);
      this.dragKind = null;
      this.dragIdx = -1;
      this.dragStart = null;
      this.dragClone = null;
      if (App.abort) App.abort();
    },
    onRender: function (ctx, R) {
      if (App.params.smode === 'edit') {
        const e = this.editId != null ? App.model.findById(this.editId) : null;
        if (!e || e.type !== 'spline' || !e.pts) return;
        const nodes = Geo.splineControls(e);
        nodes.forEach(function (n, i) {
          const sp = R.screen(n.p), si = R.screen(n.in), so = R.screen(n.out);
          ctx.save();
          ctx.strokeStyle = 'rgba(55, 200, 255, 0.55)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(si.x, si.y); ctx.lineTo(sp.x, sp.y); ctx.lineTo(so.x, so.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(si.x, si.y, 3.5, 0, Geo.TAU);
          ctx.arc(so.x, so.y, 3.5, 0, Geo.TAU);
          ctx.fillStyle = '#ffb020';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, i === this.dragIdx && this.dragKind === 'node' ? 6 : 4.5, 0, Geo.TAU);
          ctx.fillStyle = '#37c8ff';
          ctx.strokeStyle = '#0d1117';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }, this);
        return;
      }
      if (!this.points.length) return;
      const pts = this.points.slice();
      if (this.hover) pts.push(this.hover);
      const preview = this._mkSpline(pts, false);
      if (preview) R.previewEntity(preview);
      this.points.forEach(function (q, i) {
        const s = R.screen(q);
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Geo.TAU);
        ctx.fillStyle = i === 0 ? '#ffb020' : '#37c8ff';
        ctx.fill();
        ctx.restore();
      }, this);
      if (this.points.length >= 3) R.previewLabel('点回起点闭合', this.points[0]);
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
      if (App.params.lref === true && !this.refId) return '点按一条已有直线作为角度参考';
      if (!this.points.length) return '点按起点';
      return App.params.lmod === true ? '点按方向（按输入长度生成）' : '点按方向点生成角度线';
    },
    params: function () {
      return [
        { key: 'lmod', type: 'toggle', label: '长度输入', def: false, group: '长度' },
        { key: 'len', label: '长度', def: 100, group: '长度', when: function (p) { return p.lmod === true; } },
        { key: 'ang', label: '角度°', def: 45, group: '角度' },
        {
          key: 'aref', type: 'choice', label: '参考方向', def: 'x', group: '角度参考',
          options: [{ v: 'x', label: '与X轴形成角度' }, { v: 'y', label: '与Y轴形成角度' }],
          when: function (p) { return p.lref !== true; }
        },
        { key: 'lref', type: 'toggle', label: '与指定线形成角度', def: false, group: '角度参考' }
      ];
    },
    activate: function () { this.reset(); },
    reset: function () {
      this.points = [];
      this.hover = null;
      this.refId = null;
    },
    onParamChange: function (key) {
      if (key === 'lref' || key === 'aref') {
        this.refId = null;
        this.points = [];
        this.hover = null;
      }
    },
    onTap: function (p) {
      if (App.params.lref === true && !this.refId) {
        const e = App.pick(p);
        if (!e || e.type !== 'line') { App.toast('请点按一条已有直线作为角度参考'); return; }
        this.refId = e.id;
        App.model.selected.clear();
        App.model.selected.add(e.id);
        App.afterSelectionChange();
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (!this.points.length) {
        this.points.push(Geo.cloneP(p));
        App.updatePrompt();
        return;
      }
      this._create(p);
    },
    /** 参考方向角：X 轴 0°，Y 轴 90°，或所选直线的方向 */
    _refAngle: function () {
      if (App.params.lref === true && this.refId) {
        const e = App.model.findById(this.refId);
        if (e && e.type === 'line') return Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x);
      }
      return App.params.aref === 'y' ? Math.PI / 2 : 0;
    },
    /** 由方向点求生成方向：在 ±角度 的 4 条候选射线中取最接近鼠标方向者，保证落在鼠标所在侧 */
    _dirTo: function (p) {
      const p0 = this.points[0];
      const base = this._refAngle();
      const A = Geo.rad(Number(App.params.ang) || 0);
      const m = Math.atan2(p.y - p0.y, p.x - p0.x);
      const raw = [base + A, base - A];
      let best = raw[0], bestCost = Infinity;
      for (let i = 0; i < raw.length; i++) {
        for (let k = 0; k < 2; k++) {
          const c = raw[i] + k * Math.PI;
          const diff = Math.atan2(Math.sin(m - c), Math.cos(m - c));
          const cost = Math.abs(diff);
          if (cost < bestCost - 1e-12) { bestCost = cost; best = c; }
        }
      }
      return best;
    },
    _create: function (p) {
      const p0 = this.points[0];
      if (App.params.lref === true && !this.refId) { App.toast('请先点按一条参考直线'); return; }
      const lmod = App.params.lmod === true;
      const d = p ? Geo.dist(p0, p) : 0;
      const L = lmod ? Number(App.params.len) : d;
      if (!(L > 0)) {
        App.toast(lmod ? '长度需大于 0' : '请点按方向点确定长度');
        return;
      }
      const a = d > 1e-9 ? this._dirTo(p) : this._refAngle() + Geo.rad(Number(App.params.ang) || 0);
      addEntities([{
        type: 'line',
        p1: Geo.cloneP(p0),
        p2: { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L }
      }]);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    applyParams: function () {
      if (this.points.length !== 1) { App.toast('请先点按起点'); return; }
      if (App.params.lmod !== true && !this.hover) { App.toast('请在画布上点按方向点'); return; }
      this._create(this.hover);
    },
    onRender: function (ctx, R) {
      if (this.points.length !== 1) return;
      const p0 = this.points[0];
      const lmod = App.params.lmod === true;
      const L = lmod ? (Number(App.params.len) || 0) : (this.hover ? Geo.dist(p0, this.hover) : 0);
      if (!(L > 0)) return;
      const a = this.hover ? this._dirTo(this.hover) : this._refAngle() + Geo.rad(Number(App.params.ang) || 0);
      const p1 = { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L };
      R.previewLine(p0, p1);
      R.previewLabel((Number(App.params.ang) || 0) + '°', Geo.polar(p0, L * 0.6, a));
      if (App.params.lref === true && this.refId) {
        const ref = App.model.findById(this.refId);
        if (ref && ref.type === 'line') R.previewLine(ref.p1, ref.p2);
      }
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
  const PRECISE_STRETCH_MAX = 1000000;

  /** 精确拉伸的几何预演；返回 {ok, reason?, entity?}，entity 是修改后的克隆 */
  function preciseStretchPreview(e, delta, endpoint) {
    if (!e) return { ok: false, reason: '请选中图元' };
    if (!isFinite(delta)) return { ok: false, reason: '增量必须是有效数值' };
    if (Math.abs(delta) > PRECISE_STRETCH_MAX) return { ok: false, reason: '增量超出允许范围（±' + PRECISE_STRETCH_MAX + '）' };
    const clone = JSON.parse(JSON.stringify(e));
    if (e.type === 'line') {
      const L = Geo.dist(e.p1, e.p2);
      if (L < 1e-9) return { ok: false, reason: '直线长度过小，无法精确拉伸' };
      const target = endpoint === 'start' ? 'p1' : 'p2';
      const fixedP = target === 'p1' ? e.p2 : e.p1;
      // dir 始终从 fixedP 指向 target，确保 fixedP + dir * newLen 正确得到新端点
      const origTarget = target === 'p1' ? e.p1 : e.p2;
      const dir = { x: (origTarget.x - fixedP.x) / L, y: (origTarget.y - fixedP.y) / L };
      const newLen = L + delta;
      if (newLen <= 1e-6) return { ok: false, reason: '缩短后长度过小（≈0），建议减小负增量' };
      clone[target].x = fixedP.x + dir.x * newLen;
      clone[target].y = fixedP.y + dir.y * newLen;
      return { ok: true, entity: clone };
    }
    if (e.type === 'arc') {
      const r = e.r;
      if (r <= 1e-9) return { ok: false, reason: '圆弧半径过小，无法精确拉伸' };
      const curSweep = Geo.arcSweep(e);
      const newSweep = curSweep + delta / r;
      if (newSweep <= 1e-6) return { ok: false, reason: '缩短后弧长过小（≈0），建议减小负增量' };
      if (newSweep >= Geo.TAU - 1e-6) return { ok: false, reason: '延长后将超过整圆，建议减小正增量' };
      if (endpoint === 'end') {
        if (e.ccw) clone.a1 = Geo.normAngle(e.a0 + newSweep);
        else clone.a1 = Geo.normAngle(e.a0 - newSweep);
      } else {
        if (e.ccw) clone.a0 = Geo.normAngle(e.a1 - newSweep);
        else clone.a0 = Geo.normAngle(e.a1 + newSweep);
      }
      return { ok: true, entity: clone };
    }
    if (e.type === 'circle') {
      const r = e.r;
      const newR = r + delta;
      if (newR <= 1e-6) return { ok: false, reason: '缩短后半径过小（≈0），建议减小负增量' };
      clone.r = newR;
      return { ok: true, entity: clone };
    }
    return { ok: false, reason: '精确拉伸仅支持直线 / 圆弧 / 圆' };
  }

  const stretchTool = baseTool({
    id: 'stretch', name: '拉伸', cat: 'edit', icon: '⇱', dragType: 'tool',
    reset: function () {
      this.active = false;
      this.entId = null;
      this.clone = null;
      this.mode = null;
      this.fixed = null;
      this.dir = null;
      this.hover = null;
    },
    prompt: function () {
      if (App.params.stp) {
        const n = App.model.selected.size;
        if (!n) return '精确拉伸：请先点选一个直线 / 圆弧 / 圆';
        if (n > 1) return '精确拉伸：每次仅处理一个图元，请只选一个';
        const e = App.model.selectedEntities()[0];
        if (!e) return '精确拉伸：请先选中图元';
        const delta = Number(App.params.sdd) || 0;
        const ep = e.type === 'line' || e.type === 'arc'
          ? (App.params.sept === 'start' ? '起点' : '终点')
          : '';
        const lbl = e.type === 'line' ? '直线' : e.type === 'arc' ? '圆弧' : e.type === 'circle' ? '圆' : '图元';
        const deltaTxt = (delta >= 0 ? '+' : '') + fmt(delta);
        return '精确拉伸 ' + lbl + (ep ? '·' + ep : '') + '：增量 ' + deltaTxt + '，点"确定"应用';
      }
      return '拖动直线端点沿原方向伸缩；拖动圆弧端点调整弧长（圆心固定）';
    },
    params: function () {
      const precise = function (p) { return p.stp === true; };
      const selectable = function (p) {
        if (!precise(p)) return false;
        const sel = App.model.selectedEntities();
        if (sel.length !== 1) return false;
        const e = sel[0];
        return e.type === 'line' || e.type === 'arc';
      };
      return [
        { key: 'stp', type: 'toggle', label: '精确拉伸', def: false, group: '拉伸方式' },
        { key: 'sdd', label: '增量值', def: 0, group: '精确参数',
          min: -PRECISE_STRETCH_MAX, max: PRECISE_STRETCH_MAX, apply: true, when: precise,
          hint: '正数延长 / 增大半径，负数缩短 / 减小半径' },
        { key: 'sept', type: 'choice', label: '端点', group: '精确参数', when: selectable,
          def: 'end',
          options: [
            { v: 'start', label: '起点' },
            { v: 'end',   label: '终点' }
          ] }
      ];
    },
    onTap: function (p) {
      if (!App.params.stp) return;
      const hit = App.pick(p);
      if (!hit) {
        App.model.selected.clear();
        App.afterSelectionChange();
        App.updatePrompt();
        App.updateParams();
        return;
      }
      const sel = App.model.selected;
      if (sel.size === 1 && sel.has(hit.id)) return; // 已选中，保持
      sel.clear();
      sel.add(hit.id);
      App.afterSelectionChange();
      App.updatePrompt();
      App.updateParams();
    },
    onHover: function (p) {
      this.hover = p;
      // 精确模式不在这里自动选中，交由 onTap 手动点选，避免覆盖已有选择
    },
    onDragStart: function (p) {
      if (App.params.stp) return; // 精确模式下互斥：仅通过点选 + 参数确定
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
      App.solveConstraints();
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
    applyParams: function () {
      if (!App.params.stp) return;
      const sel = App.model.selectedEntities();
      if (sel.length === 0) { App.toast('请先选中一个图元'); return; }
      if (sel.length > 1) { App.toast('精确拉伸每次仅处理一个图元'); return; }
      const e = sel[0];
      if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle') {
        App.toast('精确拉伸仅支持直线 / 圆弧 / 圆'); return;
      }
      const raw = App.params.sdd;
      const delta = Number(raw);
      if (!isFinite(delta)) { App.toast('增量必须是有效数值'); return; }
      if (Math.abs(delta) > PRECISE_STRETCH_MAX) {
        App.toast('增量超出允许范围（±' + PRECISE_STRETCH_MAX + '）'); return;
      }
      const endpoint = App.params.sept || 'end';
      const res = preciseStretchPreview(e, delta, endpoint);
      if (!res.ok) { App.toast(res.reason); return; }
      App.begin();
      Geo.copyShape(e, res.entity);
      App.solveConstraints();
      App.end();
      // 提交后重置增量值，避免 onRender 用相同 delta 在新实体上再叠加画一层覆盖性预览虚线
      App.params.sdd = 0;
      if (typeof App.updateParams === 'function') App.updateParams();
      if (typeof App.refresh === 'function') App.refresh();
      const deltaTxt = (delta >= 0 ? '+' : '') + fmt(delta);
      const ep = e.type === 'line' || e.type === 'arc'
        ? (endpoint === 'start' ? '起点' : '终点')
        : '';
      const lbl = e.type === 'line' ? '直线' : e.type === 'arc' ? '圆弧' : '圆';
      App.toast('已拉伸 ' + lbl + (ep ? '·' + ep : '') + '（增量 ' + deltaTxt + '）');
    },
    onParamChange: function () {
      App.refresh();
    },
    onRender: function (ctx, R) {
      // 自由拖拽预览
      if (this.active) {
        R.previewLabel('拉伸中', this.hover || { x: 0, y: 0 });
        return;
      }
      // 精确模式：预览
      if (!App.params.stp) return;
      const sel = App.model.selectedEntities();
      if (sel.length !== 1) return;
      const e = sel[0];
      if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle') return;
      const delta = Number(App.params.sdd) || 0;
      const endpoint = App.params.sept || 'end';
      const res = preciseStretchPreview(e, delta, endpoint);
      const screen = R.screen;
      if (!res.ok) {
        // 画红色虚线提示不可行
        const sp = screen(e.type === 'line' ? Geo.entityMidpoint(e) : e.c || e.p);
        R.previewLabel('不可行：' + res.reason, sp);
        return;
      }
      const ne = res.entity;
      // delta=0 时预览与原线完全重合，不画蓝色虚线以免盖住选中高亮，只给标签
      if (!delta) {
        const mid = ne.type === 'line' ? screen(Geo.entityMidpoint(ne)) : screen(ne.c || ne.p);
        R.previewLabel('增量 0（当前无变化）', mid);
        return;
      }
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#37c8ff';
      ctx.fillStyle = 'rgba(55, 200, 255, .22)';
      ctx.lineWidth = 1.5;
      if (ne.type === 'line') {
        const p1 = screen(ne.p1), p2 = screen(ne.p2);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.fillStyle = 'rgba(55, 200, 255, .2)';
        const mid = screen(Geo.entityMidpoint(ne));
        R.previewLabel((endpoint === 'start' ? '起点' : '终点') + (delta >= 0 ? ' +' : ' ') + fmt(delta), mid);
      } else if (ne.type === 'arc') {
        const c = screen(ne.c);
        const r = ne.r * App.view.scale;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, -ne.a0, -ne.a1, ne.ccw);
        ctx.stroke();
        const deltaSweep = delta / ne.r;
        const deltaSweepTxt = (delta >= 0 ? '+' : '') + fmt(delta) + '（弧长）';
        R.previewLabel((endpoint === 'start' ? '起点' : '终点') + ' ' + deltaSweepTxt, c);
      } else if (ne.type === 'circle') {
        const c = screen(ne.c);
        const r = ne.r * App.view.scale;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Geo.TAU, true); ctx.stroke();
        R.previewLabel('半径 ' + (delta >= 0 ? '+' : '') + fmt(delta), c);
      }
      ctx.restore();
    }
  });

  /* ================= 编辑：平移 ================= */
  const MOVE_COPY_KEY = 'cad.move.copy';
  function moveCopyDefault() {
    try { return localStorage.getItem(MOVE_COPY_KEY) === '1'; } catch (e) { return false; }
  }
  /** 平移复制：保留原对象，额外生成一份位置不变的副本 */
  function addMoveCopies(list) {
    list.forEach(function (e) { App.model.add(JSON.parse(JSON.stringify(e))); });
  }

  const moveTool = baseTool({
    id: 'move', name: '平移', cat: 'edit', icon: '↔', dragType: 'tool',
    mtoBase: null,
    reset: function () {
      this.points = [];
      this.hover = null;
      this.mtoBase = null;
      this.active = false;
      this.panning = false;
      this.clones = null;
    },
    prompt: function () {
      const suffix = App.params.mcopy ? '（复制模式：保留原图形并生成副本）' : '';
      if (App.params.mto) {
        const n = App.model.selected.size;
        if (!n) return '移动到：点按图形选择要移动的元素' + suffix;
        if (!this.mtoBase) return '已选 ' + n + ' 个，点按图形拾取基准点（自动吸附端点/圆心/交点）' + suffix;
        return '基准点（' + fmt(this.mtoBase.x) + '，' + fmt(this.mtoBase.y) +
          '）：点按目标位置，或输入目标 X/Y 后确定' + suffix;
      }
      if (App.params.multi) {
        const n = App.model.selected.size;
        return (n ? '已选 ' + n + ' 个，继续点选，输入 X/Y 偏移后确定' : '点按图形连续选择（可多选），输入偏移后确定') + suffix;
      }
      return '拖动图形平移，或输入 X/Y 偏移后确定' + suffix;
    },
    /** 把选中元素的基准点精确移动到目标坐标（tx, ty） */
    _moveToTarget: function (tx, ty) {
      const list = App.model.selectedEntities();
      if (!list.length) { App.toast('请先选中一个或多个图形'); return false; }
      const base = this.mtoBase;
      if (!base) { App.toast('请先在图形上点选基准点'); return false; }
      if (!isFinite(tx) || !isFinite(ty)) { App.toast('请输入有效的目标坐标'); return false; }
      const dx = tx - base.x, dy = ty - base.y;
      if (!isFinite(dx) || !isFinite(dy)) { App.toast('移动距离超出有效范围'); return false; }
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
        App.toast('基准点已在目标位置');
        return false;
      }
      App.begin();
      if (App.params.mcopy) addMoveCopies(list);
      list.forEach(function (e) { Geo.translateEntity(e, dx, dy); });
      App.end();
      App.params.tx = round3(tx);
      App.params.ty = round3(ty);
      this.mtoBase = null;
      App.afterSelectionChange();
      if (App.updateParams) App.updateParams();
      App.updatePrompt();
      App.toast(App.params.mcopy
        ? '已将基准点移动到（' + fmt(tx) + '，' + fmt(ty) + '），原图形已保留'
        : '已将基准点移动到（' + fmt(tx) + '，' + fmt(ty) + '）');
      return true;
    },
    params: function () {
      const mto = function (p) { return p.mto === true; };
      const offsetMode = function (p) { return p.mto !== true; };
      return [
        { key: 'multi', type: 'toggle', label: '连续选择', def: false, group: '选择', when: offsetMode },
        { key: 'mto', type: 'toggle', label: '移动到', def: false, group: '移动方式' },
        { key: 'mcopy', type: 'toggle', label: '复制', def: moveCopyDefault(), group: '移动方式' },
        { key: 'tx', label: '目标 X', def: 0, group: '目标坐标', when: mto },
        { key: 'ty', label: '目标 Y', def: 0, group: '目标坐标', when: mto },
        { key: 'mx', label: 'X 偏移', def: 0, group: '偏移量', when: offsetMode },
        { key: 'my', label: 'Y 偏移', def: 0, group: '偏移量', when: offsetMode }
      ];
    },
    onTap: function (p) {
      if (App.params.mto) {
        const sel = App.model.selected;
        const hit = App.pick(p);
        // 1) 还没有选中元素：点按选择
        if (!sel.size) {
          if (hit) {
            sel.add(hit.id);
            App.afterSelectionChange();
            App.updatePrompt();
            App.toast('已选中图形，请点按拾取基准点');
          }
          return;
        }
        // 2) 已选中但未定基准点：点按元素切换选中，点按任意位置拾取基准点
        if (!this.mtoBase) {
          if (hit && !sel.has(hit.id)) {
            sel.clear();
            sel.add(hit.id);
            App.afterSelectionChange();
            App.updatePrompt();
            App.toast('已切换选中图形，请点按拾取基准点');
            return;
          }
          const q = App.snapPoint(p);
          this.mtoBase = { x: q.x, y: q.y };
          App.updatePrompt();
          App.toast('基准点（' + fmt(q.x) + '，' + fmt(q.y) + '），点按目标位置或输入坐标');
          return;
        }
        // 3) 已有基准点：点按确定目标位置
        const q = App.snapPoint(p);
        this._moveToTarget(q.x, q.y);
        return;
      }
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
    onParamChange: function (key) {
      if (key === 'mto') this.mtoBase = null;
      if (key === 'mcopy') {
        try { localStorage.setItem(MOVE_COPY_KEY, App.params.mcopy ? '1' : '0'); } catch (e) {}
      }
    },
    applyParams: function () {
      const list = App.model.selectedEntities();
      if (!list.length) { App.toast('请先选中一个或多个图形'); return; }
      if (App.params.mto) {
        const rawX = App.params.tx, rawY = App.params.ty;
        if (rawX === '' || rawY === '' || rawX == null || rawY == null) { App.toast('请输入目标坐标 X/Y'); return; }
        const tx = Number(rawX), ty = Number(rawY);
        if (!isFinite(tx) || !isFinite(ty)) { App.toast('请输入有效的目标坐标'); return; }
        if (!this.mtoBase) { App.toast('请先在图形上点选基准点'); return; }
        this._moveToTarget(tx, ty);
        return;
      }
      const dx = Number(App.params.mx), dy = Number(App.params.my);
      if (!isFinite(dx) || !isFinite(dy)) { App.toast('请输入有效的偏移数值'); return; }
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) { App.toast('X/Y 偏移量不能同时为 0'); return; }
      App.begin();
      if (App.params.mcopy) addMoveCopies(list);
      list.forEach(function (e) { Geo.translateEntity(e, dx, dy); });
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast(App.params.mcopy
        ? '已平移并复制 ' + list.length + ' 个图元（ΔX ' + fmt(dx) + '，ΔY ' + fmt(dy) + '）'
        : '已平移 ' + list.length + ' 个图元（ΔX ' + fmt(dx) + '，ΔY ' + fmt(dy) + '）');
    },
    onDragStart: function (p) {
      // 移动到模式：拖动用于平移视图，避免误移动图形
      if (App.params.mto) { this.panning = true; this.last = p; return; }
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
      if (App.params.mcopy) addMoveCopies(App.model.selectedEntities());
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
      // 拖动过程中实时求解，关联端点同步跟随
      App.solveConstraints();
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
    _polar: function () { return App.params.amode !== 'rect'; },
    prompt: function () {
      const n = App.model.selected.size;
      if (this._polar()) {
        return (n ? '已选 ' + n + ' 个，' : '点按图形选择（可多选），') +
          '再点按画布空白处指定圆心，立即生成环形阵列';
      }
      const tail = '设置行列与间距后确定';
      return n ? '已选 ' + n + ' 个，' + tail : '点按图形选择（可多选），' + tail;
    },
    params: function () {
      const rect = function (p) { return p.amode === 'rect'; };
      const polar = function (p) { return p.amode !== 'rect'; };
      return [
        {
          key: 'amode', type: 'choice', label: '阵型', def: 'polar', group: '阵列类型',
          options: [{ v: 'polar', label: '环形' }, { v: 'rect', label: '矩形' }]
        },
        { key: 'rows', label: '行数', def: 2, group: '阵列数量', positive: true, when: rect },
        { key: 'cols', label: '列数', def: 3, group: '阵列数量', positive: true, when: rect },
        { key: 'rgap', label: '行距', def: 40, group: '阵列间距', when: rect },
        { key: 'cgap', label: '列距', def: 40, group: '阵列间距', when: rect },
        { key: 'pcount', label: '数量', def: 6, group: '环形数量', positive: true, when: polar },
        { key: 'pangle', label: '总角度°', def: 360, group: '环形角度', when: polar },
        { key: 'pcx', label: '圆心 X', def: 0, group: '环形中心', when: polar },
        { key: 'pcy', label: '圆心 Y', def: 0, group: '环形中心', when: polar }
      ];
    },
    onTap: function (p) {
      const e = App.pick(p);
      const sel = App.model.selected;
      // 环形阵列：点按画布空白处即指定圆心并立即生成
      if (this._polar() && !e) {
        if (!sel.size) {
          App.toast('请先点按图形选择要阵列的对象');
          App.updatePrompt();
          return;
        }
        App.params.pcx = round3(p.x);
        App.params.pcy = round3(p.y);
        if (App.updateParams) App.updateParams();
        this.applyParams();
        App.refresh();
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
        const cxRaw = App.params.pcx, cyRaw = App.params.pcy;
        const cx = Number(cxRaw), cy = Number(cyRaw);
        const hasCenter = cxRaw !== '' && cyRaw !== '' && cxRaw != null && cyRaw != null &&
          isFinite(cx) && isFinite(cy);
        if (hasCenter) center = { x: cx, y: cy };
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
      if (!this._polar()) {
        if (!App.model.selected.size) return;
        const plan = this._plan();
        if (plan.error) return;
        this._copies(plan).forEach(function (c) { R.ghostEntity(c); });
        return;
      }
      // 环形：悬停点作为暂定圆心预览，点按后固定为实际圆心；圆心始终以十字标记显示
      let center = null;
      if (App.model.selected.size && this.hover) {
        center = { x: this.hover.x, y: this.hover.y };
      } else {
        const cx = Number(App.params.pcx), cy = Number(App.params.pcy);
        if (isFinite(cx) && isFinite(cy)) center = { x: cx, y: cy };
      }
      if (App.model.selected.size) {
        const plan = this._plan();
        if (!plan.error) {
          if (center) plan.center = center;
          this._copies(plan).forEach(function (c) { R.ghostEntity(c); });
        }
      }
      if (center) R.previewMarker(center, '圆心');
    }
  });

  /* ================= 编辑：镜像 ================= */
  const mirrorTool = baseTool({
    id: 'mirror', name: '镜像', cat: 'edit', icon: '⇋', dragType: 'pan',
    prompt: function () {
      const n = App.model.selected.size;
      if (!n) return '点按选择要镜像的图形（可多选），再点按一条直线作为镜像轴';
      return '已选 ' + n + ' 个：点按一条直线作为镜像轴，立即生成镜像';
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
      if (sel.size && e.type === 'line') {
        this._mirrorAbout(e.p1, e.p2);
        return;
      }
      if (sel.has(e.id)) sel.delete(e.id);
      else sel.add(e.id);
      App.afterSelectionChange();
      App.updatePrompt();
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
    onRender: function (ctx, R) {
      if (!App.model.selected.size || !this.hover) return;
      const h = App.pick(this.hover);
      if (!h || h.type !== 'line') return;
      const axis = [h.p1, h.p2];
      R.previewMarker(Geo.entityMidpoint(h), '镜像轴');
      if (Geo.dist(axis[0], axis[1]) < 1e-6) return;
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

  /* ================= 编辑：组合 / 分解 ================= */
  /** 可参与组合的独立图元（≥2 个且全部不是组合对象） */
  function groupCandidates() {
    const sel = App.model.selected;
    const list = App.model.selectedEntities();
    if (sel.size < 2 || list.length !== sel.size) return [];
    for (let i = 0; i < list.length; i++) if (list[i].type === 'group') return [];
    return list;
  }

  /** 可分解的组合对象（恰好选中 1 个） */
  function ungroupCandidate() {
    const list = App.model.selectedEntities();
    if (list.length !== 1 || list[0].type !== 'group') return null;
    return list[0];
  }

  const groupTool = baseTool({
    id: 'group', name: '组合', cat: 'edit', icon: '▣', dragType: 'pan',
    enabled: function () { return groupCandidates().length >= 2; },
    prompt: function () {
      const n = groupCandidates().length;
      return n >= 2
        ? '已选 ' + n + ' 个独立图元，点按画布即可组合为一个整体'
        : '请先选择 2 个及以上独立图元';
    },
    activate: function () { this.reset(); this.apply(); },
    onTap: function () { this.apply(); },
    apply: function () {
      const list = App.model.selectedEntities();
      const ok = list.length >= 2 && list.length === App.model.selected.size &&
        list.every(function (e) { return e.type !== 'group'; });
      if (!ok) { App.toast('未满足组合条件：请选择 2 个及以上独立图元'); return false; }
      const ids = new Set(list.map(function (e) { return e.id; }));
      const ordered = App.model.entities.filter(function (e) { return ids.has(e.id); });
      if (ordered.length < 2) { App.toast('未满足组合条件：请选择 2 个及以上独立图元'); return false; }
      const firstIdx = App.model.entities.indexOf(ordered[0]);
      App.begin();
      App.model.entities = App.model.entities.filter(function (e) { return !ids.has(e.id); });
      const group = App.model.add({ type: 'group', children: ordered });
      // add 会追加到末尾，移动到首个被选图元的位置以保持绘制层级
      App.model.entities.pop();
      App.model.entities.splice(Math.min(firstIdx, App.model.entities.length), 0, group);
      App.model.selected.clear();
      App.model.selected.add(group.id);
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已组合：' + ordered.length + ' 个图元合并为 1 个整体');
      return true;
    }
  });

  const ungroupTool = baseTool({
    id: 'ungroup', name: '分解', cat: 'edit', icon: '⧅', dragType: 'pan',
    enabled: function () { return !!ungroupCandidate(); },
    prompt: function () {
      return ungroupCandidate() ? '已选组合对象，点按画布即可分解为独立图元' : '请先选中一个已组合的整体对象';
    },
    activate: function () { this.reset(); this.apply(); },
    onTap: function () { this.apply(); },
    apply: function () {
      const g = ungroupCandidate();
      if (!g) { App.toast('未满足分解条件：请选择一个组合对象'); return false; }
      const idx = App.model.entities.indexOf(g);
      const children = (g.children || []).slice();
      App.begin();
      App.model.remove(g.id);
      const pos = Math.max(0, Math.min(idx, App.model.entities.length));
      App.model.entities.splice.apply(App.model.entities, [pos, 0].concat(children));
      App.model.selected.clear();
      children.forEach(function (c) { App.model.selected.add(c.id); });
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已分解：' + children.length + ' 个图元恢复为独立对象');
      return true;
    }
  });

  /* ================= 编辑：元素分解 ================= */
  /** 复合图形的边 → 独立直线段（保留原线型，坐标不做任何偏移） */
  function entitySegments(ent) {
    const segs = [];
    let pts = null, closed = false;
    if (ent.type === 'rect') {
      pts = Geo.rectPoints(ent);
      closed = true;
    } else if (ent.type === 'poly' && ent.pts && ent.pts.length >= 2) {
      pts = ent.pts;
      closed = ent.closed !== false;
    }
    if (!pts) return segs;
    const n = pts.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (Geo.dist(a, b) < 1e-9) continue;
      const seg = { type: 'line', p1: { x: a.x, y: a.y }, p2: { x: b.x, y: b.y } };
      if (typeof ent.style === 'string') seg.style = ent.style;
      segs.push(seg);
    }
    return segs;
  }

  function entityHitsRect(ent, rect) {
    if (!rect) return true;
    const pts = Geo.entityPolyline(ent, 32);
    for (let i = 0; i < pts.length; i++) {
      if (Geo.pointInRect(pts[i], rect)) return true;
      if (i < pts.length - 1 && Geo.segmentIntersectsRect(pts[i], pts[i + 1], rect)) return true;
    }
    return false;
  }

  /** 递归分解：组合对象保留自身结构，仅替换其中的复合子图元 */
  function explodeList(list, rect) {
    const out = [];
    let shapes = 0, lines = 0;
    list.forEach(function (ent) {
      if (ent.type === 'group') {
        const sub = explodeList(ent.children || [], rect);
        if (sub.shapes) {
          const g = Object.assign({}, ent);
          g.children = sub.items;
          shapes += sub.shapes;
          lines += sub.lines;
          out.push(g);
        } else {
          out.push(ent);
        }
        return;
      }
      if (!entityHitsRect(ent, rect)) { out.push(ent); return; }
      const segs = entitySegments(ent);
      if (!segs.length) { out.push(ent); return; }
      shapes += 1;
      lines += segs.length;
      segs.forEach(function (s) { out.push(s); });
    });
    return { items: out, shapes: shapes, lines: lines };
  }

  const explodeTool = baseTool({
    id: 'explode', name: '元素分解', cat: 'edit', icon: '⌗', dragType: 'tool',
    band: null,
    reset: function () {
      this.points = [];
      this.hover = null;
      this.band = null;
    },
    prompt: function () {
      if (App.params.scope === 'region') {
        return this.band ? '松开手指分解框选区域内的复合图形' : '在画布上拖动框选分解区域（与区域相交即分解）';
      }
      return '点按“确定”分解全部轮廓线 / 矩形 / 多边形（含组合内部）';
    },
    params: function () {
      return [
        {
          key: 'scope', type: 'choice', label: '分解范围', def: 'all', group: '范围', apply: true,
          options: [{ v: 'all', label: '全部元素' }, { v: 'region', label: '指定区域' }]
        }
      ];
    },
    onParamChange: function (key) {
      if (key === 'scope') { this.band = null; App.refresh(); }
    },
    activate: function () { this.reset(); },
    deactivate: function () { this.reset(); },
    onTap: function () {
      if (App.params.scope === 'region') { App.toast('请在画布上拖动框选分解区域'); return; }
      this.applyParams();
    },
    onDragStart: function (p) {
      if (App.params.scope !== 'region') return;
      this.band = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    },
    onDragMove: function (p) {
      if (!this.band) return;
      this.band.x2 = p.x;
      this.band.y2 = p.y;
      App.refresh();
    },
    onDragEnd: function (p) {
      if (!this.band) return;
      this.band.x2 = p.x;
      this.band.y2 = p.y;
      const rect = Geo.normalizeRect(this.band.x1, this.band.y1, this.band.x2, this.band.y2);
      this.band = null;
      this._explode(rect);
    },
    onDragCancel: function () {
      this.band = null;
      App.refresh();
    },
    onRender: function (ctx, R) {
      if (!this.band) return;
      R.previewRect(Geo.normalizeRect(this.band.x1, this.band.y1, this.band.x2, this.band.y2));
    },
    applyParams: function () {
      if (App.params.scope === 'region') { App.toast('请先在画布上拖动框选分解区域'); return; }
      this._explode(null);
    },
    _explode: function (rect) {
      const res = explodeList(App.model.entities, rect);
      if (!res.shapes) { App.toast('没有可分解的轮廓线 / 矩形 / 多边形'); return false; }
      App.begin();
      App.model.entities = res.items;
      App.model.ensureIds(App.model.entities);
      Array.from(App.model.selected).forEach(function (id) {
        if (!App.model.findById(id)) App.model.selected.delete(id);
      });
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已分解 ' + res.shapes + ' 个复合图形，生成 ' + res.lines + ' 条独立线段');
      return true;
    }
  });

  /* ================= 编辑：填充 ================= */
  const FILL_NAMES = { blue: '蓝色', green: '绿色', orange: '橙色', purple: '紫色' };

  function canFillEnt(ent) {
    if (!ent) return false;
    if (ent.type === 'rect' || ent.type === 'circle') return true;
    if (ent.type === 'poly') return ent.closed !== false;
    if (ent.type === 'spline') return !!ent.closed;
    return false;
  }

  /** 写入填充色；返回实际填充的图形数量（组合对象递归处理） */
  function applyFill(ent, color) {
    if (!ent) return 0;
    if (ent.type === 'group') {
      let n = 0;
      (ent.children || []).forEach(function (c) { n += applyFill(c, color); });
      return n;
    }
    if (!canFillEnt(ent)) return 0;
    ent.fill = color;
    return 1;
  }

  const fillTool = baseTool({
    id: 'fill', name: '填充', cat: 'edit', icon: '▨', dragType: 'pan',
    _color: function () { return App.params.fcolor || 'blue'; },
    prompt: function () {
      if (App.params.fmode === 'cont') return '连续填充：点按矩形 / 圆 / 闭合轮廓即可填充，可连续点按';
      const n = App.model.selected.size;
      return n ? '规则填充：已选 ' + n + ' 个，点“确定”批量填充' : '规则填充：先选中图形，再点“确定”批量填充';
    },
    params: function () {
      return [
        {
          key: 'fmode', type: 'choice', label: '填充模式', def: 'batch', group: '填充', apply: true,
          options: [{ v: 'batch', label: '规则填充' }, { v: 'cont', label: '连续填充' }]
        },
        {
          key: 'fcolor', type: 'choice', label: '填充色', def: 'blue', group: '填充',
          options: [
            { v: 'blue', label: '蓝色' }, { v: 'green', label: '绿色' },
            { v: 'orange', label: '橙色' }, { v: 'purple', label: '紫色' }
          ]
        }
      ];
    },
    onTap: function (p) {
      if (App.params.fmode !== 'cont') return;
      const e = App.pick(p);
      if (!e) { App.toast('请点按图形边缘进行填充'); return; }
      const color = this._color();
      App.begin();
      const n = applyFill(e, color);
      if (!n) {
        App.abort();
        App.toast('该图形不支持填充（仅矩形 / 圆 / 闭合轮廓 / 闭合样条）');
        return;
      }
      App.end();
      App.afterSelectionChange();
      App.toast('已填充 ' + n + ' 个图形（' + (FILL_NAMES[color] || color) + '）');
    },
    applyParams: function () {
      const list = App.model.selectedEntities();
      if (!list.length) { App.toast('请先选中要填充的图形'); return; }
      const color = this._color();
      App.begin();
      let n = 0;
      list.forEach(function (e) { n += applyFill(e, color); });
      if (!n) {
        App.abort();
        App.toast('所选图形不支持填充（仅矩形 / 圆 / 闭合轮廓 / 闭合样条）');
        return;
      }
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已填充 ' + n + ' 个图形（' + (FILL_NAMES[color] || color) + '）');
    }
  });

  /* ================= 编辑：比例缩放 ================= */
  const SCALE_LOCK_KEY = 'cad.scale.proportional';
  function scaleLockDefault() {
    try { return localStorage.getItem(SCALE_LOCK_KEY) === '1'; } catch (e) { return false; }
  }

  function scaleSelBBox() {
    const list = App.model.selectedEntities();
    return list.length ? Geo.bboxOf(list) : null;
  }

  function scaleCorners(b) {
    return [
      { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 },
      { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }
    ];
  }

  function hitScaleCorner(b, p, tol) {
    const pts = scaleCorners(b);
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i].x - p.x) <= tol && Math.abs(pts[i].y - p.y) <= tol) return i;
    }
    return -1;
  }

  const scaleTool = baseTool({
    id: 'scale', name: '缩放', cat: 'edit', icon: '⤢', dragType: 'tool',
    reset: function () {
      this.points = [];
      this.hover = null;
      this.drag = null;
      this.clones = null;
      this.active = false;
    },
    prompt: function () {
      if (!App.model.selected.size) return '请先选中要缩放的图形';
      if (this.drag) {
        const pct = Math.round(this.drag.factor * 100);
        const mode = this.drag.prop ? '等比' : '自由';
        return mode + '缩放 ' + pct + '% · 松手完成' + (this.drag.prop ? '' : '（按住 Shift 等比）');
      }
      return App.params.slock
        ? '拖动角点等比缩放；输入百分比后点“确定”精确缩放'
        : '拖动角点自由缩放，按住 Shift 等比；输入百分比后点“确定”';
    },
    params: function () {
      return [
        { key: 'slock', type: 'toggle', label: '等比例', def: scaleLockDefault(), group: '缩放方式' },
        { key: 'spct', label: '缩放百分比', def: 100, group: '数值缩放', apply: true }
      ];
    },
    onParamChange: function (key) {
      if (key === 'slock') {
        try { localStorage.setItem(SCALE_LOCK_KEY, App.params.slock ? '1' : '0'); } catch (e) {}
      }
    },
    activate: function () { this.reset(); },
    deactivate: function () { this.reset(); },
    onTap: function () {},
    onDragStart: function (p) {
      const b = scaleSelBBox();
      if (!b) { App.toast('请先选中要缩放的图形'); return; }
      const idx = hitScaleCorner(b, p, App.worldTol(16));
      if (idx < 0) return;
      const corners = scaleCorners(b);
      this.clones = App.model.cloneSelected();
      this.drag = {
        anchor: corners[(idx + 2) % 4],
        start: corners[idx],
        sx: 1, sy: 1, factor: 1,
        prop: !!(App.params.slock || App.shiftKey)
      };
      App.begin();
      this.active = true;
    },
    onDragMove: function (p) {
      if (!this.active || !this.drag) return;
      const d = this.drag;
      const dx0 = d.start.x - d.anchor.x;
      const dy0 = d.start.y - d.anchor.y;
      if (Math.abs(dx0) < 1e-9 || Math.abs(dy0) < 1e-9) return;
      let sx = (p.x - d.anchor.x) / dx0;
      let sy = (p.y - d.anchor.y) / dy0;
      sx = Math.max(0.01, sx);
      sy = Math.max(0.01, sy);
      const prop = !!(App.params.slock || App.shiftKey);
      if (prop) {
        const s = Math.max(sx, sy);
        sx = s;
        sy = s;
      }
      d.sx = sx;
      d.sy = sy;
      d.prop = prop;
      d.factor = prop ? sx : Math.sqrt(sx * sy);
      this._apply(sx, sy);
      App.updatePrompt();
      App.refresh();
    },
    _apply: function (sx, sy) {
      const d = this.drag;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (!e) return;
        Geo.copyShape(e, c);
        Geo.scaleEntity(e, d.anchor, sx, sy);
      });
      App.solveConstraints();
    },
    onDragEnd: function () {
      if (!this.active) return;
      const d = this.drag;
      this.active = false;
      this.drag = null;
      this.clones = null;
      App.end();
      App.afterSelectionChange();
      App.updatePrompt();
      App.toast('已缩放 ' + Math.round((d ? d.factor : 1) * 100) + '%' + (d && d.prop ? '（等比）' : ''));
    },
    onDragCancel: function () {
      if (!this.active) return;
      this.clones.forEach(function (c) {
        const e = App.model.findById(c.id);
        if (e) Geo.copyShape(e, c);
      });
      this.active = false;
      this.drag = null;
      this.clones = null;
      App.abort();
      App.refresh();
    },
    applyParams: function () {
      const list = App.model.selectedEntities();
      if (!list.length) { App.toast('请先选中要缩放的图形'); return; }
      const pct = Number(App.params.spct);
      if (!isFinite(pct) || pct <= 0) { App.toast('请输入大于 0 的缩放百分比'); return; }
      if (Math.abs(pct - 100) < 1e-9) { App.toast('缩放百分比为 100%，无需缩放'); return; }
      const s = pct / 100;
      const b = Geo.bboxOf(list);
      const base = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
      App.begin();
      list.forEach(function (e) { Geo.scaleEntity(e, base, s, s); });
      App.end();
      App.afterSelectionChange();
      if (App.updateParams) App.updateParams();
      App.updatePrompt();
      App.toast('已按 ' + round3(pct) + '% 等比缩放 ' + list.length + ' 个图元');
    },
    onRender: function (ctx, R) {
      const b = scaleSelBBox();
      if (!b) return;
      R.previewRect(b);
      const pts = scaleCorners(b);
      ctx.save();
      for (let i = 0; i < pts.length; i++) {
        const s = R.screen(pts[i]);
        ctx.fillStyle = '#1e90ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.fillRect(s.x - 5, s.y - 5, 10, 10);
        ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
      }
      ctx.restore();
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

  /* ================= 查询：智能标注（尺寸驱动） ================= */
  const dimTool = baseTool({
    id: 'dim', name: '智能标注', cat: 'query', icon: '⇥', dragType: 'pan', hoverLive: true,
    prompt: function () {
      if (App.params.dmode === 'parallel') {
        if (!this.picks || !this.picks.length) {
          return '平行距离标注：依次点按两条平行直线，或拖动框选两条平行线段';
        }
        return '平行距离标注：点按第二条平行直线（已选 1 条）';
      }
      if (App.params.dmode === 'angle') {
        if (!this.picks || !this.picks.length) return '角度标注：点按第一条相交直线 / 圆弧';
        return '角度标注：点按第二条直线 / 圆弧';
      }
      if (this.picks && this.picks.length) {
        return '智能标注：再点一条直线自动判断平行距离 / 夹角，或点按空白处创建线性标注';
      }
      return '点按直线开始标注：选两条直线自动判断距离 / 角度；点按圆 / 圆弧直接标注';
    },
    params: function () {
      return [
        {
          key: 'dmode', type: 'choice', label: '标注模式', def: 'auto', group: '标注', options: [
            { v: 'auto', label: '自动' }, { v: 'angle', label: '角度' }, { v: 'parallel', label: '平行距离' }
          ]
        },
        { key: 'dortho', type: 'toggle', label: '正交标注', def: false, group: '标注' },
        { key: 'dshow', type: 'toggle', label: '显示标注', def: true, group: '标注' }
      ];
    },
    reset: function () {
      this.picks = [];
      this.hoverEnt = null;
      this.band = null;
    },
    /** 平行距离模式需要框选，因此拖动不再平移视图 */
    _syncDragType: function () {
      this.dragType = App.params.dmode === 'parallel' ? 'tool' : 'pan';
      return this.dragType;
    },
    activate: function () { this.reset(); this._syncDragType(); },
    deactivate: function () { this.reset(); },
    onParamChange: function (key) {
      if (key === 'dmode') {
        this.reset();
        this._syncDragType();
      }
    },
    onHover: function (p) {
      this.hover = p;
      this.hoverEnt = App.pick(p);
    },
    onTap: function (p) {
      if (App.params.dmode === 'parallel') { this._pickParallel(p); return; }
      if (App.params.dmode === 'angle') { this._pickAngle(p); return; }
      this._pickAuto(p);
    },
    /**
     * 自动模式：点选单条直线只做选中（不建标注、不弹信息框）；
     * 再点另一条直线自动判断平行距离 / 夹角；点按空白处为已选直线创建线性标注。
     */
    _pickAuto: function (p) {
      const D = global.CADDims;
      if (!D) return;
      const e = App.pick(p);
      if (!e) {
        if (this.picks.length === 1) {
          const ent = App.model.findById(this.picks[0]);
          this.reset();
          if (ent && ent.type === 'line') this._createLinear(ent);
          App.updatePrompt();
          App.refresh();
          return;
        }
        this.reset();
        App.toast('请点按直线、圆或圆弧');
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (e.type === 'line') {
        if (!this.picks.length) {
          this.picks = [e.id];
          App.toast('已选择直线：再点一条直线自动标注距离 / 角度，或点按空白处创建线性标注');
          App.updatePrompt();
          App.refresh();
          return;
        }
        if (this.picks[0] === e.id) { App.toast('请点按另一条直线'); return; }
        const a = App.model.findById(this.picks[0]);
        if (!a) { this.reset(); App.toast('所选直线已不存在，请重新选择'); App.refresh(); return; }
        const check = D.parallelCheck(a, e);
        if (check.ok) {
          this.reset();
          this._createParallel(a.id, e.id);
          return;
        }
        if (/重合/.test(check.error)) {
          this.reset();
          App.toast(check.error);
          App.updatePrompt();
          App.refresh();
          return;
        }
        this.reset();
        this._createAngle(a.id, e.id);
        return;
      }
      // 圆 / 圆弧：直接生成直径 / 半径标注，但不自动弹出信息框
      const kind = D.kindOf(e);
      if (!kind) { App.toast('点暂不支持智能标注'); return; }
      const exist = D.findFor(App.model, e.id, kind);
      if (exist) {
        App.toast('已存在该' + D.nameOf(kind) + '，可点按其数值修改');
        return;
      }
      App.begin();
      App.model.addDim({ kind: kind, entId: e.id, offset: App.worldTol(30) });
      App.end();
      App.toast('已生成' + D.nameOf(kind));
      App.refresh();
    },
    /** 为单条直线创建线性尺寸 */
    _createLinear: function (e) {
      const D = global.CADDims;
      if (!D) return;
      const exist = D.findFor(App.model, e.id, 'length');
      if (exist) {
        App.toast('该直线已有线性尺寸，可点按其数值修改');
        return;
      }
      App.begin();
      App.model.addDim({ kind: 'length', entId: e.id, offset: App.worldTol(30) });
      App.end();
      App.toast('已生成线性尺寸');
    },
    /** 为两条非平行直线创建角度标注 */
    _createAngle: function (idA, idB) {
      const D = global.CADDims;
      if (!D) return;
      const exist = D.findAngleFor(App.model, idA, idB);
      if (exist) {
        App.toast('已存在该角度标注，可点按其数值修改');
        App.refresh();
        return;
      }
      const draft = { kind: 'angle', ids: [idA, idB] };
      const g = D.angleGeomFor(App.model, draft);
      if (!g) { App.toast('两条直线没有有效交点，无法测量角度'); App.refresh(); return; }
      App.begin();
      draft.offset = App.worldTol(46);
      App.model.addDim(draft);
      App.end();
      App.toast('已生成角度标注 ' + fmt(g.deg) + '°');
      App.refresh();
    },
    /** 角度标注：依次点选两条直线 / 圆弧 */
    _pickAngle: function (p) {
      const D = global.CADDims;
      if (!D) return;
      const e = App.pick(p);
      if (!e) { App.toast('请点按直线、圆或圆弧'); return; }
      if (!(e.type === 'line' || conCircleLike(e))) {
        App.toast('角度标注仅支持直线与圆弧'); return;
      }
      if (!this.picks.length) {
        this.picks = [e.id];
        App.toast('已选择第一个图形，请点按第二个相交图形');
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks[0] === e.id) { App.toast('请点按另一个图形'); return; }
      const idA = this.picks[0];
      this.reset();
      this._createAngle(idA, e.id);
      App.updatePrompt();
      App.refresh();
    },
    /** 平行距离标注：依次点按两条平行直线 */
    _pickParallel: function (p) {
      const D = global.CADDims;
      if (!D) return;
      const e = App.pick(p);
      if (!e) { App.toast('请点按直线'); return; }
      if (e.type !== 'line') { App.toast('平行距离标注仅支持直线'); return; }
      if (!this.picks.length) {
        this.picks = [e.id];
        App.toast('已选择第一条直线，请点按与其平行的第二条直线');
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks[0] === e.id) { App.toast('请点按另一条直线'); return; }
      const a = App.model.findById(this.picks[0]);
      const check = D.parallelCheck(a, e);
      if (!check.ok) { App.toast(check.error); return; }
      this._createParallel(this.picks[0], e.id);
    },
    /** 校验通过后创建 / 定位平行距离标注 */
    _createParallel: function (idA, idB) {
      const D = global.CADDims;
      if (!D) return;
      const exist = D.findParallelFor(App.model, idA, idB);
      if (exist) {
        this.reset();
        App.toast('已存在该平行距离标注，可点按其数值修改');
        App.updatePrompt();
        App.refresh();
        return;
      }
      const draft = { kind: 'pdist', ids: [idA, idB] };
      const g = D.parallelGeomFor(App.model, draft);
      if (!g) { App.toast('两条线段不平行，无法标注平行距离'); return; }
      App.begin();
      draft.param = g.mid;
      App.model.addDim(draft);
      App.end();
      this.reset();
      App.toast('已生成平行距离标注 ' + fmt(g.d) + '，可点按其数值修改');
      App.updatePrompt();
      App.refresh();
    },
    /* 框选两条平行直线 */
    onDragStart: function (p) {
      if (App.params.dmode !== 'parallel') return;
      this.band = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
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
      this.band = null;
      const list = App.model.entitiesInRect(r, true).filter(function (e) { return e.type === 'line'; });
      if (list.length !== 2) {
        App.toast('请框选两条平行直线（当前 ' + list.length + ' 条）');
        App.refresh();
        return;
      }
      const D = global.CADDims;
      const check = D.parallelCheck(list[0], list[1]);
      if (!check.ok) { App.toast(check.error); App.refresh(); return; }
      this._createParallel(list[0].id, list[1].id);
    },
    onDragCancel: function () { this.band = null; },
    onRender: function (ctx, R) {
      if (App.params.dmode === 'parallel') {
        if (this.band) R.previewRect(Geo.normalizeRect(this.band.x1, this.band.y1, this.band.x2, this.band.y2));
        (this.picks || []).forEach(function (id) {
          const ent = App.model.findById(id);
          if (ent) R.ghostEntity(ent);
        });
        if (this.hoverEnt && this.picks.indexOf(this.hoverEnt.id) < 0) R.ghostEntity(this.hoverEnt);
        return;
      }
      if (App.params.dmode !== 'angle' && !(App.params.dmode === 'auto' && this.picks.length)) return;
      this.picks.forEach(function (id) {
        const ent = App.model.findById(id);
        if (ent) R.ghostEntity(ent);
      });
      if (this.hoverEnt && this.picks.indexOf(this.hoverEnt.id) < 0) R.ghostEntity(this.hoverEnt);
    }
  });

  /* ================= 几何约束工具 ================= */
  function conRep(e) {
    if (!e) return null;
    if (e.type === 'line') return Geo.lerp(e.p1, e.p2, 0.5);
    if (e.type === 'circle' || e.type === 'arc') return { x: e.c.x, y: e.c.y };
    if (e.type === 'point') return { x: e.p.x, y: e.p.y };
    if (e.type === 'rect' || e.type === 'poly' || e.type === 'spline') {
      const b = Geo.entityBBox(e);
      return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    }
    return null;
  }

  function conCircleLike(e) { return e && (e.type === 'circle' || e.type === 'arc'); }

  function commitConstraint(type, ids, extra) {
    const C = global.CADConstraints;
    if (!C) return null;
    App.begin();
    const con = App.model.addConstraint(Object.assign({ type: type, ids: ids.slice() }, extra || {}));
    C.solve(App.model);
    App.end();
    App.updatePrompt();
    return con;
  }

  function makeConstraintTool(cfg) {
    const tool = baseTool({
      id: cfg.id, name: cfg.name, cat: 'constraint', icon: cfg.icon, dragType: 'pan',
      hoverLive: true,
      prompt: function () { return cfg.prompt.call(this); },
      params: function () {
        const list = [{ key: 'cshow', type: 'toggle', label: '显示标记', def: true, group: '约束' }];
        if (cfg.type === 'distance') {
          list.push({ key: 'dv', label: '距离', def: 50, group: '约束', positive: true });
        }
        if (cfg.type === 'angle') {
          list.push({ key: 'av', label: '角度°', def: 60, group: '约束' });
        }
        if (cfg.type === 'overlap') {
          list.push({
            key: 'omode', type: 'choice', label: '重叠方式', def: 'full', group: '重叠',
            options: [{ v: 'full', label: '完全' }, { v: 'ratio', label: '比例' }]
          });
          list.push({
            key: 'oratio', label: '重叠比例%', def: 60, group: '重叠', positive: true,
            when: function (p) { return p.omode === 'ratio'; }
          });
        }
        if (cfg.type === 'fixed') {
          list.push({ key: 'fonly', type: 'toggle', label: '仅固定端点', def: false, group: '固定' });
        }
        return list;
      },
      reset: function () {
        this.picks = [];
        this.hoverEnt = null;
        this._conId = null;
        this._dvTouched = false;
        this._avTouched = false;
      },
      activate: function () { this.reset(); },
      deactivate: function () { this.reset(); },
      onParamChange: function (key) {
        if (key === 'dv') this._dvTouched = true;
        if (key === 'av') this._avTouched = true;
      },
      onHover: function (p) {
        this.hover = p;
        this.hoverEnt = App.pick(p);
      },
      onTap: function (p) {
        const e = App.pick(p);
        if (!e) { App.toast('请点按图形'); return; }
        cfg.pick.call(this, e);
      },
      onRender: function (ctx, R) {
        const C = global.CADConstraints;
        this.picks.forEach(function (id) {
          const ent = App.model.findById(id);
          if (ent) R.ghostEntity(ent);
        });
        if (this.hoverEnt && this.picks.indexOf(this.hoverEnt.id) < 0) R.ghostEntity(this.hoverEnt);
        if (!C) return;
        const draft = cfg.draft ? cfg.draft.call(this) : null;
        if (draft) {
          C.preview(App.model, draft).forEach(function (g) { R.ghostEntity(g); });
        }
      },
      applyParams: cfg.finish ? function () { cfg.finish.call(this); } : undefined
    });
    Object.keys(cfg).forEach(function (k) {
      if (k.charAt(0) === '_' && typeof cfg[k] === 'function') tool[k] = cfg[k];
    });
    return tool;
  }

  function alignLabel(pt) {
    const C = global.CADConstraints;
    if (C && C.alignPoints) return C.alignPoints[pt] || '中心点';
    return {
      lt: '左上角', center: '中心点', rt: '右上角',
      lb: '左下角', rb: '右下角', custom: '指定锚点'
    }[pt] || '中心点';
  }

  /** 批量约束：点按 / 框选多个图形后一键应用；阈值以 2 屏幕像素实时判定 */
  function makeBatchConstraintTool(cfg) {
    const alignable = cfg.type === 'halign' || cfg.type === 'valign';
    const tool = baseTool({
      id: cfg.id, name: cfg.name, cat: 'constraint', icon: cfg.icon, dragType: 'tool',
      hoverLive: true,
      prompt: function () {
        const n = (this.picks || []).length;
        const pointMode = alignable && App.params.almode === 'point';
        if (!n) {
          if (pointMode) {
            return cfg.hint + '（点对齐 · ' + alignLabel(App.params.alpt) + '）：点按图形加入，或框选；数字键 1~5 切换对齐点，0 指定锚点，M 切回边界对齐';
          }
          return cfg.hint + '：点按图形加入，或拖动框选批量选择；至少 2 个后点“确定”一键应用';
        }
        if (pointMode) {
          return '点对齐（' + alignLabel(App.params.alpt) + '）已选 ' + n + ' 个：数字键切换对齐点，点“确定”一键应用';
        }
        return '已选 ' + n + ' 个图形：继续点按添加，或点“确定”一键应用' + cfg.name;
      },
      params: function () {
        const fields = [];
        if (alignable) {
          fields.push({
            key: 'almode', type: 'choice', label: '对齐方式', def: 'bounds', group: '对齐', apply: true,
            options: [{ v: 'bounds', label: '边界对齐' }, { v: 'point', label: '点对齐' }]
          });
          fields.push({
            key: 'alpt', type: 'choice', label: '对齐点', def: 'center', group: '点对齐', apply: true,
            when: function (p) { return p.almode === 'point'; },
            options: [
              { v: 'lt', label: '左上角' }, { v: 'center', label: '中心点' }, { v: 'rt', label: '右上角' },
              { v: 'lb', label: '左下角' }, { v: 'rb', label: '右下角' }, { v: 'custom', label: '指定锚点' }
            ]
          });
          fields.push({
            key: 'alx', label: '锚点 X', def: 0, group: '指定锚点',
            when: function (p) { return p.almode === 'point' && p.alpt === 'custom'; }
          });
          fields.push({
            key: 'aly', label: '锚点 Y', def: 0, group: '指定锚点',
            when: function (p) { return p.almode === 'point' && p.alpt === 'custom'; }
          });
          fields.push({
            key: 'altol', label: '吸附阈值(px)', def: 5, min: 0, max: 50, group: '点对齐',
            when: function (p) { return p.almode === 'point'; }
          });
        }
        fields.push({ key: 'cshow', type: 'toggle', label: '显示标记', def: true, group: '约束', apply: true });
        return fields;
      },
      reset: function () {
        this.picks = [];
        this.hover = null;
        this.hoverEnt = null;
        this.band = null;
      },
      activate: function () {
        this.reset();
        this._bindAlignKeys();
      },
      deactivate: function () {
        this._unbindAlignKeys();
        this.reset();
      },
      /** 数字键选择对齐点，M 在边界 / 点对齐间切换 */
      _bindAlignKeys: function () {
        if (!alignable || this._alignKeyDown) return;
        const self = this;
        this._alignKeyDown = function (e) {
          const tag = e.target && e.target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            App.params.almode = App.params.almode === 'point' ? 'bounds' : 'point';
            if (App.updateParams) App.updateParams();
            if (App.updatePrompt) App.updatePrompt();
            if (App.refresh) App.refresh();
            if (App.toast) App.toast(App.params.almode === 'point' ? '已切换到点对齐' : '已切换到边界对齐');
            return;
          }
          const map = { '1': 'lt', '2': 'center', '3': 'rt', '4': 'lb', '5': 'rb', '0': 'custom' };
          const pt = map[e.key];
          if (!pt) return;
          e.preventDefault();
          App.params.almode = 'point';
          App.params.alpt = pt;
          if (App.updateParams) App.updateParams();
          if (App.updatePrompt) App.updatePrompt();
          if (App.refresh) App.refresh();
          if (App.toast) App.toast('对齐点：' + alignLabel(pt));
        };
        window.addEventListener('keydown', this._alignKeyDown);
      },
      _unbindAlignKeys: function () {
        if (this._alignKeyDown) window.removeEventListener('keydown', this._alignKeyDown);
        this._alignKeyDown = null;
      },
      _valid: function (e) { return !!conRep(e) && (!cfg.onlyLine || e.type === 'line'); },
      _add: function (e) {
        if (!e || !this._valid(e)) return false;
        if (this.picks.indexOf(e.id) < 0) this.picks.push(e.id);
        return true;
      },
      onHover: function (p) {
        this.hover = p;
        this.hoverEnt = App.pick(p);
      },
      onTap: function (p) {
        const e = App.pick(p);
        if (!e) return;
        if (!this._valid(e)) { App.toast(cfg.invalidTip); return; }
        const i = this.picks.indexOf(e.id);
        if (i >= 0) this.picks.splice(i, 1);
        else this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
      },
      onDragStart: function (p) {
        this.band = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      },
      onDragMove: function (p) {
        if (!this.band) return;
        this.band.x2 = p.x;
        this.band.y2 = p.y;
        App.refresh();
      },
      onDragEnd: function () {
        if (!this.band) return;
        const b = this.band;
        this.band = null;
        const rect = { x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2) };
        if (Math.abs(rect.x2 - rect.x1) < 1e-6 && Math.abs(rect.y2 - rect.y1) < 1e-6) return;
        const self = this;
        App.model.entitiesInRect(rect, true).forEach(function (e) { self._add(e); });
        App.updatePrompt();
        App.refresh();
      },
      onDragCancel: function () { this.band = null; },
      onRender: function (ctx, R) {
        if (this.band) {
          R.previewRect({
            x1: Math.min(this.band.x1, this.band.x2), y1: Math.min(this.band.y1, this.band.y2),
            x2: Math.max(this.band.x1, this.band.x2), y2: Math.max(this.band.y1, this.band.y2)
          });
        }
        (this.picks || []).forEach(function (id) {
          const e = App.model.findById(id);
          if (e) R.ghostEntity(e);
        });
        if (this.hoverEnt && (this.picks || []).indexOf(this.hoverEnt.id) < 0 && this._valid(this.hoverEnt)) {
          R.ghostEntity(this.hoverEnt);
        }
        if (!alignable || App.params.almode !== 'point') return;
        const C = global.CADConstraints;
        if (!C || typeof C.alignPointOf !== 'function') return;
        const pt = App.params.alpt || 'center';
        const custom = pt === 'custom';
        const pointOf = function (e) { return custom ? C.repPoint(e) : C.alignPointOf(e, pt); };
        const drawCross = function (p, color, r, label) {
          const s = R.screen(p);
          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.x - r - 3, s.y); ctx.lineTo(s.x + r + 3, s.y);
          ctx.moveTo(s.x, s.y - r - 3); ctx.lineTo(s.x, s.y + r + 3);
          ctx.stroke();
          if (label) {
            ctx.font = '10px -apple-system, "PingFang SC", system-ui, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, s.x + r + 5, s.y - r - 7);
          }
          ctx.restore();
        };
        const ids = this.picks || [];
        let ref = null;
        ids.forEach(function (id, i) {
          const e = App.model.findById(id);
          if (!e) return;
          const p = pointOf(e);
          if (!p) return;
          if (!ref) ref = p;
          drawCross(p, i === 0 ? '#ffb454' : '#5ad1ff', i === 0 ? 7 : 5, i === 0 ? '基准' : '');
        });
        if (custom) {
          const ax = Number(App.params.alx), ay = Number(App.params.aly);
          if (isFinite(ax) && isFinite(ay)) {
            ref = { x: ax, y: ay };
            drawCross(ref, '#ffb454', 8, '目标锚点');
          }
        }
        if (this.hoverEnt && ids.indexOf(this.hoverEnt.id) < 0) {
          const hp = pointOf(this.hoverEnt);
          if (hp) drawCross(hp, 'rgba(90, 209, 255, 0.55)', 4, '');
        }
        if (ref) {
          const s = R.screen(ref);
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 180, 84, 0.45)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (cfg.type === 'halign') { ctx.moveTo(0, s.y); ctx.lineTo(R.W || 2000, s.y); }
          else { ctx.moveTo(s.x, 0); ctx.lineTo(s.x, R.H || 2000); }
          ctx.stroke();
          ctx.restore();
        }
      },
      applyParams: function () {
        const C = global.CADConstraints;
        if (!C) return;
        let ids = this.picks.slice();
        if (!ids.length && App.model.selectedEntities) {
          ids = App.model.selectedEntities().map(function (e) { return e.id; }).filter(function (id) {
            const e = App.model.findById(id);
            return e && conRep(e) && (!cfg.onlyLine || e.type === 'line');
          });
        }
        ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
        if (ids.length < 2) {
          App.toast('请至少选择 2 个' + (cfg.onlyLine ? '直线' : '图形'));
          return;
        }
        const pointMode = alignable && App.params.almode === 'point';
        const extra = {};
        let snapPx = 2;
        if (pointMode) {
          extra.pmode = 'point';
          extra.ptype = App.params.alpt || 'center';
          const tol = Number(App.params.altol);
          extra.snap = isFinite(tol) && tol >= 0 ? tol : 5;
          snapPx = extra.snap;
          if (extra.ptype === 'custom') {
            const ax = Number(App.params.alx), ay = Number(App.params.aly);
            if (!isFinite(ax) || !isFinite(ay)) { App.toast('请输入有效的锚点坐标'); return; }
            extra.anchor = { x: ax, y: ay };
          }
        }
        const draft = Object.assign({ type: cfg.type, ids: ids }, extra);
        const dev = C.deviation(App.model, draft);
        commitConstraint(cfg.type, ids, extra);
        if (dev != null) {
          const devPx = dev * (App.view && App.view.scale ? App.view.scale : 1);
          if (devPx <= snapPx + 1e-6) {
            App.toast('已吸附到对齐点（偏差 ' + fmt(devPx) + 'px），已建立' + cfg.name + '约束');
          } else {
            App.toast('已应用' + cfg.name + (pointMode ? '（' + alignLabel(extra.ptype) + '）' : '') +
              '，原偏差 ' + fmt(devPx) + 'px');
          }
        } else {
          App.toast('已应用' + cfg.name + '约束（' + ids.length + ' 个图形）');
        }
        App.model.selected.clear();
        ids.forEach(function (id) { App.model.selected.add(id); });
        if (App.afterSelectionChange) App.afterSelectionChange();
        this.reset();
        App.updateParams && App.updateParams();
        App.updatePrompt();
        App.refresh();
      }
    });
    return tool;
  }

  const hAlignConstraintTool = makeBatchConstraintTool({
    id: 'chal', name: '水平对齐', icon: '⇔', type: 'halign', hint: '水平对齐',
    invalidTip: '该图形不支持水平对齐'
  });

  const vAlignConstraintTool = makeBatchConstraintTool({
    id: 'cval', name: '垂直对齐', icon: '⇕', type: 'valign', hint: '垂直对齐',
    invalidTip: '该图形不支持垂直对齐'
  });

  const equalConstraintTool = makeBatchConstraintTool({
    id: 'ceq', name: '等长', icon: '=', type: 'equal', onlyLine: true, hint: '等长约束',
    invalidTip: '等长约束仅支持直线'
  });

  /* ---------- 相对垂直：目标元素相对参考元素顶部 / 中部 / 底部 + 偏移 ---------- */
  const verticalRelativeTool = baseTool({
    id: 'cvrel', name: '相对垂直', cat: 'constraint', icon: '⇳', dragType: 'tool', hoverLive: true,
    prompt: function () {
      const n = (this.picks || []).length;
      if (!n) return '相对垂直：先点按目标元素，再点按参考元素；设置参考位置与偏移后点“确定”';
      if (n === 1) return '已选目标元素：请点按参考元素，可相对其顶部 / 中部 / 底部偏移定位';
      return '目标 → 参考已就绪：设置“参考位置 / 垂直偏移”后点“确定”';
    },
    params: function () {
      return [
        {
          key: 'rvanchor', type: 'choice', label: '参考位置', def: 'middle', group: '相对垂直', apply: true,
          options: [{ v: 'top', label: '顶部' }, { v: 'middle', label: '中部' }, { v: 'bottom', label: '底部' }]
        },
        { key: 'rvoffset', label: '垂直偏移', def: 0, min: -1000000, max: 1000000, group: '相对垂直' },
        { key: 'cshow', type: 'toggle', label: '显示标记', def: true, group: '约束', apply: true }
      ];
    },
    reset: function () {
      this.picks = [];
      this.hoverEnt = null;
      this.hover = null;
    },
    activate: function () { this.reset(); },
    deactivate: function () { this.reset(); },
    _valid: function (e) { return !!conRep(e); },
    onTap: function (p) {
      const e = App.pick(p);
      if (!e) { App.toast('请点按图形'); return; }
      if (!this._valid(e)) { App.toast('该图形不支持相对垂直定位'); return; }
      if ((this.picks || []).length >= 2) this.picks = [];
      if (!this.picks.length) {
        this.picks = [e.id];
        App.toast('已选目标元素，请点按参考元素');
      } else if (this.picks[0] === e.id) {
        App.toast('目标元素与参考元素不能相同');
        return;
      } else {
        this.picks.push(e.id);
        App.toast('已选参考元素，设置偏移后点“确定”');
      }
      App.model.selected.clear();
      this.picks.forEach(function (id) { App.model.selected.add(id); });
      if (App.afterSelectionChange) App.afterSelectionChange();
      App.updatePrompt();
      App.refresh();
    },
    onHover: function (p) {
      this.hover = p;
      this.hoverEnt = App.pick(p);
    },
    onRender: function (ctx, R) {
      const ids = this.picks || [];
      ids.forEach(function (id) {
        const e = App.model.findById(id);
        if (e) R.ghostEntity(e);
      });
      if (this.hoverEnt && ids.indexOf(this.hoverEnt.id) < 0) R.ghostEntity(this.hoverEnt);
      if (ids.length < 2) return;
      const ref = App.model.findById(ids[1]);
      const mov = App.model.findById(ids[0]);
      if (!ref || !mov) return;
      const rawB = Geo.entityBBox(ref);
      const b = (rawB && isFinite(rawB.x1)) ? rawB
        : { x1: Math.min(ref.x1, ref.x2), y1: Math.min(ref.y1, ref.y2), x2: Math.max(ref.x1, ref.x2), y2: Math.max(ref.y1, ref.y2) };
      const anchor = App.params.rvanchor || 'middle';
      const ay = anchor === 'top' ? b.y2 : (anchor === 'bottom' ? b.y1 : (b.y1 + b.y2) / 2);
      const off = Number(App.params.rvoffset);
      const offsetY = isFinite(off) ? off : 0;
      const midX = (b.x1 + b.x2) / 2;
      const s1 = R.screen({ x: b.x1, y: ay });
      const s2 = R.screen({ x: b.x2, y: ay });
      const sv = R.screen({ x: midX, y: ay });
      const sv2 = R.screen({ x: midX, y: ay + offsetY });
      const C = global.CADConstraints;
      const mp = C && C.repPoint ? C.repPoint(mov) : null;
      ctx.save();
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y);
      ctx.lineTo(sv2.x, sv2.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sv.x, sv.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      if (Math.abs(sv2.y - sv.y) > 2) {
        ctx.beginPath();
        ctx.moveTo(sv2.x - 4, sv2.y + (sv2.y > sv.y ? -5 : 5));
        ctx.lineTo(sv2.x, sv2.y);
        ctx.lineTo(sv2.x + 4, sv2.y + (sv2.y > sv.y ? -5 : 5));
        ctx.stroke();
      }
      if (mp) {
        const sm = R.screen(mp);
        ctx.strokeStyle = '#5ad1ff';
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    },
    applyParams: function () {
      const C = global.CADConstraints;
      if (!C) { App.toast('约束模块不可用'); return; }
      let ids = (this.picks || []).slice();
      if (ids.length < 2) {
        const sel = App.model.selectedEntities ? App.model.selectedEntities() : [];
        if (sel.length >= 2) ids = [sel[0].id, sel[1].id];
      }
      if (ids.length < 2) { App.toast('请先点选目标元素和参考元素'); return; }
      if (ids[0] === ids[1]) { App.toast('目标元素与参考元素不能相同'); return; }
      const anchor = App.params.rvanchor || 'middle';
      const offset = Number(App.params.rvoffset);
      const err = C.validateVerticalRelative(App.model, { type: 'vrel', ids: ids, anchor: anchor, offset: offset });
      if (err) { App.toast(err); return; }
      const dev = C.deviation(App.model, { type: 'vrel', ids: ids, anchor: anchor, offset: offset });
      commitConstraint('vrel', ids, { anchor: anchor, offset: offset });
      App.model.selected.clear();
      ids.forEach(function (id) { App.model.selected.add(id); });
      const label = (C.vrelAnchors && C.vrelAnchors[anchor]) || '中部';
      const devPx = dev == null ? 0 : dev * (App.view && App.view.scale ? App.view.scale : 1);
      App.toast('已应用相对垂直：' + label + ' ' + (offset >= 0 ? '+' : '') + fmt(offset) +
        (devPx > 2 ? '（原偏差 ' + fmt(devPx) + 'px）' : ''));
      this.reset();
      App.updateParams();
      App.updatePrompt();
      App.refresh();
      if (App.afterSelectionChange) App.afterSelectionChange();
    }
  });

  const hConstraintTool = makeConstraintTool({
    id: 'ch', name: '水平', icon: 'H', type: 'horizontal',
    prompt: function () { return '点按一条直线，强制水平（保持起点与长度）'; },
    pick: function (e) {
      if (e.type !== 'line') { App.toast('水平约束仅支持直线'); return; }
      commitConstraint('horizontal', [e.id]);
      App.toast('已添加水平约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.hoverEnt && this.hoverEnt.type === 'line' && !this.picks.length) {
        return { type: 'horizontal', ids: [this.hoverEnt.id] };
      }
      return null;
    }
  });

  const vConstraintTool = makeConstraintTool({
    id: 'cv', name: '垂直', icon: 'V', type: 'vertical',
    prompt: function () { return '点按一条直线，强制垂直（保持起点与长度）'; },
    pick: function (e) {
      if (e.type !== 'line') { App.toast('垂直约束仅支持直线'); return; }
      commitConstraint('vertical', [e.id]);
      App.toast('已添加垂直约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.hoverEnt && this.hoverEnt.type === 'line' && !this.picks.length) {
        return { type: 'vertical', ids: [this.hoverEnt.id] };
      }
      return null;
    }
  });

  const symmetricTool = makeConstraintTool({
    id: 'csym', name: '对称', icon: '⇋', type: 'symmetric',
    prompt: function () {
      if (!this.picks.length) return '点按第一个图形';
      if (this.picks.length === 1) return '点按第二个同类图形';
      return '点按一条直线作为对称轴';
    },
    pick: function (e) {
      if (this.picks.length < 2) {
        if (this.picks.indexOf(e.id) >= 0) { App.toast('该图形已选'); return; }
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (e.type !== 'line') { App.toast('请点按一条直线作为对称轴'); return; }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('对称轴不能是待对称图形'); return; }
      const a = App.model.findById(this.picks[0]);
      const b = App.model.findById(this.picks[1]);
      if (!a || !b || a.type !== b.type) { App.toast('两个图形类型需一致'); return; }
      commitConstraint('symmetric', [a.id, b.id], { axisId: e.id });
      App.toast('已添加对称约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length === 2 && this.hoverEnt && this.hoverEnt.type === 'line' &&
        this.picks.indexOf(this.hoverEnt.id) < 0) {
        return { type: 'symmetric', ids: this.picks.slice(), axisId: this.hoverEnt.id };
      }
      return null;
    }
  });

  const collinearTool = makeConstraintTool({
    id: 'ccol', name: '共线', icon: '≡', type: 'collinear',
    prompt: function () {
      if (!this.picks.length) return '点按一条直线作为共线基准';
      return '继续点按直线 / 点 / 圆加入共线（圆自动取圆心，已选 ' + this.picks.length + ' 个），点“确定”完成';
    },
    pick: function (e) {
      if (!this.picks.length) {
        if (e.type !== 'line') { App.toast('请先点按一条直线作为基准'); return; }
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('该图形已在共线集合中'); return; }
      if (e.type !== 'line' && e.type !== 'point' && !conCircleLike(e)) {
        App.toast('共线仅支持直线、点、圆 / 圆弧'); return;
      }
      this.picks.push(e.id);
      if (!this._conId) {
        const con = commitConstraint('collinear', this.picks.slice());
        this._conId = con ? con.id : null;
      } else {
        const con = App.model.findConstraint(this._conId);
        if (con) {
          App.begin();
          con.ids = this.picks.slice();
          if (global.CADConstraints) global.CADConstraints.solve(App.model);
          App.end();
        }
      }
      App.toast('已在 ' + this.picks.length + ' 个图形间建立共线约束');
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length === 1 && this.hoverEnt &&
        (this.hoverEnt.type === 'line' || this.hoverEnt.type === 'point' || conCircleLike(this.hoverEnt)) &&
        this.picks.indexOf(this.hoverEnt.id) < 0) {
        return { type: 'collinear', ids: [this.picks[0], this.hoverEnt.id] };
      }
      return null;
    },
    finish: function () {
      if (this.picks.length < 2) { App.toast('共线约束至少需要两个图形'); return; }
      App.toast('共线约束已完成');
      this.reset();
      App.updatePrompt();
      App.refresh();
    }
  });

  const tangentTool = makeConstraintTool({
    id: 'ctan', name: '相切', icon: 'T', type: 'tangent',
    prompt: function () {
      return this.picks.length ? '点按第二个圆 / 圆弧 / 直线' : '点按第一个圆、圆弧或直线';
    },
    pick: function (e) {
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一个图形'); return; }
      const a = App.model.findById(this.picks[0]);
      const ca = conCircleLike(a), cb = conCircleLike(e);
      const valid = (a && a.type === 'line' && cb) || (ca && e.type === 'line') || (ca && cb);
      if (!valid) { App.toast('相切支持圆-圆、圆-圆弧或圆-直线'); return; }
      commitConstraint('tangent', [a.id, e.id]);
      App.toast('已添加相切约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.id === this.picks[0]) return null;
      const a = App.model.findById(this.picks[0]);
      if (!a) return null;
      const ca = conCircleLike(a), cb = conCircleLike(this.hoverEnt);
      const valid = (a.type === 'line' && cb) || (ca && this.hoverEnt.type === 'line') || (ca && cb);
      return valid ? { type: 'tangent', ids: [a.id, this.hoverEnt.id] } : null;
    }
  });

  const distanceTool = makeConstraintTool({
    id: 'cdist', name: '距离', icon: '↔', type: 'distance',
    prompt: function () {
      if (!this.picks.length) return '点按第一个点 / 图形（直线取中点、圆取圆心）';
      if (this.picks.length === 1) return '点按第二个点 / 图形，按面板距离值固定间距';
      return '可在面板输入距离后点“确定”重新固定';
    },
    pick: function (e) {
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一个图形'); return; }
      this.picks.push(e.id);
      this._apply();
    },
    _valueFor: function (b) {
      const v = Number(App.params.dv);
      if (this._dvTouched && isFinite(v) && v > 0) return v;
      const a = this.picks.length ? App.model.findById(this.picks[0]) : null;
      const pa = conRep(a), pb = conRep(b);
      if (pa && pb) {
        const d = Geo.dist(pa, pb);
        if (d > 1e-6) return d;
      }
      return isFinite(v) && v > 0 ? v : 50;
    },
    _draftValue: function () { return this._valueFor(this.hoverEnt); },
    _apply: function () {
      if (this.picks.length < 2) { App.toast('请先点按两个点 / 图形'); return; }
      const a = App.model.findById(this.picks[0]);
      const b = App.model.findById(this.picks[1]);
      if (!a || !b) { this.reset(); return; }
      const v = this._valueFor(b);
      App.params.dv = round3(v);
      if (App.updateParams) App.updateParams();
      commitConstraint('distance', [a.id, b.id], { value: v });
      App.toast('已固定间距 ' + fmt(v));
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.id === this.picks[0]) return null;
      return { type: 'distance', ids: [this.picks[0], this.hoverEnt.id], value: this._draftValue() };
    },
    finish: function () { this._apply(); }
  });

  /** 平行约束：两条直线保持平行 */
  const parallelConstraintTool = makeConstraintTool({
    id: 'cpar', name: '平行', icon: '∥', type: 'parallel',
    prompt: function () {
      if (!this.picks.length) return '点按第一条直线';
      return '点按第二条直线，使其与第一条保持平行';
    },
    pick: function (e) {
      if (e.type !== 'line') { App.toast('平行约束仅支持直线'); return; }
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一条直线'); return; }
      const a = App.model.findById(this.picks[0]);
      if (!a) { this.reset(); return; }
      commitConstraint('parallel', [a.id, e.id]);
      App.toast('已添加平行约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length === 1 && this.hoverEnt && this.hoverEnt.type === 'line' &&
        this.hoverEnt.id !== this.picks[0]) {
        return { type: 'parallel', ids: [this.picks[0], this.hoverEnt.id] };
      }
      return null;
    }
  });

  /** 固定约束：图形在约束求解中保持不动 */
  const fixedConstraintTool = makeConstraintTool({
    id: 'cfix', name: '固定', icon: '⚓', type: 'fixed',
    prompt: function () {
      if (App.params.fonly) return '仅固定端点：点按图形固定其端点 / 圆心位置，形状与方向仍可调整';
      return '点按一个图形将其固定，后续约束求解不会移动它（可在操作选项改为“仅固定端点”）';
    },
    pick: function (e) {
      const exist = App.model.constraints.some(function (c) {
        return c.type === 'fixed' && c.ids && c.ids[0] === e.id;
      });
      if (exist) { App.toast('该图形已固定'); return; }
      const only = App.params.fonly === true;
      commitConstraint('fixed', [e.id], { onlyEndpoints: only });
      App.toast(only ? '已仅固定端点 #' + e.id : '已固定图形 #' + e.id);
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      return this.hoverEnt
        ? { type: 'fixed', ids: [this.hoverEnt.id], onlyEndpoints: App.params.fonly === true }
        : null;
    }
  });

  /** 角度约束：两条直线按面板角度固定夹角 */
  const angleConstraintTool = makeConstraintTool({
    id: 'cang', name: '角度', icon: '∠', type: 'angle',
    prompt: function () {
      if (!this.picks.length) return '点按第一条直线';
      if (this.picks.length === 1) return '点按第二条直线，按面板角度固定夹角';
      return '可在面板修改角度后点“确定”重新固定';
    },
    pick: function (e) {
      if (e.type !== 'line') { App.toast('角度约束仅支持直线'); return; }
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一条直线'); return; }
      this.picks.push(e.id);
      this._apply();
    },
    _current: function (a, b) {
      if (!a || !b || a.type !== 'line' || b.type !== 'line') return null;
      const da = unitOf(Geo.sub(a.p2, a.p1)), db = unitOf(Geo.sub(b.p2, b.p1));
      if (!da || !db) return null;
      const d = Geo.deg(Math.acos(Geo.clamp(da.x * db.x + da.y * db.y, -1, 1)));
      return d > 1e-6 && d < 180 - 1e-6 ? Math.round(d * 100) / 100 : null;
    },
    _valueFor: function () {
      const v = Number(App.params.av);
      if (this._avTouched && isFinite(v) && v > 0 && v < 180) return v;
      const a = App.model.findById(this.picks[0]);
      const b = this.picks[1] ? App.model.findById(this.picks[1]) : this.hoverEnt;
      const d = this._current(a, b);
      if (d) return d;
      return isFinite(v) && v > 0 && v < 180 ? v : 60;
    },
    _apply: function () {
      if (this.picks.length < 2) { App.toast('请先点按两条直线'); return; }
      const a = App.model.findById(this.picks[0]);
      const b = App.model.findById(this.picks[1]);
      if (!a || !b) { this.reset(); return; }
      const v = this._valueFor();
      App.params.av = round3(v);
      if (App.updateParams) App.updateParams();
      commitConstraint('angle', [a.id, b.id], { value: v });
      App.toast('已固定夹角 ' + fmt(v) + '°');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.type !== 'line' ||
        this.hoverEnt.id === this.picks[0]) return null;
      return { type: 'angle', ids: [this.picks[0], this.hoverEnt.id], value: this._valueFor() };
    },
    finish: function () { this._apply(); }
  });

  /** 点在线上约束：点 / 圆心落在直线上 */
  const onLineConstraintTool = makeConstraintTool({
    id: 'conl', name: '点在线上', icon: '⌖', type: 'onLine',
    prompt: function () {
      if (!this.picks.length) return '点按点 / 圆 / 圆弧（圆自动取圆心），或先点一条直线';
      return '点按另一条直线 / 点，完成点在线上约束';
    },
    pick: function (e) {
      if (!(e.type === 'line' || e.type === 'point' || conCircleLike(e))) {
        App.toast('点在线上仅支持点、圆 / 圆弧与直线'); return;
      }
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一个图形'); return; }
      const a = App.model.findById(this.picks[0]);
      if (!a) { this.reset(); return; }
      const valid = (a.type === 'line' && e.type !== 'line') || (a.type !== 'line' && e.type === 'line');
      if (!valid) { App.toast('请在点 / 圆 / 圆弧与直线之间建立约束'); return; }
      this.picks.push(e.id);
      commitConstraint('onLine', [a.id, e.id]);
      App.toast('已添加点在线上约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.id === this.picks[0]) return null;
      const a = App.model.findById(this.picks[0]);
      if (!a) return null;
      const valid = (a.type === 'line' && this.hoverEnt.type !== 'line') ||
        (a.type !== 'line' && this.hoverEnt.type === 'line');
      return valid ? { type: 'onLine', ids: [a.id, this.hoverEnt.id] } : null;
    }
  });

  /** 重叠约束：先点基准图形，再点要重叠的矩形 / 多边形 / 圆 */
  const overlapConstraintTool = makeConstraintTool({
    id: 'conov', name: '重叠', icon: '⧉', type: 'overlap',
    prompt: function () {
      if (!this.picks.length) return '点按矩形 / 多边形 / 圆作为基准图形';
      return '点按另一个图形，自动保持完全重叠或指定重叠比例';
    },
    pick: function (e) {
      const C = global.CADConstraints;
      if (!C || !C.isClosedShape(e)) { App.toast('重叠约束仅支持矩形、多边形或圆'); return; }
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一个图形'); return; }
      const mode = App.params.omode === 'ratio' ? 'ratio' : 'full';
      const value = mode === 'ratio' ? Number(App.params.oratio) : 100;
      if (mode === 'ratio' && !(value > 0 && value <= 100)) {
        App.toast('重叠比例需在 1~100% 之间'); return;
      }
      commitConstraint('overlap', [this.picks[0], e.id], { mode: mode, value: value });
      App.toast(mode === 'ratio' ? '已添加重叠约束（' + value + '%）' : '已添加完全重叠约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.id === this.picks[0]) return null;
      const C = global.CADConstraints;
      if (!C || !C.isClosedShape(this.hoverEnt)) return null;
      const mode = App.params.omode === 'ratio' ? 'ratio' : 'full';
      return {
        type: 'overlap', ids: [this.picks[0], this.hoverEnt.id],
        mode: mode, value: mode === 'ratio' ? Number(App.params.oratio) : 100
      };
    }
  });

  /** 两个图形之间距离最近的一对端点（用于重合约束） */
  function nearestEndpointPair(a, b) {
    const ap = Geo.entityEndpoints(a);
    const bp = Geo.entityEndpoints(b);
    if (!ap.length || !bp.length) return null;
    let best = null;
    for (let i = 0; i < ap.length; i++) {
      for (let j = 0; j < bp.length; j++) {
        const d = Geo.dist(ap[i], bp[j]);
        if (!best || d < best.d) best = { ai: i, bi: j, d: d };
      }
    }
    return best;
  }

  /** 重合约束：手动选择两个图形，使最近的一对端点重合 */
  const coincidentTool = makeConstraintTool({
    id: 'ccoin', name: '重合', icon: '⊙', type: 'coincident',
    prompt: function () {
      if (!this.picks.length) return '点按第一个带端点的图形（直线 / 圆弧 / 矩形 / 多边形 / 点）';
      return '点按第二个图形，自动取其最近端点与第一个图形重合';
    },
    pick: function (e) {
      if (!Geo.entityEndpoints(e).length) {
        App.toast('重合约束需要带端点的图形（圆请改用相切 / 点在线上）');
        return;
      }
      if (!this.picks.length) {
        this.picks.push(e.id);
        App.updatePrompt();
        App.refresh();
        return;
      }
      if (this.picks.indexOf(e.id) >= 0) { App.toast('请点按另一个图形'); return; }
      const a = App.model.findById(this.picks[0]);
      if (!a) { this.reset(); return; }
      const best = nearestEndpointPair(a, e);
      if (!best) { App.toast('无法确定重合端点'); return; }
      const dup = App.model.constraints.some(function (c) {
        return c.type === 'coincident' && c.ids && c.ids.length >= 2 &&
          ((c.ids[0] === a.id && c.ids[1] === e.id) || (c.ids[0] === e.id && c.ids[1] === a.id));
      });
      if (dup) { App.toast('这两个图形已存在重合约束'); this.reset(); return; }
      commitConstraint('coincident', [a.id, e.id], { aIdx: best.ai, bIdx: best.bi });
      App.toast('已添加重合约束');
      this.reset();
      App.updatePrompt();
      App.refresh();
    },
    draft: function () {
      if (this.picks.length !== 1 || !this.hoverEnt || this.hoverEnt.id === this.picks[0]) return null;
      const a = App.model.findById(this.picks[0]);
      if (!a) return null;
      const best = nearestEndpointPair(a, this.hoverEnt);
      if (!best) return null;
      return { type: 'coincident', ids: [a.id, this.hoverEnt.id], aIdx: best.ai, bIdx: best.bi };
    }
  });

  /** 约束设置：端点自动重合与线首尾自动链接开关（默认关闭） */
  const constraintSettingsTool = baseTool({
    id: 'cset', name: '约束设置', cat: 'constraint', icon: '⛭', dragType: 'pan',
    prompt: function () {
      const t = Number(App.params.aet) || 3;
      const a = App.params.aep ? '端点自动重合 开（阈值 ' + t + '）' : '端点自动重合 关';
      const b = App.params.llink ? '线首尾自动链接 开' : '线首尾自动链接 关';
      return a + ' · ' + b + '；点“确定”立即检测一次端点重合';
    },
    params: function () {
      return [
        { key: 'aep', type: 'toggle', label: '端点自动重合', def: false, group: '端点重合' },
        {
          key: 'aet', label: '端点阈值', def: 3, min: 0.01, group: '端点重合',
          when: function (p) { return p.aep === true; }
        },
        { key: 'llink', type: 'toggle', label: '线首尾自动链接', def: false, group: '连续画线' }
      ];
    },
    /** 立即检测一次端点重合；返回新建约束数量 */
    _detect: function () {
      const C = global.CADConstraints;
      if (!C) return 0;
      let t = Number(App.params.aet);
      if (!(t > 0)) t = 3;
      App.params.aet = t;
      App.begin();
      const added = C.autoDetectEndpoints(App.model, t);
      if (added.length) App.end();
      else App.abort();
      return added.length;
    },
    applyParams: function () {
      const n = this._detect();
      if (n > 0) App.toast('已自动建立 ' + n + ' 个端点重合约束');
      else if (Number(App.params.aet) > 0) App.toast('未发现可自动重合的端点');
      App.refresh();
      App.updatePrompt();
    },
    onParamChange: function (key, val) {
      if (key === 'aep') {
        if (val) {
          const n = this._detect();
          const t = Number(App.params.aet) || 3;
          App.toast('端点自动重合已开启：端点距离小于 ' + t + ' 时自动建立约束' +
            (n ? '（本次新增 ' + n + ' 个）' : ''));
        } else {
          App.toast('端点自动重合已关闭');
        }
      } else if (key === 'llink') {
        App.toast(val
          ? '线首尾自动链接已开启：连续画线时相邻线段端点自动建立重合约束'
          : '线首尾自动链接已关闭');
      }
    }
  });

  const constraintManagerTool = baseTool({
    id: 'cman', name: '约束管理', cat: 'constraint', icon: '⚙', dragType: 'pan',
    prompt: '查看 / 编辑 / 删除已有几何约束；点按画布恢复约束列表',
    params: function () {
      return [{ key: 'cshow', type: 'toggle', label: '显示标记', def: true, group: '约束' }];
    },
    activate: function () {
      this.reset();
      if (App.showConstraintList) App.showConstraintList();
    },
    onTap: function () {
      if (App.showConstraintList) App.showConstraintList();
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
    lineTool, centerTool, rectTool, polyTool, contourTool, splineTool, circleTool, arcTool, pointTool, angleLineTool, parallelTool, offsetTool,
    selectTool, deleteTool, trimTool, filletTool, stretchTool, moveTool, arrayTool, mirrorTool, rotateTool,
    groupTool, ungroupTool, explodeTool, fillTool, scaleTool,
    measureLengthTool, measureAngleTool, measureDistTool, measureCoordTool, propsTool, dimTool,
    hConstraintTool, vConstraintTool, hAlignConstraintTool, vAlignConstraintTool, equalConstraintTool, verticalRelativeTool,
    symmetricTool, collinearTool, tangentTool, distanceTool,
    parallelConstraintTool, fixedConstraintTool, angleConstraintTool, onLineConstraintTool,
    overlapConstraintTool, coincidentTool, constraintSettingsTool, constraintManagerTool,
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
