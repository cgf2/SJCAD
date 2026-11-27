/* 手机CAD · 自动化测试（纯逻辑，无需 DOM） */
(function (global) {
  'use strict';

  const Geo = global.Geo;
  const Doc = global.CADModel.Doc;
  const View = global.CADView.View;
  const Script = global.CADScript;

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || '断言失败');
  }
  function near(a, b, eps, msg) {
    eps = eps == null ? 1e-6 : eps;
    if (!isFinite(a) || Math.abs(a - b) > eps) {
      throw new Error((msg || '数值不符') + '：期望 ' + b + '，实际 ' + a);
    }
  }
  function docWith(list) {
    const d = new Doc();
    list.forEach(function (e) { d.add(e); });
    return d;
  }
  function line(x1, y1, x2, y2) {
    return { type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
  }
  function circle(cx, cy, r) {
    return { type: 'circle', c: { x: cx, y: cy }, r: r };
  }
  function arc(cx, cy, r, a0, a1, ccw) {
    return { type: 'arc', c: { x: cx, y: cy }, r: r, a0: a0, a1: a1, ccw: ccw !== false };
  }

  /** 构造无 DOM 的 App 桩，用于模拟触摸点按驱动工具流程 */
  function mockApp() {
    const d = new Doc();
    const app = {
      model: d,
      view: new View(),
      params: {},
      undo: [],
      infos: [],
      toasts: [],
      overlay: null,
      snapInfo: null,
      begin: function () { this.undo.push(d.snapshot()); },
      end: function () {},
      abort: function () { this.undo.pop(); },
      solveConstraints: function () { return global.CADConstraints ? global.CADConstraints.solve(this.model) : 0; },
      pick: function (p) { return d.hitTest(p, 12 / this.view.scale); },
      snapPoint: function (p) { return p; },
      toast: function (m) { this.toasts.push(m); },
      showInfo: function (t, h) { this.infos.push({ title: t, html: h }); },
      hideInfo: function () {},
      setOverlay: function (o) { this.overlay = o; },
      updatePrompt: function () {},
      updateParams: function () {},
      refresh: function () {},
      afterSelectionChange: function () {},
      showProps: function () { this.infos.push({ title: '图形属性', html: '可编辑' }); },
      showDim: function (id) {
        this.infos.push({ title: '尺寸标注', html: '<div data-dim="' + id + '"></div>' });
        this.dimId = id;
      },
      showConstraintList: function () {
        this.infos.push({ title: '几何约束', html: '列表' });
      },
      worldTol: function (px) { return px / this.view.scale; },
      entityInfo: function () { return '<div class="row"><span class="k">类型</span><span class="v">桩</span></div>'; }
    };
    global.CADTools.init(app);
    return app;
  }

  function useTool(id) {
    const t = global.CADTools.byId(id);
    t.activate();
    return t;
  }

  function lastInfo(app) {
    return app.infos[app.infos.length - 1] || { title: '', html: '' };
  }

  const suites = [
    {
      name: '几何核心',
      cases: [
        {
          name: '点距 / 角度 / 极坐标',
          run: function () {
            near(Geo.dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-9, '3-4-5 距离');
            near(Geo.deg(Geo.angleOf({ x: 0, y: 0 }, { x: 0, y: 1 })), 90, 1e-9, '正上方角度');
            const p = Geo.polar({ x: 10, y: 10 }, 5, Math.PI / 2);
            near(p.x, 10, 1e-9); near(p.y, 15, 1e-9);
          }
        },
        {
          name: '线段最近点与点到线段距离',
          run: function () {
            const r = Geo.closestOnSeg({ x: 50, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 0 });
            near(r.dist, 30, 1e-9);
            near(r.point.x, 50, 1e-9);
            near(r.point.y, 0, 1e-9);
            const r2 = Geo.closestOnSeg({ x: -50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
            near(r2.dist, 50, 1e-9, '线段外投影取端点');
          }
        },
        {
          name: '直线与直线相交（含平行）',
          run: function () {
            const hit = Geo.lineLineIntersect({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -50 }, { x: 50, y: 50 });
            assert(hit.length === 1, '应有 1 个交点');
            near(hit[0].x, 50); near(hit[0].y, 0);
            const none = Geo.lineLineIntersect({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 });
            assert(none.length === 0, '平行线不应相交');
            const seg = Geo.lineLineIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -5 }, { x: 20, y: 5 });
            assert(seg.length === 0, '线段延长线交点不应返回');
          }
        },
        {
          name: '直线与圆相交（两交点 / 相切）',
          run: function () {
            const pts = Geo.lineCircleIntersect({ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, 50);
            assert(pts.length === 2, '应有 2 个交点');
            const xs = pts.map(function (p) { return p.x; }).sort(function (a, b) { return a - b; });
            near(xs[0], -50); near(xs[1], 50);
            const tan = Geo.lineCircleIntersect({ x: -100, y: 50 }, { x: 100, y: 50 }, { x: 0, y: 0 }, 50);
            assert(tan.length === 1, '相切应返回 1 个交点');
            near(tan[0].y, 50);
          }
        },
        {
          name: '圆与圆相交',
          run: function () {
            const pts = Geo.circleCircleIntersect({ x: 0, y: 0 }, 50, { x: 60, y: 0 }, 50);
            assert(pts.length === 2, '应有 2 个交点');
            pts.forEach(function (p) { near(Geo.dist({ x: 0, y: 0 }, p), 50, 1e-9); });
            const out = Geo.circleCircleIntersect({ x: 0, y: 0 }, 10, { x: 100, y: 0 }, 10);
            assert(out.length === 0, '相离圆不应相交');
          }
        },
        {
          name: '圆弧弧长与角度包含',
          run: function () {
            const a = arc(0, 0, 10, 0, Math.PI / 2, true);
            near(Geo.arcSweep(a), Math.PI / 2, 1e-9);
            near(Geo.entityLength(a), 5 * Math.PI, 1e-9, '四分之一圆弧长');
            assert(Geo.angleOnArc(Math.PI / 4, a), '45° 应在弧上');
            assert(!Geo.angleOnArc(Math.PI, a), '180° 不应在弧上');
            const cw = arc(0, 0, 10, 0, -Math.PI / 2, false);
            near(Geo.arcSweep(cw), Math.PI / 2, 1e-9, '顺时针弧');
          }
        },
        {
          name: '图元包围盒与折线采样',
          run: function () {
            const b = Geo.entityBBox(circle(10, 20, 5));
            near(b.x1, 5, 1e-6); near(b.x2, 15, 1e-6);
            near(b.y1, 15, 1e-6); near(b.y2, 25, 1e-6);
            const poly = Geo.entityPolyline(circle(0, 0, 10), 32);
            assert(poly.length === 33, '圆采样点数量');
            near(Geo.dist({ x: 0, y: 0 }, poly[0]), 10, 1e-9);
          }
        }
      ]
    },
    {
      name: '文档模型',
      cases: [
        {
          name: '添加图元 / 拾取最近图元',
          run: function () {
            const d = docWith([
              line(0, 0, 100, 0),
              circle(50, 50, 20),
              { type: 'point', p: { x: 10, y: 10 } }
            ]);
            assert(d.count() === 3, '图元数量');
            assert(d.hitTest({ x: 50, y: 2 }, 3).type === 'line', '应拾取直线');
            assert(d.hitTest({ x: 70, y: 50 }, 3).type === 'circle', '应拾取圆');
            assert(d.hitTest({ x: 200, y: 200 }, 3) === null, '远处不应拾取');
          }
        },
        {
          name: '框选（交叉 / 全包含）',
          run: function () {
            const d = docWith([
              line(0, 0, 100, 0),
              line(0, 10, 100, 10),
              circle(200, 200, 10)
            ]);
            const crossing = d.entitiesInRect({ x1: 40, y1: -5, x2: 60, y2: 5 }, true);
            assert(crossing.length === 1, '交叉框选应命中 1 条直线');
            const contain = d.entitiesInRect({ x1: -5, y1: -5, x2: 105, y2: 15 }, false);
            assert(contain.length === 2, '全包含应命中 2 条直线');
          }
        },
        {
          name: '删除与选中状态同步',
          run: function () {
            const d = docWith([line(0, 0, 10, 0), circle(0, 0, 5)]);
            const first = d.entities[0];
            d.selected.add(first.id);
            assert(d.remove(first.id), '删除应成功');
            assert(d.count() === 1, '剩余图元数量');
            assert(!d.selected.has(first.id), '选中集合应移除');
          }
        },
        {
          name: '关联选择链识别连续相连图元',
          run: function () {
            const d = docWith([
              line(0, 0, 10, 0),
              line(10, 0, 10, 10),
              line(10, 10, 20, 10),
              line(100, 100, 110, 100),
              line(10, 0, 40, 40)
            ]);
            const set = d.chain(d.entities[0], 1e-6);
            assert(set.size === 4, '应识别 4 条相连图元，实际 ' + set.size);
            assert(!set.has(d.entities[3].id), '孤立直线不应被选中');
          }
        },
        {
          name: '快照保存 / 恢复',
          run: function () {
            const d = docWith([line(0, 0, 10, 0)]);
            const snap = d.snapshot();
            d.add(circle(0, 0, 5));
            assert(d.count() === 2);
            assert(d.restoreSnapshot(snap), '恢复快照');
            assert(d.count() === 1, '恢复后数量');
            assert(d.selected.size === 0, '恢复后清空选择');
          }
        }
      ]
    },
    {
      name: '编辑算法',
      cases: [
        {
          name: '直线中段裁剪（两个交点）',
          run: function () {
            const target = line(0, 0, 100, 0);
            const others = [line(30, -10, 30, 10), line(60, -10, 60, 10)];
            const res = Geo.trimEntity(target, { x: 45, y: 0 }, others);
            assert(res && res.length === 2, '应切分为 2 段');
            const lengths = res.map(function (e) { return Geo.entityLength(e); }).sort(function (a, b) { return a - b; });
            near(lengths[0], 30, 1e-6);
            near(lengths[1], 40, 1e-6);
          }
        },
        {
          name: '直线端部裁剪（拾取起点一侧）',
          run: function () {
            const res = Geo.trimEntity(line(0, 0, 100, 0), { x: 5, y: 0 }, [line(30, -10, 30, 10), line(60, -10, 60, 10)]);
            assert(res && res.length === 1, '应保留 1 段');
            near(res[0].p1.x, 30, 1e-6, '保留起点应在交点 30');
            near(res[0].p2.x, 100, 1e-6);
          }
        },
        {
          name: '圆裁剪为圆弧',
          run: function () {
            const res = Geo.trimEntity(circle(0, 0, 50), { x: 50, y: 0 }, [line(0, -100, 0, 100)]);
            assert(res && res.length === 1 && res[0].type === 'arc', '圆应被裁剪为圆弧');
            near(Geo.arcSweep(res[0]), Math.PI, 1e-6, '保留半圆');
            const mid = Geo.entityMidpoint(res[0]);
            assert(mid.x < 0, '保留的应是左半圆');
          }
        },
        {
          name: '圆弧裁剪为更短圆弧',
          run: function () {
            const target = arc(0, 0, 10, 0, Math.PI, true);
            const cut = line(0, 0, 0, 20);
            const res = Geo.trimEntity(target, Geo.polar({ x: 0, y: 0 }, 10, Math.PI / 4), [cut]);
            assert(res && res.length === 1, '应保留 1 段圆弧');
            near(Geo.arcSweep(res[0]), Math.PI / 2, 1e-6, '保留四分之一圆');
          }
        },
        {
          name: '无交点时裁剪不改变图形',
          run: function () {
            const res = Geo.trimEntity(line(0, 0, 100, 0), { x: 50, y: 0 }, [circle(0, 100, 10)]);
            assert(res === null, '无交点应返回 null');
          }
        },
        {
          name: '等距线偏移（直线 / 圆）',
          run: function () {
            const o1 = Geo.offsetEntity(line(0, 0, 100, 0), 10);
            near(o1.p1.y, 10, 1e-9);
            near(o1.p2.y, 10, 1e-9);
            const o2 = Geo.offsetEntity(line(0, 0, 100, 0), -10);
            near(o2.p1.y, -10, 1e-9);
            const c1 = Geo.offsetEntity(circle(0, 0, 50), 10);
            near(c1.r, 60, 1e-9);
            assert(Geo.offsetEntity(circle(0, 0, 50), -60) === null, '半径无效应返回 null');
          }
        },
        {
          name: '平移 / 旋转 / 形态复制',
          run: function () {
            const target = line(0, 0, 10, 0);
            const copy = JSON.parse(JSON.stringify(target));
            Geo.translateEntity(target, 5, 5);
            near(target.p1.x, 5); near(target.p1.y, 5);
            const rt = JSON.parse(JSON.stringify(copy));
            Geo.rotateEntity(rt, { x: 0, y: 0 }, Math.PI / 2);
            near(rt.p2.x, 0, 1e-9, '旋转 90° 后 x');
            near(rt.p2.y, 10, 1e-9, '旋转 90° 后 y');
            const dst = line(0, 0, 1, 1);
            Geo.copyShape(dst, copy);
            near(dst.p2.x, 10);
          }
        },
        {
          name: '两直线夹角计算',
          run: function () {
            const a = line(0, 0, 10, 0);
            const b = line(0, 0, 10, 10);
            near(Geo.angleBetweenLines(a, b), 45, 1e-6);
            const c = line(0, 0, -10, 10);
            near(Geo.angleBetweenLines(a, c), 45, 1e-6, '方向相反的线取锐角 45°');
          }
        },
        {
          name: '圆弧过渡：直角相切几何',
          run: function () {
            const l1 = line(0, 0, 100, 0);
            const l2 = line(0, 0, 0, 100);
            const res = Geo.filletLines(l1, l2, 10, { x: 50, y: 0 }, { x: 0, y: 50 });
            assert(!res.error, res.error || '应成功生成');
            near(res.center.x, 10, 1e-9);
            near(res.center.y, 10, 1e-9);
            near(res.tangent1.x, 10, 1e-9);
            near(res.tangent1.y, 0, 1e-9);
            near(res.tangent2.x, 0, 1e-9);
            near(res.tangent2.y, 10, 1e-9);
            near(Geo.deg(Geo.arcSweep(res.arc)), 90, 1e-6, '过渡圆弧圆心角');
            near(Geo.dist(res.line1.p2, res.tangent1), 0, 1e-9, '直线应裁到切点');
            near(Geo.dist(res.line2.p2, res.tangent2), 0, 1e-9);

            const big = Geo.filletLines(l1, l2, 200, { x: 50, y: 0 }, { x: 0, y: 50 });
            assert(!!big.error && big.error.indexOf('半径过大') >= 0, '过大半径应报错');
            const par = Geo.filletLines(l1, line(0, 10, 100, 10), 5, { x: 50, y: 0 }, { x: 50, y: 10 });
            assert(!!par.error && par.error.indexOf('平行') >= 0, '平行线应报错');
          }
        },
        {
          name: '属性编辑：几何同步与合法性校验',
          run: function () {
            const l = line(0, 0, 10, 0);
            assert(Geo.setEntityProp(l, 'x2', 40).ok);
            near(l.p2.x, 40, 1e-9);
            assert(!Geo.setEntityProp(l, 'x2', 0).ok, '重合端点应拒绝');
            near(l.p2.x, 40, 1e-9, '非法输入不应修改图形');

            const c = circle(0, 0, 10);
            assert(!Geo.setEntityProp(c, 'r', -5).ok, '负半径应拒绝');
            near(c.r, 10, 1e-9);
            assert(Geo.setEntityProp(c, 'r', 25).ok);
            near(c.r, 25, 1e-9);

            const a = arc(0, 0, 10, 0, Math.PI / 2, true);
            assert(!Geo.setEntityProp(a, 'a1', 0).ok, '零扫掠应拒绝');
            assert(Geo.setEntityProp(a, 'a1', 180).ok);
            near(Geo.deg(a.a1), 180, 1e-9);

            const p = { type: 'point', p: { x: 1, y: 2 } };
            assert(Geo.setEntityProp(p, 'y', -3).ok);
            near(p.p.y, -3, 1e-9);
          }
        }
      ]
    },
    {
      name: '视图与手势',
      cases: [
        {
          name: '世界坐标与屏幕坐标往返',
          run: function () {
            const v = new View();
            v.scale = 2; v.tx = 100; v.ty = 300;
            const w = { x: 10, y: 20 };
            const s = v.toScreen(w);
            const back = v.toWorld(s);
            near(back.x, 10, 1e-9);
            near(back.y, 20, 1e-9);
            near(s.x, 120, 1e-9);
            near(s.y, 260, 1e-9);
          }
        },
        {
          name: '缩放锚点保持不动',
          run: function () {
            const v = new View();
            v.scale = 1; v.tx = 100; v.ty = 100;
            const anchorScreen = { x: 220, y: 180 };
            const before = v.toWorld(anchorScreen);
            v.zoomAt(anchorScreen, 2.5);
            const after = v.toWorld(anchorScreen);
            near(v.scale, 2.5);
            near(after.x, before.x, 1e-9);
            near(after.y, before.y, 1e-9);
          }
        },
        {
          name: '双指捏合缩放（applyPinch）',
          run: function () {
            const v = new View();
            v.scale = 1; v.tx = 100; v.ty = 100;
            const start = { scale: 1, tx: 100, ty: 100, dist: 100, mid: { x: 200, y: 200 } };
            const anchor = v.toWorld(start.mid);
            v.applyPinch(start, { x: 210, y: 200 }, 200);
            near(v.scale, 2, 1e-9, '双指距离翻倍，比例应翻倍');
            const after = v.toWorld({ x: 210, y: 200 });
            near(after.y, anchor.y, 1e-9);
          }
        },
        {
          name: '视图自适应使图元落入视口',
          run: function () {
            const v = new View();
            const box = { x1: 0, y1: 0, x2: 200, y2: 100 };
            v.fit(box, 360, 640, 40);
            const a = v.toScreen({ x: box.x1, y: box.y1 });
            const b = v.toScreen({ x: box.x2, y: box.y2 });
            assert(a.x >= 39 && b.x <= 321, '水平方向应在视口内');
            assert(a.y >= 39 && b.y <= 601, '垂直方向应在视口内');
            near((a.x + b.x) / 2, 180, 1e-6, '水平居中');
            near((a.y + b.y) / 2, 320, 1e-6, '垂直居中');
          }
        },
        {
          name: '缩放上下限约束',
          run: function () {
            const v = new View();
            v.scale = 1;
            v.zoomAt({ x: 0, y: 0 }, 1e9);
            assert(v.scale <= global.CADView.MAX_SCALE, '不应超过最大缩放');
            v.zoomAt({ x: 0, y: 0 }, 1e-9);
            assert(v.scale >= global.CADView.MIN_SCALE, '不应小于最小缩放');
          }
        }
      ]
    },
    {
      name: '脚本引擎',
      cases: [
        {
          name: '解析五类绘图命令',
          run: function () {
            const d = new Doc();
            const rep = Script.run('line 0 0 100 0\ncircle 50 50 30\narc 0 0 40 0 90\npoint 10 10\nangle 0 0 45 100', d);
            assert(rep.errors.length === 0, '不应有错误：' + JSON.stringify(rep.errors));
            assert(rep.created === 5, '应创建 5 个图元');
            assert(d.entities[1].type === 'circle' && d.entities[1].r === 30);
            assert(d.entities[2].type === 'arc');
            near(Geo.arcSweep(d.entities[2]), Math.PI / 2, 1e-9, '脚本角度以度为单位');
          }
        },
        {
          name: '角度线坐标正确',
          run: function () {
            const d = new Doc();
            Script.run('angle 0 0 45 100', d);
            const e = d.entities[0];
            near(e.p2.x, Math.cos(Math.PI / 4) * 100, 1e-9);
            near(e.p2.y, Math.sin(Math.PI / 4) * 100, 1e-9);
          }
        },
        {
          name: '非法命令与参数报告行号',
          run: function () {
            const d = new Doc();
            const rep = Script.run('line 0 0 10 0\nbogus 1 2\nline 1 2', d);
            assert(rep.errors.length === 2, '应有 2 条错误');
            assert(rep.errors[0].line === 2, '第一条错误行号应为 2');
            assert(rep.errors[1].line === 3, '第二条错误行号应为 3');
            assert(d.count() === 1, '仅合法直线被创建');
          }
        },
        {
          name: '半径非法与 clear 命令',
          run: function () {
            const d = new Doc();
            const rep = Script.run('circle 0 0 -5', d);
            assert(rep.errors.length === 1, '负半径应报错');
            assert(d.count() === 0);
            Script.run('line 0 0 10 0\ncircle 0 0 10\nclear', d);
            assert(d.count() === 0, 'clear 应清空图元');
          }
        },
        {
          name: '修改 / 平移 / 删除已有图形',
          run: function () {
            const d = new Doc();
            Script.run('line 0 0 100 0\nline 0 10 100 10\ncircle 50 50 20', d);
            const rep = Script.run('set 1 x2 200 y2 0\nmove 2 10 -5\ndel 3', d);
            assert(rep.errors.length === 0, '不应有错误：' + JSON.stringify(rep.errors));
            assert(rep.updated === 2 && rep.deleted === 1, '应记录 2 次修改与 1 次删除');
            assert(d.count() === 2, '删除后应剩 2 个图元');
            const l1 = d.entities[0], l2 = d.entities[1];
            near(l1.p2.x, 200, 1e-9, 'set 修改终点 X');
            near(l1.p2.y, 0, 1e-9);
            near(l2.p1.x, 10, 1e-9, 'move 平移起点 X');
            near(l2.p1.y, 5, 1e-9, 'move 平移起点 Y');
            near(l2.p2.x, 110, 1e-9, 'move 整条线平移');
          }
        },
        {
          name: '修改参数原子校验（失败不写入）',
          run: function () {
            const d = new Doc();
            Script.run('line 0 0 100 0', d);
            const rep = Script.run('set 1 x1 999 x2 999', d);
            assert(rep.errors.length === 1, '端点重合应报错');
            const e = d.entities[0];
            near(e.p1.x, 0, 1e-9, '校验失败时不应部分写入');
            near(e.p2.x, 100, 1e-9);
            const bad = Script.run('set 9 x1 0', d);
            assert(bad.errors.length === 1, '越界序号应报错');
            assert(bad.errors[0].message.indexOf('1~1') >= 0, '应提示序号范围');
          }
        }
      ]
    },
    {
      name: '工具流程（模拟触摸点按）',
      cases: [
        {
          name: '直线工具：两次点按完成绘制',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            assert(app.model.count() === 1, '应创建 1 条直线');
            near(Geo.entityLength(app.model.entities[0]), 100, 1e-9);
            assert(t.points.length === 0, '完成后应重置状态');
          }
        },
        {
          name: '中心线工具：点划线样式与两端延伸',
          run: function () {
            const app = mockApp();
            app.params.cext = 6;
            const t = useTool('center');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            assert(app.model.count() === 1, '应生成一条中心线');
            const e = app.model.entities[0];
            assert(e.type === 'line' && e.style === 'center', '中心线应为点划线样式');
            near(e.p1.x, -6, 1e-9, '起点应向外延伸');
            near(e.p2.x, 106, 1e-9, '终点应向外延伸');
            near(Geo.entityLength(e), 112, 1e-9, '延伸后总长度');
            assert(t.points.length === 0, '完成后应重置状态');
            const t2 = useTool('center');
            t2.onTap({ x: 10, y: 10 });
            t2.onTap({ x: 10, y: 10 });
            assert(app.model.count() === 1, '起点终点重合不应生成中心线');
            app.params.cext = 0;
            const t3 = useTool('center');
            t3.onTap({ x: 0, y: 50 });
            t3.onTap({ x: 0, y: 150 });
            near(app.model.entities[1].p1.y, 50, 1e-9, '延伸长度为 0 时端点不偏移');
            near(app.model.entities[1].p2.y, 150, 1e-9, '延伸长度为 0 时端点不偏移');
          }
        },
        {
          name: '中心线：点圆自动生成十字中心线',
          run: function () {
            const app = mockApp();
            app.model.add(circle(50, 60, 20));
            app.params.cext = 5;
            const t = useTool('center');
            t.onTap({ x: 50, y: 60 });
            assert(app.model.count() === 3, '应生成 2 条过圆心的十字中心线');
            const h = app.model.entities[1];
            const v = app.model.entities[2];
            assert(h.style === 'center' && v.style === 'center', '十字线应为点划线样式');
            near(h.p1.y, 60, 1e-9);
            near(h.p2.y, 60, 1e-9);
            near(h.p1.x, 25, 1e-9, '水平中心线左端按半径 + 延伸');
            near(h.p2.x, 75, 1e-9, '水平中心线右端按半径 + 延伸');
            near(v.p1.x, 50, 1e-9);
            near(v.p2.x, 50, 1e-9);
            near(v.p1.y, 35, 1e-9, '垂直中心线下端按半径 + 延伸');
            near(v.p2.y, 85, 1e-9, '垂直中心线上端按半径 + 延伸');
            assert(app.toasts.join().indexOf('水平') >= 0, '应提示已生成十字中心线');
          }
        },
        {
          name: '中心线：两条平行线生成等距中线',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 40, 100, 40));
            app.params.cext = 6;
            const t = useTool('center');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 50, y: 40 });
            assert(app.model.count() === 3, '应生成 1 条等距中线');
            const m = app.model.entities[2];
            assert(m.style === 'center', '中线应为点划线样式');
            near(m.p1.y, 20, 1e-9, '中线位于两条直线正中间');
            near(m.p2.y, 20, 1e-9);
            near(m.p1.x, -6, 1e-9, '两端按延伸长度外扩');
            near(m.p2.x, 106, 1e-9);
            assert(t.picks.length === 0, '生成后应重置选择状态');
          }
        },
        {
          name: '中心线：两条不平行线生成角平分线',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(50, -50, 50, 50));
            app.params.cext = 0;
            const t = useTool('center');
            t.onTap({ x: 20, y: 0 });
            t.onTap({ x: 50, y: 30 });
            assert(app.model.count() === 3, '应生成 1 条角平分线');
            const b = app.model.entities[2];
            near((b.p1.x + b.p2.x) / 2, 50, 1e-9, '角平分线以交点为中点');
            near((b.p1.y + b.p2.y) / 2, 0, 1e-9);
            const ang = Geo.deg(Math.atan2(b.p2.y - b.p1.y, b.p2.x - b.p1.x));
            near(Math.abs(ang), 45, 1e-6, '角平分线方向应为 45°');
            near(Geo.entityLength(b), 100, 1e-6, '长度覆盖两线端点范围');
          }
        },
        {
          name: '中心线：共线直线给出明确提示',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(100, 0, 200, 0));
            const t = useTool('center');
            t.onTap({ x: 20, y: 0 });
            t.onTap({ x: 180, y: 0 });
            assert(app.model.count() === 2, '共线直线不应生成中心线');
            assert(app.toasts.join().indexOf('重合') >= 0, '应提示两条直线重合');
          }
        },
        {
          name: '角度线：长度输入默认关闭与默认参考方向',
          run: function () {
            const app = mockApp();
            const t = useTool('angle');
            const fields = t.params();
            const lmod = fields.filter(function (f) { return f.key === 'lmod'; })[0];
            const len = fields.filter(function (f) { return f.key === 'len'; })[0];
            const aref = fields.filter(function (f) { return f.key === 'aref'; })[0];
            const lref = fields.filter(function (f) { return f.key === 'lref'; })[0];
            assert(lmod && lmod.type === 'toggle' && lmod.def === false, '长度输入应默认关闭');
            assert(len && !len.when({ lmod: false }) && len.when({ lmod: true }), '长度项应随长度输入开关显示');
            assert(aref && aref.type === 'choice' && aref.def === 'x', '参考方向默认与 X 轴形成角度');
            assert(aref.options.length === 2 && aref.options[0].v === 'x' && aref.options[1].v === 'y', '参考方向含 X / Y 两个固定选项');
            assert(lref && lref.type === 'toggle' && lref.def === false, '与指定线形成角度默认关闭');
            assert(!aref.when({ lref: true }), '启用指定线参考时应隐藏固定方向选项');
            app.params.ang = 45;
            app.params.aref = 'x';
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 50, y: -50 });
            const e = app.model.entities[0];
            assert(!!e, '应生成角度线');
            near(Geo.entityLength(e), Math.hypot(50, 50), 1e-9, '长度输入关闭时按鼠标点距离生成');
            const ang = Geo.deg(Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x));
            near(ang, -45, 1e-9, '方向贴合鼠标所在侧');
          }
        },
        {
          name: '角度线：与 Y 轴形成角度',
          run: function () {
            const app = mockApp();
            app.params.aref = 'y';
            app.params.ang = 10;
            const t = useTool('angle');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 5, y: 100 });
            const e = app.model.entities[0];
            const ang = Geo.deg(Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x));
            near(ang, 80, 1e-6, 'Y 轴参考：与 Y 轴夹角 10° 且贴合鼠标侧');
            near(Geo.entityLength(e), Math.hypot(5, 100), 1e-9, '长度输入关闭时按鼠标点距离生成');
          }
        },
        {
          name: '角度线：与指定线形成角度',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.params.lref = true;
            app.params.ang = 30;
            const t = useTool('angle');
            t.onTap({ x: 20, y: 0 });
            assert(t.refId === app.model.entities[0].id, '应记录参考直线');
            assert(app.model.selected.size === 1, '参考直线应高亮选中');
            t.onTap({ x: 0, y: 50 });
            t.onTap({ x: 100, y: -34 });
            const e = app.model.entities[1];
            const ang = Geo.deg(Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x));
            near(ang, -30, 1e-6, '相对所选直线形成 30° 且贴合鼠标侧');
          }
        },
        {
          name: '角度线：缺少参考直线时提示',
          run: function () {
            const app = mockApp();
            app.params.lref = true;
            const t = useTool('angle');
            t.onTap({ x: 0, y: 0 });
            assert(app.model.count() === 0, '未选参考线不应建线');
            assert(app.toasts.join().indexOf('角度参考') >= 0, '应提示先选参考直线');
          }
        },
        {
          name: '角度线：长度输入开启后按输入长度生成',
          run: function () {
            const app = mockApp();
            app.params.lmod = true;
            app.params.len = 50;
            app.params.ang = 45;
            const t = useTool('angle');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 70, y: -100 });
            const e = app.model.entities[0];
            near(Geo.entityLength(e), 50, 1e-9, '按输入长度生成');
            const ang = Geo.deg(Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x));
            near(ang, -45, 1e-6, '方向贴合鼠标下方');
            near(e.p2.x, Math.cos(-Math.PI / 4) * 50, 1e-9);
          }
        },
        {
          name: '角度线：无方向点时确定给出提示',
          run: function () {
            const app = mockApp();
            const t = useTool('angle');
            t.onTap({ x: 0, y: 0 });
            t.hover = null;
            t.applyParams();
            assert(app.model.count() === 0, '未提供方向点不应建线');
            assert(app.toasts.join().indexOf('方向点') >= 0, '应提示点按方向点');
          }
        },
        {
          name: '直线工具：坐标输入默认关闭',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            const fields = t.params();
            const coord = fields.filter(function (f) { return f.key === 'coord'; })[0];
            assert(coord && coord.type === 'toggle' && coord.def === false, '坐标输入应默认关闭');
            ['x1', 'y1', 'x2', 'y2'].forEach(function (k) {
              const f = fields.filter(function (fd) { return fd.key === k; })[0];
              assert(f && typeof f.when === 'function', '坐标项应带显示条件');
              assert(!f.when({ coord: false }), k + ' 默认（未勾选）应隐藏');
              assert(f.when({ coord: true }), k + ' 勾选后应显示');
            });
            t.applyParams();
            assert(app.model.count() === 0, '未勾选坐标输入时不应建图形');
            assert(app.toasts.join().indexOf('坐标输入') >= 0, '应提示先勾选坐标输入');
            app.params.coord = true;
            app.params.x1 = 0; app.params.y1 = 0;
            app.params.x2 = 50; app.params.y2 = 0;
            t.applyParams();
            assert(app.model.count() === 1, '勾选后应能按坐标建线');
          }
        },
        {
          name: '直线工具：坐标输入精确生成',
          run: function () {
            const app = mockApp();
            app.params.coord = true;
            app.params.cmode = 'abs';
            app.params.x1 = 10; app.params.y1 = 10;
            app.params.x2 = 10; app.params.y2 = 110;
            const t = useTool('line');
            t.applyParams();
            assert(app.model.count() === 1, '应创建 1 条直线');
            const e = app.model.entities[0];
            near(e.p1.x, 10, 1e-9);
            near(e.p1.y, 10, 1e-9);
            near(e.p2.x, 10, 1e-9);
            near(e.p2.y, 110, 1e-9);

            app.params.x2 = 10; app.params.y2 = 10;
            t.applyParams();
            assert(app.model.count() === 1, '重合端点应拒绝生成');
          }
        },
        {
          name: '圆 / 点工具：坐标与半径输入',
          run: function () {
            const app = mockApp();
            app.params.cx = 30; app.params.cy = 40; app.params.r = 25;
            const c = useTool('circle');
            c.applyParams();
            assert(app.model.entities[0].type === 'circle');
            near(app.model.entities[0].c.x, 30, 1e-9);
            near(app.model.entities[0].c.y, 40, 1e-9);
            near(app.model.entities[0].r, 25, 1e-9);

            app.params.x = -12.5; app.params.y = 8;
            const p = useTool('point');
            p.applyParams();
            assert(app.model.entities[1].type === 'point');
            near(app.model.entities[1].p.x, -12.5, 1e-9);
            near(app.model.entities[1].p.y, 8, 1e-9);

            app.params.r = 0;
            c.applyParams();
            assert(app.model.count() === 2, '半径 0 应拒绝生成');
          }
        },
        {
          name: '圆 / 圆弧工具点按流程',
          run: function () {
            const app = mockApp();
            const c = useTool('circle');
            c.onTap({ x: 0, y: 0 });
            c.onTap({ x: 50, y: 0 });
            assert(app.model.entities[0].type === 'circle');
            near(app.model.entities[0].r, 50, 1e-9);

            // 圆弧：两点 + 半径（第三次点按用当前半径确认）
            app.params.r = 30;
            app.params.amode = 'minor';
            const a = useTool('arc');
            a.onTap({ x: 200, y: 0 });
            a.onTap({ x: 260, y: 0 });
            a.onTap({ x: 0, y: 0 });
            const arcEnt = app.model.entities[1];
            assert(arcEnt.type === 'arc', '应创建圆弧');
            near(arcEnt.r, 30, 1e-9, '半径按输入值');
            near(Geo.dist(Geo.arcStart(arcEnt), { x: 200, y: 0 }), 0, 1e-6, '起点正确');
            near(Geo.dist(Geo.arcEnd(arcEnt), { x: 260, y: 0 }), 0, 1e-6, '终点正确');
            near(Geo.arcSweep(arcEnt), Math.PI, 1e-6, '半径等于半弦长时为半圆');
          }
        },
        {
          name: '平行线工具',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            const t = useTool('parallel');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 0, y: 30 });
            assert(app.model.count() === 2, '应生成平行线');
            near(app.model.entities[1].p1.y, 30, 1e-9);
            near(app.model.entities[1].p2.y, 30, 1e-9);
          }
        },
        {
          name: '平行线工具：输入偏移距离精确生成',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.params.poff = 35;
            const t = useTool('parallel');
            t.applyParams();
            assert(app.model.count() === 1, '未选参考线时不应生成');
            t.onTap({ x: 50, y: 0 });
            t.applyParams();
            assert(app.model.count() === 2, '应生成 1 条平行线');
            near(app.model.entities[1].p1.y, 35, 1e-9);
            near(app.model.entities[1].p2.y, 35, 1e-9);
          }
        },
        {
          name: '等距线工具（含方向判断）',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.params.dist = 20;
            const t = useTool('offset');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 50, y: -30 });
            assert(app.model.count() === 2, '应生成等距线');
            near(app.model.entities[1].p1.y, -20, 1e-9, '应向点击侧偏移');
          }
        },
        {
          name: '平移工具：X/Y 精确偏移 + 连续多选',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(circle(200, 0, 20));
            const t = useTool('move');
            app.params.multi = true;
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 220, y: 0 });
            assert(app.model.selected.size === 2, '连续选择应累计 2 个对象');
            app.params.mx = 10;
            app.params.my = -5;
            t.applyParams();
            near(app.model.entities[0].p1.x, 10, 1e-9, 'X 偏移生效');
            near(app.model.entities[0].p1.y, -5, 1e-9, 'Y 偏移生效');
            near(app.model.entities[1].c.x, 210, 1e-9, '多选对象同时平移');
            near(app.model.entities[1].c.y, -5, 1e-9);
            assert(app.model.count() === 2, '平移不应改变图元数量');

            app.params.mx = 0; app.params.my = 0;
            t.applyParams();
            near(app.model.entities[0].p1.x, 10, 1e-9, '零偏移应被拒绝');
          }
        },
        {
          name: '平移工具：移动到（点击拾取基准点 + 点击/坐标目标）',
          run: function () {
            const app = mockApp();
            const t = useTool('move');
            const defs = t.params();
            const mtoDef = defs.filter(function (f) { return f.key === 'mto'; })[0];
            const txDef = defs.filter(function (f) { return f.key === 'tx'; })[0];
            assert(mtoDef && mtoDef.def === false, '「移动到」默认应关闭');
            assert(!defs.some(function (f) { return f.key === 'mref' || f.key === 'ax' || f.key === 'ay'; }),
              '参考点仅支持点击拾取，不应再有参考点输入项');
            assert(txDef.when({ mto: false }) !== true, '关闭时不应显示目标坐标');
            assert(txDef.when({ mto: true }) === true, '开启后应显示目标坐标');

            app.params.mto = true;
            assert(t.prompt().indexOf('点按图形选择') >= 0, '未选中时应提示选择元素');
            t.applyParams();
            assert(app.toasts.join('').indexOf('请先选中') >= 0, '未选中时确定应提示');

            const l = app.model.add(line(0, 0, 100, 0));
            t.onTap({ x: 50, y: 0 });
            assert(app.model.selected.size === 1, '点按图形应选中');
            assert(t.prompt().indexOf('基准点') >= 0, '选中后应提示拾取基准点');

            // 点击拾取基准点（走吸附）
            let snapCalls = 0;
            const rawSnap = app.snapPoint;
            app.snapPoint = function (p) { snapCalls++; return rawSnap.call(this, p); };
            t.onTap({ x: 50, y: 0 });
            assert(t.mtoBase && Math.abs(t.mtoBase.x - 50) < 1e-9 && Math.abs(t.mtoBase.y) < 1e-9, '点击拾取基准点');
            assert(snapCalls === 1, '基准点拾取应经过吸附');
            assert(t.prompt().indexOf('点按目标位置') >= 0, '基准点后应提示点按目标或输入坐标');

            // 坐标输入目标
            app.params.tx = 200;
            app.params.ty = 50;
            t.applyParams();
            near(l.p1.x, 150, 1e-9, '坐标目标后基准点对齐 X');
            near(l.p1.y, 50, 1e-9, '坐标目标后基准点对齐 Y');
            assert(t.mtoBase === null, '移动后基准点应复位');

            // 点击目标位置
            t.onTap({ x: 150, y: 50 });
            assert(t.mtoBase !== null, '再次点击应拾取新的基准点');
            t.onTap({ x: 0, y: 0 });
            near(l.p1.x, 0, 1e-9, '点击目标后起点 X');
            near(l.p1.y, 0, 1e-9, '点击目标后起点 Y');
            assert(t.mtoBase === null, '点击目标完成后基准点复位');
            assert(Number(app.params.tx) === 0 && Number(app.params.ty) === 0, '点击目标应回填目标坐标');

            // 点按其它元素切换选中（圆按轮廓拾取，点圆周）
            const c = app.model.add(circle(500, 0, 20));
            t.onTap({ x: 520, y: 0 });
            assert(app.model.selected.has(c.id) && !app.model.selected.has(l.id), '点按其它元素应切换选中');
            t.onTap({ x: 500, y: 0 });
            t.onTap({ x: 600, y: 100 });
            near(c.c.x, 600, 1e-9, '圆心点击目标 X');
            near(c.c.y, 100, 1e-9, '圆心点击目标 Y');
            assert(app.model.count() === 2, '移动到不应改变图元数量');
            assert(app.undo.length > 0, '每次移动应记录撤销');
          }
        },
        {
          name: '平移工具：移动到边界（非法输入 / 超大坐标 / 模式切换）',
          run: function () {
            const app = mockApp();
            const t = useTool('move');
            app.params.mto = true;
            const l = app.model.add(line(0, 0, 100, 0));
            app.model.selected.add(l.id);

            // 未拾取基准点：拒绝移动
            app.params.tx = 10;
            app.params.ty = 10;
            t.applyParams();
            assert(app.toasts.join('').indexOf('点选基准点') >= 0, '未拾取基准点应提示');
            near(l.p1.x, 0, 1e-9, '未拾取基准点时不应移动');

            // 基准点可在元素外自由拾取；目标与基准点重合时不移动
            t.mtoBase = { x: -50, y: -20 };
            app.params.tx = -50;
            app.params.ty = -20;
            t.applyParams();
            assert(app.toasts.join('').indexOf('已在目标位置') >= 0, '基准点已在目标位置应提示');
            assert(t.mtoBase !== null, '原地未移动时应保留基准点');

            // 空目标坐标
            app.params.tx = '';
            t.applyParams();
            assert(app.toasts.join('').indexOf('请输入目标坐标') >= 0, '空目标坐标应提示');

            // 负坐标
            app.params.tx = -250.5;
            app.params.ty = -500.25;
            t.applyParams();
            near(l.p1.x, -200.5, 1e-9, '负目标 X 位移精确');
            near(l.p1.y, -480.25, 1e-9, '负目标 Y 位移精确');

            // 超大坐标
            t.mtoBase = { x: l.p2.x, y: l.p2.y };
            app.params.tx = 1e9;
            app.params.ty = -1e9;
            t.applyParams();
            near(l.p2.x, 1e9, 1e-6, '超大目标 X 精确');
            near(l.p2.y, -1e9, 1e-6, '超大目标 Y 精确');

            // 复位与模式切换清除基准点
            t.mtoBase = { x: 1, y: 2 };
            t.reset();
            assert(t.mtoBase === null, 'reset 应清除基准点');
            t.mtoBase = { x: 1, y: 2 };
            t.onParamChange('mto');
            assert(t.mtoBase === null, '切换移动方式应清除基准点');

            // 关闭「移动到」后仍走原偏移逻辑
            app.params.mto = false;
            app.params.mx = 10;
            app.params.my = 0;
            const oldX = l.p1.x;
            t.applyParams();
            near(l.p1.x, oldX + 10, 1e-9, '关闭后恢复 X/Y 偏移平移');

            // 移动到模式下拖动只平移视图，不移动图形
            app.params.mto = true;
            t.reset();
            const undoBefore = app.undo.length;
            const shapeBefore = { x: l.p1.x, y: l.p1.y };
            t.onDragStart({ x: 0, y: 0 });
            assert(t.panning === true && !t.active, '移动到模式拖动应平移视图');
            t.onDragEnd();
            assert(t.panning === false, '拖动结束应退出视图平移');
            assert(app.undo.length === undoBefore, '拖动不应产生移动撤销记录');
            near(l.p1.x, shapeBefore.x, 1e-9, '拖动不应改变图形位置');
          }
        },
        {
          name: '直线工具：正交锁定 0/90/180/270',
          run: function () {
            const app = mockApp();
            app.params.ortho = true;
            const t = useTool('line');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 10 });
            near(app.model.entities[0].p2.x, 100, 1e-9);
            near(app.model.entities[0].p2.y, 0, 1e-9, '水平锁定');

            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 10, y: 100 });
            near(app.model.entities[1].p2.x, 0, 1e-9, '垂直锁定');
            near(app.model.entities[1].p2.y, 100, 1e-9);

            app.params.coord = true;
            app.params.x1 = 0; app.params.y1 = 0;
            app.params.x2 = 100; app.params.y2 = 10;
            t.applyParams();
            near(app.model.entities[2].p2.y, 0, 1e-9, '坐标输入同样锁定水平');

            app.params.ortho = false;
            app.params.x2 = 100; app.params.y2 = 10;
            t.applyParams();
            near(app.model.entities[3].p2.y, 10, 1e-9, '关闭正交后恢复任意方向');
          }
        },
        {
          name: '等距线：距离 + 左/右/双侧 + 多选',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 0, 0, 100));
            app.model.selected.add(app.model.entities[0].id);
            app.model.selected.add(app.model.entities[1].id);
            app.params.dist = 10;
            app.params.oside = 'both';
            const t = useTool('offset');
            t.applyParams();
            assert(app.model.count() === 6, '两个对象双侧应为 4 条等距线');
            const ys = app.model.entities.slice(2).filter(function (e) { return Math.abs(e.p1.x - e.p2.x) < 1e-9; })
              .map(function (e) { return Math.round(e.p1.x); }).sort(function (a, b) { return a - b; });
            near(ys[0], -10, 1e-9, '右侧 x=-10');
            near(ys[1], 10, 1e-9, '左侧 x=10');

            const app2 = mockApp();
            app2.model.add(line(0, 0, 100, 0));
            app2.model.selected.add(app2.model.entities[0].id);
            app2.params.dist = 12;
            app2.params.oside = 'right';
            const t2 = useTool('offset');
            t2.applyParams();
            near(app2.model.entities[1].p1.y, -12, 1e-9, '右侧偏移为负');

            app2.params.dist = 0;
            t2.applyParams();
            assert(app2.model.count() === 2, '零距离应拒绝');
          }
        },
        {
          name: '等距线：单侧仅一条完整线且不重复',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.selected.add(app.model.entities[0].id);
            app.params.dist = 15;
            app.params.oside = 'left';
            const t = useTool('offset');
            t.applyParams();
            assert(app.model.count() === 2, '单侧只应新增 1 条');
            const off = app.model.entities[1];
            near(off.p1.x, 0, 1e-9);
            near(off.p2.x, 100, 1e-9);
            near(off.p1.y, 15, 1e-9, '左侧偏移');
            near(off.p2.y, 15, 1e-9, '整条线完整偏移');
            assert(app.model.selected.size === 0, '生成后不应选中结果，避免预览重复偏移');

            // 再次确定：不应产生重复或反向线条
            t.applyParams();
            assert(app.model.count() === 2, '重复确定不应叠加线条');

            // 重新选中并再次生成同一位置：应被去重
            app.model.selected.add(app.model.entities[0].id);
            t.applyParams();
            assert(app.model.count() === 2, '重合等距线应被跳过');

            // 右侧单侧同样只生成一条
            app.model.selected.add(app.model.entities[0].id);
            app.params.oside = 'right';
            t.applyParams();
            assert(app.model.count() === 3, '右侧应新增 1 条');
            near(app.model.entities[2].p1.y, -15, 1e-9, '右侧偏移');
          }
        },
        {
          name: '等距线：矩形闭合链双侧斜接',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(100, 0, 100, 60));
            app.model.add(line(100, 60, 0, 60));
            app.model.add(line(0, 60, 0, 0));
            app.model.entities.forEach(function (e) { app.model.selected.add(e.id); });
            app.params.dist = 10;
            app.params.oside = 'both';
            const t = useTool('offset');
            t.applyParams();
            // 4 条边 → 内外各 4 段，共 8 条等距线
            assert(app.model.count() === 12, '矩形双侧应生成 8 条等距线，实际 ' + (app.model.count() - 4));
            const offs = app.model.entities.slice(4);
            function has(x1, y1, x2, y2) {
              return offs.some(function (e) {
                return e.type === 'line' &&
                  Math.abs(e.p1.x - x1) < 1e-6 && Math.abs(e.p1.y - y1) < 1e-6 &&
                  Math.abs(e.p2.x - x2) < 1e-6 && Math.abs(e.p2.y - y2) < 1e-6;
              });
            }
            assert(has(-10, -10, 110, -10), '外圈下边应斜接到角点');
            assert(has(110, -10, 110, 70), '外圈右边应斜接到角点');
            assert(has(110, 70, -10, 70), '外圈上边应斜接到角点');
            assert(has(-10, 70, -10, -10), '外圈左边应斜接到角点');
            assert(has(10, 10, 90, 10), '内圈下边应斜接到角点');
            assert(has(90, 10, 90, 50), '内圈右边应斜接到角点');
            assert(has(90, 50, 10, 50), '内圈上边应斜接到角点');
            assert(has(10, 50, 10, 10), '内圈左边应斜接到角点');
            // 拐角不应出现超出角点的多余交叉线
            const bad = offs.filter(function (e) {
              return e.type === 'line' && (
                Math.abs(e.p1.y + 10) < 1e-6 && Math.abs(e.p2.y + 10) < 1e-6 &&
                (e.p1.x < -10 - 1e-6 || e.p2.x > 110 + 1e-6)
              );
            });
            assert(bad.length === 0, '拐角处不应有超出交叉线段');
          }
        },
        {
          name: '等距线：直线 + 圆弧链首尾相连',
          run: function () {
            const app = mockApp();
            app.model.add(arc(0, 0, 50, 0, Math.PI / 2, true));
            app.model.add(line(0, 50, -100, 50));
            app.model.entities.forEach(function (e) { app.model.selected.add(e.id); });
            app.params.dist = 10;
            app.params.oside = 'left';
            const t = useTool('offset');
            t.applyParams();
            assert(app.model.count() === 4, '左侧应生成 2 段等距线');
            const lArc = app.model.entities[2];
            const lLine = app.model.entities[3];
            assert(lArc.type === 'arc' && lLine.type === 'line', '结果应为圆弧 + 直线');
            near(lArc.r, 40, 1e-9, '圆弧向左内侧偏移');
            near(lLine.p1.y, 40, 1e-9, '直线向左偏移');
            near(lLine.p2.y, 40, 1e-9);
            assert(Geo.dist(Geo.arcEnd(lArc), lLine.p1) < 1e-7, '圆弧终点与直线起点应首尾相连');
            assert(Math.min(lLine.p1.x, lLine.p2.x) >= -100 - 1e-9, '偏移线不应越过原端点产生多余段');

            app.model.selected.clear();
            app.model.entities.slice(0, 2).forEach(function (e) { app.model.selected.add(e.id); });
            app.params.oside = 'right';
            const t2 = useTool('offset');
            t2.applyParams();
            assert(app.model.count() === 6, '右侧应再生成 2 段');
            const rArc = app.model.entities[4];
            const rLine = app.model.entities[5];
            near(rArc.r, 60, 1e-9, '圆弧向右外侧偏移');
            near(rLine.p1.y, 60, 1e-9);
            assert(Geo.dist(Geo.arcEnd(rArc), rLine.p1) < 1e-7, '右侧同样首尾相连');
          }
        },
        {
          name: '等距线：小圆弧偏移无效时其余段仍生成',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 40, 100, 40));
            app.model.add(arc(100, 35, 5, Math.PI / 2, 0, false));
            app.model.add(line(105, 35, 105, -60));
            app.model.entities.forEach(function (e) { app.model.selected.add(e.id); });
            app.params.dist = 10;
            app.params.oside = 'both';
            useTool('offset').applyParams();
            assert(app.model.count() === 8, '外侧 3 段 + 内侧 2 段，不能整侧丢失');
            near(app.model.entities[3].p1.y, 50, 1e-9, '外侧第一段');
            near(app.model.entities[5].p1.x, 115, 1e-9, '外侧末段');
            const in1 = app.model.entities[6];
            const in2 = app.model.entities[7];
            near(in1.p1.y, 30, 1e-9, '内侧直线仍生成');
            near(in2.p1.x, 95, 1e-9);
            assert(Geo.dist(in1.p2, in2.p1) < 1e-9, '跳过的小圆弧处两段应斜接相连');
          }
        },
        {
          name: '平行线：单侧任意方向与双侧生成',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            const t = useTool('parallel');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 50, y: -45 });
            assert(app.model.count() === 2, '点按下方应生成 1 条平行线');
            near(app.model.entities[1].p1.y, -45, 1e-9, '可在基准线下方生成');

            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 50, y: 30 });
            near(app.model.entities[2].p1.y, 30, 1e-9, '也可在基准线上方生成');

            app.params.poff = 25;
            app.params.pside = 'both';
            const t2 = useTool('parallel');
            t2.onTap({ x: 50, y: 0 });
            t2.applyParams();
            assert(app.model.count() === 5, '双侧应新增 2 条平行线');
            const ys = app.model.entities.slice(3).map(function (e) { return Math.round(e.p1.y); })
              .sort(function (a, b) { return a - b; });
            near(ys[0], -25, 1e-9, '左法向反向');
            near(ys[1], 25, 1e-9, '左法向正向');
          }
        },
        {
          name: '圆弧：两点 + 半径的劣弧/优弧与半径自适应',
          run: function () {
            const app = mockApp();
            app.params.r = 50;
            app.params.amode = 'minor';
            const t = useTool('arc');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 60, y: 0 });
            t.applyParams();
            assert(app.model.entities[0].type === 'arc', '应生成圆弧');
            near(app.model.entities[0].r, 50, 1e-9);
            const minorSweep = 2 * Math.asin(30 / 50);
            near(Geo.arcSweep(app.model.entities[0]), minorSweep, 1e-6, '劣弧扫掠角');

            app.params.amode = 'major';
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 60, y: 0 });
            t.applyParams();
            near(Geo.arcSweep(app.model.entities[1]), Math.PI * 2 - minorSweep, 1e-6, '优弧扫掠角');

            // 半径小于弦长一半：自动按半圆生成
            app.params.r = 10;
            app.params.amode = 'minor';
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 60, y: 0 });
            t.applyParams();
            near(app.model.entities[2].r, 30, 1e-9, '半径自动适配为半弦长');
            near(Geo.arcSweep(app.model.entities[2]), Math.PI, 1e-6, '退化为半圆');
          }
        },
        {
          name: '点工具：靠近圆/圆弧自动捕捉圆心',
          run: function () {
            const app = mockApp();
            app.model.add(circle(100, 0, 30));
            app.model.add(arc(0, 100, 20, 0, Math.PI, true));
            const t = useTool('point');
            t.onTap({ x: 100, y: 29 });
            assert(app.model.entities[2].type === 'point');
            near(app.model.entities[2].p.x, 100, 1e-9, '圆上点按捕捉圆心 X');
            near(app.model.entities[2].p.y, 0, 1e-9, '圆上点按捕捉圆心 Y');

            t.onTap({ x: -19, y: 101 });
            near(app.model.entities[3].p.x, 0, 1e-9, '圆弧上点按捕捉圆心 X');
            near(app.model.entities[3].p.y, 100, 1e-9, '圆弧上点按捕捉圆心 Y');

            t.onTap({ x: 300, y: 300 });
            near(app.model.entities[4].p.x, 300, 1e-9, '远离圆时正常放点');
            assert(app.model.entities[4].p.y === 300);
          }
        },
        {
          name: '直线工具：圆相切与直线垂直辅助',
          run: function () {
            const app = mockApp();
            app.model.add(circle(0, 0, 50));
            const t = useTool('line');
            t.onTap({ x: 50, y: 0 });
            assert(app.params.lref === 'circle', '起点落在圆上应提供相切选项');
            app.params.tangent = true;
            t.onTap({ x: 50, y: 60 });
            const tan = app.model.entities[1];
            assert(tan.type === 'line');
            near(tan.p1.x, 50, 1e-9);
            near(tan.p1.y, 0, 1e-9);
            near(tan.p2.x, 50, 1e-9, '切线应沿径向的法向');
            near(tan.p2.y, 60, 1e-9, '切线长度随拖动');

            app.model.add(line(0, 300, 100, 300));
            app.params.tangent = false;
            app.params.perp = false;
            t.onTap({ x: 50, y: 300 });
            assert(app.params.lref === 'line', '起点落在直线上应提供垂直选项');
            app.params.perp = true;
            t.onTap({ x: 70, y: 360 });
            const per = app.model.entities[3];
            near(per.p2.x, 50, 1e-9, '垂线终点应垂直投影');
            near(per.p2.y, 360, 1e-9);

            // 起点落在圆弧上同样应提供切线选项
            app.model.add(arc(200, 0, 40, 0, Math.PI, true));
            app.params.perp = false;
            t.onTap({ x: 240, y: 0 });
            assert(app.params.lref === 'circle', '起点落在圆弧上应提供切线选项');
            const defs = global.CADTools.byId('line').params();
            const tanDef = defs.filter(function (q) { return q.key === 'tangent'; })[0];
            const perDef = defs.filter(function (q) { return q.key === 'perp'; })[0];
            assert(tanDef.label === '相切' && typeof tanDef.when === 'function', '圆弧起点显示相切选项');
            assert(perDef.label === '垂直' && typeof perDef.when === 'function', '直线起点显示垂直选项');
          }
        },
        {
          name: '直线工具：经过图形时自动切换相切 / 垂直选项',
          run: function () {
            const app = mockApp();
            app.model.add(circle(0, 0, 50));
            app.model.add(line(-100, 80, 100, 80));
            const t = useTool('line');
            t.onHover({ x: 50, y: 0 });
            assert(app.params.lref === 'circle', '光标经过圆应提供相切选项');
            t.onHover({ x: 0, y: 80 });
            assert(app.params.lref === 'line', '光标经过直线应提供垂直选项');
            t.onTap({ x: 0, y: 80 });
            assert(app.params.lref === 'line' && t.refId === app.model.entities[1].id, '起点参考保持为直线');
            t.onHover({ x: 50, y: 0 });
            assert(app.params.lref === 'circle', '绘制中再次经过圆应切回相切选项');
            t.onHover({ x: 10, y: -40 });
            assert(app.params.lref === 'line', '离开圆后回退到起点所在直线');
          }
        },
        {
          name: '直线终点：靠近圆弧吸附切点、靠近直线吸附垂足',
          run: function () {
            const app = mockApp();
            app.model.add(circle(100, 0, 40));
            app.model.add(line(50, -100, 50, 100));
            app.params.asnap = true;
            app.params.stol = '18';
            const t = useTool('line');
            t.onTap({ x: 0, y: 0 });
            const res1 = t._endPoint({ x: 0, y: 0 }, { x: 100, y: 40 });
            near(res1.p.x, 84, 0.6, '切点 X');
            near(res1.p.y, 36.66, 0.6, '切点 Y');
            assert(t.snapMode === '切点', '状态栏应显示切点捕捉');
            assert(t.snapPt && Geo.dist(t.snapPt, res1.p) < 1e-9, '应有捕捉点用于视觉提示');

            t.reset();
            t.onTap({ x: 0, y: 0 });
            const res2 = t._endPoint({ x: 0, y: 0 }, { x: 55, y: 30 });
            near(res2.p.x, 50, 1e-9, '垂足 X');
            near(res2.p.y, 0, 1e-9, '垂足 Y');
            assert(t.snapMode === '垂足', '状态栏应显示垂足捕捉');

            // 按住 Shift / 关闭自动捕捉时不吸附
            t.reset();
            t.onTap({ x: 0, y: 0 });
            app.params.asnap = false;
            const res3 = t._endPoint({ x: 0, y: 0 }, { x: 55, y: 30 });
            near(res3.p.x, 55, 1e-9, '关闭后保持原始位置');
            assert(t.snapMode === null, '关闭后无捕捉提示');
            app.params.asnap = true;
            t.snapHold = true;
            const res4 = t._endPoint({ x: 0, y: 0 }, { x: 55, y: 30 });
            near(res4.p.x, 55, 1e-9, '按住 Shift 临时关闭捕捉');
            t.snapHold = false;
          }
        },
        {
          name: '连续画线 + 坐标输入：起点衔接与增量/绝对切换',
          run: function () {
            const app = mockApp();
            app.params.coord = true;
            app.params.lchain = true;
            app.params.cmode = 'rel';
            app.params.ortho = false;
            app.params.x1 = 10;
            app.params.y1 = 20;
            app.params.x2 = 30;
            app.params.y2 = 40;

            const defs = global.CADTools.byId('line').params();
            const cmodeDef = defs.filter(function (f) { return f.key === 'cmode'; })[0];
            const x2Def = defs.filter(function (f) { return f.key === 'x2'; })[0];
            assert(cmodeDef && cmodeDef.def === 'rel', '终点输入默认应为增量坐标');
            assert(cmodeDef.options.length === 2, '应提供绝对 / 增量两种模式');
            assert(typeof x2Def.validate === 'function', '终点字段应支持实时校验');

            const t = useTool('line');
            t.applyParams();
            assert(app.model.count() === 1, '应生成第一条直线');
            const l1 = app.model.entities[0];
            near(l1.p1.x, 10, 1e-9, '增量模式起点 X');
            near(l1.p1.y, 20, 1e-9, '增量模式起点 Y');
            near(l1.p2.x, 40, 1e-9, '增量模式终点 X = 起点 + ΔX');
            near(l1.p2.y, 60, 1e-9, '增量模式终点 Y = 起点 + ΔY');
            assert(t.points.length === 1, '连续画线应从上一条终点继续');
            near(t.points[0].x, 40, 1e-9, '新起点 = 上一条终点 X');
            near(t.points[0].y, 60, 1e-9, '新起点 = 上一条终点 Y');
            near(Number(app.params.x1), 40, 1e-9, '起点参数同步为上一条终点');
            assert(Number(app.params.x2) === 0 && Number(app.params.y2) === 0, '生成后终点输入应自动清零');

            app.params.x2 = 30;
            app.params.y2 = 40;
            t.applyParams();
            assert(app.model.count() === 2, '应生成第二条直线');
            const l2 = app.model.entities[1];
            near(l2.p1.x, 40, 1e-9, '第二条起点衔接第一条终点');
            near(l2.p1.y, 60, 1e-9);
            near(l2.p2.x, 70, 1e-9, '输入增量后第二条按新增量生成');
            near(l2.p2.y, 100, 1e-9);
            assert(Number(app.params.x2) === 0 && Number(app.params.y2) === 0, '第二条生成后同样清零');

            app.params.cmode = 'abs';
            app.params.x2 = -50;
            app.params.y2 = 0;
            t.applyParams();
            assert(app.model.count() === 3, '绝对模式应生成第三条直线');
            const l3 = app.model.entities[2];
            near(l3.p1.x, 70, 1e-9, '绝对模式起点仍为上一终点');
            near(l3.p2.x, -50, 1e-9, '绝对模式终点 X');
            near(l3.p2.y, 0, 1e-9, '绝对模式终点 Y');
            assert(Number(app.params.x2) === 0 && Number(app.params.y2) === 0, '绝对模式生成后终点输入清零');

            // 终点与起点重合时拒绝生成
            app.params.x2 = -50;
            app.params.y2 = 0;
            const before = app.model.count();
            t.applyParams();
            assert(app.model.count() === before, '终点与起点重合时应拒绝生成');
            assert(app.toasts.join('').indexOf('重合') >= 0, '应提示起点与终点重合');

            // 正交 + 增量：按主方向取整
            app.params.ortho = true;
            app.params.cmode = 'rel';
            app.params.x2 = 50;
            app.params.y2 = 10;
            t.applyParams();
            const l4 = app.model.entities[app.model.count() - 1];
            near(l4.p1.y, 0, 1e-9, '正交起点沿用上一条终点');
            near(l4.p2.x, 0, 1e-9, '正交优先水平方向 ΔX');
            near(l4.p2.y, 0, 1e-9, '正交时 Y 与起点对齐');

            // 实时校验：非数字 / 零增量
            app.params.cmode = 'rel';
            app.params.x2 = 'abc';
            assert(x2Def.validate('abc', app.params) !== '', '非数字应给出校验提示');
            app.params.x2 = 0;
            app.params.y2 = 0;
            assert(x2Def.validate(0, app.params).indexOf('重合') >= 0, '零增量应提示重合');
          }
        },
        {
          name: '镜像：点选轴线生成对称副本',
          run: function () {
            const app = mockApp();
            app.model.add(line(10, 10, 30, 10));
            app.model.add(circle(20, 30, 5));
            app.model.add(arc(20, 50, 10, 0, Math.PI / 2, true));
            app.model.add(line(0, 0, 0, 100));
            app.model.entities.slice(0, 3).forEach(function (e) { app.model.selected.add(e.id); });
            const t = useTool('mirror');
            assert(t.params().length === 0, '镜像工具不应再提供手动输入镜像轴参数');
            assert(typeof t.applyParams !== 'function', '镜像工具不应再提供“确定”入口');
            t.onTap({ x: 0, y: 50 });
            assert(app.model.count() === 7, '点选轴线后应生成 3 个镜像副本并保留原图');
            const ml = app.model.entities[4];
            near(ml.p1.x, -10, 1e-9, '直线端点镜像 X');
            near(ml.p1.y, 10, 1e-9);
            near(ml.p2.x, -30, 1e-9);
            const mc = app.model.entities[5];
            assert(mc.type === 'circle');
            near(mc.c.x, -20, 1e-9);
            near(mc.c.y, 30, 1e-9);
            near(mc.r, 5, 1e-9);
            const ma = app.model.entities[6];
            assert(ma.type === 'arc');
            near(ma.c.x, -20, 1e-9);
            near(Geo.arcSweep(ma), Math.PI / 2, 1e-6, '镜像后扫掠角不变');
            assert(ma.ccw === false, '镜像后圆弧旋向翻转');
            const mid = Geo.entityMidpoint(ma);
            near(mid.x, -20 - 10 * Math.cos(Math.PI / 4), 1e-6, '圆弧镜像到轴线另一侧');

            assert(app.model.selected.size === 0, '生成后清空选择');
            t.onTap({ x: 0, y: 50 });
            assert(app.model.count() === 7, '未选中时点按轴线不应再生成');

            const app2 = mockApp();
            app2.model.add(circle(0, 0, 5));
            app2.model.add(line(0, 0, 0, 100));
            app2.model.selected.add(app2.model.entities[0].id);
            useTool('mirror').onTap({ x: 0, y: 50 });
            assert(app2.model.count() === 2, '与已有图形重合的镜像应跳过');
          }
        },
        {
          name: '镜像：已选图形点按轴线立即完成',
          run: function () {
            const app = mockApp();
            app.model.add(line(10, 10, 30, 10));
            app.model.add(line(0, 0, 0, 100));
            app.model.selected.add(app.model.entities[0].id);
            const t = useTool('mirror');
            t.onTap({ x: 0, y: 50 });
            assert(app.model.count() === 3, '点按轴线后应立即生成 1 个副本');
            const cp = app.model.entities[2];
            assert(cp.type === 'line');
            near(cp.p1.x, -10, 1e-9, '关于竖轴镜像 X');
            near(cp.p2.x, -30, 1e-9);
            near(cp.p1.y, 10, 1e-9, '镜像不改变 y');
            assert(app.model.selected.size === 0, '完成后清空选择');
            assert(app.toasts.join().indexOf('镜像副本') >= 0, '应提示已生成副本');
          }
        },
        {
          name: '阵列：矩形行列生成副本',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 10, 0));
            app.model.selected.add(app.model.entities[0].id);
            app.params.amode = 'rect';
            app.params.rows = 2;
            app.params.cols = 3;
            app.params.rgap = 50;
            app.params.cgap = 20;
            const t = useTool('array');
            t.applyParams();
            assert(app.model.count() === 6, '2×3 阵列应生成 5 个副本');
            const xs = app.model.entities.slice(1).map(function (e) { return Math.round(e.p1.x); }).sort(function (a, b) { return a - b; });
            near(xs[0], 0, 1e-9); near(xs[2], 20, 1e-9); near(xs[4], 40, 1e-9);
            const ys = app.model.entities.slice(1).map(function (e) { return Math.round(e.p1.y); }).sort(function (a, b) { return a - b; });
            near(ys[0], 0, 1e-9); near(ys[4], 50, 1e-9, '行距生效');
            assert(app.model.selected.size === 0, '生成后清空选择');

            app.params.rows = 0;
            t.applyParams();
            assert(app.model.count() === 6, '非法行数应拒绝');

            app.params.rows = 1; app.params.cols = 1;
            t.applyParams();
            assert(app.model.count() === 6, '1×1 不应生成副本');
          }
        },
        {
          name: '阵列：环形数量与角度',
          run: function () {
            const app = mockApp();
            const tDefault = useTool('array');
            assert(tDefault._polar() === true, '阵列默认使用环形阵型');
            app.model.add({ type: 'point', p: { x: 20, y: 0 } });
            app.model.add({ type: 'point', p: { x: -20, y: 0 } });
            app.model.entities.forEach(function (e) { app.model.selected.add(e.id); });
            app.params.amode = 'polar';
            app.params.pcount = 4;
            app.params.pangle = 360;
            const t = useTool('array');
            t.applyParams();
            assert(app.model.count() === 8, '2 个点 × 环形 4 等分应生成 6 个副本');
            const pts = app.model.entities.filter(function (e) { return e.type === 'point'; });
            const has = function (x, y) {
              return pts.some(function (e) {
                return Math.abs(e.p.x - x) < 1e-6 && Math.abs(e.p.y - y) < 1e-6;
              });
            };
            assert(has(0, 20), '绕包围盒中心旋转 90°');
            assert(has(0, -20), '旋转 270°');
            assert(has(-20, 0), '旋转 180°');

            app.params.pcount = 1;
            t.applyParams();
            assert(app.model.count() === 8, '环形数量小于 2 应拒绝');

            app.params.pcount = 3; app.params.pangle = 0;
            app.model.entities.forEach(function (e) { app.model.selected.add(e.id); });
            t.applyParams();
            assert(app.model.count() === 8, '总角度为 0 应拒绝');

            // 自定义圆心：指定 (0,0) 而非包围盒中心
            const app2 = mockApp();
            app2.model.add({ type: 'point', p: { x: 20, y: 10 } });
            app2.model.selected.add(app2.model.entities[0].id);
            app2.params.amode = 'polar';
            app2.params.pcount = 4;
            app2.params.pangle = 360;
            app2.params.pcx = 0;
            app2.params.pcy = 0;
            const t2 = useTool('array');
            t2.applyParams();
            assert(app2.model.count() === 4, '自定义圆心应生成 3 个副本');
            assert(app2.model.entities.some(function (e) {
              return e.type === 'point' && Math.abs(e.p.x + 10) < 1e-6 && Math.abs(e.p.y - 20) < 1e-6;
            }), '绕指定圆心旋转 90°');

            // 空白处点按：指定圆心并立即生成阵列
            app2.model.selected.add(app2.model.entities[0].id);
            const before = app2.model.count();
            t2.onTap({ x: 0, y: 0 });
            near(Number(app2.params.pcx), 0, 1e-9);
            near(Number(app2.params.pcy), 0, 1e-9, '点按空白设置圆心');
            assert(app2.model.count() === before + 3, '点按圆心应立即生成 3 个环形副本');
            assert(app2.model.selected.size === 0, '生成后清空选择');
            assert(app2.toasts.join().indexOf('环形阵列副本') >= 0, '应提示已生成环形副本');

            // 未选择对象时点按圆心只提示，不生成
            const before2 = app2.model.count();
            t2.onTap({ x: 30, y: 30 });
            assert(app2.model.count() === before2, '未选择对象时点按不应生成');
            assert(app2.toasts[app2.toasts.length - 1].indexOf('请先') >= 0, '应提示先选择对象');
          }
        },
        {
          name: '选择：连续选择与关联选择',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 40, 0));
            app.model.add(line(100, 0, 140, 0));
            app.model.add(line(200, 0, 240, 0));
            app.params.cont = true;
            const t = useTool('select');
            t.onTap({ x: 20, y: 0 });
            t.onTap({ x: 120, y: 0 });
            assert(app.model.selected.size === 2, '连续选择应累加');
            t.onTap({ x: 20, y: 0 });
            assert(app.model.selected.size === 1, '再次点按应取消该图形');

            app.params.cont = false;
            t.onTap({ x: 220, y: 0 });
            assert(app.model.selected.size === 1, '关闭连续选择后为单选');

            const app2 = mockApp();
            app2.model.add(line(0, 0, 40, 0));
            app2.model.add(line(40, 0, 80, 0));
            app2.model.add(line(200, 0, 240, 0));
            app2.params.chain = true;
            const t2 = useTool('select');
            t2.onTap({ x: 20, y: 0 });
            assert(app2.model.selected.size === 2, '关联选择应带出端点相连的图形');
          }
        },
        {
          name: '裁剪工具（点按中段）',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(30, -10, 30, 10));
            app.model.add(line(60, -10, 60, 10));
            const t = useTool('trim');
            t.onTap({ x: 45, y: 0 });
            assert(app.model.count() === 4, '裁剪后应为 4 个图元（2 竖线 + 2 段）');
          }
        },
        {
          name: '圆弧过渡工具：保留原线段并生成圆弧',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 0, 0, 100));
            const id1 = app.model.entities[0].id;
            const id2 = app.model.entities[1].id;
            app.params.fr = 10;
            const t = useTool('fillet');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 0, y: 50 });
            assert(app.model.count() === 3, '应新增 1 条过渡圆弧');
            const l1 = app.model.findById(id1), l2 = app.model.findById(id2);
            assert(!!l1 && !!l2, '原线段应保留且 id 不变');
            near(l1.p2.x, 10, 1e-9, '第一条线应裁到切点');
            near(l1.p1.x, 100, 1e-9, '保留远端');
            near(l2.p2.y, 10, 1e-9, '第二条线应裁到切点');
            const arcEnt = app.model.entities[2];
            assert(arcEnt.type === 'arc');
            near(Geo.deg(Geo.arcSweep(arcEnt)), 90, 1e-6);

            app.params.fr = 500;
            const t2 = useTool('fillet');
            t2.onTap({ x: 90, y: 0 });
            t2.onTap({ x: 0, y: 90 });
            assert(app.model.count() === 3, '过大半径不应生成');
            assert(app.toasts.join().indexOf('半径过大') >= 0, '应提示半径过大');
          }
        },
        {
          name: '圆弧过渡：直线到圆弧',
          run: function () {
            const app = mockApp();
            app.model.add(line(-100, 0, 100, 0));
            app.model.add(circle(0, 60, 50));
            app.params.fr = 20;
            const t = useTool('fillet');
            t.onTap({ x: 80, y: 0 });
            t.onTap({ x: 41, y: 31.4 });
            assert(app.model.count() === 3, '应生成 1 条过渡圆弧');
            const cut = app.model.entities[0];
            near(cut.p2.x, 100, 1e-9, '保留点按侧线段');
            const cx = Math.sqrt(70 * 70 - 40 * 40);
            near(cut.p1.x, cx, 1e-6, '直线裁到切点');
            near(cut.p1.y, 0, 1e-9);
            const fillet = app.model.entities[2];
            assert(fillet.type === 'arc');
            near(fillet.r, 20, 1e-9);
            near(fillet.c.y, 20, 1e-9, '圆心在直线上方 r 处');
            near(Math.abs(fillet.c.x), cx, 1e-6, '圆心为支撑线与圆的交点');
            const ends = [Geo.arcStart(fillet), Geo.arcEnd(fillet)];
            assert(ends.some(function (q) { return Geo.dist(q, cut.p1) < 1e-6; }), '过渡弧应与直线切点相连');
            assert(ends.some(function (q) { return Math.abs(Geo.dist(q, { x: 0, y: 60 }) - 50) < 1e-6; }), '过渡弧应与原圆相切');
            near(app.model.entities[1].r, 50, 1e-9, '整圆保持原样');
          }
        },
        {
          name: '圆弧过渡：圆弧到圆弧',
          run: function () {
            const app = mockApp();
            app.model.add(arc(-60, 0, 50, -Math.PI / 2, Math.PI / 2, true));
            app.model.add(arc(60, 0, 50, Math.PI / 2, Math.PI * 1.5, true));
            app.params.fr = 10;
            const t = useTool('fillet');
            t.onTap({ x: -10, y: 0 });
            t.onTap({ x: 10, y: 0 });
            assert(app.model.count() === 3, '两段圆弧之间应生成过渡圆弧');
            const a1 = app.model.entities[0];
            const a2 = app.model.entities[1];
            const fillet = app.model.entities[2];
            assert(fillet.type === 'arc');
            near(fillet.r, 10, 1e-9);
            near(fillet.c.x, 0, 1e-6, '圆心在两弧之间');
            near(fillet.c.y, 0, 1e-6);
            near(Geo.arcSweep(fillet), Math.PI, 1e-6, '过渡为半圆');
            const e1 = Geo.arcStart(a1), e2 = Geo.arcEnd(a1);
            const g1 = Geo.arcStart(a2), g2 = Geo.arcEnd(a2);
            const f0 = Geo.polar(fillet.c, fillet.r, fillet.a0);
            const f1 = Geo.polar(fillet.c, fillet.r, fillet.a1);
            const touches = function (a, b) { return Geo.dist(a, b) < 1e-6; };
            const all = [e1, e2, g1, g2];
            assert(all.some(function (q) { return touches(q, f0); }), '过渡弧一端应与某段圆弧端点相连');
            assert(all.some(function (q) { return touches(q, f1); }), '过渡弧另一端应与另一段圆弧端点相连');
            near(a1.r, 50, 1e-9, '原弧半径不变');
            near(a2.r, 50, 1e-9);
          }
        },
        {
          name: '圆弧过渡：关闭裁剪保留原图形',
          run: function () {
            const app = mockApp();
            app.model.add(line(-100, 0, 100, 0));
            app.model.add(line(0, -100, 0, 100));
            app.params.fr = 20;
            app.params.trim = false;
            const t = useTool('fillet');
            t.onTap({ x: 60, y: 0 });
            t.onTap({ x: 0, y: 60 });
            assert(app.model.count() === 3, '应只新增过渡圆弧');
            near(app.model.entities[0].p1.x, -100, 1e-9, '横线未被裁剪');
            near(app.model.entities[0].p2.x, 100, 1e-9);
            near(app.model.entities[1].p1.y, -100, 1e-9, '竖线未被裁剪');
            near(app.model.entities[1].p2.y, 100, 1e-9);
            near(app.model.entities[2].r, 20, 1e-9, '圆弧半径正确');

            // 默认开启裁剪时仍会收缩原图形
            app.params.trim = true;
            const t2 = useTool('fillet');
            t2.onTap({ x: 60, y: 0 });
            t2.onTap({ x: 0, y: 60 });
            assert(app.model.count() === 4, '再次过渡只新增圆弧');
            const xs = [app.model.entities[0].p1.x, app.model.entities[0].p2.x].sort(function (a, b) { return a - b; });
            near(xs[0], 20, 1e-6, '开启裁剪后横线收缩到切点');
            near(xs[1], 100, 1e-6);
          }
        },
        {
          name: '关联选择：链拾取模块已移除且功能不丢失',
          run: function () {
            assert(!global.CADTools.byId('chain'), '链拾取工具应已移除');
            const app = mockApp();
            app.model.add(line(0, 0, 10, 0));
            app.model.add(line(10, 0, 10, 10));
            app.model.add(line(10, 10, 20, 10));
            app.model.add(line(100, 100, 110, 100));
            app.params.chain = true;
            const t = useTool('select');
            t.onTap({ x: 5, y: 0 });
            assert(app.model.selected.size === 3, '关联选择应选中 3 条相连线段');
          }
        },
        {
          name: '选择 / 框选 / 删除工具',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 10, 100, 10));
            const sel = useTool('select');
            sel.onTap({ x: 50, y: 0 });
            assert(app.model.selected.size === 1, '点按应选中 1 条');
            sel.onDragStart({ x: -5, y: -5 });
            sel.onDragMove({ x: 105, y: 15 });
            sel.onDragEnd({ x: 105, y: 15 });
            assert(app.model.selected.size === 2, '框选应选中 2 条');

            const del = useTool('delete');
            del.onTap({ x: 50, y: 0 });
            assert(app.model.count() === 1, '删除工具应移除 1 条');
          }
        },
        {
          name: '平移工具：拖动选中图形',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.selected.add(app.model.entities[0].id);
            const t = useTool('move');
            t.onDragStart({ x: 50, y: 0 });
            t.onDragMove({ x: 60, y: 10 });
            t.onDragEnd({ x: 60, y: 10 });
            near(app.model.entities[0].p1.x, 10, 1e-9);
            near(app.model.entities[0].p1.y, 10, 1e-9);
          }
        },
        {
          name: '旋转工具：基点和拖动旋转',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.selected.add(app.model.entities[0].id);
            const t = useTool('rotate');
            t.onTap({ x: 0, y: 0 });
            t.onDragStart({ x: 10, y: 0 });
            t.onDragMove({ x: 0, y: 10 });
            t.onDragEnd({ x: 0, y: 10 });
            const e = app.model.entities[0];
            near(e.p2.x, 0, 1e-6, '旋转 90° 后终点 x');
            near(e.p2.y, 100, 1e-6, '旋转 90° 后终点 y');
          }
        },
        {
          name: '拉伸工具：直线保持方向、圆弧固定圆心',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            const t = useTool('stretch');
            t.onDragStart({ x: 2, y: 0 });
            t.onDragMove({ x: 20, y: 10 });
            t.onDragEnd({ x: 20, y: 10 });
            const e = app.model.entities[0];
            near(e.p1.x, 20, 1e-9, '端点沿原方向投影到 x=20');
            near(e.p1.y, 0, 1e-9, '直线方向保持水平');
            near(e.p2.x, 100, 1e-9, '另一端不应移动');

            app.model.add(arc(0, 0, 50, 0, Math.PI / 2, true));
            const t2 = useTool('stretch');
            const a = app.model.entities[1];
            t2.onDragStart({ x: 50, y: 0 });
            t2.onDragMove({ x: 35.355, y: 35.355 });
            t2.onDragEnd({ x: 35.355, y: 35.355 });
            near(a.c.x, 0, 1e-9, '圆心 X 固定');
            near(a.c.y, 0, 1e-9, '圆心 Y 固定');
            near(a.r, 50, 1e-9, '半径固定');
            near(Geo.deg(a.a0), 45, 1e-3, '仅起始角变化以调整弧长');
            near(Geo.deg(Geo.arcSweep(a)), 45, 1e-3);
          }
        },
        {
          name: '测量长度 / 角度 / 距离',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            const len = useTool('mlen');
            len.onTap({ x: 50, y: 0 });
            assert(lastInfo(app).title === '长度测量', '长度面板标题');
            assert(lastInfo(app).html.indexOf('100') >= 0, '长度值应为 100');

            app.model.add(line(0, 0, 20, 20));
            const ang = useTool('mangle');
            ang.onTap({ x: 10, y: 0 });
            ang.onTap({ x: 10, y: 10 });
            assert(lastInfo(app).title === '角度测量', '角度面板标题');
            assert(lastInfo(app).html.indexOf('45') >= 0, '夹角应为 45°');

            const dist = useTool('mdist');
            dist.onTap({ x: 0, y: 0 });
            dist.onTap({ x: 3, y: 4 });
            assert(lastInfo(app).title === '距离测量', '距离面板标题');
            assert(lastInfo(app).html.indexOf('5') >= 0, '距离应为 5');
            assert(app.overlay && app.overlay.type === 'dim', '应生成距离标注');
          }
        },
        {
          name: '坐标点查询：端点/中点/交点/圆心收集',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(20, -60, 20, 40));
            app.model.add(circle(200, 200, 30));
            const t = useTool('mcoord');
            t.onTap({ x: 1, y: 1 });
            assert(t.collected.length === 1, '应收集端点');
            assert(t.collected[0].type === '端点');
            near(t.collected[0].p.x, 0, 1e-9);
            near(t.collected[0].p.y, 0, 1e-9);

            t.onTap({ x: 20, y: 1 });
            assert(t.collected.length === 2 && t.collected[1].type === '交点', '应收集交点');
            near(t.collected[1].p.x, 20, 1e-9);
            near(t.collected[1].p.y, 0, 1e-9);

            t.onTap({ x: 201, y: 200 });
            assert(t.collected.length === 3, '应收集圆心');
            assert(t.collected[2].type === '圆心');
            assert(lastInfo(app).title === '坐标点集合');
            assert(lastInfo(app).html.indexOf('3 个坐标点') >= 0, '面板应显示集合数量');
            assert(lastInfo(app).html.indexOf('(200, 200)') >= 0, '面板应输出坐标值');

            t.onTap({ x: 0.5, y: 0.5 });
            assert(t.collected.length === 3, '重复点应被忽略');
            assert(app.toasts.join().indexOf('已收集') >= 0, '应提示已收集');
            assert(app.model.count() === 3, '查询不应改变图元数量');
          }
        },
        {
          name: '属性查询工具',
          run: function () {
            const app = mockApp();
            app.model.add(circle(10, 20, 15));
            const t = useTool('props');
            t.onTap({ x: 25, y: 20 });
            assert(lastInfo(app).title === '图形属性');
            assert(lastInfo(app).html.indexOf('可编辑') >= 0, '属性面板应为可编辑模式');
            assert(app.model.selected.size === 1);
          }
        }
      ]
    },
    {
      name: '标注与几何约束',
      cases: [
        {
          name: '圆工具：半径 / 直径切换实时换算且不中断绘制',
          run: function () {
            const app = mockApp();
            const t = useTool('circle');
            app.params.cx = 0;
            app.params.cy = 0;
            app.params.r = 50;
            assert(app.params.rmode !== 'd', '默认应为半径输入');
            t.onParamChange('rmode', 'd');
            near(Number(app.params.r), 100, 1e-9, '半径 50 切换直径应为 100');
            t.onTap({ x: 0, y: 0 });
            assert(t.points.length === 1, '切换后圆心应保留');
            t.onParamChange('rmode', 'r');
            assert(t.points.length === 1, '再次切换不应中断绘制');
            near(Number(app.params.r), 50, 1e-9, '直径 100 切回半径应为 50');
            near(t._radius(), 50, 1e-9, '半径模式预览半径');

            t.onParamChange('rmode', 'd');
            near(t._radius(), 50, 1e-9, '直径 100 → 预览半径 50');
            app.params.r = 100;
            t.applyParams();
            near(app.model.entities[0].r, 50, 1e-9, '输入直径 100 应生成半径 50 的圆');
          }
        },
        {
          name: '智能标注：自动识别与尺寸驱动',
          run: function () {
            const D = global.CADDims;
            const d = docWith([line(0, 0, 100, 0)]);
            const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 20 });
            near(D.valueOf(d, dim), 100, 1e-9, '线性标注值');
            let r = D.setValue(d, dim, 150);
            assert(r.ok, '线性尺寸驱动应成功');
            near(Geo.dist(d.entities[0].p1, d.entities[0].p2), 150, 1e-9, '改值后直线长度为 150');

            const c = d.add(circle(0, 0, 20));
            const dim2 = d.addDim({ kind: 'diameter', entId: c.id });
            near(D.valueOf(d, dim2), 40, 1e-9, '直径标注值');
            assert(D.setValue(d, dim2, 100).ok);
            near(c.r, 50, 1e-9, '直径驱动半径');
            assert(dim2.kind === 'diameter' && dim2.entId === c.id, '标注记录类型与对象');

            const a = d.add(arc(200, 0, 30, 0, Math.PI / 2));
            const dim3 = d.addDim({ kind: 'radius', entId: a.id });
            assert(D.setValue(d, dim3, 45).ok);
            near(a.r, 45, 1e-9, '半径驱动');

            assert(!D.setValue(d, dim, '0').ok, '零值应拒绝');
            assert(!D.setValue(d, dim, 'abc').ok, '非数字应拒绝');
            const html = D.infoHtml(d, dim);
            assert(html.indexOf('data-dim') >= 0 && html.indexOf('150') >= 0, '面板应包含可编辑数值');
          }
        },
        {
          name: '正交标注：按主方向取坐标差',
          run: function () {
            const D = global.CADDims;
            const mk = function (x2, y2) {
              const d = docWith([line(0, 0, x2, y2)]);
              const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 2 });
              return { d: d, dim: dim };
            };
            const h = mk(100, 0);
            near(D.valueOf(h.d, h.dim, true), 100, 1e-9, '水平正交标注 = Δx');
            const v = mk(0, 60);
            near(D.valueOf(v.d, v.dim, true), 60, 1e-9, '垂直正交标注 = Δy');
            const a45 = mk(100, 100);
            near(D.valueOf(a45.d, a45.dim), Math.hypot(100, 100), 1e-9, '45° 普通标注为实际长度');
            near(D.valueOf(a45.d, a45.dim, true), 100, 1e-9, '45° 正交标注取 Δx');
            const flat = mk(120, 50);
            near(D.valueOf(flat.d, flat.dim), Math.hypot(120, 50), 1e-9, '斜线普通标注为实际长度');
            near(D.valueOf(flat.d, flat.dim, true), 120, 1e-9, '斜线正交标注取主方向 Δx');
            const steep = mk(40, 90);
            near(D.valueOf(steep.d, steep.dim, true), 90, 1e-9, '陡斜线正交标注取 Δy');

            const panel = D.infoHtml(flat.d, flat.dim, true);
            assert(panel.indexOf('正交长度') >= 0 && panel.indexOf('120') >= 0, '正交面板显示坐标差');
            assert(D.setValue(flat.d, flat.dim, 150, true, true).ok, '正交尺寸驱动校验通过');
            assert(D.setValue(flat.d, flat.dim, 150, false, true).ok, '正交尺寸驱动成功');
            near(Math.abs(flat.d.entities[0].p2.x - flat.d.entities[0].p1.x), 150, 1e-9, '正交驱动后 Δx=150');
            near(flat.d.entities[0].p2.y, 50, 1e-9, '正交驱动保持 Δy 不变');

            const normal = mk(120, 50);
            assert(D.setValue(normal.d, normal.dim, 130, false).ok, '普通尺寸驱动成功');
            near(Geo.dist(normal.d.entities[0].p1, normal.d.entities[0].p2), 130, 1e-9, '普通驱动按直线长度');
            near(D.valueOf(normal.d, normal.dim), 130, 1e-9, '普通标注值仍为实际长度');
          }
        },
        {
          name: '正交标注：拖动越界自动切换方向',
          run: function () {
            const D = global.CADDims;
            const d = docWith([line(0, 0, 120, 50)]);
            const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 2 });
            const app = {
              model: d, view: { scale: 10 }, params: { dshow: true, dortho: true },
              dimDrag: {}
            };
            near(D.valueOf(d, dim, true), 120, 1e-9, '初始按水平方向标注');
            assert(D.moveLine(app, dim, { x: 60, y: 10 }) === true, '范围内拖动应成功');
            assert(dim.orthoAxis === undefined, '范围内拖动保持自动判定');
            near(D.valueOf(d, dim, true), 120, 1e-9, '方向不变仍取 Δx');

            // 沿箭头方向拖出右边界（120 + 30px/scale）→ 切换为垂直
            D.moveLine(app, dim, { x: 200, y: 10 });
            assert(dim.orthoAxis === 'v', '拖出边界应切换为垂直标注');
            near(D.valueOf(d, dim, true), 50, 1e-9, '切换后按 Δy 显示');
            assert(app.dimDrag.orthoFlipLock === true, '本次拖动应锁定方向防止来回翻转');
            D.moveLine(app, dim, { x: 10, y: 10 });
            assert(dim.orthoAxis === 'v', '同一次拖动内不应再次翻转');

            // 新一次拖动：垂直方向拖出上下边界 → 切回水平
            app.dimDrag = {};
            D.moveLine(app, dim, { x: 60, y: 10 });
            assert(dim.orthoAxis === 'v', '未越界时保持已切换的方向');
            near(D.valueOf(d, dim, true), 50, 1e-9, '保持垂直方向数值');
            D.moveLine(app, dim, { x: 60, y: 200 });
            assert(dim.orthoAxis === 'h', '拖出上下边界应切回水平');
            near(D.valueOf(d, dim, true), 120, 1e-9, '切回后按 Δx 显示');

            // 非正交拖动不改变正交方向语义
            const d2 = docWith([line(0, 0, 120, 50)]);
            const dim2 = d2.addDim({ kind: 'length', entId: d2.entities[0].id, offset: 2 });
            const app2 = {
              model: d2, view: { scale: 10 }, params: { dshow: true, dortho: false },
              dimDrag: {}
            };
            const L2 = Geo.dist({ x: 0, y: 0 }, { x: 120, y: 50 });
            const n2 = { x: -50 / L2, y: 120 / L2 };
            D.moveLine(app2, dim2, { x: n2.x * 10, y: n2.y * 10 });
            assert(dim2.orthoAxis === undefined, '非正交拖动不设置正交方向');
            near(dim2.offset, 10, 1e-9, '非正交偏移仍按法向投影');
          }
        },
        {
          name: '标注线：命中检测、拖动偏移与数值联动',
          run: function () {
            const D = global.CADDims;
            const d = docWith([line(0, 0, 100, 0)]);
            const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 2 });
            const noop = function () {};
            const ctx = {
              save: noop, restore: noop, beginPath: noop, closePath: noop,
              moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
              setLineDash: noop, translate: noop, rotate: noop,
              measureText: function (t) { return { width: String(t).length * 7 }; },
              fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: ''
            };
            const R = {
              ctx: ctx,
              screen: function (p) { return { x: p.x * 10 + 100, y: p.y * 10 + 100 }; },
              label: function (text, pt) { this.lastLabel = { text: text, pt: pt }; }
            };
            const app = {
              model: d,
              view: {
                scale: 10,
                toWorld: function (s) { return { x: (s.x - 100) / 10, y: (s.y - 100) / 10 }; }
              },
              params: { dshow: true, dortho: false },
              renderer: R
            };

            D.draw(R, app);
            assert(D.hitLine(app, { x: 600, y: 121 }, 4) === dim, '标注线范围内应命中');
            assert(D.hitLine(app, { x: 600, y: 300 }, 4) === null, '标注线范围外不应命中');
            const info0 = D.labelInfo(dim.id);
            assert(info0 && info0.text === '100', '应缓存标注数值');

            assert(D.moveLine(app, dim, { x: 50, y: 6 }) === true, '拖动应更新标注线偏移');
            near(dim.offset, 6, 1e-9, '偏移距离应跟随拖动');
            D.draw(R, app);
            const info1 = D.labelInfo(dim.id);
            assert(!dim.labelPos, '联动模式下不再冻结数值坐标');
            near(info1.x, info0.x, 1e-9, '联动时数值 x 与标注线保持一致');
            near(info1.y, info0.y + 40, 1e-9, '联动时数值 y 随标注线同步移动');
            assert(D.hitLine(app, { x: 600, y: 161 }, 4) === dim, '新位置应命中标注线');
            assert(D.hitLine(app, { x: 600, y: 121 }, 4) === null, '原位置不应再命中');

            const dc = docWith([circle(0, 0, 50)]);
            const cent = dc.entities[0].c;
            const ddim = dc.addDim({ kind: 'diameter', entId: dc.entities[0].id });
            const appC = {
              model: dc, view: { scale: 10 }, params: { dshow: true, dortho: false },
              renderer: R
            };
            D.draw(R, appC);
            const dg0 = D.circleGeomFor(appC, dc.entities[0], ddim);
            near(Geo.dist(dg0.tip, cent), 50, 1e-9, '默认箭头端点落在圆周');
            near(dg0.tip.x, 50 * Math.SQRT1_2, 1e-9, '默认方向为 45°');
            assert(!dg0.inside, '默认不进入圆内双向样式');

            // 圆内：穿过圆心的完整双向箭头，两端落在两侧轮廓
            assert(D.moveLine(appC, ddim, { x: 20, y: 30 }) === true, '直径标注应可拖动');
            near(ddim.anchor.x, 20, 1e-9, '拖动落点 x 写入 anchor');
            near(ddim.anchor.y, 30, 1e-9, '拖动落点 y 写入 anchor');
            assert(!ddim.shift, '不再使用自由平移');
            const dg1 = D.circleGeomFor(appC, dc.entities[0], ddim);
            assert(dg1.inside, '落点在圆内应切换双向直径样式');
            near(Geo.dist(dg1.tip, cent), 50, 1e-9, '圆内样式：箭头端点仍在圆周');
            near(Geo.dist(dg1.back, cent), 50, 1e-9, '圆内样式：另一端也在圆周');
            near(dg1.tip.x + dg1.back.x, 0, 1e-9, '双向箭头两端关于圆心对称 x');
            near(dg1.tip.y + dg1.back.y, 0, 1e-9, '双向箭头两端关于圆心对称 y');
            D.draw(R, appC);
            const dinfo = D.labelInfo(ddim.id);
            assert(dinfo && dinfo.text === '⌀100', '直径标注值');
            const anchorS = R.screen(ddim.anchor);
            near(dinfo.x, anchorS.x + 8, 1e-9, '圆内数值跟随落点 x');
            near(dinfo.y, anchorS.y - 8, 1e-9, '圆内数值跟随落点 y');
            assert(D.hitLine(appC, anchorS, 6) === ddim, '圆内直径线应可命中');

            // 圆外四个象限：圆心固定、箭头端点固定在轮廓、方向随鼠标
            [{ x: 120, y: 0 }, { x: 0, y: 120 }, { x: -120, y: 0 }, { x: 0, y: -120 }]
              .forEach(function (q, i) {
                assert(D.moveLine(appC, ddim, q) === true, '圆外拖动 ' + i);
                const g = D.circleGeomFor(appC, dc.entities[0], ddim);
                assert(!g.inside, '圆外不应进入双向样式');
                near(Geo.dist(g.tip, cent), 50, 1e-9, '象限 ' + i + ' 箭头端点在圆周');
                near(g.c.x, cent.x, 1e-9, '象限 ' + i + ' 圆心 x 不受鼠标影响');
                near(g.c.y, cent.y, 1e-9, '象限 ' + i + ' 圆心 y 不受鼠标影响');
                near(Math.cos(g.ang - Math.atan2(q.y, q.x)), 1, 1e-9, '象限 ' + i + ' 方向跟随落点');
              });

            // 圆弧：箭头方向被限制在弧上，圆心与半径端点保持锚定
            const da = docWith([arc(0, 0, 30, 0, Math.PI / 2, true)]);
            const arcEnt = da.entities[0];
            const adim = da.addDim({ kind: 'radius', entId: arcEnt.id });
            const appA = { model: da, view: { scale: 10 }, params: { dshow: true, dortho: false }, renderer: R };
            const ag0 = D.circleGeomFor(appA, arcEnt, adim);
            near(Geo.dist(ag0.tip, arcEnt.c), 30, 1e-9, '默认半径箭头在弧上');
            assert(Geo.angleOnArc(Geo.angleOf(arcEnt.c, ag0.tip), arcEnt), '默认方向在弧范围内');
            [{ x: 20, y: 20 }, { x: -90, y: 0 }, { x: 0, y: -90 }, { x: 90, y: 5 }]
              .forEach(function (q, i) {
                D.moveLine(appA, adim, q);
                const g = D.circleGeomFor(appA, arcEnt, adim);
                near(Geo.dist(g.tip, arcEnt.c), 30, 1e-9, '弧标注 ' + i + ' 箭头端点在弧上');
                assert(Geo.angleOnArc(Geo.angleOf(g.c, g.tip), arcEnt), '弧标注 ' + i + ' 方向限制在弧内');
                near(g.c.x, 0, 1e-9, '弧标注 ' + i + ' 圆心不变 x');
                near(g.c.y, 0, 1e-9, '弧标注 ' + i + ' 圆心不变 y');
              });
            D.draw(R, appA);
            const ainfo = D.labelInfo(adim.id);
            assert(ainfo && ainfo.text === 'R30', '半径标注值');

            app.params.dshow = false;
            assert(D.hitLine(app, { x: 600, y: 161 }, 4) === null, '隐藏标注时不可命中');
          }
        },
        {
          name: '标注位置与偏移：快照恢复与查询重绘保持最新坐标',
          run: function () {
            const D = global.CADDims;
            const d = docWith([line(0, 0, 80, 0)]);
            const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 16 });
            dim.labelPos = { x: 30, y: 45 };
            dim.anchor = { x: 4, y: 6 };
            const snap = d.snapshot();
            dim.labelPos = { x: 5, y: 5 };
            dim.offset = 99;
            dim.anchor = { x: 1, y: 2 };
            d.restoreSnapshot(snap);
            near(d.dims[0].labelPos.x, 30, 1e-9, '快照恢复后 x 坐标');
            near(d.dims[0].labelPos.y, 45, 1e-9, '快照恢复后 y 坐标');
            near(d.dims[0].offset, 16, 1e-9, '快照恢复后标注线偏移');
            near(d.dims[0].anchor.x, 4, 1e-9, '快照恢复后锚点 x');
            near(d.dims[0].anchor.y, 6, 1e-9, '快照恢复后锚点 y');

            const noop = function () {};
            const ctx = {
              save: noop, restore: noop, beginPath: noop, closePath: noop,
              moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
              setLineDash: noop, translate: noop, rotate: noop,
              measureText: function (t) { return { width: String(t).length * 7 }; },
              fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: ''
            };
            const R = {
              ctx: ctx,
              screen: function (p) { return { x: p.x * 2 + 50, y: p.y * 2 + 50 }; },
              label: noop
            };
            const app = { model: d, view: { scale: 2 }, params: { dshow: true, dortho: false }, renderer: R };
            D.draw(R, app);
            const info = D.labelInfo(d.dims[0].id);
            near(info.x, 110, 1e-9, '重绘后保持 x');
            near(info.y, 140, 1e-9, '重绘后保持 y');
          }
        },
        {
          name: '平行距离标注：识别、几何、拖动与样式',
          run: function () {
            const D = global.CADDims;
            const noop = function () {};
            const ctx = {
              save: noop, restore: noop, beginPath: noop, closePath: noop,
              moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
              setLineDash: noop, translate: noop, rotate: noop,
              measureText: function (t) { return { width: String(t).length * 7 }; },
              fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: ''
            };
            const R = {
              ctx: ctx,
              screen: function (p) { return { x: p.x * 2 + 50, y: p.y * 2 + 50 }; },
              label: noop
            };

            // 平行校验：平行 / 非平行 / 非直线
            const d = docWith([
              line(0, 0, 100, 0),
              line(0, 20, 100, 20),
              line(0, 0, 0, 100)
            ]);
            const A = d.entities[0], B = d.entities[1], C = d.entities[2];
            const chk = D.parallelCheck(A, B);
            assert(chk.ok, '水平平行线应通过校验');
            near(chk.d, 20, 1e-9, '平行距离');
            const bad = D.parallelCheck(A, C);
            assert(!bad.ok, '垂直相交线不应通过平行校验');
            assert(/不平行/.test(bad.error), '非平行提示应明确');
            assert(!D.parallelCheck(A, { type: 'circle', c: { x: 0, y: 0 }, r: 5 }).ok, '圆不参与平行距离标注');

            // 重叠区间：默认尺寸线位于有效重叠区间中点
            const dim = d.addDim({ kind: 'pdist', ids: [A.id, B.id] });
            const g = D.parallelGeomFor(d, dim);
            assert(g && g.mode === 'overlap', '应识别线段重叠区间');
            near(g.d, 20, 1e-9, '重叠区间距离');
            near(g.mid, 50, 1e-9, '默认区间中点');
            near(g.pa.y, 0, 1e-9, '尺寸线起点落在第一条线上');
            near(g.pb.y, 20, 1e-9, '尺寸线终点落在第二条线上');
            near(D.valueOf(d, dim), 20, 1e-9, '标注数值');

            // 不同长度 / 部分重叠：只标注有效重叠区间
            const d2 = docWith([line(0, 0, 100, 0), line(40, 10, 60, 10)]);
            const dim2 = d2.addDim({ kind: 'pdist', ids: [d2.entities[0].id, d2.entities[1].id] });
            const g2 = D.parallelGeomFor(d2, dim2);
            near(g2.d, 10, 1e-9, '不同长度间距');
            near(g2.mid, 50, 1e-9, '部分重叠取交集中点');

            // 倾斜 30° 等距平行线
            const ca = Math.cos(Math.PI / 6), sa = Math.sin(Math.PI / 6);
            const d3 = docWith([
              line(0, 0, ca * 100, sa * 100),
              line(-sa * 15, ca * 15, ca * 100 - sa * 15, sa * 100 + ca * 15)
            ]);
            const dim3 = d3.addDim({ kind: 'pdist', ids: [d3.entities[0].id, d3.entities[1].id] });
            const g3 = D.parallelGeomFor(d3, dim3);
            near(g3.d, 15, 1e-9, '30° 平行线垂直距离');
            near(Geo.dist(g3.pa, d3.entities[0].p1), 50, 1e-9, '倾斜尺寸线落在有效区间中点');

            // 延长线平行：无投影重叠时取最近端点之间的有效区间
            const d4 = docWith([line(0, 0, 50, 0), line(80, 30, 120, 30)]);
            const dim4 = d4.addDim({ kind: 'pdist', ids: [d4.entities[0].id, d4.entities[1].id] });
            const g4 = D.parallelGeomFor(d4, dim4);
            assert(g4 && g4.mode === 'extend', '无重叠应识别为延长线平行区间');
            near(g4.d, 30, 1e-9, '延长线平行距离');
            near(g4.t, 65, 1e-9, '默认定位在最近端点区间中点');
            assert(!g4.insideA && !g4.insideB, '定位点应落在延长线上');

            // 拖动只改变显示位置，不改变距离
            const app = { model: d, view: { scale: 2 }, params: { dshow: true, dortho: false }, renderer: R };
            assert(D.moveLine(app, dim, { x: 30, y: -80 }) === true, '平行距离标注应可拖动');
            near(dim.param, 30, 1e-9, '拖动写入显示位置');
            const g5 = D.parallelGeomFor(d, dim);
            near(g5.d, 20, 1e-9, '拖动后距离不变');
            assert(D.moveLine(app, dim, { x: 500, y: 0 }) === true, '越界拖动应被限制');
            near(dim.param, 100, 1e-9, '显示位置限制在有效范围');

            // 绘制 + 命中检测 + 数值文本
            D.draw(R, app);
            const info = D.labelInfo(dim.id);
            assert(info && info.text === '20', '平行距离数值文本');
            const midS = R.screen({ x: dim.param, y: 10 });
            assert(D.hitLine(app, midS, 6) === dim, '尺寸线可命中');

            // 样式自定义与校验
            assert(D.setStyle(dim, 'font', 'mono').ok, '字体设置');
            assert(D.setStyle(dim, 'size', 18).ok, '字号设置');
            assert(D.setStyle(dim, 'color', '#ff8800').ok, '文字颜色设置');
            assert(D.setStyle(dim, 'dash', 'dash').ok, '尺寸线线型设置');
            assert(!D.setStyle(dim, 'size', 100).ok, '非法字号应拒绝');
            assert(!D.setStyle(dim, 'color', 'red').ok, '非法颜色应拒绝');
            assert(!D.setStyle(dim, 'font', 'comic').ok, '非法字体应拒绝');
            D.draw(R, app);
            assert(D.labelInfo(dim.id).text === '20', '样式修改后数值不变');

            // 查找已有标注（顺序无关）与快照恢复
            assert(D.findParallelFor(d, B.id, A.id) === dim, '反序查找应命中同一标注');
            const snap = d.snapshot();
            dim.param = 10;
            dim.style.size = 12;
            d.restoreSnapshot(snap);
            near(d.dims[0].param, 100, 1e-9, '快照恢复显示位置');
            near(d.dims[0].style.size, 18, 1e-9, '快照恢复样式');
            // 尺寸驱动：修改距离值 -> 第一条线不动，第二条线沿法线平移
            assert(!D.setValue(d, d.dims[0], 0, false).ok, '距离 0 应被拒绝');
            assert(!D.setValue(d, d.dims[0], -5, false).ok, '负距离应被拒绝');
            assert(D.setValue(d, d.dims[0], 30, true).ok, 'dryRun 应通过校验');
            near(D.parallelGeomFor(d, d.dims[0]).d, 20, 1e-9, 'dryRun 不应改变图形');
            assert(D.setValue(d, d.dims[0], 30, false).ok, '平行距离应支持尺寸驱动');
            near(D.parallelGeomFor(d, d.dims[0]).d, 30, 1e-9, '驱动后距离精确为输入值');
            const A2 = d.findById(A.id), B2 = d.findById(B.id);
            near(A2.p1.y, 0, 1e-9, '第一条线保持不动');
            near(A2.p2.y, 0, 1e-9, '第一条线保持不动');
            near(B2.p1.y, 30, 1e-9, '第二条线沿法线平移');
            near(B2.p2.y, 30, 1e-9, '第二条线整体平移');
            near(D.valueOf(d, d.dims[0]), 30, 1e-9, '标注数值同步更新');
            assert(/data-dim="/.test(D.infoHtml(d, d.dims[0])), '面板应提供距离修改输入');
          }
        },
        {
          name: '智能标注自动判断：单线选中、二次选择距离 / 角度、仅数值弹框',
          run: function () {
            const D = global.CADDims;

            // 1) 单条直线：只选中，不创建标注、不弹信息框
            let app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 20, 100, 20));
            let t = useTool('dim');
            t.onTap({ x: 50, y: 0 });
            assert(app.model.dims.length === 0, '点选单条直线不应创建标注');
            assert(app.dimId === undefined, '点选单条直线不应弹出标注信息框');
            assert(t.picks.length === 1, '点选单条直线应进入选中状态');

            // 2) 再点另一条平行直线：自动生成平行距离标注
            t.onTap({ x: 50, y: 20 });
            assert(app.model.dims.length === 1, '两条平行直线应自动生成一条标注');
            assert(app.model.dims[0].kind === 'pdist', '平行时应生成平行距离标注');
            near(D.valueOf(app.model, app.model.dims[0]), 20, 1e-9, '自动平行距离数值');
            assert(app.dimId === undefined, '自动生成标注时不应弹出信息框');

            // 3) 不平行的两条直线：自动生成夹角标注
            app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 0, 0, 100));
            t = useTool('dim');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 0, y: 50 });
            assert(app.model.dims.length === 1 && app.model.dims[0].kind === 'angle', '不平行时应生成角度标注');
            near(D.valueOf(app.model, app.model.dims[0]), 90, 1e-6, '自动角度数值');
            assert(app.dimId === undefined, '角度标注不应自动弹框');

            // 4) 已选一条直线后点按空白：为该直线创建线性标注
            app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            t = useTool('dim');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 500, y: 500 });
            assert(app.model.dims.length === 1 && app.model.dims[0].kind === 'length', '空白点按应创建线性标注');
            assert(app.model.dims[0].entId === app.model.entities[0].id, '线性标注应关联所选直线');
            assert(app.dimId === undefined, '线性标注不应自动弹框');

            // 5) 圆 / 圆弧：直接创建直径 / 半径标注，且不弹框
            app = mockApp();
            app.model.add(circle(0, 0, 50));
            t = useTool('dim');
            t.onTap({ x: 50, y: 0 });
            assert(app.model.dims.length === 1 && app.model.dims[0].kind === 'diameter', '点按圆应生成直径标注');
            assert(app.dimId === undefined, '直径标注不应自动弹框');
            t.onTap({ x: 50, y: 0 });
            assert(app.model.dims.length === 1, '重复点按不应重复创建标注');

            app = mockApp();
            app.model.add(arc(0, 0, 30, 0, Math.PI / 2, true));
            t = useTool('dim');
            t.onTap({ x: 30 * Math.SQRT1_2, y: 30 * Math.SQRT1_2 });
            assert(app.model.dims.length === 1 && app.model.dims[0].kind === 'radius', '点按圆弧应生成半径标注');
            assert(app.dimId === undefined, '半径标注不应自动弹框');

            // 6) 数值文本命中：仅点中数值矩形才返回该标注
            const noop = function () {};
            const ctx = {
              save: noop, restore: noop, beginPath: noop, closePath: noop,
              moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
              setLineDash: noop, translate: noop, rotate: noop,
              measureText: function (s) { return { width: String(s).length * 7 }; },
              fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: ''
            };
            const R = {
              ctx: ctx,
              screen: function (p) { return { x: p.x * 10 + 100, y: p.y * 10 + 100 }; },
              label: noop
            };
            const d = docWith([line(0, 0, 100, 0)]);
            const dim = d.addDim({ kind: 'length', entId: d.entities[0].id, offset: 2 });
            const app2 = { model: d, view: { scale: 10 }, params: { dshow: true, dortho: false }, renderer: R };
            D.draw(R, app2);
            const li = D.labelInfo(dim.id);
            assert(D.hitLabel(app2, { x: li.x + 5, y: li.y - 5 }, 4) === dim, '数值矩形内应命中');
            assert(D.hitLabel(app2, { x: li.x, y: li.y + 40 }, 4) === null, '数值矩形外不应命中');
            // 标注线命中但数值不命中：点按标注线不弹信息框
            assert(D.hitLine(app2, { x: 588, y: 121 }, 4) === dim, '标注线应命中');
            assert(D.hitLabel(app2, { x: 588, y: 121 }, 4) === null, '点在标注线上不应命中数值');
            app2.params.dshow = false;
            D.draw(R, app2);
            assert(D.hitLabel(app2, { x: li.x + 5, y: li.y - 5 }, 4) === null, '隐藏标注时不可命中数值');
          }
        },
        {
          name: '约束求解：水平 / 垂直',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 50)]);
            const id = d.entities[0].id;
            const L0 = Math.hypot(100, 50);
            d.addConstraint({ type: 'horizontal', ids: [id] });
            C.solve(d);
            near(d.entities[0].p2.y, 0, 1e-9, '水平约束终点 y');
            near(Geo.dist(d.entities[0].p1, d.entities[0].p2), L0, 1e-9, '水平约束保持长度');

            const d2 = docWith([line(0, 0, 30, -80)]);
            d2.addConstraint({ type: 'vertical', ids: [d2.entities[0].id] });
            C.solve(d2);
            near(d2.entities[0].p2.x, 0, 1e-9, '垂直约束终点 x');
            near(d2.entities[0].p2.y, -Math.hypot(30, 80), 1e-9, '垂直约束保持长度与方向');
          }
        },
        {
          name: '约束求解：对称 / 共线',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([
              circle(0, 0, 10),
              circle(30, 5, 10),
              line(50, -100, 50, 100)
            ]);
            d.addConstraint({
              type: 'symmetric',
              ids: [d.entities[0].id, d.entities[1].id],
              axisId: d.entities[2].id
            });
            C.solve(d);
            near(d.entities[1].c.x, 100, 1e-9, '对称后圆心 x');
            near(d.entities[1].c.y, 0, 1e-9, '对称后圆心 y');
            near(d.entities[1].r, 10, 1e-9, '对称不改半径');

            const d2 = docWith([line(0, 0, 100, 0), line(0, 50, 50, 80)]);
            const L1 = Math.hypot(50, 30);
            d2.addConstraint({ type: 'collinear', ids: [d2.entities[0].id, d2.entities[1].id] });
            C.solve(d2);
            near(d2.entities[1].p1.y, 0, 1e-9, '共线后起点在基准线上');
            near(d2.entities[1].p2.y, 0, 1e-9, '共线后终点在基准线上');
            near(Geo.dist(d2.entities[1].p1, d2.entities[1].p2), L1, 1e-9, '共线保持长度');
          }
        },
        {
          name: '约束求解：相切 / 距离',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([circle(0, 0, 20), circle(100, 0, 10)]);
            d.addConstraint({ type: 'tangent', ids: [d.entities[0].id, d.entities[1].id] });
            C.solve(d);
            near(Geo.dist(d.entities[0].c, d.entities[1].c), 30, 1e-9, '两圆外切圆心距');

            const d2 = docWith([circle(0, 30, 20), line(-100, 0, 100, 0)]);
            d2.addConstraint({ type: 'tangent', ids: [d2.entities[0].id, d2.entities[1].id] });
            C.solve(d2);
            near(Math.abs(d2.entities[0].c.y), 20, 1e-9, '圆与直线相切时圆心到直线距离等于半径');

            const d3 = docWith([
              { type: 'point', p: { x: 0, y: 0 } },
              { type: 'point', p: { x: 10, y: 0 } }
            ]);
            d3.addConstraint({ type: 'distance', ids: [d3.entities[0].id, d3.entities[1].id], value: 50 });
            C.solve(d3);
            near(d3.entities[1].p.x, 50, 1e-9, '距离约束固定为 50');
            near(d3.entities[1].p.y, 0, 1e-9);
          }
        },
        {
          name: '约束预览不修改原图 / 列表 / 失效清理',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 50)]);
            const id = d.entities[0].id;
            const ghosts = C.preview(d, { type: 'horizontal', ids: [id] });
            assert(ghosts.length === 1, '应返回 1 个预览副本');
            near(ghosts[0].p2.y, 0, 1e-9, '预览副本已水平');
            near(d.entities[0].p2.y, 50, 1e-9, '预览不改变原图');

            const con = d.addConstraint({ type: 'horizontal', ids: [id] });
            const html = C.listHtml(d);
            assert(html.indexOf('水平') >= 0 && html.indexOf('删除') >= 0, '约束列表应含类型与删除');
            assert(d.findConstraint(con.id), '应能按 id 查找约束');

            d.remove(id);
            assert(d.pruneRefs(), '删除图元后应清理引用');
            assert(d.constraints.length === 0, '关联约束应被移除');
            assert(d.dims.length === 0, '关联标注应被移除');
          }
        },
        {
          name: '约束工具：水平点按 / 距离编辑',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 50));
            const t = useTool('ch');
            t.onTap({ x: 50, y: 25 });
            assert(app.model.constraints.length === 1, '应新增水平约束');
            near(app.model.entities[0].p2.y, 0, 1e-9, '水平工具应立即生效');

            const app2 = mockApp();
            app2.model.add({ type: 'point', p: { x: 0, y: 0 } });
            app2.model.add({ type: 'point', p: { x: 10, y: 0 } });
            const t2 = useTool('cdist');
            t2.onTap({ x: 0, y: 0 });
            t2.onTap({ x: 10, y: 0 });
            assert(app2.model.constraints.length === 1, '应新增距离约束');
            const con = app2.model.constraints[0];
            near(con.value, 10, 1e-9, '默认按当前间距固定');

            app2.begin();
            con.value = 40;
            global.CADConstraints.solve(app2.model);
            app2.end();
            near(app2.model.entities[1].p.x, 40, 1e-9, '修改距离值后图形同步');
          }
        },
        {
          name: '直线：连续画线与圆弧方向吸附',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            assert(app.model.entities.length === 1, '应先完成第一条直线');
            assert(t.points.length === 1, '连续模式应以终点作为新起点');
            near(t.points[0].x, 100, 1e-9, '新起点 x = 上一条终点 x');
            near(t.points[0].y, 0, 1e-9, '新起点 y = 上一条终点 y');
            t.onTap({ x: 100, y: 60 });
            assert(app.model.entities.length === 2, '应连续生成第二条直线');
            near(app.model.entities[1].p1.x, 100, 1e-9, '第二条直线与第一条首尾相连');
            near(app.model.entities[1].p1.y, 0, 1e-9);
            near(app.model.entities[1].p2.y, 60, 1e-9);
            t.onRightClick();
            assert(app.params.lchain === false && t.points.length === 0, '右键应退出连续画线并取消当前直线');

            // 起点在圆上 → 法线 / 切线方向吸附
            const app2 = mockApp();
            app2.model.add(circle(0, 0, 50));
            const t2 = useTool('line');
            t2.onTap({ x: 50, y: 0 });
            assert(app2.params.larc === true, '起点在圆上应显示方向吸附');
            app2.params.lalign = 'normal';
            t2.onTap({ x: 90, y: 80 });
            near(app2.model.entities[1].p2.y, 0, 1e-6, '法线吸附终点应落在半径方向');
            near(app2.model.entities[1].p2.x, 90, 1e-6);

            const app3 = mockApp();
            app3.model.add(circle(0, 0, 50));
            const t3 = useTool('line');
            t3.onTap({ x: 50, y: 0 });
            app3.params.lalign = 'tangent';
            t3.onTap({ x: 90, y: 80 });
            near(app3.model.entities[1].p2.x, 50, 1e-6, '切线吸附终点 x 固定');
            near(app3.model.entities[1].p2.y, 80, 1e-6, '切线吸附终点沿 y 方向');
          }
        },
        {
          name: '角度标注：两条直线的夹角与尺寸驱动',
          run: function () {
            const D = global.CADDims;
            const d = docWith([line(0, 0, 100, 0), line(0, 0, 0, 100)]);
            const dim = d.addDim({
              kind: 'angle', ids: [d.entities[0].id, d.entities[1].id], offset: 30
            });
            near(D.valueOf(d, dim), 90, 1e-6, '两条垂直直线夹角');
            assert(D.findAngleFor(d, dim.ids[1], dim.ids[0]) === dim, '角度标注可按顺序无关查找');
            const g = D.angleGeomFor(d, dim);
            assert(g && g.v && Math.abs(g.v.x) < 1e-9 && Math.abs(g.v.y) < 1e-9, '角度顶点在交点');

            assert(D.setValue(d, dim, 45).ok, '角度驱动应成功');
            near(D.valueOf(d, dim), 45, 1e-6, '驱动后夹角为 45°');
            assert(!D.setValue(d, dim, 0).ok && !D.setValue(d, dim, 180).ok, '角度需在 0~180° 之间');
            assert(D.infoHtml(d, dim).indexOf('角度') >= 0, '角度标注面板应显示角度');
            assert(D.nameOf('angle') === '角度标注', '名称应为角度标注');

            assert(!D.angleGeomFor(d, { kind: 'angle', ids: [d.entities[0].id, 999] }), '缺失图元应返回空');
          }
        },
        {
          name: '约束求解：平行 / 角度',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 0), line(0, 50, 50, 80)]);
            d.addConstraint({ type: 'parallel', ids: [d.entities[0].id, d.entities[1].id] });
            C.solve(d);
            const a = d.entities[0], b = d.entities[1];
            const cross = (a.p2.x - a.p1.x) * (b.p2.y - b.p1.y) - (a.p2.y - a.p1.y) * (b.p2.x - b.p1.x);
            near(cross, 0, 1e-6, '平行约束后方向叉积为 0');
            near(Geo.dist(b.p1, b.p2), Math.hypot(50, 30), 1e-9, '平行约束保持第二条长度');

            const d2 = docWith([line(0, 0, 100, 0), line(0, 0, 0, 100)]);
            d2.addConstraint({ type: 'angle', ids: [d2.entities[0].id, d2.entities[1].id], value: 60 });
            C.solve(d2);
            const a2 = d2.entities[0], b2 = d2.entities[1];
            const la = Geo.dist(a2.p1, a2.p2), lb = Geo.dist(b2.p1, b2.p2);
            const da = { x: (a2.p2.x - a2.p1.x) / la, y: (a2.p2.y - a2.p1.y) / la };
            const db = { x: (b2.p2.x - b2.p1.x) / lb, y: (b2.p2.y - b2.p1.y) / lb };
            near(Geo.deg(Math.acos(Geo.clamp(da.x * db.x + da.y * db.y, -1, 1))), 60, 1e-6, '角度约束后夹角为 60°');
          }
        },
        {
          name: '约束求解：固定 / 点在线上 / 圆取圆心',
          run: function () {
            const C = global.CADConstraints;
            // 固定：被固定图形不参与移动
            const d = docWith([
              { type: 'point', p: { x: 0, y: 0 } },
              { type: 'point', p: { x: 10, y: 0 } }
            ]);
            d.addConstraint({ type: 'fixed', ids: [d.entities[1].id] });
            d.addConstraint({ type: 'distance', ids: [d.entities[0].id, d.entities[1].id], value: 50 });
            C.solve(d);
            near(d.entities[1].p.x, 10, 1e-9, '固定点不被距离约束移动');
            near(d.entities[0].p.x, 0, 1e-9, '另一端保持不动');

            // 点在线上：圆自动取圆心
            const d2 = docWith([circle(30, 25, 12), line(-100, 0, 100, 0)]);
            d2.addConstraint({ type: 'onLine', ids: [d2.entities[0].id, d2.entities[1].id] });
            C.solve(d2);
            near(d2.entities[0].c.y, 0, 1e-9, '圆心被投影到直线上');
            near(d2.entities[0].c.x, 30, 1e-9, '投影保持沿直线方向位置');
            near(d2.entities[0].r, 12, 1e-9, '点在线上不改变半径');

            // 共线：圆自动取圆心
            const d3 = docWith([line(0, 0, 100, 0), circle(40, 30, 10)]);
            d3.addConstraint({ type: 'collinear', ids: [d3.entities[0].id, d3.entities[1].id] });
            C.solve(d3);
            near(d3.entities[1].c.y, 0, 1e-9, '共线时圆心落到基准线');
            near(d3.entities[1].c.x, 40, 1e-9, '共线保持圆心沿线位置');

            // 距离：圆取圆心
            const d4 = docWith([circle(0, 0, 10), circle(10, 0, 10)]);
            d4.addConstraint({ type: 'distance', ids: [d4.entities[0].id, d4.entities[1].id], value: 80 });
            C.solve(d4);
            near(Geo.dist(d4.entities[0].c, d4.entities[1].c), 80, 1e-9, '圆距离按圆心计算');
          }
        },
        {
          name: '新增约束工具：平行 / 固定 / 角度 / 点在线上',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(0, 50, 50, 80));
            const tp = useTool('cpar');
            tp.onTap({ x: 50, y: 0 });
            tp.onTap({ x: 25, y: 65 });
            assert(app.model.constraints.length === 1 && app.model.constraints[0].type === 'parallel', '平行工具应添加约束');

            const app2 = mockApp();
            app2.model.add(circle(0, 0, 20));
            const tf = useTool('cfix');
            tf.onTap({ x: 20, y: 0 });
            assert(app2.model.constraints[0].type === 'fixed', '固定工具应添加约束');
            tf.onTap({ x: 20, y: 0 });
            assert(app2.model.constraints.length === 1, '重复固定同一图形应提示且不重复添加');

            const app3 = mockApp();
            app3.model.add(line(0, 0, 100, 0));
            app3.model.add(line(0, 0, 0, 100));
            app3.params.av = 30;
            const ta = useTool('cang');
            ta.onTap({ x: 50, y: 0 });
            ta.onTap({ x: 0, y: 50 });
            assert(app3.model.constraints[0].type === 'angle', '角度工具应添加约束');
            near(app3.model.constraints[0].value, 90, 1e-6, '未改面板值时按当前夹角固定');

            const app4 = mockApp();
            app4.model.add(circle(20, 30, 10));
            app4.model.add(line(-100, 0, 100, 0));
            const tl = useTool('conl');
            tl.onTap({ x: 30, y: 30 });
            tl.onTap({ x: 0, y: 0 });
            assert(app4.model.constraints[0].type === 'onLine', '点在线上工具应添加约束');
            near(app4.model.entities[0].c.y, 0, 1e-9, '圆心应立即投影到直线');
          }
        },
        {
          name: '固定工具：仅固定端点开关',
          run: function () {
            const app = mockApp();
            app.model.add(circle(0, 0, 20));
            const tf = useTool('cfix');
            const f = tf.params().filter(function (fd) { return fd.key === 'fonly'; })[0];
            assert(f && f.type === 'toggle' && f.def === false, '固定工具应提供“仅固定端点”开关且默认关闭');
            app.params.fonly = true;
            tf.onTap({ x: 20, y: 0 });
            assert(app.model.constraints[0].type === 'fixed', '应添加固定约束');
            assert(app.model.constraints[0].onlyEndpoints === true, '开启后应提交仅固定端点');
            assert(app.toasts.join().indexOf('端点') >= 0, '应提示仅固定端点');
          }
        },
        {
          name: '固定约束：仅固定端点的求解行为',
          run: function () {
            const C = global.CADConstraints;
            // 圆：仅固定圆心，半径可随其他约束变化
            const d = docWith([circle(0, 0, 100), circle(0, 200, 50)]);
            d.addConstraint({ type: 'fixed', ids: [d.entities[1].id], onlyEndpoints: true });
            d.addConstraint({ type: 'overlap', ids: [d.entities[0].id, d.entities[1].id] });
            C.solve(d);
            const cb = d.entities[1];
            near(cb.c.x, 0, 1e-9, '仅固定端点：圆心 X 保持');
            near(cb.c.y, 200, 1e-9, '仅固定端点：圆心 Y 保持');
            near(cb.r, 100, 1e-9, '仅固定端点：半径可被其他约束改变');

            // 完整固定：圆心与半径均不变
            const d2 = docWith([circle(0, 0, 100), circle(0, 200, 50)]);
            d2.addConstraint({ type: 'fixed', ids: [d2.entities[1].id] });
            d2.addConstraint({ type: 'overlap', ids: [d2.entities[0].id, d2.entities[1].id] });
            C.solve(d2);
            near(d2.entities[1].c.y, 200, 1e-9, '完整固定：圆心保持');
            near(d2.entities[1].r, 50, 1e-9, '完整固定：半径保持');

            // 直线：仅固定端点时端点不参与移动
            const d3 = docWith([{ type: 'point', p: { x: 50, y: 100 } }, line(0, 0, 100, 0)]);
            d3.addConstraint({ type: 'fixed', ids: [d3.entities[1].id], onlyEndpoints: true });
            d3.addConstraint({ type: 'distance', ids: [d3.entities[0].id, d3.entities[1].id], value: 200 });
            C.solve(d3);
            near(d3.entities[1].p1.x, 0, 1e-9, '直线起点 X 保持');
            near(d3.entities[1].p1.y, 0, 1e-9, '直线起点 Y 保持');
            near(d3.entities[1].p2.x, 100, 1e-9, '直线终点 X 保持');
            near(d3.entities[1].p2.y, 0, 1e-9, '直线终点 Y 保持');

            // 圆弧：仅固定端点，半径保持、圆心反解
            const d4 = docWith([arc(0, 0, 30, 0, Math.PI / 2, true), line(-100, 50, 100, 50)]);
            d4.addConstraint({ type: 'fixed', ids: [d4.entities[0].id], onlyEndpoints: true });
            d4.addConstraint({ type: 'tangent', ids: [d4.entities[0].id, d4.entities[1].id] });
            C.solve(d4);
            const a4 = d4.entities[0];
            assert(d4.constraints[0].onlyEndpoints === true, '约束应记录仅固定端点');
            near(a4.r, 30, 1e-9, '仅固定端点：圆弧半径保持');
            near(Geo.dist(Geo.arcStart(a4), { x: 30, y: 0 }), 0, 1e-6, '圆弧起点保持');
            near(Geo.dist(Geo.arcEnd(a4), { x: 0, y: 30 }), 0, 1e-6, '圆弧终点保持');
            near(a4.c.x, 0, 1e-6, '圆心按端点反解');
            near(a4.c.y, 0, 1e-6);
          }
        }
      ]
    },
    {
      name: '矩形 / 多边形 / 重叠约束',
      cases: [
        {
          name: '矩形几何、包围盒与拾取',
          run: function () {
            const r = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50, style: 'solid', fill: 'blue' };
            assert(Geo.entityPolyline(r).length === 5, '矩形应返回闭合的 5 个点');
            const b = Geo.entityBBox(r);
            near(b.x1, 0); near(b.y1, 0); near(b.x2, 100); near(b.y2, 50);
            near(Geo.entityLength(r), 300, 1e-9, '矩形周长');
            const mid = Geo.entityMidpoint(r);
            near(mid.x, 50); near(mid.y, 25);
            near(Geo.hitDistance(r, { x: 50, y: 0 }), 0, 1e-9, '边上距离');
            near(Geo.hitDistance(r, { x: 120, y: 25 }), 20, 1e-9, '边外距离');
            assert(Geo.entityEndpoints(r).length === 4, '矩形应有 4 个角点');
          }
        },
        {
          name: '多边形面积、周长、包围盒与圆交点',
          run: function () {
            const p = {
              type: 'poly', closed: true,
              pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
            };
            near(Math.abs(Geo.polyArea(p.pts)), 10000, 1e-9, '正方形面积');
            near(Geo.entityLength(p), 400, 1e-9, '正方形周长');
            const b = Geo.entityBBox(p);
            near(b.x2 - b.x1, 100); near(b.y2 - b.y1, 100);
            near(Geo.hitDistance(p, { x: 50, y: 50 }), 50, 1e-9, '内部到边距离');
            const pts = Geo.intersections(p, circle(50, 0, 20));
            assert(pts.length === 2, '多边形边与圆应有两个交点，实际 ' + pts.length);
          }
        },
        {
          name: '矩形 / 多边形平移、旋转、镜像与复制',
          run: function () {
            const r = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 };
            Geo.translateEntity(r, 10, 20);
            near(r.x1, 10); near(r.y1, 20); near(r.x2, 110); near(r.y2, 70);

            const r90 = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 };
            Geo.rotateEntity(r90, { x: 0, y: 0 }, Math.PI / 2);
            assert(r90.type === 'rect', '旋转 90° 后仍应为矩形');
            near(r90.x1, -50, 1e-9); near(r90.y1, 0, 1e-9);
            near(r90.x2, 0, 1e-9); near(r90.y2, 100, 1e-9);

            const r45 = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 };
            Geo.rotateEntity(r45, { x: 0, y: 0 }, Math.PI / 4);
            assert(r45.type === 'poly', '非 90° 旋转应转换为多边形');

            const rm = Geo.mirrorEntity({ type: 'rect', x1: 10, y1: 0, x2: 30, y2: 20 },
              { x: 0, y: 0 }, { x: 0, y: 100 });
            assert(rm.type === 'rect', '沿垂直轴镜像矩形仍应为矩形');
            near(rm.x1, -30, 1e-9); near(rm.x2, -10, 1e-9);

            const p = { type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] };
            const cp = Geo.copyShape({}, p);
            near(cp.pts[1].x, 10);
            cp.pts[1].x = 99;
            near(p.pts[1].x, 10, 1e-9, '复制应为深拷贝');
          }
        },
        {
          name: '矩形 / 多边形属性编辑',
          run: function () {
            const r = { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 };
            assert(Geo.setEntityProp(r, 'w', 200).ok, '修改宽度应成功');
            near(r.x2 - r.x1, 200);
            assert(Geo.setEntityProp(r, 'x2', 50).ok, '修改右边界应成功');
            near(r.x2 - r.x1, 50);
            assert(!Geo.setEntityProp(r, 'w', 0).ok, '宽度 0 应被拒绝');

            const p = {
              type: 'poly', closed: true,
              pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
            };
            assert(Geo.setEntityProp(p, 'v1x', 150).ok, '修改顶点应成功');
            near(p.pts[1].x, 150);
            assert(!Geo.setEntityProp(p, 'v9x', 10).ok, '不存在的顶点应被拒绝');
          }
        },
        {
          name: '矩形工具：点按创建与参数精确创建',
          run: function () {
            const app = mockApp();
            const t = useTool('rect');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 120, y: 80 });
            assert(app.model.entities.length === 1, '点按两个角点应生成矩形');
            const r = app.model.entities[0];
            assert(r.type === 'rect', '类型应为矩形');
            near(r.x2 - r.x1, 120); near(r.y2 - r.y1, 80);
            assert(r.style === 'solid' && r.fill === 'none', '默认实线无填充');

            app.params.x1 = 10; app.params.y1 = 20;
            app.params.w = 30; app.params.h = 40;
            app.params.rstyle = 'dashed'; app.params.rfill = 'green';
            t.reset();
            t.applyParams();
            assert(app.model.entities.length === 2, '参数应精确创建一个矩形');
            const r2 = app.model.entities[1];
            near(r2.x1, 10); near(r2.y1, 20); near(r2.x2, 40); near(r2.y2, 60);
            assert(r2.style === 'dashed' && r2.fill === 'green', '边框与填充应生效');
          }
        },
        {
          name: '多边形工具：自由顶点、自动闭合与边数预设',
          run: function () {
            const app = mockApp();
            const t = useTool('poly');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.onTap({ x: 0, y: 100 });
            t.onTap({ x: 0, y: 0 });
            assert(app.model.entities.length === 1, '点回起点应闭合生成多边形');
            const p = app.model.entities[0];
            assert(p.type === 'poly' && p.closed !== false, '应为闭合多边形');
            assert(p.pts.length === 4, '应有 4 个顶点');

            t.reset();
            app.params.psides = '6';
            app.params.prad = 50;
            t.onTap({ x: 200, y: 200 });
            assert(app.model.entities.length === 2, '边数预设应生成正多边形');
            const hex = app.model.entities[1];
            assert(hex.pts.length === 6, '正六边形应有 6 个顶点');
            hex.pts.forEach(function (q) { near(Geo.dist({ x: 200, y: 200 }, q), 50, 1e-6, '外接圆半径'); });
          }
        },
        {
          name: '多边形顶点编辑',
          run: function () {
            const app = mockApp();
            app.model.add({
              type: 'poly', closed: true,
              pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
            });
            const t = useTool('poly');
            app.params.pmode = 'edit';
            t.onDragStart({ x: 0, y: 0 });
            t.onDragMove({ x: -20, y: -10 });
            t.onDragEnd();
            const p = app.model.entities[0];
            near(p.pts[0].x, -20, 1e-9); near(p.pts[0].y, -10, 1e-9);
            assert(app.undo.length === 1, '顶点编辑应进入撤销栈');
          }
        },
        {
          name: '重叠约束：完全重叠',
          run: function () {
            const d = docWith([
              { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 100 },
              circle(300, 50, 10)
            ]);
            d.addConstraint({ type: 'overlap', ids: [d.entities[0].id, d.entities[1].id], mode: 'full', value: 100 });
            global.CADConstraints.solve(d);
            const c = d.entities[1];
            near(c.c.x, 50, 1e-6); near(c.c.y, 50, 1e-6); near(c.r, 50, 1e-6);
            const C = global.CADConstraints;
            near(C.overlapRatio(Geo.entityBBox(d.entities[0]), Geo.entityBBox(c)), 1, 1e-9);
          }
        },
        {
          name: '重叠约束：比例维持与基准移动后自动跟随',
          run: function () {
            const d = docWith([
              { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 100 },
              { type: 'rect', x1: 200, y1: 0, x2: 300, y2: 100 }
            ]);
            d.addConstraint({
              type: 'overlap', ids: [d.entities[0].id, d.entities[1].id], mode: 'ratio', value: 50
            });
            const C = global.CADConstraints;
            C.solve(d);
            let b = Geo.entityBBox(d.entities[1]);
            near(C.overlapRatio(Geo.entityBBox(d.entities[0]), b), 0.5, 1e-3, '初始重叠比例');

            d.entities[0].x1 = 500; d.entities[0].x2 = 600;
            d.entities[0].y1 = 0; d.entities[0].y2 = 100;
            C.solve(d);
            b = Geo.entityBBox(d.entities[1]);
            near(C.overlapRatio(Geo.entityBBox(d.entities[0]), b), 0.5, 1e-3, '基准移动后重叠比例');
          }
        },
        {
          name: '重叠约束：重叠过多时回退到指定比例',
          run: function () {
            const d = docWith([
              { type: 'rect', x1: 0, y1: 0, x2: 100, y2: 100 },
              { type: 'rect', x1: 20, y1: 0, x2: 120, y2: 100 }
            ]);
            d.addConstraint({
              type: 'overlap', ids: [d.entities[0].id, d.entities[1].id], mode: 'ratio', value: 40
            });
            const C = global.CADConstraints;
            C.solve(d);
            const ratio = C.overlapRatio(Geo.entityBBox(d.entities[0]), Geo.entityBBox(d.entities[1]));
            near(ratio, 0.4, 1e-3, '重叠过多时应向外移动');
          }
        },
        {
          name: '重叠约束工具：参数传递与自动求解',
          run: function () {
            const app = mockApp();
            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 100 });
            app.model.add(circle(300, 50, 10));
            app.params.omode = 'ratio';
            app.params.oratio = 40;
            const t = useTool('conov');
            t.onTap({ x: 0, y: 50 });
            t.onTap({ x: 310, y: 50 });
            assert(app.model.constraints.length === 1, '应添加重叠约束');
            const c = app.model.constraints[0];
            assert(c.type === 'overlap' && c.mode === 'ratio', '约束方式应为比例');
            near(c.value, 40, 1e-9);
            global.CADConstraints.solve(app.model);
            const A = Geo.entityBBox(app.model.entities[0]);
            const B = Geo.entityBBox(app.model.entities[1]);
            near(global.CADConstraints.overlapRatio(A, B), 0.4, 1e-3, '重叠比例应生效');
          }
        }
      ]
    },
    {
      name: '端点重合与线首尾链接',
      cases: [
        {
          name: '端点自动检测：阈值内建立、阈值外跳过、重复不叠加',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 0), line(101.5, 0.8, 200, 0)]);
            const added = C.autoDetectEndpoints(d, 3);
            assert(added.length === 1, '阈值内应新建 1 个约束，实际 ' + added.length);
            const c = added[0];
            assert(c.type === 'coincident' && d.constraints[0] === c, '约束应写入模型');
            assert(c.aIdx === 1 && c.bIdx === 0, '应连接第一条终点与第二条起点');
            assert(C.nameOf('coincident') === '重合', '约束名称应为重合');
            assert(C.iconOf('coincident') === '⊙', '约束标记应为 ⊙');

            assert(C.autoDetectEndpoints(d, 3).length === 0, '重复检测不应叠加约束');
            assert(d.constraints.length === 1, '重复检测后仍只有 1 条约束');

            const far = docWith([line(0, 0, 100, 0), line(105, 0, 200, 0)]);
            assert(C.autoDetectEndpoints(far, 3).length === 0, '超出阈值不应建立');
            assert(C.autoDetectEndpoints(far, 0).length === 0, '阈值为 0 不建立');
            assert(C.autoDetectEndpoints(far, -1).length === 0, '负阈值不建立');
          }
        },
        {
          name: '端点自动检测：圆弧 / 多边形 / 点与阈值边界',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([arc(0, 0, 50, 0, Math.PI / 2), line(50.5, 0.5, 80, 0)]);
            let added = C.autoDetectEndpoints(d, 1);
            assert(added.length === 1, '圆弧端点应被检测');
            assert(added[0].aIdx === 0 && added[0].bIdx === 0, '应取圆弧起点与直线起点');

            const d2 = docWith([
              { type: 'poly', closed: true, pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }] },
              { type: 'point', p: { x: 0.2, y: 0.3 } }
            ]);
            added = C.autoDetectEndpoints(d2, 1);
            assert(added.length === 1 && added[0].aIdx === 0 && added[0].bIdx === 0,
              '多边形顶点与点应建立重合约束');

            const d3 = docWith([line(0, 0, 100, 0), line(102, 0, 200, 0)]);
            assert(C.autoDetectEndpoints(d3, 2).length === 1, '距离等于阈值应建立');

            const d4 = docWith([circle(0, 0, 10), line(9, 0, 100, 0)]);
            assert(C.autoDetectEndpoints(d4, 2).length === 0, '圆没有端点，不参与检测');
          }
        },
        {
          name: '手动重合约束工具：最近端点自动重合与重复校验',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 100, 0));
            const b = app.model.add(line(120, 70, 180, 70));
            const t = useTool('ccoin');
            t.onTap({ x: 50, y: 0 });
            t.onTap({ x: 150, y: 70 });
            assert(app.model.constraints.length === 1, '应添加重合约束');
            const c = app.model.constraints[0];
            assert(c.type === 'coincident' && c.aIdx === 1 && c.bIdx === 0, '应取最近的一对端点');
            near(b.p1.x, 100, 1e-9, '第二条线起点应平移到重合位置');
            near(b.p1.y, 0, 1e-9, '第二条线起点应平移到重合位置');
            near(b.p2.x, 160, 1e-9, '第二条线整体平移');
            near(Geo.dist(a.p2, b.p1), 0, 1e-9, '端点应精确重合');

            const t2 = useTool('ccoin');
            t2.onTap({ x: 50, y: 0 });
            t2.onTap({ x: 140, y: 0 });
            assert(app.model.constraints.length === 1, '重复添加不应叠加约束');
            assert(t2.picks.length === 0, '重复添加后应重置选择');

            const app2 = mockApp();
            app2.model.add(circle(0, 0, 20));
            app2.model.add(line(0, 0, 50, 0));
            const t3 = useTool('ccoin');
            t3.onTap({ x: 20, y: 0 });
            assert(app2.model.constraints.length === 0, '圆没有端点，不应建立重合约束');
          }
        },
        {
          name: '端点重合约束：拖动基准或跟随图形后保持重合',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 0), line(100, 0, 100, 80)]);
            d.addConstraint({
              type: 'coincident',
              ids: [d.entities[0].id, d.entities[1].id], aIdx: 1, bIdx: 0
            });
            Geo.translateEntity(d.entities[0], 10, 20);
            C.solve(d);
            near(d.entities[1].p1.x, 110, 1e-9, '跟随端点 x 应与基准重合');
            near(d.entities[1].p1.y, 20, 1e-9, '跟随端点 y 应与基准重合');
            near(d.entities[1].p2.y, 100, 1e-9, '跟随图形应整体平移保持形状');

            Geo.translateEntity(d.entities[1], 30, -10);
            C.solve(d);
            near(d.entities[1].p1.x, 110, 1e-9, '拖动跟随图形后应回到基准端点');
            near(d.entities[1].p1.y, 20, 1e-9);
          }
        },
        {
          name: '拖动过程中实时保持端点重合',
          run: function () {
            const app = mockApp();
            const a = line(0, 0, 100, 0);
            const b = line(100, 0, 100, 80);
            app.model.add(a);
            app.model.add(b);
            app.model.addConstraint({
              type: 'coincident', ids: [a.id, b.id], aIdx: 1, bIdx: 0
            });
            app.model.selected.add(a.id);
            const t = useTool('move');
            t.onDragStart({ x: 50, y: 0 });
            t.onDragMove({ x: 60, y: 10 });
            // 尚未结束拖动，关联端点就应同步跟随
            near(b.p1.x, 110, 1e-9, '拖动过程中跟随端点 x');
            near(b.p1.y, 10, 1e-9, '拖动过程中跟随端点 y');
            t.onDragEnd({ x: 60, y: 10 });
          }
        },
        {
          name: '端点重合约束：缺失图元 / 非法索引 / 圆无端点',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 0)]);
            assert(!C.solveOne(d, { type: 'coincident', ids: [d.entities[0].id, 'none'], aIdx: 0, bIdx: 0 }),
              '缺失图元应返回 false');
            assert(!C.solveOne(d, {
              type: 'coincident', ids: [d.entities[0].id, d.entities[0].id], aIdx: 0, bIdx: 1
            }), '同一图元应返回 false');

            const d2 = docWith([line(0, 0, 100, 0), line(50, 50, 80, 80), circle(0, 0, 5)]);
            assert(!C.solveOne(d2, {
              type: 'coincident', ids: [d2.entities[0].id, d2.entities[1].id], aIdx: 9, bIdx: 0
            }), '非法端点索引应返回 false');
            assert(!C.solveOne(d2, {
              type: 'coincident', ids: [d2.entities[0].id, d2.entities[2].id], aIdx: 0, bIdx: 0
            }), '圆无端点应返回 false');

            const d3 = docWith([line(0, 0, 100, 0), line(100, 0, 100, 80)]);
            assert(!C.solveOne(d3, {
              type: 'coincident', ids: [d3.entities[0].id, d3.entities[1].id], aIdx: 1, bIdx: 0
            }), '端点已重合时无需移动');
          }
        },
        {
          name: '约束设置工具：默认关闭、开关即时检测与提示',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 100, 0));
            app.model.add(line(101, 0, 200, 0));
            const t = useTool('cset');
            const defs = t.params();
            const aep = defs.filter(function (f) { return f.key === 'aep'; })[0];
            const llink = defs.filter(function (f) { return f.key === 'llink'; })[0];
            assert(aep && aep.def === false, '端点自动重合默认关闭');
            assert(llink && llink.def === false, '线首尾自动链接默认关闭');
            assert(app.model.constraints.length === 0, '未开启时不自动建立约束');

            app.params.aep = true;
            app.params.aet = 3;
            t.onParamChange('aep', true);
            assert(app.model.constraints.length === 1, '开启后应即时检测并建立约束');
            const toast = app.toasts[app.toasts.length - 1] || '';
            assert(toast.indexOf('端点自动重合已开启') >= 0, '开启应给出操作说明');
            assert(toast.indexOf('1') >= 0, '提示应包含新增数量');

            t.onParamChange('aep', false);
            assert((app.toasts[app.toasts.length - 1] || '').indexOf('已关闭') >= 0, '关闭应给出提示');

            app.params.aet = 0.5;
            t.onParamChange('aep', true);
            assert(app.model.constraints.length === 1, '阈值内已检测过的端点不应重复建立');
          }
        },
        {
          name: '连续画线：线首尾自动链接建立并跟随',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true;
            app.params.llink = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            assert(app.model.entities.length === 1 && app.model.constraints.length === 0,
              '第一条直线不建立链接约束');

            t.onTap({ x: 100, y: 80 });
            assert(app.model.entities.length === 2, '应连续生成第二条直线');
            assert(app.model.constraints.length === 1, '第二条直线应建立 1 条重合约束');
            const c = app.model.constraints[0];
            assert(c.type === 'coincident' && c.aIdx === 1 && c.bIdx === 0,
              '应连接上一条终点与当前起点');
            assert(c.ids[0] === app.model.entities[0].id && c.ids[1] === app.model.entities[1].id,
              '约束对象顺序应为上一条 → 当前条');

            t.onTap({ x: 0, y: 80 });
            assert(app.model.constraints.length === 2, '第三条直线应再建立 1 条约束');

            Geo.translateEntity(app.model.entities[0], 10, 10);
            global.CADConstraints.solve(app.model);
            near(app.model.entities[1].p1.x, 110, 1e-9, '拖动前一段后一段起点应跟随');
            near(app.model.entities[1].p1.y, 10, 1e-9);
            near(app.model.entities[1].p2.y, 90, 1e-9, '后续线段保持首尾相连');
          }
        },
        {
          name: '连续画线：关闭链接或未开连续画线时不自动约束',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true;
            app.params.llink = false;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 80 });
            assert(app.model.entities.length === 2 && app.model.constraints.length === 0,
              '关闭链接时不应建立约束');

            app.params.llink = true;
            t.onTap({ x: 0, y: 80 });
            assert(app.model.constraints.length === 1, '开启后下一段应建立约束');

            const app2 = mockApp();
            const t2 = useTool('line');
            app2.params.llink = true;
            t2.onTap({ x: 0, y: 0 });
            t2.onTap({ x: 10, y: 0 });
            t2.onTap({ x: 20, y: 0 });
            assert(app2.model.constraints.length === 0, '未开启连续画线时不应建立链接约束');
          }
        },
        {
          name: '闭环：默认开启且依赖连续画线 + 首尾链接',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            const lloop = t.params().filter(function (f) { return f.key === 'lloop'; })[0];
            assert(lloop && lloop.type === 'toggle', '应提供闭环开关');
            assert(lloop.def === true, '闭环默认开启');

            app.params.lchain = false; app.params.llink = true;
            assert(lloop.when(app.params) === false, '未开连续画线时不显示闭环');
            app.params.lchain = true; app.params.llink = false;
            assert(lloop.when(app.params) === false, '未开首尾链接时不显示闭环');
            app.params.llink = true;
            assert(lloop.when(app.params) === true, '两项开启后应显示闭环');
          }
        },
        {
          name: '闭环：右键退出自动补线并建立首尾重合约束',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true;
            app.params.llink = true;
            app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 80 });
            assert(app.model.entities.length === 2, '应先画出两条直线');
            assert(app.model.constraints.length === 1, '相邻两段应有 1 条链接约束');

            t.onRightClick();
            const ents = app.model.entities;
            assert(ents.length === 3, '退出时应自动补一条闭合直线');
            const first = ents[0], last = ents[1], closed = ents[2];
            near(closed.p1.x, last.p2.x); near(closed.p1.y, last.p2.y);
            near(closed.p2.x, first.p1.x); near(closed.p2.y, first.p1.y);

            assert(app.model.constraints.length === 3, '闭环应新增两条重合约束');
            const c1 = app.model.constraints[1], c2 = app.model.constraints[2];
            assert(c1.type === 'coincident' && c1.aIdx === 1 && c1.bIdx === 0 &&
              c1.ids[0] === last.id && c1.ids[1] === closed.id, '末段终点应与闭合线起点重合');
            assert(c2.type === 'coincident' && c2.aIdx === 1 && c2.bIdx === 0 &&
              c2.ids[0] === closed.id && c2.ids[1] === first.id, '闭合线终点应与首段起点重合');

            assert(app.params.lchain === false, '退出后应关闭连续画线');
            assert(t.chainFirstId === null && t.chainLastId === null, '退出后应清理链状态');
          }
        },
        {
          name: '闭环：切换工具 / 拖动取消同样触发',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 60, y: 0 });
            t.onTap({ x: 60, y: 60 });
            t.deactivate(); // 相当于切换到其它工具
            assert(app.model.entities.length === 3, '切换工具时应自动闭合');
            assert(app.model.constraints.length === 3, '切换工具时应新增两条闭环约束');

            const t2 = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t2.onTap({ x: 200, y: 0 });
            t2.onTap({ x: 260, y: 0 });
            t2.onTap({ x: 260, y: 60 });
            t2.onDragCancel();
            assert(app.model.entities.length === 6, '拖动取消时应自动闭合');
            assert(app.model.constraints.length === 6, '拖动取消应再新增三条约束');
          }
        },
        {
          name: '闭环：单段 / 首尾已重合 / 开关关闭时不补线',
          run: function () {
            // 只有一段：首尾同一条，不应闭合
            let app = mockApp();
            let t = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onRightClick();
            assert(app.model.entities.length === 1, '只有一段时不应自动闭合');

            // 首尾端点已重合：不应重复补线
            app = mockApp();
            t = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.onTap({ x: 0, y: 100 });
            t.onTap({ x: 0, y: 0 });
            const n = app.model.entities.length;
            t.onRightClick();
            assert(app.model.entities.length === n, '首尾已重合时不应重复补线');

            // 关闭首尾链接
            app = mockApp();
            t = useTool('line');
            app.params.lchain = true; app.params.llink = false; app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.onRightClick();
            assert(app.model.entities.length === 2, '未开首尾链接时不应自动闭合');

            // 关闭闭环本身
            app = mockApp();
            t = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = false;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.onRightClick();
            assert(app.model.entities.length === 2, '关闭闭环后不应自动补线');
          }
        },
        {
          name: '闭环：重复退出防抖且状态可复用',
          run: function () {
            const app = mockApp();
            const t = useTool('line');
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.onRightClick();
            t.onRightClick();
            t.onRightClick();
            assert(app.model.entities.length === 3, '连续多次退出只应补一条闭合线');
            assert(app.model.constraints.length === 3, '连续多次退出只应新增两条约束');

            // 重新开启后可再次正常闭环
            app.params.lchain = true; app.params.llink = true; app.params.lloop = true;
            t.activate();
            t.onTap({ x: 200, y: 0 });
            t.onTap({ x: 300, y: 0 });
            t.onTap({ x: 300, y: 100 });
            t.onRightClick();
            assert(app.model.entities.length === 6, '状态清理后可再次正常闭环');
            assert(app.model.constraints.length === 6, '再次闭环应新增三条约束');
          }
        }
      ]
    },
    {
      name: '性能冒烟',
      cases: [
        {
          name: '200 图元下 2000 次拾取耗时',
          run: function () {
            const d = new Doc();
            let seed = 7;
            function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
            for (let i = 0; i < 200; i++) {
              const x = rnd() * 400 - 200, y = rnd() * 400 - 200;
              if (i % 2) d.add(line(x, y, x + rnd() * 80, y + rnd() * 80));
              else d.add(circle(x, y, 5 + rnd() * 30));
            }
            const t0 = performance.now();
            for (let i = 0; i < 2000; i++) d.hitTest({ x: (i % 100) - 50, y: (i % 80) - 40 }, 2);
            const ms = performance.now() - t0;
            const avg = ms / 2000;
            assert(avg < 5, '单次拾取平均耗时应低于 5ms，实际 ' + avg.toFixed(3) + 'ms');
            return '单次 ' + avg.toFixed(3) + ' ms（200 图元 / 2000 次）';
          }
        },
        {
          name: '100 段关联选择链识别耗时',
          run: function () {
            const d = new Doc();
            for (let i = 0; i < 100; i++) d.add(line(i * 10, 0, (i + 1) * 10, 0));
            const t0 = performance.now();
            const set = d.chain(d.entities[50], 1e-6);
            const ms = performance.now() - t0;
            assert(set.size === 100, '应识别全部 100 段');
            assert(ms < 100, '关联选择链识别应在 100ms 内完成，实际 ' + ms.toFixed(1) + 'ms');
            return ms.toFixed(2) + ' ms / 100 段';
          }
        }
      ]
    },
    {
      name: '轮廓线与样条线',
      cases: [
        {
          name: '样条采样 / 长度 / 包围盒 / 中点',
          run: function () {
            const s = { type: 'spline', pts: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }], smooth: 0.5, closed: false };
            const pts = Geo.splinePolyline(s, 48);
            assert(pts.length > 10, '样条应采样出足够多的点');
            near(pts[0].x, 0, 1e-9, '采样起点 X');
            near(pts[0].y, 0, 1e-9, '采样起点 Y');
            near(pts[pts.length - 1].x, 100, 1e-9, '采样终点 X');
            near(pts[pts.length - 1].y, 0, 1e-9, '采样终点 Y');
            const len = Geo.entityLength(s);
            assert(len > 156.2, '曲线长度应大于折线弦长，实际 ' + len);
            const b = Geo.entityBBox(s);
            assert(b.x1 >= -1e-9 && b.x2 <= 100 + 1e-9, '包围盒 X 范围');
            assert(b.y2 > 30 && b.y2 <= 60 + 1e-9, '包围盒 Y 上限');
            const mid = Geo.entityMidpoint(s);
            near(mid.x, 50, 1e-6, '对称样条中点 X');
            const sp = pts[Math.floor(pts.length / 2)];
            near(Geo.hitDistance(s, sp), 0, 1e-6, '采样点应落在样条上');
            assert(Geo.splineCurves(s).length === 2, '3 个节点应生成 2 段曲线');
          }
        },
        {
          name: '样条交点识别与闭合',
          run: function () {
            const s = { type: 'spline', pts: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }], smooth: 0.5, closed: false };
            const hits = Geo.intersections(s, line(-10, 30, 110, 30));
            assert(hits.length >= 2, '样条与水平线应至少识别 2 个交点，实际 ' + hits.length);
            hits.forEach(function (p) { near(p.y, 30, 1e-6, '交点应落在直线上'); });
            const closed = { type: 'spline', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], smooth: 0.5, closed: true };
            assert(Geo.splineCurves(closed).length === 3, '闭合样条应包含收尾段');
            const cp = Geo.splinePolyline(closed, 60);
            near(Geo.dist(cp[0], cp[cp.length - 1]), 0, 1e-6, '闭合样条首尾应重合');
          }
        },
        {
          name: '样条平移 / 镜像 / 复制独立',
          run: function () {
            const s = { type: 'spline', pts: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }], smooth: 0.4, closed: false };
            Geo.translateEntity(s, 10, -5);
            near(s.pts[1].x, 60, 1e-9, '平移后节点 X');
            near(s.pts[1].y, 15, 1e-9, '平移后节点 Y');
            const m = Geo.mirrorEntity(s, { x: 0, y: 0 }, { x: 0, y: 10 });
            assert(m && m.type === 'spline', '样条应支持镜像');
            near(m.pts[1].x, -60, 1e-9, '镜像后节点 X 取反');
            near(m.pts[1].y, 15, 1e-9, '镜像后节点 Y 不变');
            const copy = Geo.copyShape({}, s);
            copy.pts[0].x = 999;
            near(s.pts[0].x, 10, 1e-9, '复制后修改不应影响原样条');
            assert(Geo.contourClosure([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.4 }], 0.5), '首尾在容差内应判定闭合');
            assert(!Geo.contourClosure([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }], 0.5), '首尾超差不应闭合');
            assert(!Geo.contourClosure([{ x: 0, y: 0 }, { x: 10, y: 0 }], 100), '少于 3 点不应闭合');
          }
        },
        {
          name: '轮廓线工具：开放 / 自动闭合 / 节点增删',
          run: function () {
            const app = mockApp();
            app.params.cmode = 'draw';
            app.params.cend = 'open';
            const t = useTool('contour');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 100, y: 0 });
            t.onTap({ x: 100, y: 100 });
            t.applyParams();
            assert(app.model.count() === 1, '应生成 1 条开放轮廓');
            const e = app.model.entities[0];
            assert(e.type === 'poly' && e.closed === false, '开放轮廓应为非闭合 poly');
            assert(e.pts.length === 3, '节点数量应为 3');

            // 点回起点闭合
            app.params.cend = 'auto';
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 80, y: 0 });
            t.onTap({ x: 80, y: 60 });
            t.onTap({ x: 1, y: 1 });
            assert(app.model.count() === 2, '点回起点附近应完成闭合轮廓');
            assert(app.model.entities[1].closed === true, '自动检测应生成闭合轮廓');

            // 编辑：线段插点 + 再次点按删除
            app.params.cmode = 'edit';
            const ec = app.model.entities[1];
            const n0 = ec.pts.length;
            t.onTap({ x: 40, y: 30 });
            assert(ec.pts.length === n0 + 1, '在线段上点按应插入节点');
            t.onTap({ x: 40, y: 30 });
            assert(ec.pts.length === n0, '再次点按同一节点应删除');

            // 拖动节点
            const q = ec.pts[0];
            t.onDragStart({ x: q.x, y: q.y });
            t.onDragMove({ x: q.x + 12, y: q.y + 8 });
            t.onDragEnd();
            near(ec.pts[0].x, q.x + 12, 1e-9, '拖动后节点 X 更新');
            near(ec.pts[0].y, q.y + 8, 1e-9, '拖动后节点 Y 更新');
          }
        },
        {
          name: '样条线工具：绘制 / 平滑度 / 手柄与节点编辑',
          run: function () {
            const app = mockApp();
            app.params.smode = 'draw';
            app.params.smooth = 0.5;
            app.params.sclosed = false;
            const t = useTool('spline');
            t.onTap({ x: 0, y: 0 });
            t.onTap({ x: 50, y: 50 });
            t.onTap({ x: 100, y: 0 });
            t.applyParams();
            assert(app.model.count() === 1, '应生成 1 条样条线');
            const e = app.model.entities[0];
            assert(e.type === 'spline' && e.pts.length === 3, '样条节点数量');
            near(e.smooth, 0.5, 1e-9, '平滑度应写入图元');

            app.params.smode = 'edit';
            t.onTap({ x: 50, y: 50 });
            assert(t.editId === e.id, '编辑模式点按应选中样条');
            const h = Geo.splineControls(e)[0].out;
            t.onDragStart(h);
            assert(t.dragKind === 'out', '应识别控制手柄拖动');
            t.onDragMove({ x: h.x + 20, y: h.y + 10 });
            t.onDragEnd();
            const h2 = Geo.splineControls(e)[0].out;
            near(h2.x, h.x + 20, 1e-9, '手柄 X 更新');
            near(h2.y, h.y + 10, 1e-9, '手柄 Y 更新');

            t.onDragStart({ x: 50, y: 50 });
            assert(t.dragKind === 'node', '应识别节点拖动');
            t.onDragMove({ x: 60, y: 65 });
            t.onDragEnd();
            near(e.pts[1].x, 60, 1e-9, '节点拖动后 X');
            near(e.pts[1].y, 65, 1e-9, '节点拖动后 Y');
          }
        },
        {
          name: '水平 / 垂直对齐约束求解与偏差',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 10, 0), line(20, 10, 30, 10), circle(50, 30, 5)]);
            const ids = d.entities.map(function (e) { return e.id; });
            const hc = d.addConstraint({ type: 'halign', ids: ids });
            assert(hc, '应能添加水平对齐约束');
            const dev0 = C.deviation(d, hc);
            near(dev0, 30, 1e-9, '水平对齐初始偏差为最大 Y 差');
            C.solve(d);
            near(C.repPoint(d.entities[0]).y, 0, 1e-6);
            near(C.repPoint(d.entities[1]).y, 0, 1e-6, '第二条直线应对齐到基准 Y');
            near(C.repPoint(d.entities[2]).y, 0, 1e-6, '圆应对齐到基准 Y');
            near(C.deviation(d, hc), 0, 1e-9, '求解后偏差应为 0');
            assert(C.deviation(d, hc) <= 2 / 1.6, '偏差应在 2px 容差内');

            const d2 = docWith([line(0, 0, 10, 0), line(20, 10, 30, 10)]);
            const vc = d2.addConstraint({ type: 'valign', ids: d2.entities.map(function (e) { return e.id; }) });
            C.solve(d2);
            near(C.repPoint(d2.entities[0]).x, 5, 1e-6);
            near(C.repPoint(d2.entities[1]).x, 5, 1e-6, '垂直对齐后 X 一致');
            near(C.deviation(d2, vc), 0, 1e-9);
          }
        },
        {
          name: '等长约束与批量约束工具',
          run: function () {
            const C = global.CADConstraints;
            const d = docWith([line(0, 0, 100, 0), line(20, 10, 60, 10)]);
            const eq = d.addConstraint({ type: 'equal', ids: d.entities.map(function (e) { return e.id; }) });
            near(C.deviation(d, eq), 60, 1e-9, '等长初始偏差');
            C.solve(d);
            near(Geo.entityLength(d.entities[0]), 100, 1e-6);
            near(Geo.entityLength(d.entities[1]), 100, 1e-6, '第二条直线应缩放到等长');
            const mid = Geo.entityMidpoint(d.entities[1]);
            near(mid.x, 40, 1e-6, '等长缩放应保持中点 X');
            near(mid.y, 10, 1e-6, '等长缩放应保持中点 Y');

            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(line(20, 10, 30, 10));
            const t = useTool('chal');
            t.onTap({ x: 5, y: 0 });
            t.onTap({ x: 25, y: 10 });
            assert(t.picks.length === 2, '批量选择应记录 2 个图形');
            t.applyParams();
            assert(app.model.constraints.length === 1 && app.model.constraints[0].type === 'halign', '应一键添加水平对齐约束');
            near(C.repPoint(a).y, C.repPoint(b).y, 1e-6, '批量应用后 Y 对齐');

            const app2 = mockApp();
            const l1 = app2.model.add(line(0, 0, 100, 0));
            const l2 = app2.model.add(line(0, 20, 40, 20));
            const te = useTool('ceq');
            te.onTap({ x: 50, y: 0 });
            te.onTap({ x: 20, y: 20 });
            te.applyParams();
            near(Geo.entityLength(l1), 100, 1e-6);
            near(Geo.entityLength(l2), 100, 1e-6, '等长工具一键应用');
          }
        },
        {
          name: '新增功能确定按钮标记：轮廓线与批量约束',
          run: function () {
            mockApp();
            const contour = useTool('contour');
            assert(contour.params().some(function (f) { return f.apply === true; }), '轮廓线收尾参数应请求确定按钮');
            const ceq = useTool('ceq');
            assert(ceq.params().some(function (f) { return f.apply === true; }), '批量约束应请求确定按钮');
          }
        },
        {
          name: '点对齐：参考点 / 求解 / 自定义锚点 / 兼容元素',
          run: function () {
            const app = mockApp();
            const C = global.CADConstraints;
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            near(C.alignPointOf(r, 'lt').x, 0, 1e-9);
            near(C.alignPointOf(r, 'lt').y, 50, 1e-9);
            near(C.alignPointOf(r, 'rt').x, 100, 1e-9);
            near(C.alignPointOf(r, 'lb').y, 0, 1e-9);
            near(C.alignPointOf(r, 'rb').x, 100, 1e-9);
            near(C.alignPointOf(r, 'center').x, 50, 1e-9);
            near(C.alignPointOf(r, 'center').y, 25, 1e-9);

            const c = app.model.add(circle(200, 0, 20));
            near(C.alignPointOf(c, 'lt').x, 180, 1e-9, '圆左上角 x');
            near(C.alignPointOf(c, 'lt').y, 20, 1e-9, '圆左上角 y');

            // 兼容文本框 / 图片 / 容器等以边界框描述的元素
            const box = { type: 'textbox', x1: 10, y1: 20, x2: 30, y2: 40 };
            near(C.alignPointOf(box, 'rb').x, 30, 1e-9);
            near(C.alignPointOf(box, 'rb').y, 20, 1e-9);
            near(C.repPoint(box).x, 20, 1e-9, '未知类型退回包围盒中心');

            // 点对齐求解：左上角水平对齐
            const th = useTool('chal');
            app.params.almode = 'point';
            app.params.alpt = 'lt';
            app.params.altol = 5;
            th.picks = [r.id, c.id];
            th.applyParams();
            const con = app.model.constraints[app.model.constraints.length - 1];
            assert(con.pmode === 'point' && con.ptype === 'lt', '约束应记录点对齐配置');
            near(con.snap, 5, 1e-9, '默认吸附阈值 5px');
            near(C.alignPointOf(app.model.findById(c.id), 'lt').y,
              C.alignPointOf(r, 'lt').y, 1e-9, '左上角应水平对齐');
            near(C.deviation(app.model, con), 0, 1e-9, '对齐后偏差归零');

            // 指定锚点：垂直对齐到 X=120
            const tv = useTool('cval');
            app.params.almode = 'point';
            app.params.alpt = 'custom';
            app.params.alx = 120;
            app.params.aly = 0;
            app.params.altol = 8;
            tv.picks = [r.id, c.id];
            tv.applyParams();
            const con2 = app.model.constraints[app.model.constraints.length - 1];
            assert(con2.anchor && con2.anchor.x === 120, '应保存锚点坐标');
            near(C.repPoint(app.model.findById(r.id)).x, 120, 1e-9, '矩形对齐到锚点 X');
            near(C.repPoint(app.model.findById(c.id)).x, 120, 1e-9, '圆对齐到锚点 X');

            // 切回边界对齐后保持原有行为（使用新图形，避免与点对齐约束互相拉扯）
            app.params.almode = 'bounds';
            const r3 = app.model.add({ type: 'rect', x1: 0, y1: 200, x2: 40, y2: 240 });
            const c3 = app.model.add(circle(300, 300, 10));
            const th2 = useTool('chal');
            th2.picks = [r3.id, c3.id];
            th2.applyParams();
            const con3 = app.model.constraints[app.model.constraints.length - 1];
            assert(!con3.pmode, '边界对齐不应写入点对齐字段');
            near(C.deviation(app.model, con3), 0, 1e-9);
            th.deactivate();
            tv.deactivate();
            th2.deactivate();
          }
        },
        {
          name: '相对垂直：锚点 / 正负偏移 / 边界 / 校验 / 跨层级 / 屏幕稳定性',
          run: function () {
            const C = global.CADConstraints;
            const app = mockApp();
            // 参考矩形：x 0~100, y 0~50 → 顶部 50 / 中部 25 / 底部 0
            const ref = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            const mov = app.model.add(line(200, 300, 260, 300));

            // 顶部 +20：目标代表点 Y 应为 70
            const c1 = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'top', offset: 20 });
            assert(c1.type === 'vrel' && c1.anchor === 'top' && c1.offset === 20, '应创建顶部 +20 约束');
            near(C.repPoint(mov).y, 70, 1e-6, '顶部 +20 后目标中点 Y');
            near(C.verticalRelativeY(app.model, c1), 70, 1e-9, 'verticalRelativeY 顶部 +20');
            near(C.deviation(app.model, c1), 0, 1e-9, '求解后偏差归零');

            // 中部 -15：目标代表点 Y 应为 10
            const c2 = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'middle', offset: -15 });
            near(C.repPoint(mov).y, 10, 1e-6, '中部 -15 后目标中点 Y');
            near(C.verticalRelativeY(app.model, c2), 10, 1e-9, 'verticalRelativeY 中部 -15');

            // 底部 +0：目标代表点 Y 应为 0
            const c3 = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'bottom', offset: 0 });
            near(C.repPoint(mov).y, 0, 1e-6, '底部 +0 后目标中点 Y');

            // 默认 anchor=middle、offset=0
            const c4 = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id] });
            assert(c4.anchor === 'middle' && c4.offset === 0, '默认应为中部、零偏移');
            near(C.repPoint(mov).y, 25, 1e-6, '中部零偏移后目标中点 Y');

            // 边界值：±1e6 合法，超出报错
            const cbUp = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'top', offset: 1000000 });
            near(C.verticalRelativeY(app.model, cbUp), 1000050, 1e-6, '上边界 +1e6');
            const cbDown = C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'bottom', offset: -1000000 });
            near(C.verticalRelativeY(app.model, cbDown), -1000000, 1e-6, '下边界 -1e6');

            function expectError(fn, re, msg) {
              let err = null;
              try { fn(); } catch (e) { err = e; }
              assert(err, msg + '：应抛出错误');
              assert(re.test(err.message), msg + '：错误文案应明确');
            }

            const before = app.model.constraints.length;
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'top', offset: 1000001 });
            }, /超出允许范围/, '偏移超上界');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'top', offset: -1000001 });
            }, /超出允许范围/, '偏移超下界');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'top', offset: NaN });
            }, /有效数值/, '非法偏移 NaN');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, ref.id], anchor: 'center', offset: 0 });
            }, /参考位置/, '非法锚点');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, 'missing'], anchor: 'top', offset: 0 });
            }, /参考元素不存在/, '参考元素缺失');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: ['missing', ref.id], anchor: 'top', offset: 0 });
            }, /目标元素不存在/, '目标元素缺失');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id, mov.id], anchor: 'top', offset: 0 });
            }, /不能相同/, '目标与参考相同');
            expectError(function () {
              C.addVerticalRelative(app.model, { ids: [mov.id], anchor: 'top', offset: 0 });
            }, /需要同时指定/, '缺少参考元素');
            assert(app.model.constraints.length === before, '非法约束应回滚，不残留');
            expectError(function () {
              C.verticalRelativeY(app.model, { type: 'vrel', ids: [mov.id, 'missing'], anchor: 'top', offset: 0 });
            }, /参考元素不存在/, 'verticalRelativeY 参数非法');
            assert(C.deviation(app.model, { type: 'vrel', ids: [mov.id, 'missing'], anchor: 'top', offset: 0 }) === null,
              '无效约束偏差应为 null');

            // 跨层级：参考元素在目标之后添加，且为不同结构类型的容器
            const d2 = docWith([line(0, 300, 40, 300)]);
            const target = d2.entities[0];
            const box = d2.add({ type: 'textbox', x1: 10, y1: 100, x2: 30, y2: 200 });
            C.addVerticalRelative(d2, { ids: [target.id, box.id], anchor: 'bottom', offset: 5 });
            near(C.repPoint(target).y, 105, 1e-6, '跨层级容器底部 +5');

            // 跨层级：圆弧参考（不同类型，按圆弧包围盒中部对齐）
            const d3 = docWith([line(0, 0, 20, 0)]);
            const t3 = d3.entities[0];
            const ar = d3.add(arc(100, 80, 20, 0, Math.PI));
            C.addVerticalRelative(d3, { ids: [t3.id, ar.id], anchor: 'middle', offset: 0 });
            const ab = Geo.entityBBox(ar);
            near(C.repPoint(t3).y, (ab.y1 + ab.y2) / 2, 1e-6, '圆弧中部对齐');

            // 屏幕缩放稳定性：只改变视图缩放并重复求解，世界坐标不应漂移
            const app3 = mockApp();
            const r3 = app3.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            const m3 = app3.model.add(line(500, 500, 540, 500));
            C.addVerticalRelative(app3.model, { ids: [m3.id, r3.id], anchor: 'top', offset: 30 });
            const y0 = C.repPoint(m3).y;
            near(y0, 80, 1e-9, '屏幕缩放前位置');
            [0.25, 0.5, 1, 2.5, 8].forEach(function (s) {
              app3.view.scale = s;
              C.solve(app3.model);
              near(C.repPoint(m3).y, y0, 1e-6, '缩放 ' + s + ' 时位置稳定');
            });

            // 删除参考 / 目标后约束应被清理
            const app4 = mockApp();
            const r4 = app4.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            const m4 = app4.model.add(line(0, 50, 10, 50));
            C.addVerticalRelative(app4.model, { ids: [m4.id, r4.id], anchor: 'top', offset: 0 });
            assert(app4.model.constraints.some(function (c) { return c.type === 'vrel'; }), '应存在相对垂直约束');
            app4.model.remove(r4.id);
            app4.model.pruneRefs();
            assert(!app4.model.constraints.some(function (c) { return c.type === 'vrel'; }), '删除参考元素后约束应清理');

            const app4b = mockApp();
            const r4b = app4b.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            const m4b = app4b.model.add(line(0, 50, 10, 50));
            C.addVerticalRelative(app4b.model, { ids: [m4b.id, r4b.id], anchor: 'top', offset: 0 });
            app4b.model.remove(m4b.id);
            app4b.model.pruneRefs();
            assert(!app4b.model.constraints.some(function (c) { return c.type === 'vrel'; }), '删除目标元素后约束应清理');

            // 工具流程：参数、正常应用、非法偏移提示
            const app5 = mockApp();
            const ref5 = app5.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            const mv5 = app5.model.add(line(300, -200, 340, -200));
            const tvrel = useTool('cvrel');
            const fields = tvrel.params();
            assert(fields.some(function (f) { return f.key === 'rvanchor' && f.apply === true; }),
              '参考位置参数应请求确定按钮');
            assert(fields.some(function (f) { return f.key === 'rvoffset'; }), '应有垂直偏移参数');
            app5.params.rvanchor = 'bottom';
            app5.params.rvoffset = 25;
            tvrel.picks = [mv5.id, ref5.id];
            tvrel.applyParams();
            const con5 = app5.model.constraints[app5.model.constraints.length - 1];
            assert(con5.type === 'vrel' && con5.anchor === 'bottom' && con5.offset === 25,
              '工具应创建正确的相对垂直约束');
            near(C.repPoint(mv5).y, 25, 1e-6, '工具底部 +25 定位');

            const count5 = app5.model.constraints.length;
            app5.params.rvoffset = 2000000;
            tvrel.picks = [mv5.id, ref5.id];
            tvrel.applyParams();
            assert(app5.model.constraints.length === count5, '非法偏移不应创建约束');
            assert(app5.toasts.some(function (m) { return /超出允许范围/.test(m); }), '应提示偏移超范围');
            tvrel.deactivate();
          }
        },
        {
          name: '功能徽标说明映射：全部工具覆盖且主题有效',
          run: function () {
            const map = global.CAD_FEATURE_HELP;
            const meta = global.CAD_HELP_META || {};
            assert(map && typeof map === 'object', '应存在功能说明映射');
            const titles = Object.keys(meta);
            assert(titles.length === 37, '功能说明主题应为 37 项，实际 ' + titles.length);
            const tools = global.CADTools.list;
            assert(tools.length > 40, '工具数量应覆盖全部模块，实际 ' + tools.length);
            const missing = [];
            const badTopic = [];
            const badSteps = [];
            tools.forEach(function (t) {
              const e = map[t.id];
              if (!e) { missing.push(t.id); return; }
              if (!e.topic || titles.indexOf(e.topic) < 0) badTopic.push(t.id + ':' + (e.topic || ''));
              if (!Array.isArray(e.steps) || e.steps.length < 2) badSteps.push(t.id);
              (e.related || []).forEach(function (r) {
                if (titles.indexOf(r) < 0) badTopic.push(t.id + '->' + r);
              });
            });
            assert(missing.length === 0, '工具缺少说明映射：' + missing.join(','));
            assert(badTopic.length === 0, '无效说明主题：' + badTopic.join(','));
            assert(badSteps.length === 0, '操作步骤不足：' + badSteps.join(','));
            const extra = Object.keys(map).filter(function (id) {
              return !global.CADTools.byId(id);
            });
            assert(extra.length === 0, '存在无对应工具的映射：' + extra.join(','));
          }
        },
        {
          name: '拉伸精确模式：默认关闭、增量/端点、校验、预览、应用',
          run: function () {
            const T = global.CADTools;
            const Geo = global.Geo;
            // 关键：用 mockApp 会自动执行 CADTools.init(app)，将 tools.js 闭包里的 App 指向 mockApp，
            // 保证 applyParams / onDragStart / onDragMove 等工具方法访问的是同一个 App。
            const app = mockApp();
            const stretch = T.byId('stretch');
            assert(stretch && stretch.id === 'stretch', '应存在拉伸工具');

            // 准备：清空并重置参数
            app.model.clear();
            app.model.selected.clear();
            app.params.stp = false;
            app.params.sdd = 0;
            app.params.sept = 'end';
            stretch.reset();
            stretch.activate();

            function setupCleanup(fn) {
              try { fn(); } finally {
                app.model.clear();
                app.model.selected.clear();
                app.params.stp = false;
                app.params.sdd = 0;
                app.params.sept = 'end';
                if (Array.isArray(app.undo)) app.undo.length = 0;
                if (Array.isArray(app.redo)) app.redo.length = 0;
              }
            }

            function runCase(name, fn) {
              try { setupCleanup(fn); }
              catch (e) { assert(false, name + '：' + (e && e.message) + (e && e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : '')); }
            }

            // ---- 参数默认值与 when 过滤 ----
            runCase('参数默认值与 when 过滤', function () {
              app.model.clear();
              app.model.selected.clear();
              app.params.stp = true;
              const ffields = stretch.params();
              const stpF = ffields.find(function (f) { return f.key === 'stp'; });
              const sddF = ffields.find(function (f) { return f.key === 'sdd'; });
              const septF = ffields.find(function (f) { return f.key === 'sept'; });
              assert(stpF && stpF.def === false, 'stp 默认应为关闭');
              assert(sddF && sddF.min === -1000000 && sddF.max === 1000000, '增量范围 ±1e6');
              assert(sddF.apply === true, '增量字段应有确定按钮');
              assert(sddF.when(app.params) === true, 'stp=true 时 sdd.when 为 true');
              assert(septF.when(app.params) === false, '无选中时 sept.when 为 false');

              const line1 = app.model.add(line(0, 0, 100, 0));
              app.model.selected.add(line1.id);
              assert(septF.when(app.params) === true, '选中直线后 sept.when 为 true');
              app.model.selected.clear();
              const c1 = app.model.add({ type: 'circle', c: { x: 0, y: 0 }, r: 5 });
              app.model.selected.add(c1.id);
              assert(septF.when(app.params) === false, '选中圆后 sept.when 为 false');
            });

            // ---- 互斥：精确模式开启时拖拽不生效 ----
            runCase('精确模式开启时拖拽不生效', function () {
              const line2 = app.model.add(line(10, 10, 30, 10));
              app.params.stp = true;
              const before = { p1x: line2.p1.x, p2x: line2.p2.x };
              stretch.onDragStart({ x: 15, y: 10 });
              stretch.onDragMove({ x: 50, y: 10 });
              stretch.onDragEnd();
              assert(stretch.active !== true, '精确模式下拖拽不应激活');
              assert(line2.p1.x === before.p1x && line2.p2.x === before.p2x, '精确模式下拖拽不应改变端点');
            });

            // ---- 互斥：精确模式关闭时自由拖拽正常 ----
            runCase('精确模式关闭时自由拖拽正常', function () {
              const line3 = app.model.add(line(10, 10, 30, 10));
              app.params.stp = false;
              // 拾取点靠近 p2(30,10) → mode='p2', fixed=p1(10,10), dir=(1,0)
              // 拖拽到右侧 x=60 → p2 被延长到 (60,10)
              stretch.onDragStart({ x: 28, y: 10 });
              assert(stretch.active === true, '自由拖拽应激活');
              stretch.onDragMove({ x: 60, y: 10 });
              stretch.onDragEnd();
              assert(Geo.dist(line3.p1, line3.p2) > 20.01, '自由拖拽应已伸长');
            });

            // ---- applyParams 端到端：直线 +正增量延长终点 ----
            runCase('直线 +30 / -40 增量', function () {
              const ln = app.model.add(line(0, 0, 100, 0));
              app.params.stp = true;
              app.params.sdd = 30;
              app.params.sept = 'end';
              app.model.selected.add(ln.id);
              stretch.applyParams();
              near(ln.p1.x, 0, 1e-6, '固定端点不动');
              near(Geo.dist(ln.p1, ln.p2), 130, 1e-6, '终点 +30 延长到 130');
              near(ln.p2.y, 0, 1e-6, '方向保持水平');

              app.params.sdd = -40;
              app.params.sept = 'start';
              stretch.applyParams();
              near(Geo.dist(ln.p1, ln.p2), 90, 1e-6, '起点 -40 后总长 90');
              near(ln.p2.x, 130, 1e-6, '固定端 p2 位置不变');
              near(ln.p1.x, 40, 1e-6, '起点移动到 (40,0)');
            });

            // ---- 圆增量 ----
            runCase('圆半径 ±增量', function () {
              const ci = app.model.add({ type: 'circle', c: { x: 0, y: 0 }, r: 10 });
              app.params.stp = true;
              app.model.selected.add(ci.id);
              app.params.sdd = 5;
              stretch.applyParams();
              near(ci.r, 15, 1e-6, '圆半径 +5');
              app.params.sdd = -3;
              stretch.applyParams();
              near(ci.r, 12, 1e-6, '圆半径 -3');
            });

            // ---- 圆弧增量（弧长） ----
            runCase('圆弧弧长增量', function () {
              const ar = app.model.add(arc(0, 0, 10, 0, Math.PI / 2));
              const prevSweep = Geo.arcSweep(ar);
              app.params.stp = true;
              app.model.selected.add(ar.id);
              app.params.sdd = Math.PI * 10;
              app.params.sept = 'end';
              stretch.applyParams();
              const newSweep = Geo.arcSweep(ar);
              near(newSweep, prevSweep + Math.PI, 1e-6, '圆弧 sweep 增量正确');
              const normEq = function (a, b) {
                const d = Math.abs(Geo.normAngle(a) - Geo.normAngle(b));
                return d < 1e-6 || Math.abs(d - Geo.TAU) < 1e-6;
              };
              assert(normEq(ar.a0, 0), '修改终点时起始角保持');
            });

            // ---- 校验：超限 / NaN / 退化 ----
            runCase('校验：超限/NaN/退化', function () {
              const ln5 = app.model.add(line(0, 0, 10, 0));
              app.params.stp = true;
              app.model.selected.add(ln5.id);

              const before5 = JSON.stringify(ln5);
              app.params.sdd = 2000000;
              stretch.applyParams();
              assert(JSON.stringify(ln5) === before5, '超限 +2e6 不应修改实体');

              app.params.sdd = -2000000;
              stretch.applyParams();
              assert(JSON.stringify(ln5) === before5, '超限 -2e6 不应修改实体');

              app.params.sdd = 'abc';
              stretch.applyParams();
              assert(JSON.stringify(ln5) === before5, 'NaN 不应修改实体');

              app.params.sdd = -999999;
              app.params.sept = 'end';
              stretch.applyParams();
              assert(JSON.stringify(ln5) === before5, '缩短到 ≤0 不应修改实体');
            });

            // ---- 选中多个 ----
            runCase('选中多个图元', function () {
              const l6 = app.model.add(line(0, 0, 10, 0));
              const c6 = app.model.add({ type: 'circle', c: { x: 20, y: 0 }, r: 3 });
              app.model.selected.add(l6.id); app.model.selected.add(c6.id);
              app.params.stp = true; app.params.sdd = 5;
              const before6 = JSON.stringify(l6);
              stretch.applyParams();
              assert(JSON.stringify(l6) === before6, '多选时不应修改任何实体');
            });

            // ---- 默认 stp=false 时 applyParams 空操作 ----
            runCase('默认 stp=false 时空操作', function () {
              const l7 = app.model.add(line(0, 0, 10, 0));
              app.model.selected.add(l7.id);
              app.params.stp = false; app.params.sdd = 5;
              const before7 = JSON.stringify(l7);
              stretch.applyParams();
              assert(JSON.stringify(l7) === before7, '非精确模式下 applyParams 不生效');
            });

            // ---- onParamChange 钩子存在 ----
            assert(typeof stretch.onParamChange === 'function', '应提供 onParamChange 钩子');
          }
        }
      ]
    },
    {
      name: '组合与分解',
      cases: [
        {
          name: '组合：≥2 个独立图元合并为整体并保留属性',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(circle(20, 0, 5));
            app.model.add(line(100, 0, 120, 0));
            a.style = 'dashed';
            const idA = a.id, idB = b.id;
            const gt = global.CADTools.byId('group');
            assert(gt.enabled() === false, '未选择时组合应不可用');
            app.model.selected.add(idA);
            assert(gt.enabled() === false, '仅 1 个图元时组合应不可用');
            app.model.selected.add(idB);
            assert(gt.enabled() === true, '2 个独立图元时组合应可用');
            assert(gt.apply() === true, '组合应成功');
            assert(app.model.count() === 2, '顶层图元应为 2');
            const g = app.model.entities[0];
            assert(g.type === 'group', '首个位置应为组合对象');
            assert(g.children.length === 2, '组合应包含 2 个子图元');
            assert(g.children[0].id === idA && g.children[1].id === idB, '子图元 id 与顺序应保留');
            assert(g.children[0].style === 'dashed', '子图元样式应保留');
            near(g.children[1].r, 5, 1e-9, '子图元属性应保留');
            assert(app.model.selected.size === 1 && app.model.selected.has(g.id), '组合后应选中整体');
            const hit = app.model.hitTest({ x: 5, y: 0 }, 1);
            assert(hit && hit.id === g.id, '点击子图元应命中组合对象');
            const bb = Geo.entityBBox(g);
            near(bb.x1, 0, 1e-9, '组合包围盒左边界');
            near(bb.x2, 25, 1e-9, '组合包围盒右边界');
            Geo.translateEntity(g, 10, 5);
            near(g.children[0].p1.x, 10, 1e-9, '组合平移应带动子图元');
            near(g.children[1].c.y, 5, 1e-9, '组合平移应带动圆');
          }
        },
        {
          name: '组合：插入位置与文档顺序保持',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(line(0, 10, 10, 10));
            const c = app.model.add(line(0, 20, 10, 20));
            const d = app.model.add(line(0, 30, 10, 30));
            app.model.selected.add(a.id);
            app.model.selected.add(c.id);
            assert(global.CADTools.byId('group').apply() === true, '非相邻图元应可组合');
            const ids = app.model.entities.map(function (e) { return e.id; });
            assert(ids.length === 3, '组合后顶层应为 3 个对象');
            const g = app.model.entities[0];
            assert(g.type === 'group', '组合对象应位于首个被选图元的位置');
            assert(ids[1] === b.id && ids[2] === d.id, '其余图元相对顺序不变');
            assert(g.children[0].id === a.id && g.children[1].id === c.id, '子图元顺序按文档顺序');
          }
        },
        {
          name: '分解：还原独立图元与编辑属性',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(circle(20, 0, 5));
            const c = app.model.add(line(100, 0, 120, 0));
            const idA = a.id, idB = b.id, idC = c.id;
            app.model.selected.add(idA);
            app.model.selected.add(idB);
            assert(global.CADTools.byId('group').apply() === true, '准备组合');
            const g = app.model.entities[0];
            const un = global.CADTools.byId('ungroup');
            assert(un.enabled() === true, '选中组合对象时分解应可用');
            app.model.selected.clear();
            app.model.selected.add(idC);
            assert(un.enabled() === false, '选中普通图元时分解应不可用');
            app.model.selected.clear();
            app.model.selected.add(g.id);
            assert(un.apply() === true, '分解应成功');
            assert(app.model.count() === 3, '顶层图元应恢复为 3');
            const ids = app.model.entities.map(function (e) { return e.id; });
            assert(ids[0] === idA && ids[1] === idB && ids[2] === idC, '子图元应按原顺序插回');
            assert(app.model.entities.every(function (e) { return e.type !== 'group'; }), '不应残留组合对象');
            near(app.model.entities[1].r, 5, 1e-9, '分解后属性保持');
            assert(app.model.selected.size === 2 && app.model.selected.has(idA) &&
              app.model.selected.has(idB), '分解后应全选子图元');
          }
        },
        {
          name: '组合 / 分解：触发条件与空操作保护',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(line(0, 10, 10, 10));
            const gt = global.CADTools.byId('group');
            const un = global.CADTools.byId('ungroup');
            assert(gt.enabled() === false && un.enabled() === false, '空选择时两者均不可用');
            const before = app.model.snapshot();
            assert(gt.apply() === false, '空选择组合应失败');
            assert(app.model.snapshot() === before, '失败时不应改动模型');
            app.model.selected.add(a.id);
            assert(gt.apply() === false, '仅 1 个图元组合应失败');
            assert(app.model.snapshot() === before, '失败时仍不应改动模型');
            assert(app.toasts[app.toasts.length - 1].indexOf('未满足') >= 0, '应给出条件提示');
            app.model.selected.add(b.id);
            assert(gt.apply() === true, '满足条件应成功');
            assert(gt.enabled() === false, '选中组合对象时组合按钮应置灰');
            assert(un.enabled() === true, '选中组合对象时分解按钮应可用');
            assert(un.apply() === true, '分解应成功');
            assert(gt.enabled() === true, '分解出 2 个图元后组合恢复可用');
            assert(un.enabled() === false, '分解后分解按钮应置灰');
          }
        },
        {
          name: '组合 / 分解：撤销快照往返与 id 序号',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(circle(20, 0, 5));
            app.model.add(line(100, 0, 120, 0));
            app.model.selected.add(a.id);
            app.model.selected.add(b.id);
            const before = app.model.snapshot();
            assert(global.CADTools.byId('group').apply() === true, '组合应成功');
            const grouped = app.model.snapshot();
            assert(app.undo.length === 1, '组合应写入 1 条撤销记录');
            assert(app.undo[0] === before, '撤销记录应为组合前快照');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.count() === 3, '撤销后应恢复 3 个顶层图元');
            assert(app.model.entities.every(function (e) { return e.type !== 'group'; }), '撤销后不应残留组合');
            app.model.restoreSnapshot(grouped);
            assert(app.model.count() === 2, '重做后应恢复组合结果');
            const g = app.model.entities[0];
            assert(g.type === 'group' && g.children.length === 2, '重做后组合结构完整');
            app.model.selected.add(g.id);
            assert(global.CADTools.byId('ungroup').apply() === true, '分解应成功');
            assert(app.undo.length === 1, '分解应写入撤销记录');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.entities[0].type === 'group', '撤销分解应恢复组合');
            app.model.restoreSnapshot(before);
            const n = app.model.add(line(200, 0, 210, 0));
            const same = app.model.allEntities().filter(function (e) { return e.id === n.id; });
            assert(same.length === 1, '撤销恢复后新建图元 id 不应与已有冲突');
          }
        },
        {
          name: '组合对象：命中 / 框选 / 镜像 / 复制兼容',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            const b = app.model.add(line(0, 10, 10, 10));
            app.model.selected.add(a.id);
            app.model.selected.add(b.id);
            global.CADTools.byId('group').apply();
            const g = app.model.entities[0];
            let list = app.model.entitiesInRect({ x1: -1, y1: -1, x2: 2, y2: 2 }, true);
            assert(list.length === 1 && list[0].id === g.id, '交叉框选应按子图元命中组合');
            list = app.model.entitiesInRect({ x1: -1, y1: -1, x2: 12, y2: 2 }, false);
            assert(list.length === 0, '窗口框选未覆盖全部子图元时不应命中');
            list = app.model.entitiesInRect({ x1: -1, y1: -1, x2: 12, y2: 12 }, false);
            assert(list.length === 1 && list[0].id === g.id, '全部子图元在内时应选中组合');
            const mg = Geo.mirrorEntity(g, { x: -1, y: 0 }, { x: -1, y: 100 });
            assert(mg && mg.type === 'group' && mg.children.length === 2, '镜像应保留组合结构');
            app.model.add(mg);
            const ids = app.model.allEntities().map(function (e) { return e.id; });
            assert(ids.length === new Set(ids).size, '镜像副本不应复用已有 id');
            const target = Geo.copyShape({}, g);
            assert(target.type === 'group' && target.children.length === 2, '复制应深拷贝组合');
            assert(target.children[0] !== g.children[0], '复制应为独立对象');
            assert(target.children[0].id === g.children[0].id, '原地恢复语义应保留子图元 id');
            assert(Geo.entityEndpoints(g).length === 0, '组合对象不提供端点');
            assert(Geo.entityLength(g) > 0, '组合长度应累加子图元');
            assert(Geo.entityMidpoint(g).y === 5, '组合中点取包围盒中心');
          }
        }
      ]
    },
    {
      name: '元素分解',
      cases: [
        {
          name: '元素分解：矩形拆为 4 条线段且坐标精确',
          run: function () {
            const app = mockApp();
            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50, style: 'dashed' });
            const t = global.CADTools.byId('explode');
            assert(t && t.cat === 'edit', '元素分解应位于编辑模块');
            app.params.scope = 'all';
            assert(t._explode(null) === true, '矩形应可分解');
            assert(app.model.count() === 4, '矩形应拆为 4 条线段');
            const expect = [[0, 0, 100, 0], [100, 0, 100, 50], [100, 50, 0, 50], [0, 50, 0, 0]];
            expect.forEach(function (e, i) {
              const s = app.model.entities[i];
              assert(s.type === 'line', '第 ' + (i + 1) + ' 段应为直线');
              near(s.p1.x, e[0], 1e-9); near(s.p1.y, e[1], 1e-9);
              near(s.p2.x, e[2], 1e-9); near(s.p2.y, e[3], 1e-9);
              assert(s.style === 'dashed', '线型应保留');
              assert(!!s.id, '新线段应分配 id');
            });
            assert(app.undo.length === 1, '分解应写入 1 条撤销记录');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.count() === 1 && app.model.entities[0].type === 'rect', '撤销应恢复原矩形');
          }
        },
        {
          name: '元素分解：闭合轮廓与开放折线的线段数',
          run: function () {
            const app = mockApp();
            app.model.add({
              type: 'poly', closed: true,
              pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }]
            });
            app.model.add({
              type: 'poly', closed: false,
              pts: [{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 30 }]
            });
            app.params.scope = 'all';
            assert(global.CADTools.byId('explode')._explode(null) === true, '轮廓线应可分解');
            assert(app.model.count() === 6, '闭合 4 段 + 开放 2 段');
            const segs = app.model.entities;
            near(segs[0].p1.x, 0, 1e-9, '首段起点 X');
            near(segs[3].p2.x, 0, 1e-9, '闭合段终点回到起点 X');
            near(segs[3].p2.y, 0, 1e-9, '闭合段终点回到起点 Y');
            near(segs[4].p1.x, 100, 1e-9, '开放折线起点 X');
            near(segs[5].p2.x, 140, 1e-9, '开放折线终点 X');
          }
        },
        {
          name: '元素分解：指定区域只分解区域内复合图形',
          run: function () {
            const app = mockApp();
            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            app.model.add({ type: 'rect', x1: 100, y1: 0, x2: 110, y2: 10 });
            app.params.scope = 'region';
            const t = global.CADTools.byId('explode');
            t.applyParams();
            assert(app.model.count() === 2, '区域模式未框选时不应分解');
            assert(t._explode(Geo.normalizeRect(-5, -5, 15, 15)) === true, '区域内矩形应分解');
            assert(app.model.count() === 5, '1 个矩形变 4 段，另一个保留');
            assert(app.model.entities[4].type === 'rect', '区域外矩形保持不变');
            near(app.model.entities[4].x1, 100, 1e-9);
          }
        },
        {
          name: '元素分解：组合对象内部按范围分解且结构保留',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 20, y2: 20 });
            const l = app.model.add(line(50, 0, 60, 0));
            app.model.selected.add(r.id);
            app.model.selected.add(l.id);
            global.CADTools.byId('group').apply();
            app.params.scope = 'all';
            assert(global.CADTools.byId('explode')._explode(null) === true, '组合内矩形应可分解');
            assert(app.model.count() === 1, '组合对象保持为一个顶层对象');
            const g = app.model.entities[0];
            assert(g.type === 'group', '组合结构应保留');
            assert(g.children.length === 5, '4 条线段 + 原直线');
            const last = g.children[4];
            assert(last.type === 'line', '原直线仍存在');
            near(last.p1.x, 50, 1e-9, '原直线坐标不变');
            near(last.p2.y, 0, 1e-9);
          }
        },
        {
          name: '元素分解：不可分解元素保持不变与撤销回滚',
          run: function () {
            const app = mockApp();
            app.model.add(circle(0, 0, 10));
            app.model.add(arc(30, 0, 10, 0, Math.PI / 2));
            app.model.add(line(0, 30, 10, 30));
            app.model.add({
              type: 'spline', handles: [], smooth: 0.5, closed: false,
              pts: [{ x: 0, y: 50 }, { x: 10, y: 60 }, { x: 20, y: 50 }]
            });
            app.params.scope = 'all';
            const t = global.CADTools.byId('explode');
            assert(t._explode(null) === false, '无可分解图形时应失败');
            assert(app.model.count() === 4, '不可分解元素应保持不变');
            assert(app.toasts[app.toasts.length - 1].indexOf('没有可分解') >= 0, '应提示无可分解图形');

            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            const before = app.model.snapshot();
            assert(t._explode(null) === true, '加入矩形后应可分解');
            assert(app.model.count() === 8, '4 个原图元 + 4 条线段');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.snapshot() === before, '撤销应完全恢复分解前状态');
          }
        }
      ]
    },
    {
      name: '填充与平移复制',
      cases: [
        {
          name: '填充：规则填充批量应用且可撤销',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            const c = app.model.add(circle(30, 0, 5));
            const p = app.model.add({ type: 'poly', closed: true, pts: [{ x: 50, y: 0 }, { x: 60, y: 0 }, { x: 55, y: 10 }] });
            const o = app.model.add({ type: 'poly', closed: false, pts: [{ x: 70, y: 0 }, { x: 80, y: 0 }] });
            const l = app.model.add(line(90, 0, 100, 0));
            [r.id, c.id, p.id, o.id, l.id].forEach(function (id) { app.model.selected.add(id); });
            const t = global.CADTools.byId('fill');
            assert(t && t.cat === 'edit', '填充应位于编辑模块');
            app.params.fmode = 'batch';
            app.params.fcolor = 'green';
            const before = app.model.snapshot();
            t.applyParams();
            assert(r.fill === 'green' && c.fill === 'green' && p.fill === 'green', '闭合图形应批量填充');
            assert(!o.fill && !l.fill, '开放轮廓与直线不应填充');
            assert(app.model.selected.size === 5, '批量填充后选择应保持不变');
            assert(app.undo.length === 1, '填充应写入 1 条撤销记录');
            assert(app.toasts[app.toasts.length - 1].indexOf('已填充 3 个') >= 0, '应提示实际填充数量');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.snapshot() === before, '撤销应恢复填充前状态');
          }
        },
        {
          name: '填充：连续填充逐个生效且不支持图形不改动',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
            app.model.add({ type: 'poly', closed: false, pts: [{ x: 30, y: 0 }, { x: 40, y: 0 }] });
            const t = global.CADTools.byId('fill');
            app.params.fmode = 'cont';
            app.params.fcolor = 'purple';
            app.model.selected.clear();
            t.onTap({ x: 0, y: 0 });
            assert(r.fill === 'purple', '连续填充应直接生效');
            assert(app.model.selected.size === 0, '连续填充不应改变选择');
            const snap = app.model.snapshot();
            t.onTap({ x: 200, y: 200 });
            assert(app.model.snapshot() === snap, '空白点按不应改动图形');
            t.onTap({ x: 30, y: 0 });
            assert(!app.model.entities[1].fill, '开放轮廓不应填充');
            assert(app.model.snapshot() === snap, '不支持填充时不应改动图形');
            assert(app.toasts[app.toasts.length - 1].indexOf('不支持填充') >= 0, '应提示不支持填充');
          }
        },
        {
          name: '填充：组合对象内部闭合子图元一并填充',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 20, y2: 20 });
            const l = app.model.add(line(30, 0, 40, 0));
            app.model.selected.add(r.id);
            app.model.selected.add(l.id);
            global.CADTools.byId('group').apply();
            app.params.fmode = 'batch';
            app.params.fcolor = 'orange';
            global.CADTools.byId('fill').applyParams();
            const g = app.model.entities[0];
            assert(g.type === 'group', '组合结构应保留');
            assert(g.children[0].fill === 'orange', '组合内矩形应填充');
            assert(!g.children[1].fill, '组合内直线不应填充');
            assert(app.toasts[app.toasts.length - 1].indexOf('已填充 1 个') >= 0, '数量按实际填充统计');
          }
        },
        {
          name: '平移复制：关闭时保持原逻辑，开启后保留原图并生成副本',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            app.model.selected.add(a.id);
            const t = global.CADTools.byId('move');
            app.params.mto = false;
            app.params.multi = false;
            app.params.mcopy = false;
            app.params.mx = 20;
            app.params.my = 0;
            t.applyParams();
            assert(app.model.count() === 1, '关闭复制时应只平移不复制');
            near(app.model.entities[0].p1.x, 20, 1e-9, '平移逻辑应保持不变');
            app.model.selected.clear();
            app.model.selected.add(app.model.entities[0].id);
            app.params.mcopy = true;
            app.params.mx = 5;
            app.params.my = 5;
            t.applyParams();
            assert(app.model.count() === 2, '开启复制应生成副本');
            const xs = app.model.entities.map(function (e) { return e.p1.x; }).sort(function (m, n) { return m - n; });
            near(xs[0], 20, 1e-9, '原图形应保留在原位置');
            near(xs[1], 25, 1e-9, '副本应位于目标位置');
            assert(app.undo.length === 2, '复制平移写入独立撤销记录');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.count() === 1, '撤销应回到复制前状态');
          }
        },
        {
          name: '平移复制：拖动与移动到模式同样生效',
          run: function () {
            const app = mockApp();
            const a = app.model.add(line(0, 0, 10, 0));
            app.model.selected.add(a.id);
            const t = global.CADTools.byId('move');
            app.params.mto = false;
            app.params.multi = false;
            app.params.mcopy = true;
            t.onDragStart({ x: 0, y: 0 });
            t.onDragMove({ x: 5, y: 5 });
            t.onDragEnd();
            assert(app.model.count() === 2, '拖动复制应生成副本');
            const xs = app.model.entities.map(function (e) { return e.p1.x; }).sort(function (m, n) { return m - n; });
            near(xs[0], 0, 1e-9, '拖动复制的原图应留在起点');
            near(xs[1], 5, 1e-9, '拖动复制的副本应到终点');

            const app2 = mockApp();
            const b = app2.model.add(line(0, 0, 10, 0));
            app2.model.selected.add(b.id);
            app2.params.mcopy = true;
            app2.params.mto = true;
            app2.params.tx = 50;
            app2.params.ty = 50;
            const t2 = global.CADTools.byId('move');
            t2.mtoBase = { x: 0, y: 0 };
            t2.applyParams();
            assert(app2.model.count() === 2, '移动到复制应生成副本');
            assert(app2.toasts[app2.toasts.length - 1].indexOf('原图形已保留') >= 0, '应提示保留原图形');
          }
        },
        {
          name: '平移复制：开关默认关闭并持久化上次设置',
          run: function () {
            const key = 'cad.move.copy';
            let saved = null, ok = true;
            try { saved = localStorage.getItem(key); } catch (e) { ok = false; }
            if (!ok) return;
            try {
              localStorage.removeItem(key);
              mockApp();
              let f = global.CADTools.byId('move').params().filter(function (x) { return x.key === 'mcopy'; })[0];
              assert(f && f.type === 'toggle' && f.label === '复制', '平移面板应有复制开关');
              assert(f.def === false, '复制开关默认应为关闭');
              localStorage.setItem(key, '1');
              mockApp();
              f = global.CADTools.byId('move').params().filter(function (x) { return x.key === 'mcopy'; })[0];
              assert(f.def === true, '应自动恢复上次开启的设置');
              const app = mockApp();
              const t = global.CADTools.byId('move');
              app.params.mcopy = true;
              t.onParamChange('mcopy');
              assert(localStorage.getItem(key) === '1', '开启状态应持久化');
              app.params.mcopy = false;
              t.onParamChange('mcopy');
              assert(localStorage.getItem(key) === '0', '关闭状态应持久化');
            } finally {
              try {
                if (saved === null) localStorage.removeItem(key);
                else localStorage.setItem(key, saved);
              } catch (e) {}
            }
          }
        }
      ]
    },
    {
      name: '比例缩放',
      cases: [
        {
          name: '缩放：百分比输入按包围盒中心等比缩放',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            app.model.selected.add(r.id);
            const t = global.CADTools.byId('scale');
            assert(t && t.cat === 'edit', '缩放应位于编辑模块');
            app.params.slock = false;
            app.params.spct = 200;
            const before = app.model.snapshot();
            t.applyParams();
            const e = app.model.entities[0];
            near(e.x1, -50, 1e-9); near(e.x2, 150, 1e-9);
            near(e.y1, -25, 1e-9); near(e.y2, 75, 1e-9);
            near((e.x2 - e.x1) / (e.y2 - e.y1), 2, 1e-9, '宽高比应保持');
            assert(app.undo.length === 1, '缩放应写入撤销记录');
            assert(app.toasts[app.toasts.length - 1].indexOf('200%') >= 0, '应提示缩放百分比');
            app.model.restoreSnapshot(app.undo.pop());
            assert(app.model.snapshot() === before, '撤销应恢复缩放前状态');
          }
        },
        {
          name: '缩放：拖动角点等比模式保持宽高比',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            app.model.selected.add(r.id);
            const t = global.CADTools.byId('scale');
            app.params.slock = true;
            app.shiftKey = false;
            t.onDragStart({ x: 100, y: 50 });
            assert(t.active === true, '应命中角点并进入缩放');
            t.onDragMove({ x: 200, y: 50 });
            t.onDragEnd();
            const e = app.model.entities[0];
            near(e.x1, 0, 1e-9); near(e.y1, 0, 1e-9);
            near(e.x2, 200, 1e-9); near(e.y2, 100, 1e-9);
            near((e.x2 - e.x1) / (e.y2 - e.y1), 2, 1e-9, '等比缩放宽高比不变');
            assert(app.undo.length === 1, '拖动缩放应写入撤销记录');
            app.model.restoreSnapshot(app.undo.pop());
            near(app.model.entities[0].x2, 100, 1e-9, '撤销应恢复原尺寸');
          }
        },
        {
          name: '缩放：按住 Shift 临时切换等比',
          run: function () {
            const app = mockApp();
            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            app.model.selected.add(app.model.entities[0].id);
            const t = global.CADTools.byId('scale');
            app.params.slock = false;
            app.shiftKey = true;
            t.onDragStart({ x: 100, y: 50 });
            t.onDragMove({ x: 200, y: 50 });
            t.onDragEnd();
            const e = app.model.entities[0];
            near(e.x2, 200, 1e-9);
            near(e.y2, 100, 1e-9);
            near((e.x2 - e.x1) / (e.y2 - e.y1), 2, 1e-9, 'Shift 应强制等比');
          }
        },
        {
          name: '缩放：关闭等比且未按 Shift 时为自由缩放',
          run: function () {
            const app = mockApp();
            app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            app.model.selected.add(app.model.entities[0].id);
            const t = global.CADTools.byId('scale');
            app.params.slock = false;
            app.shiftKey = false;
            t.onDragStart({ x: 100, y: 50 });
            t.onDragMove({ x: 200, y: 25 });
            t.onDragEnd();
            const e = app.model.entities[0];
            near(e.x2, 200, 1e-9);
            near(e.y2, 25, 1e-9);
            assert(Math.abs((e.x2 - e.x1) / (e.y2 - e.y1) - 2) > 1e-6, '自由缩放应允许宽高比变化');
          }
        },
        {
          name: '缩放：多选按整体包围盒统一等比缩放',
          run: function () {
            const app = mockApp();
            const r1 = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 100, y2: 50 });
            const r2 = app.model.add({ type: 'rect', x1: 200, y1: 50, x2: 300, y2: 100 });
            app.model.selected.add(r1.id);
            app.model.selected.add(r2.id);
            app.params.spct = 200;
            const t = global.CADTools.byId('scale');
            t.applyParams();
            near(r1.x1, -150, 1e-9); near(r1.x2, 50, 1e-9);
            near(r1.y1, -50, 1e-9); near(r1.y2, 50, 1e-9);
            near(r2.x1, 250, 1e-9); near(r2.x2, 450, 1e-9);
            near(r2.y1, 50, 1e-9); near(r2.y2, 150, 1e-9);
            assert(app.model.count() === 2, '多选缩放不应改变图元数量');
            assert(app.model.selected.size === 2, '缩放后应保持多选');
          }
        },
        {
          name: '缩放：组合对象内部子图元同步缩放',
          run: function () {
            const app = mockApp();
            const r = app.model.add({ type: 'rect', x1: 0, y1: 0, x2: 20, y2: 20 });
            const l = app.model.add(line(50, 0, 60, 0));
            app.model.selected.add(r.id);
            app.model.selected.add(l.id);
            global.CADTools.byId('group').apply();
            app.params.spct = 200;
            global.CADTools.byId('scale').applyParams();
            const g = app.model.entities[0];
            assert(g.type === 'group', '组合结构应保留');
            const cr = g.children[0];
            near(cr.x2 - cr.x1, 40, 1e-9, '组合内矩形宽度应翻倍');
            const cl = g.children[1];
            near(Geo.dist(cl.p1, cl.p2), 20, 1e-9, '组合内直线长度应翻倍');
            assert(app.model.count() === 1, '缩放不应拆散组合');
          }
        },
        {
          name: '缩放：等比例开关默认关闭并持久化',
          run: function () {
            const key = 'cad.scale.proportional';
            let saved = null, ok = true;
            try { saved = localStorage.getItem(key); } catch (e) { ok = false; }
            if (!ok) return;
            try {
              localStorage.removeItem(key);
              mockApp();
              let fields = global.CADTools.byId('scale').params();
              let f = fields.filter(function (x) { return x.key === 'slock'; })[0];
              const pct = fields.filter(function (x) { return x.key === 'spct'; })[0];
              assert(f && f.type === 'toggle' && f.label === '等比例', '缩放面板应有等比例开关');
              assert(f.def === false, '等比例开关默认应为关闭');
              assert(pct && pct.apply === true, '百分比输入应提供确定按钮');
              localStorage.setItem(key, '1');
              mockApp();
              f = global.CADTools.byId('scale').params().filter(function (x) { return x.key === 'slock'; })[0];
              assert(f.def === true, '应自动恢复上次开启的设置');
              const app = mockApp();
              const t = global.CADTools.byId('scale');
              app.params.slock = true;
              t.onParamChange('slock');
              assert(localStorage.getItem(key) === '1', '开启状态应持久化');
              app.params.slock = false;
              t.onParamChange('slock');
              assert(localStorage.getItem(key) === '0', '关闭状态应持久化');
            } finally {
              try {
                if (saved === null) localStorage.removeItem(key);
                else localStorage.setItem(key, saved);
              } catch (e) {}
            }
          }
        }
      ]
    }
  ];

  global.CADTests = {
    run: function () {
      const out = [];
      suites.forEach(function (s) {
        s.cases.forEach(function (c) {
          try {
            const info = c.run();
            out.push({ suite: s.name, name: c.name, pass: true, info: info || '' });
          } catch (err) {
            out.push({ suite: s.name, name: c.name, pass: false, info: (err && err.message) || String(err) });
          }
        });
      });
      return out;
    },
    suites: suites
  };
})(typeof window !== 'undefined' ? window : globalThis);
