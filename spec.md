# 手机CAD · 第 16 轮：几何约束与辅助线优化（Spec）

## 1. 目标与范围

按用户第 16 轮要求，对五项功能做调整，并保持既有交互逻辑一致、无兼容性问题：

| 编号 | 需求 | 验收要点 |
|---|---|---|
| R1 | 直线绘制：手动坐标输入默认关闭，需勾选启用 | 属性面板出现「坐标输入」开关，默认关闭；关闭时 x1/y1/x2/y2 不显示、不显示「确定」；勾选后恢复原有精确输入 |
| R2 | 中心线：按对象自动生成 | 点圆/圆弧 → 过圆心水平+垂直十字中心线；两条平行线 → 等距中线；两条不平行线 → 角平分线；保留空白两点手绘兼容 |
| R3 | 镜像：移除手动输入镜像轴入口 | 镜像工具 `params()` 为空、无「确定」；仅保留“先选图形、再点按一条直线作为镜像轴” |
| R4 | 链拾取：完全移除该功能模块 | 工具列表无 `chain`；关联选择仍可用（复用 `model.chain`） |
| R5 | 固定约束：新增「仅固定端点」选项 | 约束工具面板出现「仅固定端点」开关（默认关）；开启时只锚定端点/圆心，不锁整体形状与方向；约束管理显示「仅端点 / 整体」 |

所有新增选项必须在对应功能属性面板清晰展示；调整后完成全功能回归测试。

## 2. 当前代码状态（已实现）

### R1 直线坐标输入
- [js/tools.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tools.js) `lineTool.params()`：在「捕捉」组后新增
  `{ key:'coord', type:'toggle', label:'坐标输入', def:false, group:'坐标输入' }`；
  `x1/y1/x2/y2` 均带 `when: p => p.coord === true`。
- `lineTool.applyParams()` 首行保护：`if (App.params.coord !== true) { App.toast('请先勾选“坐标输入”再输入坐标'); return; }`。
- `lineTool.prompt` 起始文案按 `App.params.coord` 两态。
- [js/main.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/main.js#L355-L357)：「确定」按钮仅在存在可见数值项时渲染：
  `const hasNumber = fields.some(fd => !fd.type || fd.type === 'number'); if (hasNumber && typeof App.tool.applyParams === 'function') ...`

### R2 中心线
- [js/tools.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tools.js#L239-L400)：
  - `centerExt()` 读取 `App.params.cext`（默认 6，非法归 0）。
  - `centerLine(p1,p2)` 生成 `{type:'line', p1, p2, style:'center'}`。
  - `crossCenterlines(e, ext)`：`h = e.r + ext`，返回过 `e.c` 的水平线与垂直线。
  - `centerlineBetween(a,b,ext)`：
    - 平行（`|sin| <= 0.01`）：法向有符号距离 `dSigned`；`|dSigned| < 1e-6` 返回 `{error:'两条直线重合，无法生成中心线'}`；否则取 `mid = a.p1 + n*dSigned/2`，沿 `ua` 投影四端点得 `[lo,hi]`，两端各加 `ext`。
    - 不平行：`Geo.lineIntersectInfinite` 求交点；把 `ub` 翻向使 `dot(ua,ub) >= 0`；`v = normalize(ua+ub)`；`L = max(端点至交点距离) + ext`，生成以交点为中点的角平分线。
  - `centerTool`（id `center`，cat `draw`，dragType `preview`）：
    - `onTap`：已有 `points` → `_finishManual`；`App.pick` 空 → 有 `picks` 则取消，否则 `_circleAt` 命中则生成十字，未命中则 `points=[p]` 两点手绘；命中 circle/arc → `_makeCross`；命中非 line → toast；命中 line → 首次记录 `picks`，同 id 提示换线，不同 id 调 `centerlineBetween` 成功后加线并 reset。
    - `_circleAt(p)`：遍历 circle，`Geo.dist(p,e.c) <= e.r + App.worldTol(10)`，取半径最小者（支持点圆内部）。
    - `_makeCross(e)`：添加两条中心线，toast「已生成过圆心的水平 / 垂直中心线」。
    - `onRender`：ghost 已选直线与 hover 的另一条直线；手绘态画点划线预览。

### R3 镜像
- [js/tools.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tools.js#L2191-L2246)：删除 `axisPick`、`x1/y1/x2/y2` 参数、`_axis()`、`applyParams`；`onTap` 中 `if (sel.size && e.type === 'line') this._mirrorAbout(e.p1, e.p2);`；`onRender` 仅在已选且 hover 命中 line 时绘制镜像轴与副本虚影。

### R4 链拾取
- [js/tools.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tools.js#L3470) 工具列表已删除 `chainTool`（现为 `... arrayTool, mirrorTool, rotateTool, ...`）。
- `model.chain` 算法保留，供「关联选择」使用（非 UI 模块）。

### R5 固定约束仅固定端点
- [js/tools.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tools.js#L2872)：`makeConstraintTool` 对 `fixed` 增加
  `{ key:'fonly', type:'toggle', label:'仅固定端点', def:false, group:'固定' }`。
- `fixedConstraintTool` 的 `prompt` / `pick` / `draft` 均读取 `App.params.fonly`，提交 `{ onlyEndpoints: true|false }`。
- [js/constraints.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/constraints.js#L1423-L1495)：
  - `fixedAnchorPoints(e)`：`Geo.entityEndpoints` 有值则复制；circle 返回圆心；否则 `[]`。
  - `fixedSnapshot`：`onlyEndpoints` 时存 `{onlyEndpoints:true, type, pts}`，否则整实体深拷贝。
  - `pinArcEndpoints(e,p1,p2)`：保持半径，由弦中点+法向偏移反解圆心，取离原圆心近者；半径不足半弦长时退化为半圆。
  - `restoreFixed`：完整模式 `Geo.copyShape`；仅端点模式 line 恢复 p1/p2、point 恢复 p、circle 恢复圆心（半径自由）、arc 调 `pinArcEndpoints`、rect/poly 平移使首角点回位（形状方向保持当前）。
- 约束管理 `listHtml`：fixed 显示 `<span class="con-mode">仅端点|整体</span>`，空态与底部 hint 补充说明。

## 3. 待完成工作

### W1 自动化用例补齐/修正 [js/tests.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tests.js)
1. 既有用例适配：
   - 「直线工具：坐标输入精确生成」（约 574 行）与「直线工具：正交锁定」（约 710 行）在 `applyParams()` 前设置 `app.params.coord = true`。
   - 「镜像：指定轴生成对称副本」（约 1075 行）删除 `params.x1...` 与 `applyParams()`：改为模型中加一条轴线，选中 3 个待镜像图元后 `onTap(轴线上一点)`；重复镜像应跳过的子场景同样改为点选轴。
   - 「链拾取识别连续相连图元」（约 211 行）改名为「关联选择链识别连续相连图元」（算法保留）。
2. 新增用例：
   - `line`：`params()` 中 `coord` 默认 `false`；`coord !== true` 时 `applyParams()` 不建图形并 toast；`when` 在 `coord=false` 时过滤 x1/y1/x2/y2。
   - `center`：
     - 圆 → 2 条 `style:'center'` 线，分别过圆心水平/垂直，长度 `2*(r+ext)`（测试点圆内部命中）。
     - 两条平行线（y=0 / y=40）→ 1 条中线 y=20，端点按投影 `[0,100]` 加 ext。
     - 两条不平行线（x 轴与 x=50 竖线）→ 角平分线过交点 (50,0)，方向 45°。
     - 两条重合线 → toast 报错且不新增图元。
   - `mirror`：`params()` 返回空数组；`applyParams` 不存在。
   - `fixed`：`onlyEndpoints` 行为
     - 圆 + `overlap`（contain）约束：圆心保持、半径随约束改变（与完整固定对比）。
     - 直线 + `distance` 约束：端点保持原位。
     - 圆弧 + 切线约束：端点与半径恢复、圆心反解。
     - 约束对象含 `onlyEndpoints: true`。

### W2 全量回归
- Edge headless 运行 `test.html`，统计 `stat ok` / `stat bad`，要求 BAD=0。

### W3 真实页面探针（五项 + 冒烟）
- 复制 `index.html` 为 `_tmp_probe_*.html`，`</body>` 前注入脚本，验证：
  1. 直线默认无坐标输入数值项、无「确定」；勾选后出现 4 个数值项与「确定」，可建线。
  2. 中心线点圆生成 2 条十字线；平行两线生成中线；不平行两线生成角平分线。
  3. 镜像工具无坐标参数与「确定」，点选轴线可完成镜像。
  4. 工具列表无「链拾取」按钮；关联选择仍可选中相连链。
  5. 固定约束面板有「仅固定端点」开关；开启后约束对象 `onlyEndpoints === true`，约束管理显示「仅端点」。
- 冒烟：直线/圆/矩形/标注/约束各跑一遍无异常，`R.draw()` 正常。
- 完成后删除临时探针文件。

### W4 文档更新
- [index.html](file:///c:/Users/Administrator/Desktop/手机CAD/index.html) 帮助：
  - 直线：坐标输入默认关闭，需勾选；
  - 中心线：三种对象自动生成规则 + 空白两点手绘；
  - 镜像：仅点选直线作镜像轴；
  - 删除链拾取说明；
  - 固定约束：补充「仅固定端点」。
- [test.html](file:///c:/Users/Administrator/Desktop/手机CAD/test.html) 手动清单：
  - 删除/改写链拾取条目；
  - 新增上述 5 项检查项，并同步自动化覆盖说明文字。

### W5 残留检查
- 全局搜索「链拾取 / chain」确保 UI、帮助、手动清单无残留（`model.chain` 与关联选择相关命名允许保留）。

## 4. 验收标准
- 自动化回归 OK 数 ≥ 115 且 BAD=0（新增 5+ 用例）。
- 真实页面探针全部 PASS，页面控制台无异常。
- 帮助与手动清单与实现一致，无「链拾取」残留入口。
- 五项功能在关闭/开启、单选/多选、边界输入（重合、零长度）场景下结果符合预期。
