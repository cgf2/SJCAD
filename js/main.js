/* 手机CAD · 应用入口：界面、手势、撤销、脚本、联动 */
(function () {
  'use strict';

  const Geo = window.Geo;
  const Doc = window.CADModel.Doc;
  const View = window.CADView.View;
  const Tools = window.CADTools;
  const Renderer = window.CADRenderer;

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('canvas');

  const App = {
    model: new Doc(),
    view: new View(),
    tool: null,
    params: {},
    undoStack: [],
    redoStack: [],
    overlay: null,
    snapInfo: null,
    W: 0,
    H: 0,
    _raf: 0
  };
  window.CADApp = App;

  const renderer = new Renderer(canvas, App);
  App.renderer = renderer;
  Tools.init(App);

  /* ---------------- 基础工具函数 ---------------- */
  function fmt(n) {
    if (!isFinite(n)) return '-';
    return String(Math.round(n * 100) / 100);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  App.refresh = function () {
    if (App._raf) return;
    App._raf = requestAnimationFrame(function () {
      App._raf = 0;
      renderer.draw();
    });
  };

  App.worldTol = function (px) {
    return px / App.view.scale;
  };

  App.pick = function (p) {
    return App.model.hitTest(p, App.worldTol(12));
  };

  App.snapPoint = function (p) {
    const tol = App.worldTol(15);
    let best = null, bestD = tol;
    /** prio 越大越优先：圆心捕捉给 1.6 倍权重，靠近圆/圆弧时优先吸附圆心 */
    function consider(q, type, prio) {
      const d = Geo.dist(p, q) / (prio || 1);
      if (d < bestD) { bestD = d; best = { p: q, type: type }; }
    }
    App.model.entities.forEach(function (e) {
      if (e.type === 'line') {
        consider(e.p1, '端点');
        consider(e.p2, '端点');
        consider(Geo.lerp(e.p1, e.p2, 0.5), '中点');
      } else if (e.type === 'circle') {
        consider(e.c, '圆心', 1.6);
        for (let i = 0; i < 4; i++) consider(Geo.polar(e.c, e.r, i * Math.PI / 2), '象限点');
      } else if (e.type === 'arc') {
        consider(e.c, '圆心', 1.6);
        consider(Geo.arcStart(e), '端点');
        consider(Geo.arcEnd(e), '端点');
        consider(Geo.entityMidpoint(e), '中点');
      } else if (e.type === 'point') {
        consider(e.p, '点');
      }
    });
    // 交点捕捉：只对光标附近的图元两两求交，兼顾精度与性能
    const near = [];
    App.model.entities.forEach(function (e) {
      if (e.type === 'point') return;
      if (Geo.hitDistance(e, p) <= tol) near.push(e);
    });
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        Geo.intersections(near[i], near[j]).forEach(function (q) { consider(q, '交点', 1.4); });
      }
    }
    if (best) {
      App.snapInfo = { p: best.p, type: best.type, t: performance.now() };
      if (App._snapTimer) clearTimeout(App._snapTimer);
      App._snapTimer = setTimeout(function () { App.refresh(); }, 1500);
      return { x: best.p.x, y: best.p.y };
    }
    App.snapInfo = null;
    return { x: p.x, y: p.y };
  };

  /* ---------------- 撤销 / 重做 ---------------- */
  App.begin = function () {
    App.undoStack.push(App.model.snapshot());
    if (App.undoStack.length > 60) App.undoStack.shift();
    App.redoStack.length = 0;
    updateHistoryUI();
  };

  App.end = function () {
    updateHistoryUI();
    updateCount();
    App.refresh();
  };

  App.abort = function () {
    App.undoStack.pop();
    updateHistoryUI();
    App.refresh();
  };

  App.undo = function () {
    if (!App.undoStack.length) { App.toast('没有可撤销的操作'); return; }
    App.redoStack.push(App.model.snapshot());
    App.model.restoreSnapshot(App.undoStack.pop());
    pruneSelection();
    App.overlay = null;
    updateCount();
    updateHistoryUI();
    App.afterSelectionChange();
    App.refreshPropsPanel();
    App.updatePrompt();
    App.toast('已撤销');
  };

  App.redo = function () {
    if (!App.redoStack.length) { App.toast('没有可重做的操作'); return; }
    App.undoStack.push(App.model.snapshot());
    App.model.restoreSnapshot(App.redoStack.pop());
    pruneSelection();
    App.overlay = null;
    updateCount();
    updateHistoryUI();
    App.afterSelectionChange();
    App.refreshPropsPanel();
    App.updatePrompt();
    App.toast('已重做');
  };

  function pruneSelection() {
    Array.from(App.model.selected).forEach(function (id) {
      if (!App.model.findById(id)) App.model.selected.delete(id);
    });
  }

  /* ---------------- 提示 / 面板 ---------------- */
  App.updatePrompt = function () {
    if (!App.tool) return;
    $('toolBadge').textContent = App.tool.name;
    const text = typeof App.tool.prompt === 'function' ? App.tool.prompt() : App.tool.prompt;
    $('promptText').textContent = (text || '') + ' · 双指缩放/平移';
  };

  function fieldError(f, raw) {
    if (raw === '' || raw == null) return '请输入数值';
    const v = Number(raw);
    if (!isFinite(v)) return '请输入有效数字';
    if (f.positive && !(v > 0)) return '需大于 0';
    if (f.min != null && v < f.min) return '不能小于 ' + f.min;
    return '';
  }

  function markParam(input, f) {
    const msg = fieldError(f, input.value);
    input.classList.toggle('invalid', !!msg);
    return msg;
  }

  App.updateParams = function () {
    const row = $('paramRow');
    row.innerHTML = '';
    const raw = App.tool && App.tool.params ? App.tool.params() : [];
    const fields = raw.filter(function (f) {
      return typeof f.when !== 'function' || f.when(App.params);
    });
    if (!fields.length) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    const groups = [], map = {};
    fields.forEach(function (f) {
      const isNum = !f.type || f.type === 'number';
      if (isNum) {
        if (App.params[f.key] === undefined || App.params[f.key] === '') App.params[f.key] = f.def;
      } else if (App.params[f.key] === undefined) {
        App.params[f.key] = f.def;
      }
      const gname = f.group || '';
      let g = map[gname];
      if (!g) { g = { name: gname, fields: [] }; map[gname] = g; groups.push(g); }
      g.fields.push(f);
    });
    function notifyParam(f) {
      if (typeof App.tool.onParamChange === 'function') App.tool.onParamChange(f.key, App.params[f.key]);
      if (f.type === 'choice' || f.type === 'toggle') App.updateParams();
      App.updatePrompt();
      App.refresh();
    }
    groups.forEach(function (g) {
      const box = document.createElement('div');
      box.className = 'param-group';
      if (g.name) {
        const gl = document.createElement('div');
        gl.className = 'param-group-label';
        gl.textContent = g.name;
        box.appendChild(gl);
      }
      const fw = document.createElement('div');
      fw.className = 'param-fields';
      g.fields.forEach(function (f) {
        if (f.type === 'toggle') {
          const wrap = document.createElement('div');
          wrap.className = 'param-field switch-field';
          const text = document.createElement('span');
          text.className = 'switch-text';
          text.textContent = f.label;
          const sw = document.createElement('label');
          sw.className = 'switch';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.key = f.key;
          cb.checked = !!App.params[f.key];
          cb.addEventListener('change', function () {
            App.params[f.key] = cb.checked;
            notifyParam(f);
          });
          const track = document.createElement('span');
          track.className = 'track';
          sw.appendChild(cb);
          sw.appendChild(track);
          wrap.appendChild(text);
          wrap.appendChild(sw);
          fw.appendChild(wrap);
          return;
        }
        if (f.type === 'choice') {
          const wrap = document.createElement('div');
          wrap.className = 'param-field param-choice';
          const seg = document.createElement('div');
          seg.className = 'seg';
          (f.options || []).forEach(function (opt) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'seg-btn' + (App.params[f.key] === opt.v ? ' active' : '');
            b.textContent = opt.label;
            b.dataset.value = opt.v;
            b.addEventListener('click', function () {
              App.params[f.key] = opt.v;
              const all = seg.querySelectorAll('.seg-btn');
              for (let i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === b);
              notifyParam(f);
            });
            seg.appendChild(b);
          });
          wrap.appendChild(seg);
          fw.appendChild(wrap);
          return;
        }
        const wrap = document.createElement('div');
        wrap.className = 'param-field';
        const label = document.createElement('label');
        label.textContent = f.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        input.dataset.key = f.key;
        input.dataset.kind = 'number';
        input.value = App.params[f.key];
        input.addEventListener('input', function () {
          App.params[f.key] = input.value;
          markParam(input, f);
          App.refresh();
        });
        wrap.appendChild(label);
        wrap.appendChild(input);
        fw.appendChild(wrap);
      });
      box.appendChild(fw);
      row.appendChild(box);
    });
    if (typeof App.tool.applyParams === 'function') {
      const btn = document.createElement('button');
      btn.className = 'param-apply';
      btn.textContent = '确定';
      btn.addEventListener('click', function () {
        let bad = null;
        row.querySelectorAll('input[data-kind="number"]').forEach(function (input) {
          const f = fields.filter(function (fd) { return fd.key === input.dataset.key; })[0];
          const msg = f ? markParam(input, f) : '';
          if (msg && !bad) bad = msg;
        });
        if (bad) { App.toast('输入不合法：' + bad); return; }
        App.tool.applyParams();
        App.updatePrompt();
        App.refresh();
      });
      row.appendChild(btn);
    }
  };

  App.toast = function (msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (App._toastTimer) clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 1600);
  };

  let propsDirty = false;
  App.propsEntId = null;

  function endPropsSession() {
    if (!propsDirty) return;
    propsDirty = false;
    App.end();
  }

  function propNum(v) { return String(Math.round(v * 1000) / 1000); }

  function propInput(label, key, value) {
    return '<div class="row edit"><span class="k">' + label + '</span>' +
      '<input class="prop-input" type="number" inputmode="decimal" step="any" data-k="' + key +
      '" value="' + propNum(value) + '" aria-label="' + label + '"></div>';
  }

  function propOut(label, key, value) {
    return '<div class="row"><span class="k">' + label + '</span>' +
      '<span class="v" data-out="' + key + '">' + value + '</span></div>';
  }

  function propsHtml(ent) {
    const names = { line: '直线', circle: '圆', arc: '圆弧', point: '点' };
    let html = '<div class="row"><span class="k">类型</span><span class="v">' + (names[ent.type] || ent.type) + '</span></div>';
    if (ent.type === 'line') {
      html += propInput('起点 X', 'x1', ent.p1.x) + propInput('起点 Y', 'y1', ent.p1.y);
      html += propInput('终点 X', 'x2', ent.p2.x) + propInput('终点 Y', 'y2', ent.p2.y);
      html += propOut('长度', 'len', fmt(Geo.dist(ent.p1, ent.p2)));
      html += propOut('倾角', 'ang', fmt(Geo.deg(Geo.normAngle(Geo.lineAngle(ent)))) + '°');
    } else if (ent.type === 'circle') {
      html += propInput('圆心 X', 'cx', ent.c.x) + propInput('圆心 Y', 'cy', ent.c.y);
      html += propInput('半径', 'r', ent.r);
      html += propOut('直径', 'dia', fmt(ent.r * 2));
      html += propOut('周长', 'circ', fmt(Geo.TAU * ent.r));
    } else if (ent.type === 'arc') {
      html += propInput('圆心 X', 'cx', ent.c.x) + propInput('圆心 Y', 'cy', ent.c.y);
      html += propInput('半径', 'r', ent.r);
      html += propInput('起始角°', 'a0', Geo.deg(Geo.normAngle(ent.a0)));
      html += propInput('终止角°', 'a1', Geo.deg(Geo.normAngle(ent.a1)));
      html += propOut('圆心角', 'sw', fmt(Geo.deg(Geo.arcSweep(ent))) + '°');
      html += propOut('弧长', 'arclen', fmt(Geo.arcSweep(ent) * ent.r));
      html += propOut('方向', 'dir', ent.ccw ? '逆时针' : '顺时针');
    } else if (ent.type === 'point') {
      html += propInput('X', 'x', ent.p.x) + propInput('Y', 'y', ent.p.y);
    }
    html += '<div class="prop-tip">修改数值即时生效，可撤销</div>';
    html += '<div id="propError" class="prop-error hidden"></div>';
    return html;
  }

  function updatePropsOutputs(ent) {
    const map = {};
    if (ent.type === 'line') {
      map.len = fmt(Geo.dist(ent.p1, ent.p2));
      map.ang = fmt(Geo.deg(Geo.normAngle(Geo.lineAngle(ent)))) + '°';
    } else if (ent.type === 'circle') {
      map.dia = fmt(ent.r * 2);
      map.circ = fmt(Geo.TAU * ent.r);
    } else if (ent.type === 'arc') {
      map.sw = fmt(Geo.deg(Geo.arcSweep(ent))) + '°';
      map.arclen = fmt(Geo.arcSweep(ent) * ent.r);
      map.dir = ent.ccw ? '逆时针' : '顺时针';
    }
    const body = $('infoBody');
    Object.keys(map).forEach(function (k) {
      const el = body.querySelector('[data-out="' + k + '"]');
      if (el) el.textContent = map[k];
    });
  }

  App.showProps = function (ent) {
    App.showInfo('图形属性', propsHtml(ent));
    App.propsEntId = ent.id;
  };

  App.refreshPropsPanel = function () {
    if (!App.propsEntId) return;
    const ent = App.model.findById(App.propsEntId);
    if (!ent) { App.hideInfo(); return; }
    $('infoTitle').textContent = '图形属性';
    $('infoBody').innerHTML = propsHtml(ent);
    $('infoPanel').classList.remove('hidden');
    $('selBar').classList.add('hidden');
  };

  function setPropError(input, msg) {
    input.classList.toggle('invalid', !!msg);
    const box = $('propError');
    if (box) {
      box.textContent = msg || '';
      box.classList.toggle('hidden', !msg);
    }
  }

  function onPropInput(e) {
    const input = e.target;
    if (!input || !input.dataset || !input.dataset.k || !App.propsEntId) return;
    const ent = App.model.findById(App.propsEntId);
    if (!ent) return;
    const check = Geo.setEntityProp(ent, input.dataset.k, input.value, true);
    if (!check.ok) { setPropError(input, check.error); return; }
    setPropError(input, '');
    if (!propsDirty) { propsDirty = true; App.begin(); }
    Geo.setEntityProp(ent, input.dataset.k, input.value, false);
    updatePropsOutputs(ent);
    App.refresh();
  }

  App.showInfo = function (title, html) {
    endPropsSession();
    App.propsEntId = null;
    $('infoTitle').textContent = title;
    $('infoBody').innerHTML = html;
    $('infoPanel').classList.remove('hidden');
    $('selBar').classList.add('hidden');
  };

  App.hideInfo = function () {
    endPropsSession();
    App.propsEntId = null;
    $('infoPanel').classList.add('hidden');
    updateSelBar();
  };

  App.setOverlay = function (ov) {
    App.overlay = ov;
    App.refresh();
  };

  App.entityInfo = function (ent, withId) {
    const names = { line: '直线', circle: '圆', arc: '圆弧', point: '点' };
    function row(k, v) {
      return '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
    }
    let html = row('类型', names[ent.type] || ent.type);
    if (withId) html += row('ID', escapeHtml(ent.id));
    if (ent.type === 'line') {
      html += row('起点', '(' + fmt(ent.p1.x) + ', ' + fmt(ent.p1.y) + ')');
      html += row('终点', '(' + fmt(ent.p2.x) + ', ' + fmt(ent.p2.y) + ')');
      html += row('长度', fmt(Geo.dist(ent.p1, ent.p2)));
      html += row('倾角', fmt(Geo.deg(Geo.normAngle(Geo.lineAngle(ent)))) + '°');
    } else if (ent.type === 'circle') {
      html += row('圆心', '(' + fmt(ent.c.x) + ', ' + fmt(ent.c.y) + ')');
      html += row('半径', fmt(ent.r));
      html += row('直径', fmt(ent.r * 2));
      html += row('周长', fmt(Geo.TAU * ent.r));
    } else if (ent.type === 'arc') {
      html += row('圆心', '(' + fmt(ent.c.x) + ', ' + fmt(ent.c.y) + ')');
      html += row('半径', fmt(ent.r));
      html += row('起始角', fmt(Geo.deg(Geo.normAngle(ent.a0))) + '°');
      html += row('终止角', fmt(Geo.deg(Geo.normAngle(ent.a1))) + '°');
      html += row('圆心角', fmt(Geo.deg(Geo.arcSweep(ent))) + '°');
      html += row('弧长', fmt(Geo.arcSweep(ent) * ent.r));
      html += row('方向', ent.ccw ? '逆时针' : '顺时针');
    } else if (ent.type === 'point') {
      html += row('坐标', '(' + fmt(ent.p.x) + ', ' + fmt(ent.p.y) + ')');
    }
    return html;
  };

  /* ---------------- 工具切换 ---------------- */
  App.setTool = function (id) {
    const next = Tools.byId(id);
    if (!next) return;
    if (App.tool === next) {
      App.tool.reset();
      App.overlay = null;
      App.snapInfo = null;
      updateToolChips();
      App.updatePrompt();
      App.updateParams();
      App.toast('已重置「' + next.name + '」');
      App.refresh();
      return;
    }
    if (App.tool) App.tool.deactivate();
    App.tool = next;
    next.activate();
    App.overlay = null;
    App.snapInfo = null;
    App.hideInfo();
    updateToolChips();
    App.updatePrompt();
    App.updateParams();
    updateSelBar();
    App.refresh();
  };

  function updateToolChips() {
    const chips = document.querySelectorAll('.tool-chip');
    for (let i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', App.tool && chips[i].dataset.id === App.tool.id);
    }
    const vbtns = document.querySelectorAll('.vbtn');
    for (let i = 0; i < vbtns.length; i++) {
      vbtns[i].classList.toggle('active', vbtns[i].dataset.view === 'pan' && App.tool && App.tool.id === 'pan');
    }
  }

  /* ---------------- 选中态 / 视野 ---------------- */
  App.afterSelectionChange = function () {
    updateSelBar();
    App.refresh();
  };

  function updateSelBar() {
    const n = App.model.selected.size;
    const bar = $('selBar');
    if (n > 0 && $('infoPanel').classList.contains('hidden')) {
      bar.classList.remove('hidden');
      $('selInfo').textContent = '已选 ' + n + ' 个图元';
    } else {
      bar.classList.add('hidden');
    }
    App.refresh();
  }

  App.zoomFit = function () {
    if (!App.model.entities.length) {
      App.view.scale = 1.6;
      App.view.tx = App.W / 2;
      App.view.ty = App.H / 2;
    } else {
      App.view.fit(App.model.bbox(), App.W, App.H, 70);
    }
    App.refresh();
  };

  function updateCount() {
    $('entCount').textContent = App.model.count() + ' 图元';
  }

  function updateHistoryUI() {
    $('btnUndo').disabled = !App.undoStack.length;
    $('btnRedo').disabled = !App.redoStack.length;
  }

  /* ---------------- 画布尺寸 ---------------- */
  function resize() {
    const oldW = App.W, oldH = App.H;
    const center = oldW && oldH ? App.view.toWorld({ x: oldW / 2, y: oldH / 2 }) : null;
    const size = renderer.resize();
    App.W = size.W;
    App.H = size.H;
    if (center) {
      App.view.tx = App.W / 2 - center.x * App.view.scale;
      App.view.ty = App.H / 2 + center.y * App.view.scale;
    } else {
      App.view.tx = App.W / 2;
      App.view.ty = App.H / 2;
    }
    App.refresh();
  }

  /* ---------------- 示例图形 ---------------- */
  function seed() {
    const ents = [
      { type: 'line', p1: { x: 0, y: 0 }, p2: { x: 180, y: 0 } },
      { type: 'line', p1: { x: 180, y: 0 }, p2: { x: 180, y: 110 } },
      { type: 'line', p1: { x: 0, y: 110 }, p2: { x: 180, y: 110 } },
      { type: 'circle', c: { x: 90, y: 55 }, r: 28 },
      { type: 'arc', c: { x: 0, y: 0 }, r: 46, a0: 0, a1: Math.PI / 2, ccw: true }
    ];
    ents.forEach(function (e) { App.model.add(e); });
    updateCount();
  }

  /* ---------------- 指针手势 ---------------- */
  const pointers = new Map();
  let pinch = null;
  let down = null;
  let dragging = false;
  let previewing = false;
  let multi = false;
  let lastTap = null;
  let panLast = null;

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function worldAtScreen(sp) { return App.view.toWorld(sp); }

  function pinchState() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[1];
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    const sp = localPoint(e);
    pointers.set(e.pointerId, sp);

    if (pointers.size === 1) {
      down = {
        screen: sp,
        world: worldAtScreen(sp),
        time: performance.now(),
        moved: false
      };
      dragging = false;
      previewing = false;
      multi = false;
    } else if (pointers.size === 2) {
      if (dragging && App.tool && App.tool.onDragCancel) App.tool.onDragCancel();
      dragging = false;
      previewing = false;
      multi = true;
      const st = pinchState();
      const pts = Array.from(pointers.values());
      pinch = {
        scale: App.view.scale,
        tx: App.view.tx,
        ty: App.view.ty,
        dist: st.dist,
        mid: st.mid,
        midStart: st.mid
      };
      if (App._snapTimer) clearTimeout(App._snapTimer);
      App.snapInfo = null;
      App.refresh();
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    const sp = localPoint(e);
    pointers.set(e.pointerId, sp);

    if (pointers.size >= 2) {
      const st = pinchState();
      if (st && pinch) {
        App.view.applyPinch(
          { scale: pinch.scale, tx: pinch.tx, ty: pinch.ty, dist: pinch.dist, mid: pinch.mid },
          st.mid, st.dist
        );
        App.refresh();
      }
      return;
    }

    if (!down) return;
    const dx = sp.x - down.screen.x;
    const dy = sp.y - down.screen.y;
    const movedEnough = Math.hypot(dx, dy) > 7;

    if (!movedEnough && !dragging && !previewing) {
      // 尚未越过阈值：顺手刷新悬停预览
      const p = App.snapPoint(worldAtScreen(sp));
      if (App.tool && App.tool.onHover) App.tool.onHover(p);
      if (App.tool && App.tool.dragType === 'preview') App.refresh();
      return;
    }
    down.moved = true;

    const dragType = App.tool ? App.tool.dragType : 'pan';

    if (dragType === 'tool') {
      if (!dragging) {
        dragging = true;
        if (App.tool.onDragStart) App.tool.onDragStart(down.world);
      }
      if (App.tool.onDragMove) {
        const world = worldAtScreen(sp);
        const p = App.tool.id === 'stretch' ? App.snapPoint(world) : world;
        if (App.tool.onHover) App.tool.onHover(p);
        App.tool.onDragMove(p);
      }
    } else if (dragType === 'preview') {
      previewing = true;
      const p = App.snapPoint(worldAtScreen(sp));
      if (App.tool.onHover) App.tool.onHover(p);
      App.refresh();
    } else {
      // 平移视图
      if (!dragging) {
        dragging = true;
        panLast = sp;
      }
      if (panLast) {
        App.view.pan(sp.x - panLast.x, sp.y - panLast.y);
        panLast = sp;
      }
      App.refresh();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const sp = localPoint(e);
    pointers.delete(e.pointerId);

    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) { down = null; multi = false; }
      return;
    }

    if (!down) return;

    if (dragging) {
      dragging = false;
      panLast = null;
      if (App.tool && App.tool.onDragEnd) App.tool.onDragEnd(worldAtScreen(sp));
      down = null;
      App.updatePrompt();
      return;
    }

    if (previewing) {
      previewing = false;
      down = null;
      App.refresh();
      return;
    }

    // 点按
    const isTap = !down.moved && (performance.now() - down.time) < 900 && pointers.size === 0;
    if (isTap && !multi) {
      handleTap(worldAtScreen(sp), sp);
    }
    if (pointers.size === 0) { down = null; multi = false; }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', function (e) {
    pointers.delete(e.pointerId);
    if (pinch) pinch = null;
    if (dragging && App.tool && App.tool.onDragCancel) App.tool.onDragCancel();
    dragging = false;
    previewing = false;
    down = null;
    multi = false;
    App.refresh();
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function handleTap(world, screen) {
    if (!App.tool) return;
    const hit = App.pick(world);
    const now = performance.now();

    // 双击空白：自适应（选择工具下）
    if (lastTap && now - lastTap.t < 320 &&
        Math.hypot(screen.x - lastTap.x, screen.y - lastTap.y) < 30 &&
        !hit && !lastTap.hit && App.tool.id === 'select') {
      lastTap = null;
      App.zoomFit();
      App.toast('视图已自适应');
      return;
    }

    const p = App.snapPoint(world);
    App.tool.onTap(p);
    lastTap = { t: now, x: screen.x, y: screen.y, hit: !!hit };
    App.updatePrompt();
    updateCount();
    App.refresh();
  }

  /* ---------------- 脚本 ---------------- */
  const scriptModal = $('scriptModal');
  const scriptInput = $('scriptInput');

  function openScript() {
    scriptModal.classList.remove('hidden');
    if (!scriptInput.value.trim()) scriptInput.value = window.CADScript.SAMPLE;
    scriptInput.focus();
  }

  function runScript() {
    const text = scriptInput.value;
    if (!text.trim()) { App.toast('请输入脚本命令'); return; }
    const before = App.model.entities.length;
    App.begin();
    const rep = window.CADScript.run(text, App.model);
    const changed = App.model.entities.length !== before || rep.updated > 0 || rep.deleted > 0;
    if (changed) {
      App.end();
      updateCount();
      pruneSelection();
      App.overlay = null;
      App.afterSelectionChange();
      App.refreshPropsPanel();
    } else {
      App.abort();
    }
    if (rep.errors.length) {
      let html = '<div class="row"><span class="k">新建 / 修改 / 删除</span><span class="v">' +
        rep.created + ' / ' + rep.updated + ' / ' + rep.deleted + '</span></div>';
      rep.errors.forEach(function (err) {
        html += '<div class="row"><span class="k">第 ' + err.line + ' 行</span><span class="v">' +
          escapeHtml(err.message) + '</span></div>';
      });
      html += '<div class="hint">请检查命令名与参数个数（空格或逗号分隔）；修改已有图形用 set/move/del + 图元序号。</div>';
      App.showInfo('脚本执行结果', html);
      App.refresh();
      return;
    }
    scriptModal.classList.add('hidden');
    App.toast('脚本执行完成：新建 ' + rep.created + '，修改 ' + rep.updated + '，删除 ' + rep.deleted);
    if (rep.created > 0) App.zoomFit();
  }

  /* ---------------- 菜单 / 导入导出 ---------------- */
  function openMenu() { $('menuSheet').classList.remove('hidden'); }
  function closeMenu() { $('menuSheet').classList.add('hidden'); }

  function exportJSON() {
    const data = JSON.stringify({ version: 1, entities: App.model.entities }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'cad-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    closeMenu();
    App.toast('已导出 JSON');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : data.entities;
        if (!Array.isArray(list)) throw new Error('缺少 entities 数组');
        const valid = list.filter(function (e) {
          return e && ['line', 'circle', 'arc', 'point'].indexOf(e.type) >= 0;
        });
        if (!valid.length) throw new Error('没有可识别的图元');
        App.begin();
        App.model.clear();
        valid.forEach(function (e) { delete e.id; App.model.add(e); });
        App.end();
        updateCount();
        App.zoomFit();
        App.toast('已导入 ' + valid.length + ' 个图元');
      } catch (err) {
        App.toast('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!App.model.entities.length) { App.toast('画布已为空'); return; }
    if (!window.confirm('确定清空画布上的所有图形？')) return;
    App.begin();
    App.model.clear();
    App.overlay = null;
    App.end();
    App.afterSelectionChange();
    App.zoomFit();
    App.toast('画布已清空');
  }

  /* ---------------- 界面事件绑定 ---------------- */
  document.querySelectorAll('#tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#tabs .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderToolRow(btn.dataset.tab);
    });
  });

  function renderToolRow(tab) {
    const row = $('toolRow');
    row.innerHTML = '';
    Tools.list.filter(function (t) { return t.cat === tab; }).forEach(function (t) {
      const b = document.createElement('button');
      b.className = 'tool-chip';
      b.dataset.id = t.id;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = t.icon;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = t.name;
      b.appendChild(ic);
      b.appendChild(nm);
      b.addEventListener('click', function () { App.setTool(t.id); });
      row.appendChild(b);
    });
    updateToolChips();
  }

  document.querySelectorAll('#viewDock .vbtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const act = btn.dataset.view;
      if (act === 'in') App.view.zoomCenter(1.3, App.W, App.H);
      else if (act === 'out') App.view.zoomCenter(1 / 1.3, App.W, App.H);
      else if (act === 'fit') { App.zoomFit(); App.toast('视图已自适应'); return; }
      else if (act === 'pan') {
        if (App.tool && App.tool.id === 'pan') App.setTool(App._prevTool || 'select');
        else { App._prevTool = App.tool ? App.tool.id : 'select'; App.setTool('pan'); }
        return;
      }
      App.refresh();
    });
  });

  $('btnUndo').addEventListener('click', App.undo);
  $('btnRedo').addEventListener('click', App.redo);
  $('btnScript').addEventListener('click', openScript);
  $('btnMenu').addEventListener('click', openMenu);
  $('scriptClose').addEventListener('click', function () { scriptModal.classList.add('hidden'); });
  $('scriptRun').addEventListener('click', runScript);
  $('scriptSample').addEventListener('click', function () { scriptInput.value = window.CADScript.SAMPLE; });
  $('infoClose').addEventListener('click', App.hideInfo);
  $('infoBody').addEventListener('input', onPropInput);
  $('infoBody').addEventListener('focusout', function (e) {
    if (e.target && e.target.dataset && e.target.dataset.k) endPropsSession();
  });
  $('helpClose').addEventListener('click', function () { $('helpModal').classList.add('hidden'); });
  $('btnSelDelete').addEventListener('click', function () {
    if (!App.model.selected.size) return;
    App.begin();
    Array.from(App.model.selected).forEach(function (id) { App.model.remove(id); });
    App.end();
    App.overlay = null;
    App.afterSelectionChange();
    App.toast('已删除选中图形');
  });
  $('btnSelClear').addEventListener('click', function () {
    App.model.selected.clear();
    App.afterSelectionChange();
  });

  $('menuSheet').addEventListener('click', function (e) {
    if (e.target.id === 'menuSheet') closeMenu();
  });

  $('importFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (file) importJSON(file);
    e.target.value = '';
  });

  document.querySelectorAll('.sheet-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const act = btn.dataset.act;
      if (act === 'script') { closeMenu(); openScript(); }
      else if (act === 'grid') {
        renderer.grid = !renderer.grid;
        btn.textContent = '网格显示：' + (renderer.grid ? '开' : '关');
        App.refresh();
      } else if (act === 'export') exportJSON();
      else if (act === 'import') $('importFile').click();
      else if (act === 'help') { closeMenu(); $('helpModal').classList.remove('hidden'); }
      else if (act === 'test') { window.location.href = 'test.html'; }
      else if (act === 'clear') { closeMenu(); clearAll(); }
      else if (act === 'close') closeMenu();
    });
  });

  $('scriptModal').addEventListener('click', function (e) {
    if (e.target.id === 'scriptModal') scriptModal.classList.add('hidden');
  });
  $('helpModal').addEventListener('click', function (e) {
    if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden');
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 260); });

  /* ---------------- 启动 ---------------- */
  resize();
  seed();
  // 默认展示编辑页签与选择工具
  document.querySelectorAll('#tabs .tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === 'edit');
  });
  renderToolRow('edit');
  App.setTool('select');
  App.zoomFit();
  updateHistoryUI();
  updateCount();
  App.refresh();

  // 对外脚本 API
  window.CAD = {
    app: App,
    model: App.model,
    view: App.view,
    script: function (text) {
      const rep = window.CADScript.run(text, App.model);
      updateCount();
      pruneSelection();
      App.afterSelectionChange();
      App.refreshPropsPanel();
      App.refresh();
      return rep;
    },
    setTool: App.setTool,
    zoomFit: App.zoomFit,
    undo: App.undo,
    redo: App.redo,
    tools: Tools.list
  };
})();
