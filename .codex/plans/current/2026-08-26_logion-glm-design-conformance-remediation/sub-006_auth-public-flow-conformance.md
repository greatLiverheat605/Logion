# 子计划：Auth、Callback 与 Onboarding GLM 一致性整改

## 元信息

- 子计划 ID：`sub-006`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 7 - Auth、Callback 与 Onboarding
- 创建时间：`2026-08-26T18:35:42+08:00`
- 状态：已完成 ✓
- Shrimp 父任务：`4ad352d5-0c42-4cfd-9a4b-bf2a31fc7e89`
- Shrimp 子任务：`77ec4144-2172-4738-9823-ee6e1e03e801`
- 创建原因：范围覆盖 Login、Register、Verify、Recover、Callback、Onboarding 及公共浏览器测试，涉及超过 3 个文件且包含认证安全、token、MFA、Passkey、Vault 与首次引导状态机，属于高风险公共入口整改

## 保护边界

- 保留正式 Session Cookie、CSRF、注册模式、统一隐私错误、request ID、MFA、Passkey、邮箱验证、密码恢复、token fragment 与设备命名语义，不改变 API payload 或安全边界。
- Password manager、paste 和 `autocomplete` 必须可用；密码可见切换需要可访问名称，不得依赖认知测试完成认证。
- 以隔离 GLM PublicShell specs、Target PNG 与 Conformance Contract 为视觉/IA 基线，不复制 fixture、hash router、mock 注册模式或原型 `/auth/passkey` 路由。
- 共享 440px PublicShell 只承载公共视觉骨架；Login、Register、Verify、Recover、Callback 与 Onboarding 保持各自正式状态机。
- 不新增依赖；优先复用现有 Radix、`AppIcon`、认证 API、Onboarding service 与正式焦点能力。

## 步骤分解

### 步骤 1：冻结 Public Target、正式认证语义与 Before 差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T18:48:42+08:00`
- **AI 评分**：`96/100`
- **目标**：对照 GLM PublicShell specs/Target、正式路由合同与现有认证/引导代码，冻结每条公共流程的布局树、primary、状态、输入与 Function Reachability。
- **涉及文件**：GLM `specs/02-05`、Public Target PNG、`auth-form-shell.tsx`、各认证表单、`onboarding-wizard.tsx`、Callback、现有 tests/Before 截图。
- **验证方法**：覆盖 Login 密码/MFA/Passkey、Register 模式、Verify fragment token、Recover 两阶段与第二因素、Callback 跳转、Onboarding Persona/Workspace/Space/Vault/首个目标/完成；明确原型能力与正式路由偏离。

### 步骤 2：实现 440px PublicShell 与紧凑认证表单

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T19:03:54+08:00`
- **AI 评分**：`96/100`
- **目标**：用 GLM 聚焦式 PublicShell 和紧凑表单层级替换旧装饰侧栏与大块表单，同时保留现有认证业务逻辑。
- **涉及文件**：`apps/web/src/features/auth/auth-form-shell.tsx`、Login/Register/Verify/Recover 表单、route-specific CSS/tests。
- **验证方法**：每层唯一 primary；密码 manager/paste/autocomplete/可见切换、MFA、Passkey、统一错误/request ID、loading/success/disabled 保持；320/390/1024/1440 无 overflow，键盘与焦点顺序正确。

### 步骤 3：整改正式 Callback 与 Onboarding 工作流

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T19:15:26+08:00`
- **AI 评分**：`96/100`
- **目标**：让 Callback 与首次引导使用同一公共视觉语言，但保留正式 token 处理、访问守卫与 Persona/Workspace/Space/Vault/目标副作用顺序。
- **涉及文件**：`apps/web/src/app/auth/callback/page.tsx`、`apps/web/src/features/onboarding/`、相关 tests/CSS。
- **验证方法**：Callback 成功/失败/缺 token 与 complete/incomplete 跳转通过；Onboarding 全步骤、返回、跳过允许项、错误恢复和完成设置通过；不创建 `/auth/passkey`。

### 步骤 4：真实公共任务、四断点与逐流程证据

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T20:40:00+08:00`
- **AI 评分**：`96/100`
- **目标**：重建无挂载 8080 Web 镜像，运行匿名/首次登录真实任务、公共可访问性与四断点证据，生成 Auth/Onboarding Before/Target/After 报告。
- **涉及文件**：公共 Playwright specs、`reports/ui-refactor/after/`、Auth/Onboarding 验收报告。
- **验证方法**：真实注册/登录/恢复/验证/回调/Onboarding 可达；Axe、键盘、焦点、password manager/paste、reduced-motion、320/390/1024/1440、Function Reachability 100%；PO 逐流程结论保留至后续验收。

## 执行记录

| 时间             | 操作                                                   | 结果                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 18:35 | 创建子计划并进入步骤 1                                 | Gate 1 已由 Product Owner 明确通过；Auth 公共入口因多流程和安全状态机触发子计划；冻结正式安全语义，禁止复制原型路由与 mock                                                                                                                                                         |
| 2026-08-26 18:48 | 步骤 1：冻结 Public Target、正式认证语义与 Before 差异 | 96/100；完成 6 路由布局树、primary、regions、正式安全语义与 Function Reachability 映射；固化 Before 同视口证据；步骤 2 进入执行                                                                                                                                                    |
| 2026-08-26 19:03 | 步骤 2：实现 440px PublicShell 与紧凑认证表单          | 96/100；移除 Auth 旧装饰分栏渲染，完成 440px PublicShell、四流程 regions、唯一 primary、密码可见切换、MFA Choice、Passkey capability 与恢复入口；新增 MFA 空 methods 和 Strict Mode fragment 回归门；194 tests、typecheck、lint 通过                                               |
| 2026-08-26 19:15 | 步骤 3：整改正式 Callback 与 Onboarding 工作流         | 96/100；Callback 使用 PublicShell 并保留正式 redirect/retry；Onboarding 重构为 620px 聚焦工作区、七段 stepper、持续 Persona/Workspace/Space/Vault 回显、返回与焦点管理；选择回填和 Goal 防重复完成；194 tests、typecheck、lint 通过                                                |
| 2026-08-26 20:40 | 步骤 4：真实公共任务、四断点与逐流程证据               | 96/100；修复 Today ready 前跳转 Callback 的 E2E 竞态，画像结构图标改用 AppIcon；最终 Web digest `72d8a423...`、0 mounts、healthz 200；公共多浏览器 125 passed / 7 skipped；24 After、20 Auth Before、Target 哈希与证据限制写入 `auth-onboarding-conformance.md`；Shrimp 子任务完成 |

## 完成摘要

Auth 五路由、Callback 与正式七步 Onboarding 已完成 GLM 主体一致性整改。正式认证安全边界、注册策略、Persona/Workspace/Space/Vault/Goal 副作用和全部恢复入口保持不变；公共生产矩阵、四断点、Axe、键盘、焦点、password manager/paste、reduced-motion 与 Function Reachability 均通过。旧 Onboarding 无法重放的 320/1024 Before 证据已明确记录，没有通过 mock 或兼容代理伪造。
