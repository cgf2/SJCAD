/* 手机CAD · 脚本绘图引擎
 * 每行一条命令，数值可用空格或逗号分隔，角度单位为度。
 * line x1 y1 x2 y2
 * circle cx cy r
 * arc cx cy r a0 a1 [ccw]
 * point x y
 * angle x y angle length        （角度线）
 * set 序号 参数 值 [参数 值 ...]  （修改画布内已有图形，序号从 1 开始）
 * move 序号 dx dy               （平移已有图形）
 * del 序号                      （删除已有图形）
 * clear
 */
(function (global) {
  'use strict';
  const DEG = Math.PI / 180;

  function parseLine(text) {
    const s = text.replace(/#.*$/, '').trim();
    if (!s) return null;
    const tokens = s.replace(/,/g, ' ').split(/\s+/);
    const cmd = tokens.shift().toLowerCase();
    const nums = tokens.map(Number);
    return { cmd: cmd, tokens: tokens, nums: nums, raw: s };
  }

  /** 按 1 起的序号读取当前画布内的图元 */
  function entityAt(doc, idx) {
    const i = Math.round(idx) - 1;
    const list = doc.entities || [];
    if (!(idx >= 1) || i >= list.length) {
      throw new Error('图元序号需在 1~' + list.length + ' 之间');
    }
    return list[i];
  }

  function run(text, doc) {
    const report = { created: 0, updated: 0, deleted: 0, errors: [], commands: 0 };
    function add(ent) { doc.add(ent); report.created++; }
    const lines = String(text == null ? '' : text).split(/[\n;]/);

    lines.forEach(function (line, index) {
      const parsed = parseLine(line);
      if (!parsed) return;
      report.commands++;
      const cmd = parsed.cmd;
      const n = parsed.nums;
      const tokens = parsed.tokens;
      function need(count) {
        if (n.length < count || n.slice(0, count).some(function (v) { return !isFinite(v); })) {
          throw new Error('参数需要 ' + count + ' 个有效数字');
        }
      }
      try {
        if (cmd === 'line') {
          need(4);
          add({ type: 'line', p1: { x: n[0], y: n[1] }, p2: { x: n[2], y: n[3] } });
        } else if (cmd === 'circle') {
          need(3);
          if (n[2] <= 0) throw new Error('半径必须大于 0');
          add({ type: 'circle', c: { x: n[0], y: n[1] }, r: n[2] });
        } else if (cmd === 'arc') {
          need(5);
          if (n[2] <= 0) throw new Error('半径必须大于 0');
          add({
            type: 'arc',
            c: { x: n[0], y: n[1] },
            r: n[2],
            a0: n[3] * DEG,
            a1: n[4] * DEG,
            ccw: n.length >= 6 ? n[5] !== 0 : true
          });
        } else if (cmd === 'point') {
          need(2);
          add({ type: 'point', p: { x: n[0], y: n[1] } });
        } else if (cmd === 'angle' || cmd === 'angline') {
          need(4);
          const a = n[2] * DEG;
          add({
            type: 'line',
            p1: { x: n[0], y: n[1] },
            p2: { x: n[0] + Math.cos(a) * n[3], y: n[1] + Math.sin(a) * n[3] }
          });
        } else if (cmd === 'set') {
          if (tokens.length < 3 || (tokens.length - 1) % 2 !== 0) {
            throw new Error('用法：set 序号 参数 值 [参数 值 ...]');
          }
          const Geo = global.Geo;
          if (!Geo || !Geo.setEntityProp) throw new Error('几何引擎未就绪');
          const ent = entityAt(doc, Number(tokens[0]));
          // 先深拷贝草稿逐项校验，全部通过后再一次性同步到图元
          const draft = JSON.parse(JSON.stringify(ent));
          for (let i = 1; i + 1 < tokens.length; i += 2) {
            const key = tokens[i].toLowerCase();
            const val = Number(tokens[i + 1]);
            const chk = Geo.setEntityProp(draft, key, val, false);
            if (!chk.ok) throw new Error('参数 ' + key + '：' + chk.error);
          }
          Geo.copyShape(ent, draft);
          report.updated++;
        } else if (cmd === 'move') {
          need(3);
          const Geo = global.Geo;
          const ent = entityAt(doc, n[0]);
          Geo.translateEntity(ent, n[1], n[2]);
          report.updated++;
        } else if (cmd === 'del' || cmd === 'delete') {
          need(1);
          const ent = entityAt(doc, n[0]);
          doc.remove(ent.id);
          report.deleted++;
        } else if (cmd === 'clear') {
          doc.clear();
        } else {
          throw new Error('未知命令 “' + cmd + '”');
        }
      } catch (err) {
        report.errors.push({ line: index + 1, text: parsed.raw, message: err.message });
      }
    });

    return report;
  }

  const SAMPLE = [
    '# 新建图形',
    'line 0 0 120 0',
    'line 120 0 120 80',
    'circle 40 40 25',
    'arc 0 0 60 0 90',
    'point 90 90',
    'angle 0 100 45 70',
    '# 修改已有图形（序号从 1 开始）',
    '# set 1 x2 150',
    '# move 3 10 0',
    '# del 4'
  ].join('\n');

  global.CADScript = { run: run, parseLine: parseLine, SAMPLE: SAMPLE };
})(typeof window !== 'undefined' ? window : globalThis);
