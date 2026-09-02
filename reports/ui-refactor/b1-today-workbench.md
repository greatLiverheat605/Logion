# B1 Today GLM 一致性验收报告

## 当前结论

Today 已按批准的 GLM 信息架构完成实现与 AI 自检：正式页面从“结构上已有三栏、主体仍缺关键信息”的旧工作台，整改为 Queue Master、NEXT ACTION Main、Task Context Inspector 与主列连续信息区。真实任务、会话、证据、人工验收、Persona、Workspace、Space、Vault 与 sync-v1 语义均由正式 controller 驱动，没有引入 GLM fixture、mock 数据、hash router 或旧 Center 渲染分支。

- 自动化真实流程：通过
- 四断点截图、几何与区域合同：通过
- Axe、键盘、焦点恢复、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%
- Product Owner 视觉与任务验收：**待 Gate 1 明确签字**

自动化通过只证明实现可运行、可达且未破坏合同，不代表 Product Owner 已批准视觉层级。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/today` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Persona、Workspace、Space、Vault、IndexedDB、ProtectedOfflineRepository、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 48 项；保留用户与计划内既有改动，未自动提交或回滚 |
| Web image | `sha256:f252645fb1e101f2621bd6c2dc73d17872ddd5f22786d9b578841a8e185ce7f4` |
| Web image Created | `2026-08-26T07:31:00.75669628Z` |
| Web container Started | `2026-08-26T07:31:02.359042745Z` |
| Proxy container Started | `2026-08-26T07:31:13.13440252Z` |
| 运行状态 | Web、Proxy healthy；`/health` 200；Web mounts 为 0 |

本轮只重建 Web 与 reverse-proxy；API、Postgres、Redis、worker 和已有数据卷未重建、未清空。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | [Before](before/app-today-320x640.png) | `app_today-320x640.png` | [After](after/app-today-320x640.png) |
| 390 x 844 | [Before](before/app-today-390x844.png) | `app_today-390x844.png` | [After](after/app-today-390x844.png) |
| 1024 x 768 | [Before](before/app-today-1024x768.png) | `app_today-1024x768.png` | [After](after/app-today-1024x768.png) |
| 1440 x 900 | [Before](before/app-today-1440x900.png) | `app_today-1440x900.png` | [After](after/app-today-1440x900.png) |

全部 Before/After 图片的像素尺寸与文件名一致。Target 文件存在性、视口和 SHA-256 由 `reports/ui-refactor/glm-target-manifest.json` 固定。

| 视口 | Target SHA-256 | After SHA-256 |
| --- | --- | --- |
| 320 | `6e968f533d9dc665d00070106025fe46da34d2d61718562376ba153564230c27` | `871d3b0749d06e440546dd0bf989a65c655832f95ca1056766c718e5877846dd` |
| 390 | `92f1a276e422c34a2fab118e02cdf3d7f0e4cc33caf9aac89c16b07d73913fb2` | `2b68943ab3babdea3e2e79b8829e1102eb57017ac362d215243f555903b49fb7` |
| 1024 | `dbc4d4152bb2b83f4197d022b1e66871325fcaea003a2db94834a0684bae2fd6` | `28ab5e7c94de863c8a9094726c4d4c25eaa5ba8a24ddde8734aa6924dc58e322` |
| 1440 | `45237a580d7af2cb47477efd5c805d7cca6d38549c63bacbd961b11bb0a261ce` | `b311ff8bc7db8675a0d18f63c0f30bebcf0cbd23f4627beb3719e16bf2bf1935` |

320 Target 本身存在重复拼接伪影，因此只用于文件完整性和视口验收，不作为像素匹配依据；该视口的结构判断采用 GLM specs，并与 390/1024/1440 Target 交叉核对。这是 Target 证据限制，不是正式实现偏离。

## 主体结构差异

### Before

```text
Today Workbench
├─ Header
│  ├─ 今日信号 Dialog 入口
│  ├─ 立即同步
│  └─ 新建任务
├─ Context Bar
├─ Workspace / Space Select Toolbar
└─ Workbench Frame
   ├─ Queue Master
   ├─ NEXT ACTION Main
   │  └─ 当前动作与执行轨迹
   └─ Task Context Inspector
      └─ 证据、验收、会话与链接
```

旧实现虽然摆出了三栏，但 GLM 要求首屏可见的证据与人工验收、今日信号和 14 天趋势被降入 Inspector 或 Sheet；额外 Select Toolbar 重复要求系统已知上下文。小屏再把 Queue/Main/Inspector 切成互斥 pane，形成“桌面缩成分页器”的错误阅读顺序。

### After

```text
Today Workbench
├─ Workbench Header
│  ├─ 今日驾驶舱与正式任务说明
│  ├─ 立即同步 icon action
│  └─ 新建任务 secondary action
├─ Context Bar
│  └─ Workspace / Space / Persona / 权限 / Vault / Sync 持续回显
└─ Workbench Frame
   ├─ Queue Master
   │  ├─ 今日任务列表
   │  └─ 完成 / 阻塞 / 待验收计数
   ├─ Main Workspace
   │  ├─ NEXT ACTION 与唯一状态化 primary
   │  ├─ 证据与人工验收
   │  ├─ 今日信号与 Persona 详情 Sheet
   │  └─ 14 天真实执行趋势
   └─ Task Context Inspector
      ├─ 属性与说明
      ├─ 证据 / 验收 / 会话历史
      └─ 审计与同步入口
```

1440 px 保持 264px Master、弹性 Main、316px Inspector；1024 px 保持 Master/Main 并让 Inspector 在下方可达；320/390 px 按 Queue → Main → Inspector 连续纵向阅读，不再使用 pane switcher 或固定 action tray。Vault locked 时恢复动作会提前到移动可见区域。

## 主任务与交互路径

主任务是“推进当前下一动作，并附加证据与显式人工验收”。路径保持在 Today 当前上下文内：

```text
解锁 Vault
→ 选择或新建任务
→ 开始专注
→ 结束会话并记录实际投入
→ 添加证据
→ 提交待验收
→ 由有权限成员明确决定验收
→ 关闭已验收任务
```

NEXT ACTION 中的 primary 随正式状态变化，但每个可见交互层最多只有一个：安排到今天、开始专注、结束会话、补充证据、提交验收决定、关闭已验收任务或无任务时新建任务。结束会话不会自动完成任务，证据不会自动成为验收结论。

## 组件映射

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份与命令 | `WorkbenchHeader` + `WorkbenchTooltip` | 同步为命名 icon action，新建任务为 secondary |
| 上下文回显 | `WorkbenchContextBar` | 自动带入已知上下文，不提供重复 Select 表单 |
| 连续工作面 | `WorkbenchFrame` | Master/Main/Inspector 稳定 landmarks 与响应式顺序 |
| 当前状态主操作 | `WorkbenchActionBar` | 当前可见层唯一 primary；低频状态变更进入 Dropdown Menu |
| 任务属性与历史 | `InspectorSection` | 扫描式属性、证据、验收、会话，不套页面卡片 |
| 低频输入 | `WorkbenchSheet` | 新建、结束会话、证据、验收、阻塞；最多二级披露 |
| 状态恢复 | `ProductOperationalStateNotice` | 真实 loading/offline/permission/409 等状态与 button/link recovery |
| Persona 信号 | `PersonaTodayOverview` | 主列显示真实指标，详情 Sheet 保持焦点恢复 |

## Function Reachability

| 正式能力 | 新入口 | 真实验证 |
| --- | --- | --- |
| Workspace / Space / Persona / 权限 / Vault / Sync 上下文 | Context Bar | 真实上下文持续回显，通过 |
| Vault 解锁 | locked Main recovery | 移动与桌面可达，通过 |
| 创建任务并关联目标/阶段 | Header 或空状态 primary → New Task Sheet | 真实 API/Repository 闭环通过 |
| 队列选择 | Queue Master | 选中态与 Inspector 同步，通过 |
| backlog / planned / in-progress / blocked / submitted 状态 | NEXT ACTION primary + Task Menu + Block Sheet | controller/component tests 通过 |
| 开始专注会话 | NEXT ACTION primary | 真实会话通过 |
| 结束会话与实际分钟 | Finish Session Sheet | 真实会话通过；不自动完成任务 |
| 添加 text/link/note/resource 证据 | 证据区 action → Evidence Sheet | 真实证据通过；HTTP(S) 约束保留 |
| 显式人工验收 | NEXT ACTION primary → Verification Sheet | 真实 passed decision 通过 |
| 关闭已验收任务 | NEXT ACTION primary | 真实闭环通过 |
| Persona 今日信号 | 主列 4 指标 + Persona 详情 Sheet | 真实 dashboard model 通过 |
| 14 天执行趋势 | 主列趋势区 | 真实 completed session 数据驱动，通过 |
| sync-v1 手动同步 | Header “立即同步” icon action | 真实同步通过 |
| offline / locked / permission / 409 / stale 等恢复 | Operational State Notice | shared state 与 controller tests 通过 |
| 审计与同步详情 | Inspector links | 正式路由可达，通过 |

`TodayControllerResult.commands` 的全部正式 command 均由新 View 消费或通过可发现入口触达，Function Reachability 为 100%。

## 响应式与无障碍

- 320、390、1024、1440：document 和可见元素无横向溢出、遮挡或不可达操作。
- 四视口 GLM 六区域均存在：`today-queue`、`today-next-action`、`today-evidence`、`today-signals`、`today-trend`、`today-inspector`。
- 四视口 Axe 对 `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa` 零 violation。
- 当前可见层 `data-workbench-primary="true"` 不超过 1，且 primary 位于可达区域。
- Persona Sheet 支持 Escape，关闭后焦点恢复到“画像详情”；Sheet 首字段获得焦点。
- `prefers-reduced-motion: reduce` 下 animation/transition duration 满足审计阈值。
- 移动控件保持至少 44x44px 触达，这是相对 GLM 28/34px 视觉高度的 WCAG 增强，不改变布局树或功能。
- 选中任务辅助文字已使用合格 token；应用内 Browser console 无 warning、error 或 page error。

## 验证记录

```text
pnpm --filter @logion/web test       46 files / 172 tests passed
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm --filter @logion/web build      35 routes built
git diff --check                     passed
today-workbench.spec.ts              1 passed / 11.7s
cross-route Playwright               21 passed / 2.5min
```

真实 E2E 使用正式 Session/API/Vault 数据完成任务创建、专注开始/结束、证据、显式人工验收和关闭。重复执行时优先复用当前 Space 的正式目标；若存在中断留下的 active session，则按正式命令以 `abandoned` 结束后再开始本轮，不修改数据库、不注入 fixture。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44x44px | WCAG 与移动触达质量要求 | 仅扩大点击区，不改变 GLM 信息层级 | 待 Gate 1 一并确认 |
| 320 Target 不做像素对比 | Target PNG 有重复拼接伪影 | 保留哈希/尺寸；采用 specs 与其余三视口交叉验收 | 待 Gate 1 一并确认 |

没有其他 route-specific 偏离获批。Today 当前状态为“实现及 AI 自检完成，等待 Gate 1”，不得写成 Product Owner 已验收。

## Product Owner Gate 1 任务

Product Owner 需在真实 `127.0.0.1:8080` 运行实例中，以 1440 和 390 为主要视口，抽查 320/1024，并完成以下任务：解锁、选择任务、开始/结束专注、添加证据、显式验收、关闭任务、查看 Persona 详情与同步恢复。验收时对照同视口 GLM Target，明确判断视觉层级、信息密度、首屏主任务和交互路径，不以“测试全绿”或“看着更漂亮”代替签字。
