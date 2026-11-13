/* 手机CAD · 文档模型（图元集合、拾取、框选、链拾取） */
(function (global) {
  'use strict';
  const Geo = global.Geo;

  function Doc() {
    this.entities = [];
    this.selected = new Set();
    this._seq = 1;
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
    this._seq = 1;
  };

  Doc.prototype.count = function () { return this.entities.length; };

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

  Doc.prototype.snapshot = function () {
    return JSON.stringify(this.entities);
  };

  Doc.prototype.restoreSnapshot = function (text) {
    try {
      this.entities = JSON.parse(text);
      this.selected.clear();
      this._seq = this.entities.length + 1;
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
