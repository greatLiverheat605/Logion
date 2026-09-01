# 子计划：Radix 兼容性与 bundle spike

## 元信息

- 子计划 ID：`sub-002`
- 父计划：[2026-08-26_logion-glm-prototype-refactor.md](../2026-08-26_logion-glm-prototype-refactor.md)
- 关联步骤：步骤 2 - 完成 Radix 决策 spike 与依赖门
- 创建时间：`2026-08-26T01:51:00+08:00`
- 状态：已完成
- 创建原因：新增依赖并验证 React/Next 边界与 bundle，属于高风险接口变更

## 实现方案

### 步骤 1：记录安装前基线

- **状态**：已完成 ✓
- **目标**：运行正式 Web build 并记录 `.next` 客户端产物体积。
- **验证方法**：构建通过并生成可复查报告。

### 步骤 2：安装批准的七个 primitive 包

- **状态**：已完成 ✓
- **目标**：固定 Radix Dialog、Popover、DropdownMenu、Tabs、Tooltip、Select、ContextMenu 版本。
- **验证方法**：package/lock 只新增批准依赖，peer dependency 覆盖 React 19。

### 步骤 3：兼容性与安装后构建

- **状态**：已完成 ✓
- **目标**：用最小组件测试验证键盘/焦点基础行为，并比较安装后构建体积。
- **验证方法**：web test/typecheck/build 通过，无 hydration warning，报告记录差异。

## 执行记录

| 时间             | 操作                 | 结果                                   |
| ---------------- | -------------------- | -------------------------------------- |
| 2026-08-26 01:51 | 创建子计划           | 执行中                                 |
| 2026-08-26 02:01 | 完成兼容性与构建验证 | 137 tests、lint、typecheck、build 通过 |
