# 子计划：GLM Token、Shell 与共享 Primitives 校准

## 元信息

- 子计划 ID：`sub-002`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 2 - 校准全局 token、Shell 与共享 primitives
- 创建时间：`2026-08-26T14:27:45+08:00`
- 状态：已完成 ✓
- 完成时间：`2026-08-26T14:57:02+08:00`
- AI 评分：96/100
- 创建原因：涉及全局 token、Shell、Workbench、Radix adapters 与组件/浏览器测试，超过 3 个文件且属于高影响共享层

## 保护边界

- 保留当前 `globals.css` 中用户已有 Auth/PublicShell 视觉改动，不回退 access/auth 布局。
- 保留 AppShell 的真实 Workspace/角色、Persona、Vault、通知、CSP nonce 与 overlay 行为。
- 保留现有 Radix 依赖和 adapter props；不新增 UI 包，不复制 GLM overlay。
- 全局 CSS 只承载 token、Shell 和共享 primitive，不新增路由领域选择器。
- 移动触达保持至少 44x44px，不降回 GLM 原型的 40px。

## 步骤分解

### 步骤 1：校准 GLM token 与 App Shell 几何

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:57:02+08:00`
- **结果**：Light/Dark semantic token、232px Sidebar、48px Topbar 与稳定 Shell test id 已校准；真实 Workspace、角色、Persona、Vault、通知和 CSP nonce 行为保持不变。
- **目标**：建立 GLM light/dark token 兼容映射，固定 232px Sidebar、48px Topbar，并接入 `app-sidebar`、`app-topbar`、`app-main` test id。
- **涉及文件**：`apps/web/src/app/globals.css`、`apps/web/src/components/app-shell/app-shell.tsx`、对应 Shell tests。
- **验证方法**：token/几何断言通过；真实上下文、CSP nonce、菜单与移动抽屉不回退。

### 步骤 2：校准 Workbench 几何与区域语义

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:57:02+08:00`
- **结果**：共享 Workbench 固定 264px Master、316px Inspector 与 1100/720 响应式；移除 Today 对共享列宽的过期覆盖，区域 test id 与唯一 primary 合同通过。
- **目标**：固定 Desktop Master 264px、Inspector 316px，按 1100/720 断点实施三栏、收 Inspector、移动 pane switcher，并接入共享区域 test id。
- **涉及文件**：`apps/web/src/components/product/workbench.tsx`、`apps/web/src/components/product/workbench.css`、`workbench.test.tsx`。
- **验证方法**：组件结构、pane 键盘可达、test id、三档响应式与唯一 primary 合同通过。

### 步骤 3：验证 Radix、reduced-motion 与四断点共享基线

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:57:02+08:00`
- **结果**：Web 46 文件 172 测试、typecheck、lint、Prettier、production build 通过；真实 8080 的四断点 overflow/primary、焦点恢复、reduced-motion、三样板 Axe 与 GLM 几何全部通过，依赖未新增。
- **目标**：保持 Dialog/Sheet/Menu/Tabs 的 SSR、焦点恢复、Esc 与键盘行为；验证 320/390/1024/1440 Shell 无溢出且依赖清单不变。
- **涉及文件**：`apps/web/src/components/product/headless-ui.tsx`、现有 compatibility/component/browser tests。
- **验证方法**：Web test/typecheck/lint、Playwright discovery/目标走查、Prettier、依赖 diff 和 GLM geometry helper 通过。

## 执行记录

| 时间             | 操作                   | 结果                                                          |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| 2026-08-26 14:27 | 创建子计划并进入步骤 1 | 执行中；明确保护 Auth、真实 Workspace 上下文和现有 Radix 行为 |
| 2026-08-26 14:57 | 步骤 1：Token 与 Shell | 完成；232/48 几何、双主题 token 与稳定 test id 通过           |
| 2026-08-26 14:57 | 步骤 2：Workbench      | 完成；264/316 几何、1100/720 响应式与 Today 覆盖冲突已修复    |
| 2026-08-26 14:57 | 步骤 3：共享验收       | 96/100；真实 8080、Axe、焦点、reduced-motion 与构建全部通过   |
