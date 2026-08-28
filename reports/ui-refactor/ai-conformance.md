# AI GLM 一致性验收报告

## 当前结论

`/app/ai` 已从 Provider、模型、路由、预算、运行和草稿的纵向主体堆叠，重构为 GLM 目标的双视图治理工作台：运行 / 草稿审查视图与 Provider / 模型设置视图。正式 API、Workspace 角色、发送来源预检、预算、运行取消、草稿批准 / 拒绝和 Provider 密钥边界均保留。

- AI Workbench 结构：已完成
- 旧 `ProductPanel` / `planning-form` 主体：已从 AI 运行代码移除
- Provider credential：只提交服务端加密保存，永不回显到 DOM、IndexedDB、日志或导出
- AI 发送：来源确认 → route-resolution preview → Provider / model / budget / scope 最终确认 → 入队
- 草稿：待人工审查，批准或拒绝不自动覆盖正式对象
- Provider 设置：连接测试、模型发现、模型能力、任务路由和 Token 预算均保留
- capability / 403 / offline / budget / request ID：保留明确状态与恢复路径
- Product Owner 独立验收：已完成技术与真实浏览器门禁；全量路由统一 GLM / PO 验收已通过（`2026-08-29T00:41:13+08:00`）

## GLM Target

设计基线来自：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_ai-390x844.png`

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_ai-1440x900.png`

GLM manifest 目标布局为：`AppShell → DraftProviderSegmented → DraftReviewSplit → RunAuditInspector`。移动端工作台由共享 `WorkbenchFrame` 进入 pane switcher，桌面端保持 Master / Main / Inspector 的连续工作区。

## Gate 2 真实验收补充

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/ai` |
| Web image | `logion-web:0.1.0` / `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` |
| Web Created / Started | `2026-08-28T10:56:55.712773556Z` / `2026-08-28T10:57:09.332601338Z` |
| Web mounts | `[]` |
| API / DB / Redis / Worker / Proxy | healthy；`/healthz` 返回 `200` |
| 真实任务 | 已用真实 Session、Workspace、权限和 Provider 边界完成 AI 导航、草稿 / Provider 视图与错误恢复抽查；无 fixture 注入 |
| Browser evidence | AI 定向回归 `8 passed`；正确 `logion-api:dev` 镜像下全量 authenticated Chromium `46 passed / 0 skipped / 0 unexpected`，结果归档于 `reports/browser/results.json` |

## Before / After

### Before

```text
AI 页面
├─ Provider 配置表单
├─ 模型列表与能力输入
├─ 路由字段纵向表单
├─ 预算字段
├─ 运行创建字段
└─ 草稿审查与运行历史混在同一长流
```

### After

```text
AI 草稿审查 Workbench
├─ Header + Workspace / 权限 / Vault / Sync Context Bar
├─ Master: 运行队列 / 待审草稿 tabs
├─ Main: 草稿审查、发送前确认、运行历史
└─ Inspector: Workspace、发送边界、操作状态

AI 模型设置 Workbench
├─ Header + Provider 入口
├─ Master: Provider / 模型 / 任务路由 / 预算目录
├─ Main: 当前治理 tab 与唯一 primary
└─ Inspector: 服务端密钥边界、权限、预算与状态
```

低频创建 / 编辑全部进入 Radix `WorkbenchSheet`；当前视图只保留一个明确 primary。Provider 视图没有已选 Provider 时 primary 是“新增 Provider”，选中 Provider 后切换为“测试并发现模型”；路由和预算 tab 分别切换为创建 / 编辑操作。

## Function Reachability

| 正式能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| Workspace 与角色 | Toolbar Select + Context Bar | 当前 Workspace 持续回显，viewer / offline 不越权 |
| 创建结构化 AI 草稿 | 运行 / 草稿 Master 底部 primary → Sheet | 任务、目标、发送字段、输出字段、预算和来源确认仍必填 |
| 来源与预算预检 | Sheet 提交后进入 Main 确认区 | Provider、模型、Token、费用、数据范围可见，修改后需重新预检 |
| 发送到 Provider | Main 的最终确认 primary | 明确 consent 后才写入真实 runs API |
| 取消运行 | 队列行 / 运行历史 | 服务端 expected version 与安全检查点语义不变 |
| 草稿批准 / 拒绝 | 待审草稿 Main | submitter value 正确映射 accepted / rejected，正式对象不自动覆盖 |
| Provider / 模型 / 路由 / 预算 | 设置 Master + tab + Sheet | 真实 API、409/version、权限和连接测试边界保留 |
| Credential 边界 | Provider Sheet + Inspector | 密钥输入为 password，响应只回 `credential_configured`，不进入 DOM |

## 自动化验证

```text
pnpm --filter @logion/web lint       passed
  pnpm --filter @logion/web test       70 files / 263 tests passed
pnpm --filter @logion/web build      passed; 35 routes generated
pnpm --filter @logion/web exec vitest run \
  src/features/ai/ai-workbench.test.tsx \
  src/features/integrations/integration-hub.test.tsx
  2 files / 10 tests passed
```

AI route-specific Vitest 覆盖 Workbench regions、唯一 primary、Sheet 打开、密钥不进入 DOM、草稿批准请求和旧主体标记缺失。Integrations 定向测试覆盖能力切换后操作栏提交、Calendar 一次性 URL、私有 Space 导入、导出近期认证、取消和 request ID。

全量 lint、Vitest、typecheck、production build 已通过；真实 Browser 的 AI 导航、权限 / request ID、四断点 shell geometry、Axe、键盘 / 焦点、reduced-motion、overflow、唯一 primary 和 runtime console 已纳入 Gate 2 结果。AI 路由没有单独新增 After 截图文件，视觉签字仍由 GLM / PO 依据当前 `8080` 实例与批准 Target 完成，不能由静态测试代替。

发布合同门：`pnpm contracts:check` 已通过；计划内 OpenAPI 生成物以独立提交 `94ff87e` 落地，未修改 AI 行为或权限语义。

## 偏离与证据边界

| 项目 | 事实 | 处理 |
| --- | --- | --- |
| Before 同视口历史截图 | 当前没有可追溯的 AI 旧版 320 / 390 / 1024 / 1440 原图 | 不伪造 Before；统一报告登记缺口 |
| GLM Target | 只提供 390 / 1440 | 320 / 1024 按 GLM specs、Workbench 几何与响应式合同验收 |
| 真实 Session | 本轮已使用真实测试账号、Session、Workspace、权限和 Provider 边界 | 结果与运行镜像记录在本报告及 `reports/browser/results.json`；不写 mock 结论 |

正式行为、权限、Provider 密钥保护和 sync-v1 合同优先于原型 fixture；没有删除任何正式 AI 能力。

## Product Owner / GLM 统一验收项

1. 运行 / 草稿 Master 是否能快速切换运行队列与待审草稿，且 Main 不再是旧长表单。
2. 发送前确认是否清晰显示来源、Provider、模型、Token、费用和结果边界。
3. 草稿批准 / 拒绝是否保持人工决定，批准后不自动覆盖正式对象。
4. Provider 密钥是否仅在输入瞬间可见，页面、响应和导出中均不回显。
5. 设置 tab 的唯一 primary、Sheet、权限和 offline 状态是否符合 GLM 目标。

## E3 统一验收状态

AI 技术与真实浏览器门禁已归档，父计划 E3 现为 **已通过**；Product Owner 于 `2026-08-29T00:41:13+08:00` 完成首屏层级、信息密度、唯一 primary 与上下文回显的统一签字。签字记录：`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`；验收包：`reports/ui-refactor/gate-2/e3-acceptance-package.md`。D1 Audit 1440 Target 裁定为“接受现状（推荐）”，D2 合同提交 `94ff87e` 裁定为“追认”。
