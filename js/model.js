/* 手机CAD · 文档模型（图元集合、拾取、框选、链拾取） */
(function (global) {
  'use strict';
  const Geo = global.Geo;

  function Doc() {
    this.entities = [];
    this.selected = new Set();
    this.dims = [];
    this.constraints = [];
    this._seq = 1;
    this._dseq = 1;
    this._cseq = 1;
  }

  Doc.prototype.add = function (ent) {
    if (!ent.id) ent.id = 'e' + (this._seq++);
    ent.id = String(ent.id);
    if (this.findById(ent.id)) ent.id = 'e' + (this._seq++);
    this.entities.push(ent);
    return ent;
  };

  Doc.prototype.findById = function (id) {
    for (let i = 0; i < this.entities.length; i++) {
      if (this.entities[i].id === id) return this.entities[i];
    }
    return null;
  };

  Doc.prototype.remove = function (id) {
    const i = this.entities.findIndex(function (e) { return e.id === id; });
    if (i >= 0) this.entities.splice(i, 1);
    this.selected.delete(id);
    return i >= 0;
  };

  Doc.prototype.clear = function () {
    this.entities = [];
    this.selected.clear();
    this.dims = [];
    this.constraints = [];
    this._seq = 1;
    this._dseq = 1;
    this._cseq = 1;
  };

  Doc.prototype.count = function () { return this.entities.length; };

  /* ---------- 尺寸标注 ---------- */
  Doc.prototype.addDim = function (dim) {
    if (!dim.id) dim.id = 'd' + (this._dseq++);
    dim.id = String(dim.id);
    this.dims.push(dim);
    return dim;
  };

  Doc.prototype.findDim = function (id) {
    for (let i = 0; i < this.dims.length; i++) if (this.dims[i].id === id) return this.dims[i];
    return null;
  };

  Doc.prototype.removeDim = function (id) {
    const i = this.dims.findIndex(function (d) { return d.id === id; });
    if (i >= 0) { this.dims.splice(i, 1); return true; }
    return false;
  };

  /* ---------- 几何约束 ---------- */
  Doc.prototype.addConstraint = function (con) {
    if (!con.id) con.id = 'c' + (this._cseq++);
    con.id = String(con.id);
    this.constraints.push(con);
    return con;
  };

  Doc.prototype.findConstraint = function (id) {
    for (let i = 0; i < this.constraints.length; i++) if (this.constraints[i].id === id) return this.constraints[i];
    return null;
  };

  Doc.prototype.removeConstraint = function (id) {
    const i = this.constraints.findIndex(function (c) { return c.id === id; });
    if (i >= 0) { this.constraints.splice(i, 1); return true; }
    return false;
  };

  /** 删除图元后清理失效的标注与约束 */
  Doc.prototype.pruneRefs = function () {
    const ids = new Set();
    this.entities.forEach(function (e) { ids.add(e.id); });
    const beforeD = this.dims.length, beforeC = this.constraints.length;
    this.dims = this.dims.filter(function (d) {
      if (d.ids && d.ids.length) {
        for (let i = 0; i < d.ids.length; i++) if (!ids.has(d.ids[i])) return false;
        return true;
      }
      return ids.has(d.entId);
    });
    this.constraints = this.constraints.filter(function (c) {
      if (!c.ids || !c.ids.length) return false;
      for (let i = 0; i < c.ids.length; i++) if (!ids.has(c.ids[i])) return false;
      if (c.axisId && !ids.has(c.axisId)) return false;
      return true;
    });
    return this.dims.length !== beforeD || this.constraints.length !== beforeC;
  };

  Doc.prototype.selectedEntities = function () {
    const sel = this.selected;
    return this.entities.filter(function (e) { return sel.has(e.id); });
  };

  /** 拾取最近图元，tol 为世界坐标容差 */
  Doc.prototype.hitTest = function (p, tol) {
    let best = null, bestD = Infinity;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      const d = Geo.hitDistance(e, p);
      const lim = e.type === 'point' ? Math.max(tol, 8) : tol;
      if (d <= lim && d < bestD) { best = e; bestD = d; }
    }
    return best;
  };

  /** 框选：crossing=true 为交叉选择 */
  Doc.prototype.entitiesInRect = function (rect, crossing) {
    return this.entities.filter(function (e) {
      const pts = Geo.entityPolyline(e, 32);
      if (!crossing) return pts.every(function (p) { return Geo.pointInRect(p, rect); });
      for (let i = 0; i < pts.length; i++) {
        if (Geo.pointInRect(pts[i], rect)) return true;
        if (i < pts.length - 1 && Geo.segmentIntersectsRect(pts[i], pts[i + 1], rect)) return true;
      }
      return false;
    });
  };

  /** 链拾取：从 start 出发，识别端点相连的连续图元 */
  Doc.prototype.chain = function (start, tol) {
    tol = tol || 1e-6;
    const chosen = new Set([start.id]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.pop();
      const ends = Geo.entityEndpoints(cur);
      if (!ends.length) continue;
      for (let i = 0; i < this.entities.length; i++) {
        const other = this.entities[i];
        if (chosen.has(other.id)) continue;
        const oe = Geo.entityEndpoints(other);
        if (!oe.length) continue;
        let linked = false;
        for (let a = 0; a < ends.length && !linked; a++) {
          for (let b = 0; b < oe.length; b++) {
            if (Geo.dist(ends[a], oe[b]) <= tol) { linked = true; break; }
          }
        }
        if (linked) { chosen.add(other.id); queue.push(other); }
      }
    }
    return chosen;
  };

  Doc.prototype.bbox = function (onlySelected) {
    return Geo.bboxOf(onlySelected ? this.selectedEntities() : this.entities);
  };

  function maxSeq(list) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const m = /^[a-z](\d+)$/.exec(String(list[i].id || ''));
      if (m) n = Math.max(n, Number(m[1]));
    }
    return n + 1;
  }

  Doc.prototype.snapshot = function () {
    return JSON.stringify({ entities: this.entities, dims: this.dims, constraints: this.constraints });
  };

  Doc.prototype.restoreSnapshot = function (text) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        this.entities = data;
        this.dims = [];
        this.constraints = [];
      } else {
        this.entities = data.entities || [];
        this.dims = data.dims || [];
        this.constraints = data.constraints || [];
      }
      this.selected.clear();
      this._seq = maxSeq(this.entities);
      this._dseq = maxSeq(this.dims);
      this._cseq = maxSeq(this.constraints);
      return true;
    } catch (e) {
      return false;
    }
  };

  Doc.prototype.cloneSelected = function () {
    return this.selectedEntities().map(function (e) { return JSON.parse(JSON.stringify(e)); });
  };

  global.CADModel = { Doc: Doc };
})(typeof window !== 'undefined' ? window : globalThis);
