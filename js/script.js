/* 手机CAD · 脚本绘图引擎
 * 每行一条命令，数值可用空格或逗号分隔，角度单位为度。
 * line x1 y1 x2 y2
 * circle cx cy r
 * arc cx cy r a0 a1 [ccw]
 * point x y
 * angle x y angle length        （角度线）
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
    return { cmd: cmd, nums: nums, raw: s };
  }

  function run(text, doc) {
    const report = { created: 0, errors: [], commands: 0 };
    function add(ent) { doc.add(ent); report.created++; }
    const lines = String(text == null ? '' : text).split(/[\n;]/);

    lines.forEach(function (line, index) {
      const parsed = parseLine(line);
      if (!parsed) return;
      report.commands++;
      const cmd = parsed.cmd;
      const n = parsed.nums;
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
    'line 0 0 120 0',
    'line 120 0 120 80',
    'circle 40 40 25',
    'arc 0 0 60 0 90',
    'point 90 90',
    'angle 0 100 45 70'
  ].join('\n');

  global.CADScript = { run: run, parseLine: parseLine, SAMPLE: SAMPLE };
})(typeof window !== 'undefined' ? window : globalThis);
