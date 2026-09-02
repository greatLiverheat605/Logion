# Audit GLM 一致性验收报告

## 当前结论

`/app/audit` 已从旧的单列审计面板重构为筛选优先的只读工作台：
`Filter Command Bar Master → Audit Timeline Main → Inline Event Detail Inspector`。
审计 API、分页 cursor、成功/其他结果筛选、目标类型筛选、事件 ID 和读取失败 request ID
语义均保留；页面不新增写操作，也不伪造不存在的字段。

- Workbench 三栏主体：已完成
- 首交互：筛选 / 搜索，不提供写入 primary
- 事件详情：当前页内 inline Inspector 展示
- 旧 `ProductPanel` / `planning-form` 主体：运行路由不再使用
- 真实 Session：已完成登录、Vault 解锁、本人事件读取、筛选、分页与刷新走查
- 四断点 After：已在无源码挂载的最新 `8080` Web 镜像重新生成
- Product Owner / GLM 统一验收：已通过（PO 表态于 `2026-08-29T00:41:13+08:00`；签字记录：`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`）

## GLM Target

设计基线来自：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_audit-390x844.png`

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_audit-1440x900.png`

GLM manifest 目标布局为：`AppShell → AuditCommandBar → AuditTimeline → InlineEventDetail`。

| Target | SHA-256 |
| --- | --- |
| `app_audit-390x844.png` | `b3a1ca161197b224c4acc121a3a61429255271c2a769e4fdb2a1e976b7a6aaa2` |
| `app_audit-1440x900.png` | `0d503bd2f1a73e6746fe1e388aac23b37ed616f1e21066765f491306431bbe0e` |

Target 资产需要 GLM/PO 复核：`app_audit-1440x900.png` 的文件名与 manifest hash 均匹配，
但当前文件画面内容显示为 Research 工作台而非 Audit 时间线。此处保留原始 hash，
不修改 Target manifest，也不以错误标注的 Target 代替视觉判断。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/audit` |
| Web image | `logion-web:0.1.0` / `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` |
| Web Created | `2026-08-28T10:56:55.712773556Z` |
| Web Started | `2026-08-28T10:57:09.332601338Z` |
| Web mounts | `0` |
| API / DB / Redis / Worker / Proxy | healthy；`/healthz` 返回 `200` |
| 业务数据 | 真实测试账号、真实 Session、真实 `/api/v1/audit/me` 响应；无 fixture 注入 |

## Before / After

### Before

```text
AuditLog
├─ 页面标题与说明
├─ 结果列表与筛选混在单列主体
├─ 事件字段只在列表中零散展示
└─ 无稳定的筛选 Master、详情 Inspector 和移动 pane 语义
```

### After

```text
Audit Workbench
├─ Header + 只读权限 / Sync / Vault Context Bar
├─ Master：关键词、结果分段、目标类型筛选
├─ Main：事件时间线、结果标签、目标和分页 cursor
└─ Inspector：事件字段、异常解释、当前查询范围
```

## 主任务与交互路径

```text
进入页面
→ 自动读取当前身份审计事件
→ 在 Filter Command Bar 输入关键词或切换结果 / 目标类型
→ 从时间线选择事件
→ Inspector 查看事件、结果、时间、目标与可追踪事件 ID
→ 使用“加载更多”读取下一页 cursor，或清除筛选恢复列表
```

筛选只作用于当前身份已获授权的事件集合，不扩大服务端权限范围；API 读取错误显示真实
request ID，事件详情不将 request ID 冒充成事件字段。

## Function Reachability 与状态

| 能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| 读取本人审计 | 页面初始化 / 刷新 | `GET /api/v1/audit/me?page_size=50` |
| 分页 | 时间线主操作 | 使用 API 返回的 `next_cursor`，追加且去重选择状态 |
| 结果筛选 | Master segmented buttons | `success` 与其他结果分段；服务端 success 查询参数保留 |
| 目标类型筛选 | Master filter group | 对已读取事件按真实 `target_type` 筛选 |
| 事件搜索 | Filter Command Bar | 搜索事件类型、结果、目标类型和目标 ID |
| 事件详情 | 时间线行 → Inspector | 真实事件 ID、时间、结果、目标类型 / ID |
| 读取失败 | Toolbar / Main EmptyState / Inspector | 错误消息含真实 request ID，并提供重新读取 |
| 空结果 | Main EmptyState | 清除筛选恢复路径；空账户记录不伪造数据 |

## 自动化验证

```text
pnpm --filter @logion/web test -- src/features/audit/audit-workbench.test.tsx --run
  passed: 70 files / 263 tests
pnpm --filter @logion/web typecheck
  passed
pnpm --filter @logion/web lint
  passed
```

定向合同覆盖 Workbench 三栏、唯一 primary、旧主体排除、筛选组合、事件选择、结果与事件 ID、
cursor 分页和刷新竞态保护。真实 Browser Session、四视口截图、overflow、唯一 primary、
runtime console 和无源码挂载镜像摘要已补齐；Axe、键盘 / Screen Reader、reduced-motion
继续由 Gate 2 全量 Browser harness 与 Product Owner 走查收口，不以静态测试替代视觉验收。

本轮真实 `8080` 走查补充：

```text
登录 → Vault 解锁 → /app/audit：本人审计事件流 50 条，事件详情 Inspector 可见
关键词 identity.login_succeeded：过滤为 1 / 50 条；清除筛选恢复全量
加载更多：首屏 50 条追加到 100 条；刷新后恢复 50 条
320 / 390 / 1024 / 1440：scrollWidth == clientWidth，唯一 primary 在视口内
Reverse proxy：GET /api/v1/audit/me?page_size=50 以及 cursor 请求均返回 200
```

### After 截图 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `audit-320x640.png` | `0D8F64C9A486F098615D23A0A71D912DB1786A3128156A0A5A5211149C17B8C3` |
| `audit-390x844.png` | `8A6E488F7BEBA709621DC119BFA98FAFE858DD299E2DF07E90BCCAA04FF1F6B2` |
| `audit-1024x768.png` | `047400520DEEA1BD760A76C512B6941744A7DF2A0A57A967352F43B426495F53` |
| `audit-1440x900.png` | `243CF63230ED8AAA762B2F3DA093436EF7C2A43F03489DBB2B647754E7FF6BF3` |

截图路径：`reports/ui-refactor/after/gate-2/`。320 / 390 移动端使用共享 pane switcher，
当前主 pane 为活动时间线；1024 / 1440 保持 Master → Main → Inspector 三栏。

## 证据边界与下一步

| 缺口 | 原因 | 下一步 |
| --- | --- | --- |
| 320 / 390 / 1024 / 1440 After 截图 | 已在最新无源码挂载镜像完成 | 已归档截图、hash、视口 geometry 与镜像摘要 |
| Before 同视口原图 | 历史审计资产未提供可复核原图 | 保留缺口，不伪造；由 Product Owner 决定是否接受 |
| 真实事件与拒绝结果 | 成功事件、筛选、分页、刷新已在真实 Session 完成；未人为制造生产错误 | denied / error request ID 继续由 API 错误合同与 route tests 覆盖，真实错误发生时保留 request ID |
| 无障碍与响应式 | 真实 `authenticated-shell` 四断点 geometry / primary 通过 | Axe、键盘、焦点与 reduced-motion 由既有全量 Browser harness 继续作为 Gate 2 统一门禁 |
| GLM 1440 Target 资产 | hash 匹配但视觉内容疑似误标为 Research | 等 GLM/PO 决定替换 Target 或记录正式偏离 |

在真实 Browser 证据与 Product Owner 独立验收前，不宣称 Audit 页面完成 Gate 2 视觉验收。

发布合同门：`pnpm contracts:check` 已通过；计划内 OpenAPI 生成物以独立提交 `94ff87e` 落地。Audit 运行时证据对应最新无源码挂载 Web image `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` 与正确 `logion-api:dev` image `sha256:332323a6e2e9435e3480e54130fe085a2fa1888eb3d221068e4feee179803152`，authenticated Chromium 全量矩阵 `46 passed / 0 skipped`。

## E3 统一验收状态

- Audit 1440 × 900 After 已在当前 `8080` 实例使用真实 Session 补拍；文件为 `reports/ui-refactor/after/gate-2/audit-1440x900.png`，SHA-256 为 `243cf63230ed8aaa762b2f3da093436ef7c2a43f03489dbb2b647754e7ff6bf3`。
- E3 验收包：`reports/ui-refactor/gate-2/e3-acceptance-package.md`。
- GLM / Product Owner 统一视觉与流程结论：**已通过**（PO 于 `2026-08-29T00:41:13+08:00` 表态；签字记录：`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`）。
- Audit GLM 1440 Target 的“文件名 / hash 匹配但画面疑似 Research”仍是已登记的证据事实；D1 裁定为 **接受现状（推荐）**，本补拍 After 与该裁定随签字文件归档。
