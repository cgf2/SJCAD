# 手机CAD · 第 16 轮任务清单

> 对应 spec：[spec.md](file:///c:/Users/Administrator/Desktop/手机CAD/spec.md)

## 已完成（代码实现）
- [x] T1 R1 直线坐标输入：`lineTool` 新增 `coord` 开关（def false）、4 个坐标项 `when` 条件、`applyParams` 保护、prompt 两态
- [x] T2 R1 属性面板：「确定」按钮仅在存在可见数值项时显示（`main.js#L355-357`）
- [x] T3 R2 中心线：`crossCenterlines` / `centerlineBetween` / `centerTool` 三态交互（圆十字、平行中线、角平分线、空白两点手绘）
- [x] T4 R3 镜像：移除 `axisPick`、手动轴参数、`_axis()`、`applyParams`；保留点选轴线
- [x] T5 R4 移除 `chainTool` 与工具列表入口；`model.chain` 保留给关联选择
- [x] T6 R5 固定约束：新增 `fonly` toggle、提交 `onlyEndpoints`、快照/恢复仅端点分支、约束管理「仅端点/整体」显示
- [x] T7 用例初步调整：链拾取用例改为「关联选择：链拾取模块已移除且功能不丢失」；性能用例改名

## 待执行（按顺序）

### T8 修正既有用例（完成）
- [x] T8.1 [tests.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tests.js#L574-L591)「直线工具：坐标输入精确生成」：`applyParams()` 前 `app.params.coord = true`
- [x] T8.2 [tests.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tests.js#L710-L734)「直线工具：正交锁定」：`applyParams()` 前 `app.params.coord = true`
- [x] T8.3 [tests.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tests.js#L1075-L1115)「镜像：点选轴线生成对称副本」：删除手动轴参数与 `applyParams()`，改为点选轴线；补充 `params()` 为空断言
- [x] T8.4 [tests.js](file:///c:/Users/Administrator/Desktop/手机CAD/js/tests.js#L211-L224)「链拾取识别连续相连图元」改名为「关联选择链识别连续相连图元」

### T9 新增用例（完成）
- [x] T9.1 直线坐标输入默认关闭：`coord` 默认 false、`when` 过滤、关闭时 `applyParams` 不建图形
- [x] T9.2 中心线圆：点圆内部 → 2 条 `style:'center'` 十字线，长度 `2*(r+ext)`
- [x] T9.3 中心线平行两线 → 等距中线（y=20，含 ext）
- [x] T9.4 中心线不平行两线 → 角平分线（过交点、方向 45°）
- [x] T9.5 中心线共线两线 → toast 报错且不新增
- [x] T9.6 固定约束仅端点：圆（overlap contain，圆心固定、半径可变）、线（distance，端点保持）、弧（切线，端点+半径恢复）、约束对象含 `onlyEndpoints`

### T10 自动化回归（完成）
- [x] Edge headless 跑 `test.html`，统计 OK/BAD，要求 BAD=0（结果：OK=117，BAD=0）

### T11 真实页面探针（完成）
- [x] 注入 `_tmp_probe_*.html`：五项功能 + 绘制/标注/约束冒烟，全部 PASS（20/20）
- [x] 删除临时探针文件

### T12 文档与残留
- [x] 更新 [index.html](file:///c:/Users/Administrator/Desktop/手机CAD/index.html) 帮助（直线坐标默认关闭、中心线三规则、镜像仅点选轴、移除链拾取、固定仅端点）
- [x] 更新 [test.html](file:///c:/Users/Administrator/Desktop/手机CAD/test.html) 手动清单与覆盖说明
- [x] 全局搜索「链拾取 / chain」确认无 UI 残留（仅保留“模块已移除”说明与关联选择链算法注释）
