# 子计划：Settings、Profile 与 Help 工作区 GLM 一致性整改

## 状态

- **状态**：技术实现与自动化自检完成，等待真实 Session / 四视口 / PO 走查
- **父计划**：`2026-08-26_logion-glm-design-conformance-remediation.md`
- **父步骤**：步骤 13
- **MCP 任务**：`3b9d11d3-03b4-4ef8-a2bc-0ca418d94465`

## 目标

按 GLM 为 `/app/settings`、`/app/profile`、`/app/help` 建立三个专属主体：
Settings 使用分组设置列表和二级 Sheet，Profile 聚焦真实账户身份、个人活动和安全入口，
Help 提供搜索、环境诊断、恢复路径和 FAQ。保留 Persona、主题、用户设置、onboarding、
个人信息、安全中心、帮助恢复和环境诊断功能，不复用旧 `ProductPanel` / `IntegrationHubEntry` 主体。

## 路由验收线

1. Settings：Grouped Settings List、Persona / Appearance / Interaction 分组、低频编辑进入 Sheet；唯一主操作为当前设置命令。
2. Profile：Account Summary、Personal Activity、Account Actions；身份来自真实 Session，安全和数据入口可发现，不虚构个人资料字段。
3. Help：Help Search、Environment Diagnostics、Recovery Paths、FAQ；搜索为首交互，诊断状态可解释并提供真实恢复链接。

## 约束

- 复用现有 `ThemeToggle`、`usePersona`、`useSession`、`useVaultSession` 和 `userSettingService`；不新增 UI 库。
- 每页最多一个 `data-workbench-primary="true"`，每页保留 route-specific CSS 与布局。
- loading、empty、error、offline、locked、permission、capability-disabled、stale 均需有可理解的视觉状态和恢复动作。
- 不改变用户设置 API、Persona 持久化、Session、Vault 或安全中心语义。

## 验证

- Settings / Profile / Help route-specific Vitest；Web 全量 test、typecheck、lint、build。
- 320、390、1024、1440 视口溢出、唯一 primary、键盘焦点和 reduced-motion 静态/浏览器合同。
- 真实 Session/API/权限和 GLM Before/Target/After 截图待无源码挂载镜像；未取得证据前不得标记 PO 通过。

## 执行记录

| 时间 | 路由 | 状态 | 结果 |
| --- | --- | --- | --- |
| 2026-08-28 | Settings / Profile / Help | 执行中 | 已冻结 GLM 目标树，准备先写 RED 合同测试；现有页面仍为旧 ProductPanel / 占位主体。 |
| 2026-08-28 | Settings / Profile / Help | 技术完成 | Settings 已迁移为 Grouped Settings List + Secondary Sheet；Profile 已迁移为真实 Session 驱动的 Account Summary / Personal Activity / Account Actions；Help 已迁移为 Help Search / Environment Diagnostics / Recovery Paths / FAQ。定向 3 files / 3 tests、全量 69 files / 250 tests、typecheck、lint、Next 16 production build 全部通过；MCP `3b9d11d3-03b4-4ef8-a2bc-0ca418d94465` 已以 88/100 完成。真实 Session、四断点截图、Axe、键盘/读屏、reduced-motion 和 PO/GLM 统一走查仍待补。 |
