# Security GLM Conformance

## 路由

- 路由：`/app/security`
- 目标：GLM Security Checklist Master、认证设置 Main、设备与恢复 Inspector。
- 实现：`apps/web/src/features/security/security-center.tsx`

## Before / After

Before 主体是单列 `ProductHero`、指标网格、设备 `ProductPanel`、Passkey 表单和展开式恢复区；认证动作与对象列表纵向堆叠，页面没有稳定的对象导航或检查器层级。

After 主体为 `WorkbenchFrame` 三栏布局：

- Master：保护概览、登录凭据、设备与会话、认证器与恢复四个安全分区，持续显示完成度与状态标签。
- Main：安全清单和分区 Tabs；安全对象以列表呈现，刷新是次操作，当前风险项按状态提供唯一 primary（启用 TOTP 或添加 Passkey）。
- Inspector：保护摘要、风险与恢复、当前状态，持续回显有效设备、Passkey、TOTP 和恢复码数量。
- Sheet：Passkey 注册、TOTP enrollment、恢复码再生成和关闭 TOTP 均在当前上下文完成，避免跳页和长表单。

## Function Reachability

- Passkey 注册仍使用 `/api/v1/auth/passkeys/register/options` 与 `/verify`，保留浏览器认证器、challenge、CSRF 和命名语义。
- Passkey 与设备撤销仍使用原 DELETE API 和确认路径；设备撤销提示会话立即失效。
- TOTP enrollment、动态码验证、恢复码再生成和关闭仍使用原 API、当前动态码和确认语义。
- 恢复码只在生成后显示一次，并在 Inspector 中提示离线保存。

## 验证

- `pnpm --filter @logion/web typecheck`：通过。
- `pnpm --filter @logion/web lint`：通过。
- `pnpm --filter @logion/web test -- src/features/security/security-workbench.test.tsx --run`：通过，`64 files / 241 tests`。
- 结构合同覆盖：Workbench 三栏、唯一 primary 状态、旧主体排除、Passkey/TOTP/设备入口。

## 证据缺口

当前浏览器没有可用的真实 Session，尚未输入敏感凭据，因此真实 API/权限/Vault 任务、四断点 Before/GLM Target/After 截图、Axe、键盘/Screen Reader、reduced-motion、overflow、runtime console 和无挂载镜像摘要仍待补齐。该路由暂不标记为 PO 独立验收通过。
