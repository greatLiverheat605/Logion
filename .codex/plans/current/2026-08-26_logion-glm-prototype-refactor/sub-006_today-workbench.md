# 子计划：Today 执行工作台样板

## 元信息

- 子计划 ID：`sub-006`
- 父计划：[2026-08-26_logion-glm-prototype-refactor.md](../2026-08-26_logion-glm-prototype-refactor.md)
- 关联步骤：步骤 6 - Today 执行工作台样板
- 创建时间：`2026-08-26T03:35:00+08:00`
- 状态：执行中
- 创建原因：controller/view 拆分、领域工作台主体、样式/测试和真实四断点验收跨越超过 3 个文件并涉及核心 sync-v1/Vault 副作用

## 实现方案

### 步骤 1：提取真实 Today controller 合同

- **MCP ID**：`f5d4ce5a-6318-4c01-b36b-d025055e5532`
- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T04:01:46+08:00`
- **AI 评分**：94/100
- **目标**：冻结任务、会话、证据、人工验收、Persona、Workspace/Space、Vault、sync-v1、冲突与恢复动作，把数据与副作用提取到 `use-today-controller.ts`。
- **验证方法**：API、repository、payload 和副作用顺序不变；全部正式 commands 可达；characterization tests、web typecheck/lint 通过。

### 步骤 2：实现三栏 Today Workbench 主体

- **MCP ID**：`c16931c2-57d2-415f-afd5-acd68bf04860`
- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T04:11:48+08:00`
- **AI 评分**：95/100
- **依赖**：步骤 1
- **目标**：以 Queue Master、NEXT ACTION Main、Task Context Inspector 替换旧 hero/卡片/Disclosure/长表单主体，移动端默认 Main 并通过 pane switcher 访问其余区域。
- **验证方法**：当前可见层 primary `<= 1`；任务/会话/证据/验收/冲突/Persona/Vault/sync 功能可达性 100%；组件、Axe、键盘测试通过。

### 步骤 3：完成真实数据与四断点验收

- **MCP ID**：`bde97dcf-2a81-4240-b00c-056170ab2cfe`
- **状态**：执行中
- **依赖**：步骤 2
- **目标**：在正式 Compose/Session/API/Persona/Workspace/Space/Vault/sync 状态下走查 Today，生成四张 After 和 B1 报告。
- **验证方法**：320/390/1024/1440 无溢出、遮挡和不可达操作；Axe、键盘、焦点、reduced-motion、primary、Function Reachability 全过。

## 执行记录

| 时间             | 操作                                   | 结果                                                                                                                                                                                          |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 03:35 | 创建子计划                             | 执行中；Shrimp 三个依赖任务已建立                                                                                                                                                             |
| 2026-08-26 03:36 | 步骤 1：提取真实 Today controller 合同 | 执行中；开始冻结 view-model 与 commands                                                                                                                                                       |
| 2026-08-26 04:01 | 步骤 1：提取真实 Today controller 合同 | 已完成；正式 TodayCenter 已实际消费 controller，167 项 web 测试、typecheck、lint 通过，Shrimp 94/100                                                                                          |
| 2026-08-26 04:02 | 步骤 2：实现三栏 Today Workbench 主体  | 执行中；开始布局、交互与可访问性验证                                                                                                                                                          |
| 2026-08-26 04:11 | 步骤 2：实现三栏 Today Workbench 主体  | 已完成；三栏连续工作面、Radix 次级交互、移动 pane、唯一 primary、真实四断点 Axe、168 项测试与 production build 通过，Shrimp 95/100                                                            |
| 2026-08-26 04:12 | 步骤 3：完成真实数据与四断点验收       | 执行中；复用 logion-b1 真实栈生成 After 证据并走查正式功能                                                                                                                                    |
| 2026-08-26 05:01 | 步骤 3：自动化真实验收                 | 真实任务/会话/证据/人工验收闭环、四断点 Axe/overflow/primary/reduced-motion、CSP nonce 与 console 零应用错误通过；B1 报告已生成，待应用内 Browser 登录授权完成 1440/390 可见抽查后同步 Shrimp |
