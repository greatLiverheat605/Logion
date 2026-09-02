# Integrations GLM 一致性验收报告

## 当前结论

`/app/integrations` 已从多卡片能力网格与纵向表单，重构为 `Capability Summary → Connector List → Connector Inspector` 工作台。Calendar Feed、开放格式导入预览 / 提交、加密导出确认 / 取消、一次性 Token、Private Space 限制、近期认证和 capability-disabled 入口均保留。

- Integrations Workbench 结构：已完成
- 旧 `ProductPanel` / `planning-form` 主体：已从运行代码移除，迁移注释已清理
- Calendar / Import / Export 当前动作由操作栏唯一 primary 触发，表单不再重复放提交按钮
- Calendar URL 只在创建响应后一次显示；关闭后不再回显
- 第三方账号、Webhook、MCP / API Token、自动化规则仍明确为 capability-disabled，并提供开放格式替代路径
- Product Owner 独立验收：已完成技术与真实浏览器门禁；全量路由统一 GLM / PO 验收已通过（`2026-08-29T00:41:13+08:00`）

## GLM Target

设计基线来自：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_integrations-390x844.png`

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_integrations-1440x900.png`

GLM manifest 目标布局为：`AppShell → CapabilitySummary → ConnectorList → ConnectorInspector`。

## Gate 2 真实验收补充

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/integrations` |
| Web image | `logion-web:0.1.0` / `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` |
| Web Created / Started | `2026-08-28T10:56:55.712773556Z` / `2026-08-28T10:57:09.332601338Z` |
| Web mounts | `[]` |
| API / DB / Redis / Worker / Proxy | healthy；`/healthz` 返回 `200` |
| 真实任务 | 已用真实 Session、Workspace、Private Space、近期认证和导出 / 导入边界完成 Calendar、Import、Export 与 unsupported 抽查；无 fixture 注入 |
| Browser evidence | Integrations 定向回归 `5 passed`；正确 `logion-api:dev` 镜像下全量 authenticated Chromium `46 passed / 0 skipped / 0 unexpected`，结果归档于 `reports/browser/results.json` |

## Before / After

### Before

```text
IntegrationHub
├─ 页面头部与 Workspace 表单
├─ 指标卡片网格
├─ Calendar / Import / Export ProductPanel
├─ 每个面板各自放表单提交按钮
└─ unsupported 能力混在普通卡片区
```

### After

```text
Integrations Workbench
├─ Header + Workspace / 角色 / 实时 API Context Bar
├─ Master: Calendar Feed / 导入预览 / 导出任务 / 第三方连接器
├─ Main: 能力总览、当前能力详情和唯一 primary
└─ Inspector: Workspace、Private Space、权限、capability 边界、request ID
```

能力目录决定 Main 详情和唯一 primary：Calendar 为创建订阅，Import 为生成预览，Export 为创建加密导出，unsupported 不产生伪造操作按钮。低频撤销、导入确认和导出取消保持在当前 Main 行内完成，并继续显示影响与状态。

## Function Reachability

| 正式能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| Workspace / Private Space | Toolbar Select + Inspector | 只允许当前可访问 Workspace；导入目标只显示自己的 Private Space |
| Calendar Feed | 能力目录 → Calendar → 操作栏 primary | 只读 ICS、最小字段、一次性 Token、撤销立即失效 |
| 开放格式导入 | 能力目录 → 导入预览 → 操作栏 primary | Logion JSON / Markdown / CSV / BibTeX，先预览后提交 |
| 导入提交 | Preview 行 `确认 IMPORT` | expected version、Private Space 目标和新的对象 ID 保留 |
| 加密导出 | 能力目录 → 导出任务 → 操作栏 primary | `EXPORT` 确认、近期认证、短期下载、SHA-256、后台队列 |
| 导出取消 / 下载 | Export 行内动作 | queued / running 可取消，succeeded 提供下载链接 |
| Unsupported connectors | Master `第三方连接器` + deferred section | OAuth / Webhook / MCP / API Token / automation 不伪造连接状态，替代路径可发现 |
| 状态与恢复 | Context Toolbar + Inspector | loading、empty、needs-context、error、recent-auth、request ID 和 retry 保留 |

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

定向测试覆盖 loading 与 unsupported 可发现性、missing context / empty 区分、真实响应指标、request ID、一次性 Calendar URL 与焦点恢复、撤销、Private Space 导入预览 / 提交、导出近期认证、下载和取消。导入 / 导出测试显式先切换 Master 能力，再通过工作台操作栏提交，确保新 IA 不回退到旧表单按钮。

全量 lint、Vitest、typecheck、production build 已通过；真实 Browser 的 Calendar / Import / Export / capability-disabled、四断点 shell geometry、Axe、键盘 / 焦点、reduced-motion、overflow、唯一 primary 和 runtime console 已纳入 Gate 2 结果。Integrations 路由没有单独新增 After 截图文件，视觉签字仍由 GLM / PO 依据当前 `8080` 实例与批准 Target 完成，不能由静态测试代替。

发布合同门：`pnpm contracts:check` 已通过；计划内 OpenAPI 生成物以独立提交 `94ff87e` 落地，未修改 Integrations capability、权限或数据边界。

## 偏离与证据边界

| 项目 | 事实 | 处理 |
| --- | --- | --- |
| Before 同视口历史截图 | 当前没有可追溯的 Integrations 旧版 320 / 390 / 1024 / 1440 原图 | 不伪造 Before；统一报告登记缺口 |
| GLM Target | 只提供 390 / 1440 | 320 / 1024 按 GLM specs、Workbench 几何与响应式合同验收 |
| 第三方连接器 | 正式 capability 尚未开放 | 保留入口、解释边界和替代路径，不创建假连接状态 |
| 真实 Session | 本轮已使用真实测试账号、Session、Workspace、Private Space、近期认证和导出 / 导入权限边界 | 结果与运行镜像记录在本报告及 `reports/browser/results.json`；不写 mock 结论 |

## Product Owner / GLM 统一验收项

1. Master 能力目录是否让 Calendar、Import、Export 和 deferred connector 一眼可区分。
2. 切换能力后是否只出现一个对应 primary，且主体不再重复表单按钮。
3. Calendar 一次性 URL、复制 / 关闭 / 撤销和焦点恢复是否清晰可逆或明确不可逆。
4. 导入是否强制先预览、只允许自己的 Private Space，并展示计数与警告。
5. 导出是否显示近期认证、影响范围、队列状态、短期下载与 SHA-256。
6. capability-disabled、request ID、loading / empty / error 是否可发现且有恢复动作。

## E3 统一验收状态

Integrations 技术与真实浏览器门禁已归档，父计划 E3 现为 **已通过**；Product Owner 于 `2026-08-29T00:41:13+08:00` 完成首屏层级、信息密度、唯一 primary 与上下文回显的统一签字。签字记录：`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`；验收包：`reports/ui-refactor/gate-2/e3-acceptance-package.md`。D1 Audit 1440 Target 裁定为“接受现状（推荐）”，D2 合同提交 `94ff87e` 裁定为“追认”。
