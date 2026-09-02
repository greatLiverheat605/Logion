# 子计划：Context、状态与主操作合同

## 元信息

- 子计划 ID：`sub-004`
- 父计划：[2026-08-26_logion-glm-prototype-refactor.md](../2026-08-26_logion-glm-prototype-refactor.md)
- 关联步骤：步骤 4 - 统一 Context Bar、状态系统与主操作合同
- 创建时间：`2026-08-26T02:27:00+08:00`
- 状态：已完成
- 创建原因：公共状态类型、Workbench API、Shell 上下文和全局操作层级跨越 7 个以上文件并影响后续三个样板

## 实现方案

### 步骤 1：建立 11 类可恢复状态合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:38:00+08:00`
- **AI 评分**：94/100
- **目标**：新增 11 类 `ProductOperationalState` discriminated union，以可执行 button/link recovery 驱动专门视觉；保留现有 Center 的兼容入口，不改领域 payload。
- **验证方法**：11 类状态逐项渲染；impact、live region、button/link recovery 可执行；既有 derive/notice 测试继续通过。

### 步骤 2：建立结构化 Context Bar 与唯一主操作合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:41:00+08:00`
- **AI 评分**：93/100
- **目标**：为 Workspace、Space、Persona、权限、Vault、Sync 建立结构化 Context model；只回显真实已知值；通过 `WorkbenchActionBar` API 将 primary 收敛为单一槽位。
- **验证方法**：上下文项、tone、缺省省略和 action slot 测试通过；单一 workbench layer 只能渲染一个带语义标记的 primary。

### 步骤 3：降级全局捕获并执行集成回归

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T02:45:00+08:00`
- **AI 评分**：94/100
- **目标**：将全局 capture 从 primary 按钮降为命名 icon action；Shell 使用真实已加载 Workspace 名称，保留 Persona、Vault、online/sync 回显与原操作事件。
- **验证方法**：capture/focus 事件合同、Shell/Persona/Workspace/Vault 相关测试、web lint/typecheck/test/build 通过；移动目标保持 44px。

## 执行记录

| 时间             | 操作                                            | 结果                                                                |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| 2026-08-26 02:27 | 创建子计划                                      | 执行中                                                              |
| 2026-08-26 02:38 | 步骤 1：建立 11 类可恢复状态合同                | 94/100；11 状态、影响、live semantics 与真实 recovery 合同通过      |
| 2026-08-26 02:41 | 步骤 2：建立结构化 Context Bar 与唯一主操作合同 | 93/100；真实已知上下文映射与单一 primary 槽合同通过                 |
| 2026-08-26 02:45 | 步骤 3：降级全局捕获并执行集成回归              | 94/100；44px icon action、真实 Workspace 回显、160 tests/build 通过 |
