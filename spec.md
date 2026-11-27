# 编辑模块新增「组合 / 分解」功能 · 技术规格

## 1. 目标
在现有编辑（`cat: 'edit'`）工具集中新增两个命令式工具：
- **组合**：把 ≥2 个选中的独立图元合并为一个整体对象（`type: 'group'`），完整保留每个子图元的几何、样式与 id，并保持原有绘制顺序（层级）。
- **分解**：把选中的整体对象拆回独立图元，子图元回到顶层图元列表的原有位置，恢复各自独立编辑属性。

同时满足：
- 两个工具**仅在「功能扩展」开关开启时可见**（复用现有 `EXT_HIDE_EDIT` 机制）。
- 未满足触发条件时按钮**置灰不可点**；组合需 ≥2 个独立图元，分解需恰好选中 1 个组合对象。
- 与 `App.begin/end` 快照机制完全兼容，可正常撤销 / 重做。
- 不修改任何现有编辑工具的核心逻辑，交互与提示风格保持一致。

## 2. 数据模型
组合对象为**嵌套容器**，作为普通图元参与 `model.entities`：

```js
{ id: 'e7', type: 'group', children: [ /* 原图元对象，保留各自 id 与全部属性 */ ] }
```

- 子图元从 `model.entities` 顶层移入 `children`，**id 不变**，顺序 = 原文档顺序。
- 组合对象插入到「第一个被选中图元」在文档中的位置，保证绘制层级不跳变。
- 分解时按 `children` 原顺序插回组合对象所在下标处。
- 组合对象不携带任何几何字段，几何一律由其子图元决定。

## 3. 精确改动清单

### 3.1 `js/geometry.js`（新增 group 递归支持）
| 函数 | 改动 |
|---|---|
| `hitDistance` | `type === 'group'` → 子图元 `hitDistance` 取最小值 |
| `entityPolyline` | group → 依次拼接各子图元 polyline（供 bbox 兜底） |
| `entityBBox` | group → 各子图元 `entityBBox` 并集 |
| `entityMidpoint` | group → 包围盒中心 |
| `entityLength` | group → 子图元长度累加 |
| `entityEndpoints` | group → `[]`（不参与关联链 / 首尾链接） |
| `translateEntity` | group → 对 `children` 递归 |
| `rotateEntity` | group → 对 `children` 递归 |
| `mirrorEntity` | group → 返回新 group，`children` 递归镜像，且**递归清除 id**（副本不得复用原 id） |
| `copyShape` | group → 深拷贝 `children`（保留 id，用于旋转 / 拖动 / 约束求解的原地恢复；新增副本的重复 id 由 `Doc.add` 递归补齐） |
| `setEntityProp` | group → `{ ok:false, error:'组合对象不支持直接修改属性，请先分解' }` |
| 新增 `cloneEntity` | 仅内部使用：JSON 深拷贝后递归删除 id，供镜像 / 阵列使用 |

导出：无需新增导出（`cloneEntity` 内部使用即可）。

### 3.2 `js/model.js`
| 方法 | 改动 |
|---|---|
| `findById` | 递归：先查顶层，再查每个 group 的 `children` |
| `add` | 重复 id 检测改用（递归）`findById` |
| 新增 `allEntities()` | 返回展平后的全部图元（顶层 + group 子孙），供捕捉 / 引用校验使用 |
| `pruneRefs` | id 集合改用 `allEntities()`，**保证组合期间约束 / 标注引用不被误删** |
| `entitiesInRect` | group 特殊分支：交叉选择 = 任一子图元命中；窗口选择 = 所有子图元完全在内 |
| `maxSeq` | 递归统计 group 子图元 id，避免撤销恢复后新建 id 冲突 |
| `snapshot / restoreSnapshot` | 不改（JSON 自然包含嵌套结构） |
| `count / bbox / chain` | 不改（`count` 统计顶层对象，组合后计为 1；`chain` 不穿组） |

### 3.3 `js/render.js`
- `strokeEntity` 增加 group 分支：对 `children` 逐个 `strokeEntity(child, color, width, glow)` 后返回。
- 选中组合对象时整体高亮其所有子图元（颜色 / 线宽 / 发光沿用入参），子图元自带 `style` / `fill` / `centerMark` 不受影响。
- `pathEntity` 不变（group 不会走到该分支）。

### 3.4 `js/tools.js`
在 `rotateTool` 之后新增：

```js
function groupCandidates() {
  const sel = App.model.selected;
  const list = App.model.selectedEntities();
  if (sel.size < 2 || list.length !== sel.size) return [];
  for (let i = 0; i < list.length; i++) if (list[i].type === 'group') return [];
  return list;
}
function ungroupCandidate() {
  const list = App.model.selectedEntities();
  return list.length === 1 && list[0].type === 'group' ? list[0] : null;
}
```

- `groupTool`：`id:'group'`, `name:'组合'`, `cat:'edit'`, `icon:'▣'`, `dragType:'pan'`
  - `enabled()` → `groupCandidates().length >= 2`
  - `prompt()` → 满足时「已选 N 个独立图元，点按画布即可组合」；否则「请先选择 2 个及以上独立图元」
  - `activate()` / `onTap()` → 调 `this.apply()`
  - `apply()`：条件不满足 → `App.toast('请先选中 2 个及以上独立图元')` 并返回 false；否则
    `App.begin()` → 按文档顺序取出选中图元 → 从顶层移除 → `App.model.add({type:'group', children: 有序子图元})` → 把 group 移到首个被选图元原下标 → `selected = {group.id}` → `App.end()` → `App.afterSelectionChange()` → `App.updatePrompt()` → toast `已组合：N 个图元合并为 1 个整体`
- `ungroupTool`：`id:'ungroup'`, `name:'分解'`, `cat:'edit'`, `icon:'⧅'`, `dragType:'pan'`
  - `enabled()` → `!!ungroupCandidate()`
  - `apply()`：条件不满足 → toast `请先选中一个组合对象`；否则 `App.begin()` → 记录 group 下标 → `remove(group.id)` → 子图元按下标插回顶层 → `selected = 子图元 id 集合` → `App.end()` → `afterSelectionChange()` → toast `已分解：N 个图元恢复为独立对象`
- 注册：工具数组 `..., moveTool, arrayTool, mirrorTool, rotateTool, groupTool, ungroupTool, ...`

说明：两者为「即点即执行」命令（选中 → 点按钮立即生效），保留在当前工具上可继续点按画布重复执行，与删除 / 镜像等单击型工具一致。

### 3.5 `js/main.js`
- `EXT_HIDE_EDIT` 增加：`{ group: true, ungroup: true }`。
- `updateToolChips()`：对每个 chip 取 `Tools.byId(id)`，若 `typeof t.enabled === 'function' && !t.enabled()` → `chip.disabled = true` + `classList.add('disabled')`，否则清除。`active` 逻辑不变。
- `App.setTool(id)`：在 `if (!next) return;` 之后增加条件守卫——工具存在 `enabled()` 且返回 false 时 `App.toast('未满足「' + next.name + '」的触发条件：…')` 并 `return`（不切换工具）。
- `App.afterSelectionChange()`：先调用 `updateToolChips()`，再 `updateSelBar()` + `refresh()`，使按钮置灰状态随选择 / 撤销 / 框选实时同步。
- 其它（undo/redo、ext 开关、渲染循环）不改。

### 3.6 `css/app.css`
- `.tool-chip:disabled { opacity: .45; }`（保持布局尺寸不变，仅视觉置灰）。

### 3.7 文档与清单
- `js/help-meta.js`
  - `CAD_HELP_META` 新增主题 `'组合与分解'`（summary / scenes / notes）。
  - `CAD_FEATURE_HELP` 新增 `group`、`ungroup` 两项：`topic:'组合与分解'`，`steps` ≥ 2 步，`related` 引用有效主题。
- `index.html`
  - 「功能扩展」说明段落：隐藏清单补「编辑页的组合、分解」。
  - 编辑功能说明区新增「组合与分解」段落：说明条件、即点即执行、撤销兼容、仅扩展开启可见。
- `js/tests.js`
  - 「功能徽标说明映射」用例中主题数 `33` → `34`。
- `test.html`
  - 第 69 项「33 个折叠说明卡片」→「34 个」。
  - 新增第 73 项手动验证清单（显隐、置灰、组合/分解、撤销/重做、边界）。
  - 底部覆盖说明补充组合 / 分解用例。

## 4. 边界与兼容
- 组合只接受**顶层独立图元**，不允许「组合里再组合」；选中项含 group 时按钮置灰。
- 分解只接受**恰好 1 个** group；多选 / 选中普通图元时置灰。
- 撤销 / 重做：snapshot 为 JSON，天然包含 `children`；`restoreSnapshot` 递归重算 `_seq`，防止后续新建 id 撞车。
- 约束 / 标注：`pruneRefs` 使用递归 id 集合，组合不会清空引用；`findById` 递归保证标注仍能定位子图元。分解后约束按原逻辑恢复生效。
- 捕捉：`App.snapPoint` 改为遍历展平后的图元列表（若未改，则组合后无法吸附子图元端点，属功能回退，必须一并处理）。
  实现：`App.model.allEntities()` 替换 `App.model.entities` 的两个遍历（端点捕捉 + 交点捕捉）。
- 命中 / 框选：命中组合返回 group；框选按子图元判定（见 3.2）。
- 层叠：组合/分解不改变相对绘制顺序。
- 原有工具：删除、平移、旋转、镜像、阵列通过 `Geo.*` 递归后可直接作用于组合对象；裁剪 / 过渡 / 拉伸不识别 group（与现状一致，不报错）。

## 5. 测试与验证
1. **自动化**（`js/tests.js` 新增 6 例，基线 145 → 151）：
   - 组合：2/3 选中合并、数量、children id/属性/顺序、选中态、插入下标。
   - 分解：还原数量、id、顺序、选中态、group 移除。
   - 触发条件：0/1/含 group 时 `enabled()` 为 false；单个 group 时 ungroup 为 true；不满足时 `apply()` 不改模型且有 toast。
   - 撤销快照往返：组合前 snapshot → 组合 → 恢复 → 原样；再组合 → undo stack 记录正确。
   - 组合对象兼容：`hitTest` 命中 group、`entityBBox` 覆盖、`entitiesInRect` 交叉/窗口、`translateEntity`、`mirrorEntity`（新副本无重复 id）、`copyShape`。
   - 工具注册与分类：group/ungroup 存在、`cat==='edit'`、具备 `enabled`。
2. **回归**：
   `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\AppData\Local\Temp\run_cad_stretch_test.ps1"`
   期望 `PASS=151 FAIL=0`。
3. **真实页面探针**（Edge headless，`localStorage['cad.ext.enabled']='1'`）：
   - 扩展关闭：编辑页无「组合 / 分解」chip；
   - 扩展开启：chip 出现；
   - 脚本选中 2 条线后 `CADApp.afterSelectionChange()` → 组合 chip 可用；`CADApp.setTool('group')` → 顶层图元 3→2，组合 chip 置灰、分解 chip 可用；
   - `CADApp.setTool('ungroup')` → 顶层恢复 3；
   - `CADApp.undo()` / `redo()` 后图元数与按钮置灰状态正确。
4. **清理**：删除遗留 `_tmp_probe_stretch.html` / `_tmp_probe_stretch.js`，探针临时文件用完即删。

## 6. 验收标准
- 扩展关闭时两个入口完全不可见；开启后出现在编辑页。
- 未达条件时按钮置灰且点击无副作用（仅提示）。
- 组合后整体可被拾取 / 框选 / 平移 / 旋转 / 镜像，子图元属性与 id 完整保留。
- 分解后与组合前完全一致（数量、id、几何、样式、顺序），且可独立编辑。
- 组合 / 分解均可撤销与重做，撤销后按钮状态同步刷新。
- 原有 145 项用例全部通过。
