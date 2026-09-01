# 子计划：Workbench 与 Overlay primitives

## 元信息

- 子计划 ID：`sub-003`
- 父计划：[2026-08-26_logion-glm-prototype-refactor.md](../2026-08-26_logion-glm-prototype-refactor.md)
- 关联步骤：步骤 3 - 建立 Workbench 与 Overlay primitives
- 创建时间：`2026-08-26T02:02:00+08:00`
- 状态：已完成
- 创建原因：新增跨页面布局 API、替换共享 Modal 并建立多类 overlay adapter

## 实现方案

### 步骤 1：迁移共享 AppModal

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:05:00+08:00`
- **AI 评分**：92/100
- **目标**：在不改变调用方 API 的前提下用 Radix Dialog 接管 focus trap、Escape、outside click 和焦点恢复。
- **验证方法**：现有调用编译，Modal 组件测试通过。

### 步骤 2：实现连续工作面 primitives

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:19:00+08:00`
- **AI 评分**：93/100
- **目标**：实现 WorkbenchFrame、Header、ContextBar、Toolbar、InspectorSection 和稳定响应式 pane switcher。
- **验证方法**：桌面三栏、1024/移动单 pane 可达；组件测试验证切换与 landmarks。

### 步骤 3：实现 Headless UI adapters

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:24:00+08:00`
- **AI 评分**：95/100
- **目标**：提供 Dialog/Sheet/Popover/DropdownMenu/Tabs/Tooltip/Select/ContextMenu 的项目 API 和一致样式。
- **验证方法**：键盘、焦点、关闭恢复、命名和 reduced-motion 测试；web lint/typecheck/test/build 通过。

## 执行记录

| 时间             | 操作                              | 结果                                                                                         |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-08-26 02:02 | 创建子计划                        | 执行中                                                                                       |
| 2026-08-26 02:05 | 步骤 1：迁移共享 AppModal         | 92/100；Radix Dialog 接管焦点、Escape 与关闭语义，2 项测试通过                               |
| 2026-08-26 02:19 | 步骤 2：实现连续工作面 primitives | 93/100；三栏与单 pane 布局、landmarks、上下文和 44px 触达合同通过                            |
| 2026-08-26 02:24 | 步骤 3：实现 Headless UI adapters | 95/100；8 类 adapter、键盘/焦点/命名/reduced-motion 合同、145 tests 与 production build 通过 |
