# 实施任务清单 · 组合 / 分解

> 全部任务已完成，回归 PASS=151 / FAIL=0。

## T1 几何层递归支持（js/geometry.js）
- [x] `hitDistance` / `entityPolyline` / `entityBBox` / `entityMidpoint` / `entityLength` / `entityEndpoints` 增加 `group` 分支。
- [x] `translateEntity` / `rotateEntity` / `mirrorEntity` / `copyShape` 递归处理 `children`；镜像副本递归清除 id，`copyShape` 深拷贝保留 id（原地恢复语义），新增副本的重复子 id 由 `Doc.add` 补齐。
- [x] `setEntityProp` 对 group 返回明确错误。
- 验收：group 的命中距离、包围盒、平移、镜像副本 id 唯一（自动化用例覆盖）。

## T2 模型层（js/model.js）
- [x] `findById` 递归（含 group 子图元）。
- [x] 新增 `allEntities()` 展平方法。
- [x] `pruneRefs` 使用 `allEntities()` 的 id 集合。
- [x] `entitiesInRect` 增加 group 的交叉 / 窗口判定。
- [x] `maxSeq` 递归统计嵌套 id；`add` 递归补齐子图元唯一 id。
- 验收：组合后标注 / 约束引用不被清理；框选行为正确；撤销恢复后新建图元 id 不冲突。

## T3 渲染（js/render.js）
- [x] `strokeEntity` 增加 group 分支，逐子图元绘制并透传颜色 / 线宽 / 发光。
- 验收：页面探针中组合对象正常显示与整体高亮。

## T4 工具实现（js/tools.js）
- [x] 新增 `groupCandidates()` / `ungroupCandidate()` 辅助函数。
- [x] 新增 `groupTool`（id `group`，编辑页，`enabled()` ≥2 独立图元，`activate`/`onTap` → `apply`）。
- [x] 新增 `ungroupTool`（id `ungroup`，编辑页，`enabled()` 单个 group，`activate`/`onTap` → `apply`）。
- [x] 注册到工具数组（`rotateTool` 之后）。
- 验收：组合后顶层数量减少、选中 group；分解后完全还原；条件不足仅 toast 不改模型。

## T5 交互与置灰（js/main.js + css/app.css）
- [x] `EXT_HIDE_EDIT` 加入 `group`、`ungroup`。
- [x] `updateToolChips()` 按 `tool.enabled()` 设置 `disabled` + `.disabled`。
- [x] `App.setTool()` 增加条件守卫与提示。
- [x] `App.afterSelectionChange()` 调用 `updateToolChips()`。
- [x] `App.snapPoint` 的两个遍历改用 `App.model.allEntities()`。
- [x] CSS 新增 `.tool-chip:disabled { opacity: .45; }`。
- 验收：页面探针确认扩展关闭不可见、开启可见、选中/撤销后置灰状态同步、组合后子图元端点可捕捉。

## T6 文档与清单
- [x] `js/help-meta.js`：新增主题 `组合与分解`，新增 `group` / `ungroup` 功能说明（steps ≥2）。
- [x] `index.html`：功能扩展隐藏清单补充组合/分解；编辑说明新增「组合与分解」段落。
- [x] `test.html`：第 69 项 33 → 34；新增第 73 项检查清单；补充覆盖说明。
- [x] `js/tests.js`：主题数断言 33 → 34。

## T7 自动化测试（js/tests.js）
- [x] 组合：合并数量 / children id、属性、顺序 / 选中态 / 插入位置。
- [x] 分解：还原数量 / id / 顺序 / 选中态。
- [x] 触发条件与置灰逻辑（0/1/含 group、单个 group）。
- [x] 撤销快照往返（组合 → 恢复 → 再组合）。
- [x] 组合对象兼容：hitTest / bbox / 框选 / 平移 / 镜像 / 复制。
- [x] 工具注册与分类校验（说明映射完整性用例覆盖）。
- 验收：新增 6 例，总数 151，全部通过。

## T8 回归与真机页面验证
- [x] 回归脚本结果：`PASS=151 FAIL=0`。
- [x] Edge headless 探针：扩展关闭无组合/分解入口；开启后出现；选中 2 图元组合可用、分解置灰；组合后顶层 3→2 且按钮状态互换；分解后恢复 3、无 group；撤销后 2（1 个 group）、重做后 3。
- [x] 清理 `_tmp_probe_group.js` / `_tmp_probe_group_on.html` / `_tmp_probe_group_off.html` 及遗留 `_tmp_probe_stretch.*`。
- [x] 输出变更摘要与手动验证清单。
