/* 手机CAD · 几何核心（纯函数，无 DOM 依赖，可在测试页/Node 中直接加载） */
(function (global) {
  'use strict';

  const EPS = 1e-9;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  function P(x, y) { return { x: x, y: y }; }
  function cloneP(p) { return { x: p.x, y: p.y }; }
  function add(a, b) { return P(a.x + b.x, a.y + b.y); }
  function sub(a, b) { return P(a.x - b.x, a.y - b.y); }
  function mul(a, k) { return P(a.x * k, a.y * k); }
  function lerp(a, b, t) { return P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function dist(a, b) { return Math.sqrt(dist2(a, b)); }
  function rad(d) { return d * DEG; }
  function deg(r) { return r / DEG; }
  function normAngle(a) {
    a = a % TAU;
    if (a < 0) a += TAU;
    if (a >= TAU - EPS) a = 0;
    return a;
  }
  function angleOf(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }
  function polar(c, r, a) { return P(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- 线段 ---------- */
  function closestOnSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < EPS) return { point: cloneP(a), t: 0, dist: dist(p, a) };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = clamp(t, 0, 1);
    const q = P(a.x + dx * t, a.y + dy * t);
    return { point: q, t: t, dist: dist(p, q) };
  }

  function lineLineIntersect(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return [];
    const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / den;
    const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
    return [P(a1.x + d1x * t, a1.y + d1y * t)];
  }

  /** 两条无限延长直线的交点（用于圆弧过渡，允许交点在端点之外） */
  function lineIntersectInfinite(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / den;
    return P(a1.x + d1x * t, a1.y + d1y * t);
  }

  function unitVec(v) {
    const L = Math.hypot(v.x, v.y);
    return L < EPS ? null : { x: v.x / L, y: v.y / L };
  }

  function dotVec(a, b) { return a.x * b.x + a.y * b.y; }

  function lineCircleIntersect(a1, a2, c, r) {
    const dx = a2.x - a1.x, dy = a2.y - a1.y;
    const fx = a1.x - c.x, fy = a1.y - c.y;
    const A = dx * dx + dy * dy;
    if (A < EPS) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    disc = Math.sqrt(disc);
    const out = [];
    const t1 = (-B - disc) / (2 * A), t2 = (-B + disc) / (2 * A);
    [t1, t2].forEach(function (t) {
      if (t < -1e-9 || t > 1 + 1e-9) return;
      const q = P(a1.x + dx * t, a1.y + dy * t);
      for (let i = 0; i < out.length; i++) {
        if (dist2(out[i], q) < 1e-14) return; // 相切时两解重合，去重
      }
      out.push(q);
    });
    return out;
  }

  function circleCircleIntersect(c1, r1, c2, r2) {
    const d = dist(c1, c2);
    if (d < EPS || d > r1 + r2 + 1e-7 || d < Math.abs(r1 - r2) - 1e-7) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    const h = Math.sqrt(Math.max(0, h2));
    const xm = c1.x + a * (c2.x - c1.x) / d;
    const ym = c1.y + a * (c2.y - c1.y) / d;
    const rx = -(c2.y - c1.y) * (h / d);
    const ry = (c2.x - c1.x) * (h / d);
    const out = [P(xm + rx, ym + ry)];
    if (h > 1e-7) out.push(P(xm - rx, ym - ry));
    return out;
  }

  /* ---------- 圆弧 ---------- */
  function arcSweep(arc) {
    return arc.ccw ? normAngle(arc.a1 - arc.a0) : normAngle(arc.a0 - arc.a1);
  }

  function angleOnArc(a, arc) {
    const sw = arcSweep(arc);
    if (sw >= TAU - 1e-7) return true;
    const s = arc.ccw ? normAngle(a - arc.a0) : normAngle(arc.a0 - a);
    return s <= sw + 1e-7;
  }

  function arcStart(arc) { return polar(arc.c, arc.r, arc.a0); }
  function arcEnd(arc) { return polar(arc.c, arc.r, arc.a1); }

  /* ---------- 图元基础 ---------- */
  function isCircleLike(ent) { return ent.type === 'circle' || ent.type === 'arc'; }
  function isPolyLike(ent) { return !!ent && (ent.type === 'rect' || ent.type === 'poly'); }

  function rectPoints(ent) {
    return [P(ent.x1, ent.y1), P(ent.x2, ent.y1), P(ent.x2, ent.y2), P(ent.x1, ent.y2)];
  }

  function polyPoints(ent) {
    return (ent.pts || []).map(cloneP);
  }

  /** 矩形 / 多边形的描边顶点（闭合时首尾重复一个点） */
  function closedPoints(ent) {
    const pts = ent.type === 'rect' ? rectPoints(ent) : polyPoints(ent);
    if (ent.type === 'poly' && ent.closed === false) return pts;
    if (pts.length) pts.push(cloneP(pts[0]));
    return pts;
  }

  /** 矩形 / 多边形拆成线段，便于求交、拾取与偏移 */
  function polySegments(ent) {
    const pts = ent.type === 'rect' ? rectPoints(ent) : polyPoints(ent);
    const closed = ent.type === 'rect' || ent.closed !== false;
    const segs = [];
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (dist(a, b) < EPS) continue;
      segs.push({ type: 'line', p1: cloneP(a), p2: cloneP(b) });
    }
    return segs;
  }

  /* ---------- 贝塞尔样条 ---------- */
  function bezierPoint(c, t) {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
    return P(a * c.p0.x + b * c.p1.x + cc * c.p2.x + d * c.p3.x,
      a * c.p0.y + b * c.p1.y + cc * c.p2.y + d * c.p3.y);
  }

  /** 样条节点控制柄：显式 handles 优先，否则按 Catmull-Rom 自动推导 */
  function splineControls(ent) {
    const pts = ent.pts || [];
    const n = pts.length;
    const closed = !!ent.closed;
    let s = typeof ent.smooth === 'number' ? clamp(ent.smooth, 0, 1) : 0.5;
    if (!(n > 0)) return [];
    const k = s / 6;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const h = ent.handles && ent.handles[i];
      if (h && h.in && h.out) {
        out.push({ p: cloneP(p), in: cloneP(h.in), out: cloneP(h.out) });
        continue;
      }
      let prev, next;
      if (closed) {
        prev = pts[(i - 1 + n) % n];
        next = pts[(i + 1) % n];
      } else {
        prev = pts[Math.max(0, i - 1)];
        next = pts[Math.min(n - 1, i + 1)];
      }
      const tv = sub(next, prev);
      out.push({
        p: cloneP(p),
        in: P(p.x - tv.x * k, p.y - tv.y * k),
        out: P(p.x + tv.x * k, p.y + tv.y * k)
      });
    }
    return out;
  }

  /** 样条拆成逐段三次贝塞尔曲线 */
  function splineCurves(ent) {
    const nodes = splineControls(ent);
    const n = nodes.length;
    if (n < 2) return [];
    const closed = !!ent.closed;
    const count = closed ? n : n - 1;
    const curves = [];
    for (let i = 0; i < count; i++) {
      const a = nodes[i], b = nodes[(i + 1) % n];
      curves.push({ p0: cloneP(a.p), p1: cloneP(a.out), p2: cloneP(b.in), p3: cloneP(b.p) });
    }
    return curves;
  }

  /** 样条按段采样为折线；segs 为总采样段数（近似） */
  function splinePolyline(ent, segs) {
    const curves = splineCurves(ent);
    if (!curves.length) return polyPoints(ent);
    const per = Math.max(6, Math.ceil((segs || 64) / curves.length));
    const out = [];
    curves.forEach(function (c, ci) {
      for (let i = 0; i <= per; i++) {
        if (ci > 0 && i === 0) continue;
        out.push(bezierPoint(c, i / per));
      }
    });
    return out;
  }

  /** 轮廓闭合检测：首尾点距离不超过 tol 视为可闭合 */
  function contourClosure(pts, tol) {
    if (!pts || pts.length < 3) return false;
    return dist(pts[0], pts[pts.length - 1]) <= (tol > 0 ? tol : 1e-6);
  }

  function entityPolyline(ent, segs) {
    segs = segs || 64;
    if (ent.type === 'group') {
      const out = [];
      (ent.children || []).forEach(function (c) {
        entityPolyline(c, segs).forEach(function (q) { out.push(q); });
      });
      return out;
    }
    if (ent.type === 'line') return [cloneP(ent.p1), cloneP(ent.p2)];
    if (ent.type === 'point') return [cloneP(ent.p)];
    if (ent.type === 'spline') return splinePolyline(ent, Math.max(segs, 48));
    if (isPolyLike(ent)) return closedPoints(ent);
    if (ent.type === 'circle') {
      const out = [];
      for (let i = 0; i <= segs; i++) out.push(polar(ent.c, ent.r, i / segs * TAU));
      return out;
    }
    if (ent.type === 'arc') {
      const sw = arcSweep(ent);
      const n = Math.max(4, Math.ceil(segs * sw / TAU));
      const out = [];
      for (let i = 0; i <= n; i++) {
        const a = ent.ccw ? ent.a0 + sw * i / n : ent.a0 - sw * i / n;
        out.push(polar(ent.c, ent.r, a));
      }
      return out;
    }
    return [];
  }

  function entityEndpoints(ent) {
    if (ent.type === 'group') return [];
    if (ent.type === 'line') return [cloneP(ent.p1), cloneP(ent.p2)];
    if (ent.type === 'point') return [cloneP(ent.p)];
    if (ent.type === 'arc') return [arcStart(ent), arcEnd(ent)];
    if (ent.type === 'rect') return rectPoints(ent);
    if (ent.type === 'poly') return polyPoints(ent);
    if (ent.type === 'spline') return polyPoints(ent);
    return [];
  }

  function polylineLength(pts, closed) {
    let total = 0;
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) total += dist(pts[i], pts[(i + 1) % pts.length]);
    return total;
  }

  function entityLength(ent) {
    if (ent.type === 'group') {
      return (ent.children || []).reduce(function (sum, c) { return sum + entityLength(c); }, 0);
    }
    if (ent.type === 'line') return dist(ent.p1, ent.p2);
    if (ent.type === 'circle') return TAU * ent.r;
    if (ent.type === 'arc') return arcSweep(ent) * ent.r;
    if (ent.type === 'rect') return 2 * ((ent.x2 - ent.x1) + (ent.y2 - ent.y1));
    if (ent.type === 'poly') return polylineLength(polyPoints(ent), ent.closed !== false);
    if (ent.type === 'spline') return polylineLength(splinePolyline(ent, 120), false);
    return 0;
  }

  function entityMidpoint(ent) {
    if (ent.type === 'group') {
      const b = entityBBox(ent);
      return P((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
    }
    if (ent.type === 'line') return lerp(ent.p1, ent.p2, 0.5);
    if (ent.type === 'point') return cloneP(ent.p);
    if (ent.type === 'circle') return polar(ent.c, ent.r, Math.PI / 4);
    if (ent.type === 'arc') {
      const sw = arcSweep(ent);
      return polar(ent.c, ent.r, ent.ccw ? ent.a0 + sw / 2 : ent.a0 - sw / 2);
    }
    if (isPolyLike(ent)) {
      const b = entityBBox(ent);
      return P((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
    }
    if (ent.type === 'spline') {
      const pts = splinePolyline(ent, 96);
      if (!pts.length) return P(0, 0);
      const total = polylineLength(pts, false);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = dist(pts[i - 1], pts[i]);
        if (acc + d >= total / 2) {
          const t = d > EPS ? (total / 2 - acc) / d : 0;
          return lerp(pts[i - 1], pts[i], t);
        }
        acc += d;
      }
      return cloneP(pts[pts.length - 1]);
    }
    return P(0, 0);
  }

  function polyHitDistance(pts, closed, p) {
    let best = Infinity;
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const d = closestOnSeg(p, pts[i], pts[(i + 1) % pts.length]).dist;
      if (d < best) best = d;
    }
    return best;
  }

  function hitDistance(ent, p) {
    if (ent.type === 'group') {
      let best = Infinity;
      (ent.children || []).forEach(function (c) {
        const d = hitDistance(c, p);
        if (d < best) best = d;
      });
      return best;
    }
    if (ent.type === 'line') return closestOnSeg(p, ent.p1, ent.p2).dist;
    if (ent.type === 'point') return dist(p, ent.p);
    if (ent.type === 'circle') return Math.abs(dist(p, ent.c) - ent.r);
    if (ent.type === 'arc') {
      const a = angleOf(ent.c, p);
      if (angleOnArc(a, ent)) return Math.abs(dist(p, ent.c) - ent.r);
      return Math.min(dist(p, arcStart(ent)), dist(p, arcEnd(ent)));
    }
    if (ent.type === 'rect') return polyHitDistance(rectPoints(ent), true, p);
    if (ent.type === 'poly') return polyHitDistance(polyPoints(ent), ent.closed !== false, p);
    if (ent.type === 'spline') return polyHitDistance(splinePolyline(ent, 96), false, p);
    return Infinity;
  }

  function entityBBox(ent) {
    if (ent.type === 'group') {
      const kids = ent.children || [];
      if (!kids.length) return { x1: 0, y1: 0, x2: 0, y2: 0 };
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      kids.forEach(function (c) {
        const b = entityBBox(c);
        if (b.x1 < x1) x1 = b.x1; if (b.y1 < y1) y1 = b.y1;
        if (b.x2 > x2) x2 = b.x2; if (b.y2 > y2) y2 = b.y2;
      });
      return { x1: x1, y1: y1, x2: x2, y2: y2 };
    }
    if (ent.type === 'point') return { x1: ent.p.x, y1: ent.p.y, x2: ent.p.x, y2: ent.p.y };
    if (ent.type === 'line') {
      return {
        x1: Math.min(ent.p1.x, ent.p2.x), y1: Math.min(ent.p1.y, ent.p2.y),
        x2: Math.max(ent.p1.x, ent.p2.x), y2: Math.max(ent.p1.y, ent.p2.y)
      };
    }
    const pts = entityPolyline(ent, 48);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    pts.forEach(function (q) {
      if (q.x < x1) x1 = q.x; if (q.y < y1) y1 = q.y;
      if (q.x > x2) x2 = q.x; if (q.y > y2) y2 = q.y;
    });
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  function bboxOf(entities) {
    if (!entities || !entities.length) return { x1: -100, y1: -100, x2: 100, y2: 100 };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    entities.forEach(function (e) {
      const b = entityBBox(e);
      if (b.x1 < x1) x1 = b.x1; if (b.y1 < y1) y1 = b.y1;
      if (b.x2 > x2) x2 = b.x2; if (b.y2 > y2) y2 = b.y2;
    });
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  function translateEntity(ent, dx, dy) {
    if (ent.type === 'group') {
      (ent.children || []).forEach(function (c) { translateEntity(c, dx, dy); });
      return ent;
    }
    if (ent.type === 'rect') {
      ent.x1 += dx; ent.x2 += dx; ent.y1 += dy; ent.y2 += dy;
      return ent;
    }
    if ((ent.type === 'poly' || ent.type === 'spline') && ent.pts) {
      ent.pts.forEach(function (q) { q.x += dx; q.y += dy; });
      if (ent.type === 'spline' && ent.handles) {
        ent.handles.forEach(function (h) {
          if (h && h.in) { h.in.x += dx; h.in.y += dy; }
          if (h && h.out) { h.out.x += dx; h.out.y += dy; }
        });
      }
      return ent;
    }
    if (ent.p1) { ent.p1.x += dx; ent.p1.y += dy; }
    if (ent.p2) { ent.p2.x += dx; ent.p2.y += dy; }
    if (ent.p) { ent.p.x += dx; ent.p.y += dy; }
    if (ent.c) { ent.c.x += dx; ent.c.y += dy; }
    return ent;
  }

  function rotatePoint(p, base, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const x = p.x - base.x, y = p.y - base.y;
    return P(base.x + x * ca - y * sa, base.y + x * sa + y * ca);
  }

  function rotateEntity(ent, base, ang) {
    if (ent.type === 'group') {
      (ent.children || []).forEach(function (c) { rotateEntity(c, base, ang); });
      return ent;
    }
    if (ent.type === 'rect') {
      const pts = rectPoints(ent).map(function (q) { return rotatePoint(q, base, ang); });
      // 旋转 90° 的整数倍时仍是轴对齐矩形，其余角度转换为多边形
      if (Math.abs(Math.sin(ang)) < 1e-9 || Math.abs(Math.cos(ang)) < 1e-9) {
        const b = entityBBox({ type: 'poly', pts: pts, closed: true });
        ent.x1 = b.x1; ent.y1 = b.y1; ent.x2 = b.x2; ent.y2 = b.y2;
      } else {
        ent.type = 'poly';
        ent.pts = pts;
        ent.closed = true;
        delete ent.x1; delete ent.y1; delete ent.x2; delete ent.y2;
      }
      return ent;
    }
    if (ent.type === 'poly' || ent.type === 'spline') {
      ent.pts = (ent.pts || []).map(function (q) { return rotatePoint(q, base, ang); });
      if (ent.type === 'spline' && ent.handles) {
        ent.handles = ent.handles.map(function (h) {
          if (!h) return h;
          return {
            in: h.in ? rotatePoint(h.in, base, ang) : h.in,
            out: h.out ? rotatePoint(h.out, base, ang) : h.out
          };
        });
      }
      return ent;
    }
    ['p1', 'p2', 'p', 'c'].forEach(function (k) {
      if (ent[k]) ent[k] = rotatePoint(ent[k], base, ang);
    });
    if (ent.type === 'arc') { ent.a0 += ang; ent.a1 += ang; }
    return ent;
  }

  function copyShape(target, src) {
    if (src.type === 'group') {
      // 原地恢复语义：保留子图元 id；新增副本的重复 id 由 Doc.add 统一补齐
      target.type = 'group';
      target.children = (src.children || []).map(function (c) { return JSON.parse(JSON.stringify(c)); });
      delete target.p1; delete target.p2; delete target.p; delete target.c;
      delete target.pts; delete target.x1; delete target.y1; delete target.x2; delete target.y2;
      return target;
    }
    target.type = src.type;
    if (src.type === 'rect') {
      ['x1', 'y1', 'x2', 'y2'].forEach(function (k) { target[k] = src[k]; });
      delete target.pts;
    } else if (src.type === 'poly') {
      target.pts = (src.pts || []).map(cloneP);
      target.closed = src.closed !== false;
      delete target.x1; delete target.y1; delete target.x2; delete target.y2;
    } else if (src.type === 'spline') {
      target.pts = (src.pts || []).map(cloneP);
      target.handles = (src.handles || []).map(function (h) {
        return h ? { in: h.in ? cloneP(h.in) : null, out: h.out ? cloneP(h.out) : null } : null;
      });
      target.smooth = typeof src.smooth === 'number' ? src.smooth : 0.5;
      target.closed = !!src.closed;
      delete target.x1; delete target.y1; delete target.x2; delete target.y2;
    } else {
      ['p1', 'p2', 'p', 'c'].forEach(function (k) {
        if (src[k]) target[k] = cloneP(src[k]);
      });
      if (typeof src.r === 'number') target.r = src.r;
      if (typeof src.a0 === 'number') { target.a0 = src.a0; target.a1 = src.a1; target.ccw = src.ccw; }
      delete target.pts; delete target.x1; delete target.y1; delete target.x2; delete target.y2;
    }
    if (typeof src.style === 'string') target.style = src.style;
    else delete target.style;
    if (typeof src.fill === 'string') target.fill = src.fill;
    else delete target.fill;
    return target;
  }

  /** 偏移：正值向直线左法线方向 / 圆外侧偏移 */
  function offsetEntity(ent, d) {
    if (ent.type === 'line') {
      const dx = ent.p2.x - ent.p1.x, dy = ent.p2.y - ent.p1.y;
      const L = Math.hypot(dx, dy);
      if (L < EPS) return null;
      const nx = -dy / L, ny = dx / L;
      return {
        type: 'line',
        p1: P(ent.p1.x + nx * d, ent.p1.y + ny * d),
        p2: P(ent.p2.x + nx * d, ent.p2.y + ny * d)
      };
    }
    if (ent.type === 'circle') {
      const r = ent.r + d;
      if (r <= EPS) return null;
      return { type: 'circle', c: cloneP(ent.c), r: r };
    }
    if (ent.type === 'arc') {
      const r = ent.r + d;
      if (r <= EPS) return null;
      return { type: 'arc', c: cloneP(ent.c), r: r, a0: ent.a0, a1: ent.a1, ccw: ent.ccw };
    }
    return null;
  }

  /** 圆弧过渡（倒圆角）：根据两条直线与拾取侧生成切线点、圆弧。
   *  返回 { line1, line2, arc } 或 { error }。拾取点用于确定保留哪一侧线段。 */
  function filletLines(l1, l2, r, pick1, pick2) {
    if (!(r > 0)) return { error: '半径需大于 0' };
    const ip = lineIntersectInfinite(l1.p1, l1.p2, l2.p1, l2.p2);
    if (!ip) return { error: '两条直线平行，无法生成过渡圆弧' };

    function side(line, pick) {
      const d1 = dist(ip, line.p1), d2 = dist(ip, line.p2);
      const u1 = unitVec(sub(line.p1, ip));
      const u2 = unitVec(sub(line.p2, ip));
      if (!u1 && !u2) return null;
      if (!u1) return { u: u2, avail: d2, far: line.p2 };
      if (!u2) return { u: u1, avail: d1, far: line.p1 };
      const v = sub(pick || line.p1, ip);
      const keepFirst = Math.hypot(v.x, v.y) < 1e-7 ? d1 >= d2 : dotVec(v, u1) > 0;
      return keepFirst ? { u: u1, avail: d1, far: line.p1 } : { u: u2, avail: d2, far: line.p2 };
    }

    const s1 = side(l1, pick1);
    const s2 = side(l2, pick2);
    if (!s1 || !s2) return { error: '线段长度不足，无法生成过渡圆弧' };

    const theta = Math.acos(clamp(dotVec(s1.u, s2.u), -1, 1));
    if (theta < 1e-4 || theta > Math.PI - 1e-4) {
      return { error: '两条直线共线，无法生成过渡圆弧' };
    }
    const d = r / Math.tan(theta / 2);
    if (d >= s1.avail - 1e-8 || d >= s2.avail - 1e-8) {
      return { error: '半径过大，超出线段可用长度' };
    }
    const bis = unitVec({ x: s1.u.x + s2.u.x, y: s1.u.y + s2.u.y });
    if (!bis) return { error: '两条直线共线，无法生成过渡圆弧' };
    const center = {
      x: ip.x + bis.x * (r / Math.sin(theta / 2)),
      y: ip.y + bis.y * (r / Math.sin(theta / 2))
    };
    const t1 = { x: ip.x + s1.u.x * d, y: ip.y + s1.u.y * d };
    const t2 = { x: ip.x + s2.u.x * d, y: ip.y + s2.u.y * d };
    const a0 = angleOf(center, t1);
    const a1 = angleOf(center, t2);
    const ccw = normAngle(a1 - a0) <= Math.PI;
    return {
      line1: { type: 'line', p1: cloneP(s1.far), p2: cloneP(t1) },
      line2: { type: 'line', p1: cloneP(s2.far), p2: cloneP(t2) },
      arc: { type: 'arc', c: center, r: r, a0: a0, a1: a1, ccw: ccw },
      center: center,
      tangent1: t1,
      tangent2: t2
    };
  }

  /** 无限延长直线与圆的交点（不限制在线段范围内，用于圆角求心） */
  function lineCircleInfinite(a1, a2, c, r) {
    const dx = a2.x - a1.x, dy = a2.y - a1.y;
    const fx = a1.x - c.x, fy = a1.y - c.y;
    const A = dx * dx + dy * dy;
    if (A < EPS) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < -EPS) return [];
    disc = Math.sqrt(Math.max(0, disc));
    const out = [];
    [(-B - disc) / (2 * A), (-B + disc) / (2 * A)].forEach(function (t) {
      const q = P(a1.x + dx * t, a1.y + dy * t);
      for (let i = 0; i < out.length; i++) if (dist2(out[i], q) < 1e-14) return;
      out.push(q);
    });
    return out;
  }

  /** 通用圆角过渡：直线/圆/圆弧两两组合。
   *  pick1 / pick2 为两图元上被点选的位置，用于保留拾取侧。
   *  返回 { ent1, ent2, arc, tangent1, tangent2 } 或 { error }。 */
  function filletCurves(e1, e2, r, pick1, pick2) {
    if (!(r > 0)) return { error: '半径需大于 0' };
    if (!e1 || !e2 || e1 === e2 || (e1.id != null && e1.id === e2.id)) return { error: '请选择两个不同的图形' };
    const circleLike = function (e) { return e.type === 'circle' || e.type === 'arc'; };
    if (!(e1.type === 'line' || circleLike(e1)) || !(e2.type === 'line' || circleLike(e2))) {
      return { error: '仅支持直线与圆弧之间的过渡' };
    }
    if (e1.type === 'line' && e2.type === 'line') {
      const res = filletLines(e1, e2, r, pick1, pick2);
      if (res.error) return res;
      return { ent1: res.line1, ent2: res.line2, arc: res.arc, tangent1: res.tangent1, tangent2: res.tangent2 };
    }

    function support(ent, d) {
      if (ent.type === 'line') {
        const u = unitVec(sub(ent.p2, ent.p1));
        if (!u) return null;
        const n = { x: -u.y, y: u.x };
        return {
          type: 'line',
          a: P(ent.p1.x + n.x * d, ent.p1.y + n.y * d),
          b: P(ent.p2.x + n.x * d, ent.p2.y + n.y * d)
        };
      }
      const rr = ent.r + d;
      return rr > EPS ? { type: 'circle', c: cloneP(ent.c), r: rr } : null;
    }
    function inter(s1, s2) {
      if (!s1 || !s2) return [];
      if (s1.type === 'line' && s2.type === 'line') {
        const q = lineIntersectInfinite(s1.a, s1.b, s2.a, s2.b);
        return q ? [q] : [];
      }
      if (s1.type === 'line') return lineCircleInfinite(s1.a, s1.b, s2.c, s2.r);
      if (s2.type === 'line') return lineCircleInfinite(s2.a, s2.b, s1.c, s1.r);
      return circleCircleIntersect(s1.c, s1.r, s2.c, s2.r);
    }
    /** 圆心到图元的垂足 / 最近点 */
    function tangentOn(ent, ctr) {
      if (ent.type === 'line') {
        const u = unitVec(sub(ent.p2, ent.p1));
        if (!u) return null;
        const t = (ctr.x - ent.p1.x) * u.x + (ctr.y - ent.p1.y) * u.y;
        return { x: ent.p1.x + u.x * t, y: ent.p1.y + u.y * t };
      }
      const u = unitVec(sub(ctr, ent.c));
      if (!u) return null;
      return { x: ent.c.x + u.x * ent.r, y: ent.c.y + u.y * ent.r };
    }
    function onEntity(ent, q) {
      if (ent.type !== 'arc') return true;
      return angleOnArc(angleOf(ent.c, q), ent);
    }

    let best = null, bestScore = Infinity;
    [-r, r].forEach(function (d1) {
      [-r, r].forEach(function (d2) {
        const s1 = support(e1, d1), s2 = support(e2, d2);
        inter(s1, s2).forEach(function (ctr) {
          const t1 = tangentOn(e1, ctr);
          const t2 = tangentOn(e2, ctr);
          if (!t1 || !t2) return;
          const score = dist(t1, pick1 || t1) + dist(t2, pick2 || t2);
          const inRange = onEntity(e1, t1) && onEntity(e2, t2);
          const total = score + (inRange ? 0 : 1e4);
          if (total < bestScore) { bestScore = total; best = { ctr: ctr, t1: t1, t2: t2 }; }
        });
      });
    });
    if (!best) return { error: '无法生成过渡圆弧，请调整半径或拾取位置' };
    const arcStart = best.t1, arcEnd = best.t2;
    if (dist(arcStart, arcEnd) < 1e-7) return { error: '切点重合，请调整半径' };
    const a0 = angleOf(best.ctr, arcStart);
    const a1 = angleOf(best.ctr, arcEnd);
    const arc = { type: 'arc', c: best.ctr, r: r, a0: a0, a1: a1, ccw: normAngle(a1 - a0) <= Math.PI };

    function trim(ent, t, pick) {
      const c = copyShape({ type: ent.type }, ent);
      if (ent.type === 'line') {
        if (dist(ent.p1, pick || ent.p1) <= dist(ent.p2, pick || ent.p2)) {
          if (dist(ent.p1, t) < 1e-7) return null;
          c.p2 = cloneP(t);
        } else {
          if (dist(ent.p2, t) < 1e-7) return null;
          c.p1 = cloneP(t);
        }
      } else if (ent.type === 'arc') {
        const keepStart = dist(arcStartOf(ent), pick || arcStartOf(ent)) <= dist(arcEndOf(ent), pick || arcEndOf(ent));
        if (keepStart) c.a1 = angleOf(ent.c, t);
        else c.a0 = angleOf(ent.c, t);
        if (arcSweep(c) < 1e-6) return null;
      }
      return c;
    }
    function arcStartOf(e) { return polar(e.c, e.r, e.a0); }
    function arcEndOf(e) { return polar(e.c, e.r, e.a1); }

    const ent1 = trim(e1, best.t1, pick1);
    const ent2 = trim(e2, best.t2, pick2);
    if (!ent1 || !ent2) return { error: '过渡半径过大，图形剩余部分不足' };
    return { ent1: ent1, ent2: ent2, arc: arc, tangent1: best.t1, tangent2: best.t2 };
  }

  /** 递归删除图元及其 group 子孙的 id */
  function stripIds(ent) {
    delete ent.id;
    if (ent.type === 'group' && ent.children) ent.children.forEach(stripIds);
    return ent;
  }

  /** 深拷贝图元并递归清除 id，供镜像 / 阵列等复制场景使用 */
  function cloneEntity(ent) {
    return stripIds(JSON.parse(JSON.stringify(ent)));
  }

  /** 可编辑属性的统一校验与写入；dryRun=true 时只校验不修改 */
  function setEntityProp(ent, key, value, dryRun) {
    if (!ent) return { ok: false, error: '图元不存在' };
    if (ent.type === 'group') return { ok: false, error: '组合对象不支持直接修改属性，请先分解' };
    if (value === '' || value == null) return { ok: false, error: '请输入数值' };
    const v = Number(value);
    if (!isFinite(v)) return { ok: false, error: '请输入有效数字' };

    if (ent.type === 'line') {
      const p1 = cloneP(ent.p1), p2 = cloneP(ent.p2);
      if (key === 'x1') p1.x = v;
      else if (key === 'y1') p1.y = v;
      else if (key === 'x2') p2.x = v;
      else if (key === 'y2') p2.y = v;
      else return { ok: false, error: '该属性不可编辑' };
      if (dist(p1, p2) < 1e-6) return { ok: false, error: '起点与终点不能重合' };
      if (!dryRun) { ent.p1 = p1; ent.p2 = p2; }
      return { ok: true };
    }
    if (ent.type === 'circle') {
      if (key === 'cx' || key === 'cy') {
        const c = cloneP(ent.c);
        if (key === 'cx') c.x = v; else c.y = v;
        if (!dryRun) ent.c = c;
        return { ok: true };
      }
      if (key === 'r') {
        if (!(v > 0)) return { ok: false, error: '半径必须大于 0' };
        if (!dryRun) ent.r = v;
        return { ok: true };
      }
      return { ok: false, error: '该属性不可编辑' };
    }
    if (ent.type === 'arc') {
      if (key === 'cx' || key === 'cy') {
        const c = cloneP(ent.c);
        if (key === 'cx') c.x = v; else c.y = v;
        if (!dryRun) ent.c = c;
        return { ok: true };
      }
      if (key === 'r') {
        if (!(v > 0)) return { ok: false, error: '半径必须大于 0' };
        if (!dryRun) ent.r = v;
        return { ok: true };
      }
      if (key === 'a0' || key === 'a1') {
        const a0 = key === 'a0' ? rad(v) : ent.a0;
        const a1 = key === 'a1' ? rad(v) : ent.a1;
        if (normAngle(a1 - a0) < 1e-6) return { ok: false, error: '起始角与终止角不能相同' };
        if (!dryRun) { ent.a0 = a0; ent.a1 = a1; }
        return { ok: true };
      }
      return { ok: false, error: '该属性不可编辑' };
    }
    if (ent.type === 'point') {
      const p = cloneP(ent.p);
      if (key === 'x') p.x = v;
      else if (key === 'y') p.y = v;
      else return { ok: false, error: '该属性不可编辑' };
      if (!dryRun) ent.p = p;
      return { ok: true };
    }
    if (ent.type === 'rect') {
      const r = { x1: ent.x1, y1: ent.y1, x2: ent.x2, y2: ent.y2 };
      if (key === 'x1') r.x1 = v;
      else if (key === 'y1') r.y1 = v;
      else if (key === 'x2') r.x2 = v;
      else if (key === 'y2') r.y2 = v;
      else if (key === 'w') {
        if (!(v > 1e-6)) return { ok: false, error: '宽度必须大于 0' };
        r.x2 = r.x1 + v;
      } else if (key === 'h') {
        if (!(v > 1e-6)) return { ok: false, error: '高度必须大于 0' };
        r.y2 = r.y1 + v;
      } else return { ok: false, error: '该属性不可编辑' };
      const n = normalizeRect(r.x1, r.y1, r.x2, r.y2);
      if (n.x2 - n.x1 < 1e-6 || n.y2 - n.y1 < 1e-6) return { ok: false, error: '矩形宽高不能为 0' };
      if (!dryRun) { ent.x1 = n.x1; ent.y1 = n.y1; ent.x2 = n.x2; ent.y2 = n.y2; }
      return { ok: true };
    }
    if (ent.type === 'poly') {
      const m = /^v(\d+)(x|y)$/.exec(key);
      if (!m) return { ok: false, error: '该属性不可编辑' };
      const idx = Number(m[1]);
      if (!ent.pts || idx < 0 || idx >= ent.pts.length) return { ok: false, error: '顶点不存在' };
      const pts = ent.pts.map(cloneP);
      pts[idx][m[2]] = v;
      if (Math.abs(polyArea(pts)) < 1e-9) return { ok: false, error: '多边形面积不能为 0' };
      if (!dryRun) ent.pts = pts;
      return { ok: true };
    }
    return { ok: false, error: '该图元不可编辑' };
  }

  /* ---------- 相交 ---------- */
  function intersections(a, b) {
    const out = [];
    function push(pts, filterEnt) {
      (pts || []).forEach(function (p) {
        if (filterEnt && !filterEnt(p)) return;
        for (let i = 0; i < out.length; i++) if (dist2(out[i], p) < 1e-12) return;
        out.push(p);
      });
    }
    const arcFilter = function (ent) {
      return function (p) { return angleOnArc(angleOf(ent.c, p), ent); };
    };

    // 样条按采样折线拆成线段后逐对求交
    if (a.type === 'spline' || b.type === 'spline') {
      const sa = a.type === 'spline' ? polySegments({ type: 'poly', pts: splinePolyline(a, 96), closed: false }) : [a];
      const sb = b.type === 'spline' ? polySegments({ type: 'poly', pts: splinePolyline(b, 96), closed: false }) : [b];
      sa.forEach(function (x) {
        sb.forEach(function (y) { push(intersections(x, y)); });
      });
      return out;
    }

    // 矩形 / 多边形按边拆成线段后逐对求交
    if (isPolyLike(a) || isPolyLike(b)) {
      const ea = isPolyLike(a) ? polySegments(a) : [a];
      const eb = isPolyLike(b) ? polySegments(b) : [b];
      ea.forEach(function (sa) {
        eb.forEach(function (sb) { push(intersections(sa, sb)); });
      });
      return out;
    }

    if (a.type === 'line' && b.type === 'line') {
      push(lineLineIntersect(a.p1, a.p2, b.p1, b.p2));
    } else if (a.type === 'line' && isCircleLike(b)) {
      push(lineCircleIntersect(a.p1, a.p2, b.c, b.r), b.type === 'arc' ? arcFilter(b) : null);
    } else if (b.type === 'line' && isCircleLike(a)) {
      push(lineCircleIntersect(b.p1, b.p2, a.c, a.r), a.type === 'arc' ? arcFilter(a) : null);
    } else if (isCircleLike(a) && isCircleLike(b)) {
      push(circleCircleIntersect(a.c, a.r, b.c, b.r), function (p) {
        return (a.type !== 'arc' || angleOnArc(angleOf(a.c, p), a)) &&
               (b.type !== 'arc' || angleOnArc(angleOf(b.c, p), b));
      });
    }
    return out;
  }

  /* ---------- 裁剪 ---------- */
  function trimLine(ent, pick, others) {
    const p1 = ent.p1, p2 = ent.p2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return null;
    const pickT = clamp(((pick.x - p1.x) * dx + (pick.y - p1.y) * dy) / len2, 0, 1);
    const ts = [];
    others.forEach(function (o) {
      intersections(ent, o).forEach(function (ip) {
        const t = ((ip.x - p1.x) * dx + (ip.y - p1.y) * dy) / len2;
        if (t > 1e-6 && t < 1 - 1e-6) {
          for (let i = 0; i < ts.length; i++) if (Math.abs(ts[i] - t) < 1e-6) return;
          ts.push(t);
        }
      });
    });
    if (!ts.length) return null;
    ts.sort(function (a, b) { return a - b; });
    const bounds = [0].concat(ts, [1]);
    let idx = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      if (pickT >= bounds[i] - 1e-6 && pickT <= bounds[i + 1] + 1e-6) { idx = i; break; }
    }
    function seg(t0, t1) {
      return { type: 'line', p1: lerp(p1, p2, t0), p2: lerp(p1, p2, t1) };
    }
    if (idx === 0) return [seg(bounds[1], 1)];
    if (idx === bounds.length - 2) return [seg(0, bounds[bounds.length - 2])];
    return [seg(0, bounds[idx]), seg(bounds[idx + 1], 1)];
  }

  function trimCircle(ent, pick, others) {
    const angles = [];
    others.forEach(function (o) {
      intersections(ent, o).forEach(function (ip) {
        const a = normAngle(angleOf(ent.c, ip));
        for (let i = 0; i < angles.length; i++) if (Math.abs(normAngle(angles[i] - a)) < 1e-6) return;
        angles.push(a);
      });
    });
    if (angles.length < 2) return null;
    angles.sort(function (a, b) { return a - b; });
    const pa = normAngle(angleOf(ent.c, pick));
    let idx = -1;
    for (let k = 0; k < angles.length; k++) {
      const a = angles[k];
      const b = angles[(k + 1) % angles.length];
      const span = normAngle(b - a);
      const off = normAngle(pa - a);
      if (off <= span + 1e-9) { idx = k; break; }
    }
    if (idx < 0) return null;
    const start = angles[(idx + 1) % angles.length];
    const end = angles[idx];
    if (normAngle(end - start) < 1e-9) return null;
    return [{ type: 'arc', c: cloneP(ent.c), r: ent.r, a0: start, a1: end, ccw: true }];
  }

  function trimArc(ent, pick, others) {
    const sw = arcSweep(ent);
    if (sw < 1e-9) return null;
    const params = [];
    others.forEach(function (o) {
      intersections(ent, o).forEach(function (ip) {
        const a = normAngle(angleOf(ent.c, ip));
        const s = ent.ccw ? normAngle(a - ent.a0) : normAngle(ent.a0 - a);
        if (s > 1e-6 && s < sw - 1e-6) {
          for (let i = 0; i < params.length; i++) if (Math.abs(params[i] - s) < 1e-6) return;
          params.push(s);
        }
      });
    });
    if (!params.length) return null;
    params.sort(function (a, b) { return a - b; });
    const bounds = [0].concat(params, [sw]);
    const pickA = normAngle(angleOf(ent.c, pick));
    let pickS = ent.ccw ? normAngle(pickA - ent.a0) : normAngle(ent.a0 - pickA);
    pickS = clamp(pickS, 0, sw);
    let idx = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      if (pickS >= bounds[i] - 1e-6 && pickS <= bounds[i + 1] + 1e-6) { idx = i; break; }
    }
    function angleAt(s) { return ent.ccw ? ent.a0 + s : ent.a0 - s; }
    function makeArc(s0, s1) {
      return { type: 'arc', c: cloneP(ent.c), r: ent.r, a0: angleAt(s0), a1: angleAt(s1), ccw: ent.ccw };
    }
    if (idx === 0) return [makeArc(bounds[1], sw)];
    if (idx === bounds.length - 2) return [makeArc(0, bounds[bounds.length - 2])];
    return [makeArc(0, bounds[idx]), makeArc(bounds[idx + 1], sw)];
  }

  function trimEntity(ent, pick, others) {
    if (ent.type === 'line') return trimLine(ent, pick, others);
    if (ent.type === 'circle') return trimCircle(ent, pick, others);
    if (ent.type === 'arc') return trimArc(ent, pick, others);
    return null;
  }

  /* ---------- 查询 ---------- */
  function lineAngle(line) { return Math.atan2(line.p2.y - line.p1.y, line.p2.x - line.p1.x); }

  /** 两条直线的锐角（0~90°） */
  function angleBetweenLines(l1, l2) {
    let d = Math.abs(deg(lineAngle(l1) - lineAngle(l2))) % 180;
    if (d > 90) d = 180 - d;
    return d;
  }

  /* ---------- 矩形 ---------- */
  function normalizeRect(x1, y1, x2, y2) {
    return {
      x1: Math.min(x1, x2), y1: Math.min(y1, y2),
      x2: Math.max(x1, x2), y2: Math.max(y1, y2)
    };
  }

  function pointInRect(p, r) {
    return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
  }

  function segmentIntersectsRect(a, b, r) {
    if (pointInRect(a, r) || pointInRect(b, r)) return true;
    const corners = [P(r.x1, r.y1), P(r.x2, r.y1), P(r.x2, r.y2), P(r.x1, r.y2)];
    for (let i = 0; i < 4; i++) {
      if (lineLineIntersect(a, b, corners[i], corners[(i + 1) % 4]).length) return true;
    }
    return false;
  }

  /* ---------- 镜像 ---------- */
  function mirrorPoint(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < EPS) return cloneP(p);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    const px = a.x + dx * t, py = a.y + dy * t;
    return P(2 * px - p.x, 2 * py - p.y);
  }

  /** 以 a-b 直线为镜像轴生成对称图元副本 */
  /** 以 base 为基点按 sx / sy 缩放图元；圆与圆弧按面积等效保持正圆不变形 */
  function scaleEntity(ent, base, sx, sy) {
    if (!ent) return ent;
    if (ent.type === 'group') {
      (ent.children || []).forEach(function (c) { scaleEntity(c, base, sx, sy); });
      return ent;
    }
    const u = Math.sqrt(Math.abs(sx * sy));
    function sp(p) {
      return P(base.x + (p.x - base.x) * sx, base.y + (p.y - base.y) * sy);
    }
    if (ent.type === 'rect') {
      const a = sp({ x: ent.x1, y: ent.y1 });
      const b = sp({ x: ent.x2, y: ent.y2 });
      ent.x1 = Math.min(a.x, b.x); ent.x2 = Math.max(a.x, b.x);
      ent.y1 = Math.min(a.y, b.y); ent.y2 = Math.max(a.y, b.y);
      return ent;
    }
    if (ent.type === 'poly' || ent.type === 'spline') {
      ent.pts = (ent.pts || []).map(sp);
      if (ent.type === 'spline' && ent.handles) {
        ent.handles = ent.handles.map(function (h) {
          if (!h) return h;
          return { in: h.in ? sp(h.in) : h.in, out: h.out ? sp(h.out) : h.out };
        });
      }
      return ent;
    }
    if (ent.type === 'circle' || ent.type === 'arc') {
      ent.c = sp(ent.c);
      ent.r = ent.r * u;
      return ent;
    }
    ['p1', 'p2', 'p', 'c'].forEach(function (k) {
      if (ent[k]) ent[k] = sp(ent[k]);
    });
    return ent;
  }

  function mirrorEntity(ent, a, b) {
    if (!ent || !a || !b || dist(a, b) < EPS) return null;
    if (ent.type === 'group') {
      return stripIds({
        type: 'group',
        children: (ent.children || []).map(function (c) {
          return mirrorEntity(c, a, b) || cloneEntity(c);
        })
      });
    }
    if (ent.type === 'line') {
      return { type: 'line', p1: mirrorPoint(ent.p1, a, b), p2: mirrorPoint(ent.p2, a, b) };
    }
    if (ent.type === 'point') {
      return { type: 'point', p: mirrorPoint(ent.p, a, b) };
    }
    if (ent.type === 'circle') {
      return { type: 'circle', c: mirrorPoint(ent.c, a, b), r: ent.r };
    }
    if (ent.type === 'arc') {
      const ax = Math.atan2(b.y - a.y, b.x - a.x);
      return {
        type: 'arc', c: mirrorPoint(ent.c, a, b), r: ent.r,
        a0: normAngle(2 * ax - ent.a0), a1: normAngle(2 * ax - ent.a1), ccw: !ent.ccw
      };
    }
    if (ent.type === 'rect' || ent.type === 'poly') {
      const pts = (ent.type === 'rect' ? rectPoints(ent) : polyPoints(ent))
        .map(function (q) { return mirrorPoint(q, a, b); });
      const out = { type: 'poly', pts: pts, closed: true };
      if (typeof ent.style === 'string') out.style = ent.style;
      if (typeof ent.fill === 'string') out.fill = ent.fill;
      // 沿水平 / 垂直轴镜像后仍可用轴对齐矩形表示
      if (ent.type === 'rect' && (Math.abs(b.y - a.y) < 1e-9 || Math.abs(b.x - a.x) < 1e-9)) {
        const bb = entityBBox(out);
        out.type = 'rect';
        out.x1 = bb.x1; out.y1 = bb.y1; out.x2 = bb.x2; out.y2 = bb.y2;
        delete out.pts;
      }
      return out;
    }
    if (ent.type === 'spline') {
      return {
        type: 'spline',
        pts: (ent.pts || []).map(function (q) { return mirrorPoint(q, a, b); }),
        handles: (ent.handles || []).map(function (h) {
          return h ? {
            in: h.in ? mirrorPoint(h.in, a, b) : null,
            out: h.out ? mirrorPoint(h.out, a, b) : null
          } : null;
        }),
        smooth: typeof ent.smooth === 'number' ? ent.smooth : 0.5,
        closed: !!ent.closed
      };
    }
    return null;
  }

  /* ---------- 两点 + 半径 生成圆弧 ---------- */
  /** 由弦端点与半径求圆弧；major=true 取优弧，否则取劣弧 */
  function arcFromChord(p1, p2, r, major) {
    const d = dist(p1, p2);
    if (!(r > 0) || d < EPS || r < d / 2 - 1e-9) return null;
    const rr = Math.max(r, d / 2);
    const mid = lerp(p1, p2, 0.5);
    const h = Math.sqrt(Math.max(rr * rr - d * d / 4, 0));
    const n = P(-(p2.y - p1.y) / d, (p2.x - p1.x) / d);
    const c = add(mid, mul(n, h));
    const a0 = angleOf(c, p1), a1 = angleOf(c, p2);
    let ccw = normAngle(a1 - a0) <= Math.PI + 1e-9;
    if (major) ccw = !ccw;
    return { type: 'arc', c: c, r: rr, a0: a0, a1: a1, ccw: ccw };
  }

  /* ---------- 折线等距（斜接顶点，避免拐角交叉/断开） ---------- */
  function polyArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  /**
   * 将折线整体等距偏移，拐角处按斜接（miter）求交，生成首尾衔接的线段集合。
   * closed 为闭合链（矩形等）；d>0 沿各段左法向。
   */
  function offsetPolyline(pts, closed, d) {
    const n = pts.length;
    if (!closed && n < 2) return null;
    if (closed && n < 3) return null;
    const count = closed ? n : n - 1;
    const nor = [];
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < EPS) return null;
      nor.push(P(-dy / L, dx / L));
    }
    function join(v, n1, n2) {
      const sx = n1.x + n2.x, sy = n1.y + n2.y;
      const sl = Math.hypot(sx, sy);
      if (sl < 1e-6) return P(v.x + n1.x * d, v.y + n1.y * d);
      const ux = sx / sl, uy = sy / sl;
      const ch = Math.max(ux * n1.x + uy * n1.y, 0.2);
      return P(v.x + ux * d / ch, v.y + uy * d / ch);
    }
    const verts = [];
    if (closed) {
      for (let i = 0; i < n; i++) verts.push(join(pts[i], nor[(i - 1 + count) % count], nor[i % count]));
    } else {
      verts.push(P(pts[0].x + nor[0].x * d, pts[0].y + nor[0].y * d));
      for (let i = 1; i < n - 1; i++) verts.push(join(pts[i], nor[i - 1], nor[i]));
      verts.push(P(pts[n - 1].x + nor[count - 1].x * d, pts[n - 1].y + nor[count - 1].y * d));
    }
    if (closed) {
      const a0 = polyArea(pts), a1 = polyArea(verts);
      if (Math.abs(a1) < 1e-9 || (a0 > 0) !== (a1 > 0)) return null;
    }
    const segs = [];
    const total = closed ? verts.length : verts.length - 1;
    for (let i = 0; i < total; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      if (dist(a, b) < 1e-9) continue;
      segs.push({ type: 'line', p1: cloneP(a), p2: cloneP(b) });
    }
    return segs.length ? segs : null;
  }

  global.Geo = {
    EPS: EPS, TAU: TAU, DEG: DEG,
    P: P, cloneP: cloneP, add: add, sub: sub, mul: mul, lerp: lerp,
    dist: dist, dist2: dist2, rad: rad, deg: deg, normAngle: normAngle,
    angleOf: angleOf, polar: polar, clamp: clamp,
    closestOnSeg: closestOnSeg,
    lineLineIntersect: lineLineIntersect,
    lineIntersectInfinite: lineIntersectInfinite,
    filletLines: filletLines,
    setEntityProp: setEntityProp,
    lineCircleIntersect: lineCircleIntersect,
    circleCircleIntersect: circleCircleIntersect,
    arcSweep: arcSweep, angleOnArc: angleOnArc, arcStart: arcStart, arcEnd: arcEnd,
    isCircleLike: isCircleLike,
    isPolyLike: isPolyLike, rectPoints: rectPoints, polyPoints: polyPoints,
    polySegments: polySegments, polyArea: polyArea,
    splineControls: splineControls, splineCurves: splineCurves,
    splinePolyline: splinePolyline, bezierPoint: bezierPoint, contourClosure: contourClosure,
    entityPolyline: entityPolyline, entityEndpoints: entityEndpoints,
    entityLength: entityLength, entityMidpoint: entityMidpoint,
    hitDistance: hitDistance, entityBBox: entityBBox, bboxOf: bboxOf,
    translateEntity: translateEntity, rotatePoint: rotatePoint, rotateEntity: rotateEntity,
    scaleEntity: scaleEntity,
    copyShape: copyShape, offsetEntity: offsetEntity,
    mirrorPoint: mirrorPoint, mirrorEntity: mirrorEntity,
    arcFromChord: arcFromChord, offsetPolyline: offsetPolyline,
    intersections: intersections, trimEntity: trimEntity, filletCurves: filletCurves,
    lineCircleInfinite: lineCircleInfinite,
    lineAngle: lineAngle, angleBetweenLines: angleBetweenLines,
    normalizeRect: normalizeRect, pointInRect: pointInRect,
    segmentIntersectsRect: segmentIntersectsRect
  };
})(typeof window !== 'undefined' ? window : globalThis);
