# Templates GLM 一致性验收报告

## 当前结论

Templates 已完成主体工作台实现与真实任务质量门。正式页面从旧 `GrowthCenter` 的纵向 `ProductPanel` / `planning-form` 表单，重构为专属的 `Category Master / Template Detail Main / Template Inspector` 工作台；创建、导入、安装、分享与撤销均在 Radix Sheet 中完成。

- Templates Workbench 结构：已完成
- 旧 Templates `ProductPanel` / `planning-form` 主体：已从运行代码移除
- 模板版本、来源/许可/风险、独立副本安装、私有导入和只读分享语义：保留
- 创建版本 → 安装独立副本 → 非法/合法导入 → 一次性分享 → 撤销：真实闭环通过
- Web typecheck、lint、Vitest、Next production build：通过
- API Planning unit tests、ruff：通过
- 8080 Web 镜像：已重建并切换到无源码挂载镜像
- Playwright 真实任务、四断点、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary 和 runtime console：通过
- 安装审计事件明确记录 `source_scope`（官方目录为 `official_catalog`）：通过
- Product Owner 独立验收：已通过（2026-08-27；接受本报告登记的证据边界）

本轮保留正式 Workspace、Space、权限、模板版本、安装、分享 token 一次显示和撤销语义。除补齐只读 Goals GET 外，没有修改既有写入 API、sync-v1、数据库或权限模型。真实测试凭据只存在于 Playwright 进程环境，不写入仓库、计划或报告。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/templates` |
| Compose project | `logion-b1` |
| Git SHA | `70bb0a2b6d9d74a69118a649dfab750e6dd5adc6` |
| Git dirty 摘要 | 工作区存在计划内既有未提交变更；本报告只更新验收记录，不清理或回滚其他改动 |
| Web image | `logion-web:0.1.0` / `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` |
| Web image Created | `2026-08-28T10:56:55.712773556Z` |
| Web container Started | `2026-08-28T10:57:09.332601338Z` |
| Web mounts | `[]` |
| API / DB / Redis / Worker / Proxy | healthy；`/healthz` 返回 `200` |
| 业务 mock | 无；当前 Gate 2 矩阵使用真实 Session、Workspace、Space、权限、API、ProtectedOfflineRepository 与 sync-v1 |

当前正确 API 镜像上的全量 authenticated Chromium 矩阵为 `46 passed / 0 skipped / 0 unexpected`；Templates 专项闭环仍由本报告记录的真实创建版本、安装、导入、分享和撤销证据覆盖。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无可复核的历史同视口 Before | 未交付该视口 Target；按 GLM specs 与响应式合同验收 | [`after/app-templates-320x640.png`](after/app-templates-320x640.png) |
| 390 x 844 | 无可复核的历史同视口 Before | `app_templates-390x844.png`（manifest 校验） | [`after/app-templates-390x844.png`](after/app-templates-390x844.png) |
| 1024 x 768 | 无可复核的历史同视口 Before | 未交付该视口 Target；按 GLM specs 与响应式合同验收 | [`after/app-templates-1024x768.png`](after/app-templates-1024x768.png) |
| 1440 x 900 | 无可复核的历史同视口 Before | `app_templates-1440x900.png`（manifest 校验） | [`after/app-templates-1440x900.png`](after/app-templates-1440x900.png) |

不缩放、不裁切、不伪造 Before / Target。After 截图来自完成登录、真实 API 读取、创建模板版本、安装独立副本、导入模板包和分享撤销后的最终无源码挂载 Web 镜像；历史 Before 与 320/1024 Target 缺口按事实登记。

### After 截图 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app-templates-320x640.png` | `56F14A2A1E9FBC3E594BD4E4FF4CC4827EEB6822B43DBDE078CB2EA2FABE91E2` |
| `app-templates-390x844.png` | `5521661C42DFCBF705C06EA59BE239A6BA4A80F1FEF64F550AD2EE022D0CE1E4` |
| `app-templates-1024x768.png` | `22CDF6F737228B356A7A0A4A54EA657832D868DC796610F24BB6206EDC80750F` |
| `app-templates-1440x900.png` | `F1BD857893AB16BCD96E7CC4C5AFAD05049C78CDC8C8C65DD90969A68D5A0280` |

## 主体结构差异

### Before

```text
GrowthCenter
├─ ProductPageHeader + locked / empty 状态
├─ Workspace / Space / Goal 上下文表单
├─ 模板创建、导入、安装字段纵向平铺
├─ 模板版本与分享列表混合在 ProductPanel
└─ 分享 token / 撤销操作与普通字段同层
```

旧主体把目录筛选、模板详情、目标来源、安装日期和分享操作堆在同一条纵向流中；当前选择无法稳定形成 Master-Detail，低频输入与危险撤销也没有独立的焦点和影响范围。

### After

```text
Templates Workbench
├─ Workbench Header + 当前选择驱动的唯一 primary
├─ Context Bar + Workspace / Space / 权限 / Sync
├─ Category Master
│  ├─ 分类与可见性 segmented filter
│  ├─ 搜索结果计数
│  └─ 模板版本列表与选中态
├─ Template Detail Main
│  ├─ 元数据、来源、许可与风险
│  ├─ 版本变更和安装差异
│  └─ 目标 Space 与已安装副本回显
└─ Template Inspector
   ├─ 安装预览与相对日期要求
   ├─ 分享列表、一次性 token 和撤销入口
   └─ capability / 权限 / 同步状态
```

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 保持三栏可扫描工作面；320/390 px 采用 Category → Detail → Inspector 连续顺序。创建、导入、安装、分享与撤销全部进入 Radix Sheet；失败保留输入，成功后才关闭并回显结果。

## 主任务与交互路径

主任务是“在当前 Workspace / Space 中找到可信模板，核对版本与安装差异，并复制为独立计划”：

```text
自动带入 Workspace / Space / 权限 / Sync
→ Category Master 搜索或筛选模板
→ Detail Main 核对来源、许可、风险、版本与目标 Space
→ 唯一 primary 打开安装 Sheet
→ 若存在相对日期，选择安装起始日期
→ 确认安装，生成新的目标 / 计划 / 阶段 ID
→ Inspector 回显独立副本与同步状态
→ 低频入口进入创建 / 导入 / 分享 Sheet
→ 分享 token 只显示一次；撤销前确认影响范围与恢复路径
```

## Function Reachability

| 正式能力 | 新入口 | 当前验证 |
| --- | --- | --- |
| Workspace / Space / current device 加载 | Context Bar + controller | 真实 Session/API 页面通过，选择持续回显 |
| 模板目录与版本读取 | Category Master | `GET /api/v1/workspaces/{id}/templates`，搜索、可见性筛选和选中态通过 |
| 目标来源读取 | controller Goals GET | 真实目标列表用于创建/分享来源选择，权限复用既有 Workspace/Space context |
| 创建模板版本 | Header `创建模板` / Inspector → Create Sheet | 正式 `POST .../templates/from-goal` payload 与新版本回显通过 |
| 安装独立副本 | 唯一 primary `安装独立副本` → Install Sheet | 相对日期校验、目标 Space、独立 ID 语义与安装后目标回显通过 |
| 导入模板包 | 更多操作 → `导入模板包` Sheet | JSON 根节点、1 MB 上限、非法输入保留、合法导入通过 |
| 创建只读分享 | 更多操作 / Inspector → Share Sheet | 有效期、字段最小化、正式 source goal/space payload 通过 |
| 一次性 Token | 分享成功状态 | 链接可打开；刷新 Templates 后 token 不再显示 |
| 撤销分享 | Share row → `撤销` Sheet | `expected_version`、影响范围、权限与不可逆恢复路径通过 |
| capability / 权限 / offline / error | Context Bar + State Notice + disabled actions | Reviewer/Viewer、离线、403、409、错误和 stale 均有可见说明或恢复入口 |
| 同步与请求编号 | Context Toolbar / State Notice | `sync-v1`、Outbox、request ID 和重试语义保留 |

## 状态与危险操作

`loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 继续由正式 `ProductWorkbenchState`、Templates controller 和 API 错误驱动。模板安装在相对日期缺失时阻止提交并保留 Sheet；模板导入在 JSON 无效或超过 1 MB 时不上传并保留输入；分享成功后 token 只在当前响应中显示。撤销 Sheet 明确“当前 Workspace 的这条链接”、所需写权限、原链接立即失效和不可逆恢复路径。

## 验证记录

```text
pnpm --filter @logion/web typecheck       passed
pnpm --filter @logion/web lint            passed
pnpm --filter @logion/web test -- --run   60 files / 230 tests passed
pnpm --filter @logion/api test planning   passed
pnpm --filter @logion/api lint (ruff)     passed
pnpm --filter @logion/web build           passed
docker compose -p logion-b1 build web    passed (`logion-web:dev`)
/healthz                                  200
pnpm exec playwright test tests/browser/templates-workbench.spec.ts --project=authenticated-chromium
                                           passed (1 test, 15.8s, latest rebuilt image)
                                           real Session/API/Workspace/Space/permission writes completed
                                           320/390/1024/1440, Axe, keyboard/focus,
                                           reduced-motion, overflow, unique primary and
                                           runtime console checks passed
uv run --package logion-api pytest -m integration apps/api/tests/test_growth_integration.py
  -k official_templates_are_global_readable_installable_and_tenant_isolated
                                           passed (1 test, source_scope audit assertion)
```

真实规格覆盖：创建目标 → 创建模板版本 → 安装独立副本 → 非法 JSON 拒绝且 Sheet 保留 → 合法 JSON 导入 → 创建一次性只读分享 → 刷新后 Token 不再显示 → 撤销分享。

## 偏离与证据边界

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 补齐 `GET /workspaces/{workspace_id}/spaces/{space_id}/goals` | Templates 原真实流程需要读取来源目标，但正式 API 原先只有 POST，GET 返回 `405` | 新增只读路由，复用既有 Workspace/Space 权限和 `GoalPlanResponse`；不改变 POST、sync-v1、数据库或权限模型 | Product Owner 已接受（Templates 独立验收） |
| 移动控件至少 44 x 44px | WCAG 与移动触达要求 | 只扩大点击区，不改变 GLM 信息层级 | 延续 Gate 1 已接受约束 |
| Before 缺少同视口历史原图 | 历史审计资产未提供可追溯的 320/390/1024/1440 Templates 原图 | 原始缺口如实记录，不缩放、不裁切、不伪造 | Product Owner 已接受（Templates 独立验收） |
| Target 只提供 390 / 1440 | 批准 GLM artifact 未交付 Templates 的 320 / 1024 Target | 320/1024 以 GLM specs、Workbench 几何、响应式与无障碍合同验收 | Product Owner 已接受（Templates 独立验收） |

除上述项目外，没有 route-specific 偏离。自动化通过证明实现可运行、可达且未破坏正式合同；Product Owner 已完成 Templates 信息密度、三栏层级、首屏主任务和证据边界的独立签字。

发布合同门：`pnpm contracts:check` 已通过；计划内 OpenAPI 生成物以独立提交 `94ff87e` 落地，Templates 的官方目录与 Goals GET 合同现在与生成产物一致。

## Product Owner 独立验收记录

2026-08-27，Product Owner 在真实 `http://127.0.0.1:8080/app/templates` 以 1440 / 390 为主视口并抽查 320 / 1024，确认以下项目：

1. Category Master 的筛选、搜索、版本选中态与 Workspace / Space 上下文持续回显。
2. Detail Main 是否明确显示来源、许可、风险、版本和安装差异。
3. 从唯一 primary 安装独立副本，检查目标 Space、相对日期和安装后副本回显。
4. 创建、导入、分享和撤销是否在 Sheet 中完成，失败是否保留输入，成功是否正确关闭。
5. 分享 token 是否只显示一次，刷新后是否不再泄露；撤销是否解释影响范围和恢复路径。
6. 对照 390 / 1440 GLM Target 判断三栏层级、信息密度和主任务编排。
7. 接受新增 Goals GET 的只读偏离，以及 Before / 320/1024 Target 证据缺口。

验收结论：`Templates 独立验收通过`。该独立 Gate 已关闭，后续统一 GLM / PO Gate 2 仍按父计划执行。

## E3 统一验收状态

Templates 的独立 PO Gate 已于 `2026-08-27` 通过；父计划的 E3 统一 GLM / PO 签字已于 `2026-08-29T00:41:13+08:00` 完成，当前状态为 **已通过**。签字记录：`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`；验收包：`reports/ui-refactor/gate-2/e3-acceptance-package.md`。Audit 1440 Target 已由 D1 裁定“接受现状（推荐）”，合同提交 `94ff87e` 已由 D2 追认。
