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
          name: '链拾取识别连续相连图元',
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
          name: '直线工具：坐标输入精确生成',
          run: function () {
            const app = mockApp();
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

            const a = useTool('arc');
            a.onTap({ x: 200, y: 0 });
            a.onTap({ x: 210, y: 0 });
            a.onTap({ x: 200, y: 10 });
            const arcEnt = app.model.entities[1];
            assert(arcEnt.type === 'arc', '应创建圆弧');
            near(Geo.arcSweep(arcEnt), Math.PI / 2, 1e-9, '逆时针 90°');
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
          name: '阵列：矩形行列生成副本',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 10, 0));
            app.model.selected.add(app.model.entities[0].id);
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
            app2.params.pcenter = true;
            app2.params.pcx = 0;
            app2.params.pcy = 0;
            const t2 = useTool('array');
            t2.applyParams();
            assert(app2.model.count() === 4, '自定义圆心应生成 3 个副本');
            assert(app2.model.entities.some(function (e) {
              return e.type === 'point' && Math.abs(e.p.x + 10) < 1e-6 && Math.abs(e.p.y - 20) < 1e-6;
            }), '绕指定圆心旋转 90°');

            // 空白处点按拾取圆心
            app2.model.selected.add(app2.model.entities[0].id);
            t2.onTap({ x: 0, y: 0 });
            near(Number(app2.params.pcx), 0, 1e-9);
            near(Number(app2.params.pcy), 0, 1e-9, '点按空白设置圆心');
            assert(app2.model.selected.size === 1, '拾取圆心不应清除对象选择');
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
          name: '链拾取工具',
          run: function () {
            const app = mockApp();
            app.model.add(line(0, 0, 10, 0));
            app.model.add(line(10, 0, 10, 10));
            app.model.add(line(10, 10, 20, 10));
            app.model.add(line(100, 100, 110, 100));
            const t = useTool('chain');
            t.onTap({ x: 5, y: 0 });
            assert(app.model.selected.size === 3, '应选中 3 条相连线段');
            assert(lastInfo(app).html.indexOf('3 个图元') >= 0, '面板应显示链数量');
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
          name: '100 段链拾取耗时',
          run: function () {
            const d = new Doc();
            for (let i = 0; i < 100; i++) d.add(line(i * 10, 0, (i + 1) * 10, 0));
            const t0 = performance.now();
            const set = d.chain(d.entities[50], 1e-6);
            const ms = performance.now() - t0;
            assert(set.size === 100, '应识别全部 100 段');
            assert(ms < 100, '链拾取应在 100ms 内完成，实际 ' + ms.toFixed(1) + 'ms');
            return ms.toFixed(2) + ' ms / 100 段';
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
