# Planning GLM 一致性验收报告

## 当前结论

Planning 已按批准的 GLM 信息架构完成实现与 AI 自检。正式页面从 `PlanningCenter` 的旧 `ProductPanel`、流程卡、指标卡和纵向 Disclosure/Form，整改为 Goal Master、Stage Route Main、Goal Inspector，以及承载低频创建与 Vault 解锁的 Radix Sheet。Session、Workspace、Space、权限、Vault、`ProtectedOfflineRepository`、`learning_goal` / `task`、position 顺序和 sync-v1 仍由正式 controller、repository 与 API 驱动。

- 自动化真实流程：通过
- 四断点 After 截图、几何与区域合同：通过
- Axe、键盘、焦点恢复、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%
- Product Owner 独立验收：**通过**
- Product Owner 原文：`Planning 独立验收通过，并接受证据缺口`
- 确认时间：`2026-08-27T02:23:39+08:00`

自动化通过只证明实现可运行、可达且未破坏正式合同，不代替 Product Owner 对 Planning 视觉层级、主任务和 Before 证据缺口的独立结论。Review 与 Exam 尚未施工。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/planning` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、IndexedDB、`ProtectedOfflineRepository`、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Web image | `sha256:c799e88f0f6f3a684f0c06702601c8d64972c24ab90565d0150e90f591a8370f` |
| Web image Created | `2026-08-26T17:02:50.101216598Z` |
| Web container Started | `2026-08-26T17:02:52.230056851Z` |
| Web mounts | `[]` |
| 运行状态 | Web / reverse proxy healthy；`/healthz` 200 |

工作区为 dirty 状态；验收过程保留用户与本计划既有改动，未自动提交、清理或回滚。应用内浏览器使用真实 Session 进入 Planning，六个 Planning 合同区域与解锁主操作可见，console error 为 0。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无同视口证据 | 未交付该视口 Target | [After](after/app-planning-320x640.png) |
| 390 x 844 | 现有移动 Before 实际为 375 x 812 | `app_planning-390x844.png` | [After](after/app-planning-390x844.png) |
| 1024 x 768 | 无同视口证据 | 未交付该视口 Target | [After](after/app-planning-1024x768.png) |
| 1440 x 900 | 现有桌面 Before 实际为 1425 x 891 | `app_planning-1440x900.png` | [After](after/app-planning-1440x900.png) |

### 证据哈希

| 证据 | 实际尺寸 | SHA-256 |
| --- | ---: | --- |
| Before desktop | 1425 x 891 | `45a86da2ecf3a97a621fad4096c989cf1a5933d3a4efe48eda9924e1bf8806d3` |
| Before mobile | 375 x 812 | `d643ff8a1575c7c991036418e2b38d2ca7369880a5950120a71bf6a4da07062e` |
| GLM Target desktop | 1440 x 900 | `ea85f84277c120c637f994fe5c55b8a5cb99e163e0c802feb2a199446f3fb3fa` |
| GLM Target mobile | 390 x 844 | `562bb42d9ee667c1ed201eaa12076810d4c0c4cf681e912b22b88dcc784b0427` |
| After 320 | 320 x 640 | `51bf583aa5425643334ec06cf2985f2bf987bdadb01a7a7bb8277d7fe80f04d5` |
| After 390 | 390 x 844 | `e54664861eace94a5178c2d850ca3d8d991b465f9a647d388b4ec0b87ae9b7e5` |
| After 1024 | 1024 x 768 | `33a6c21509a533753c4076d30c2340b67ba29fbe09e68bc3d2ebde29afad91c3` |
| After 1440 | 1440 x 900 | `47594a410873a107452b95865f012048e8b377242d70568af3073c81ed8d2a48` |

Before 原图位于隔离审计工作区：

- 桌面：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-phase1-audit\current\app_planning-1440x900.png`
- 移动：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-phase1-audit\current\app_planning-390x844.png`

文件名声称目标视口，但 PNG 实际像素尺寸不一致。不得缩放、裁切或伪造为同视口 Before；该历史证据限制必须由 Product Owner 在 Planning 独立验收中明确接受，或要求补充可追溯的同视口旧版来源。

## 主体结构差异

### Before

    App Shell
    └─ ProductPageHeader + 两个竞争主操作
       ├─ locked / empty 全宽状态卡
       ├─ workflow hero + 三个嵌套步骤
       ├─ 四个指标卡
       ├─ current-goal 卡片堆叠
       ├─ Vault Disclosure + Workspace / Space 表单
       └─ Goal Disclosure
          └─ 三组纵向字段 + 指导卡

旧主体把上下文、解锁、目标创建、状态和指标按卡片纵向串联。目标不可作为稳定 Master 选择，阶段、真实任务与 Inspector 没有形成同一工作面，主操作在多个区块重复。

### After

    Planning Workbench
    ├─ Workbench Header
    │  └─ 当前状态唯一 primary
    ├─ Context Bar
    │  └─ Workspace / Space / Persona / 权限 / Vault / Sync
    ├─ Operational Notice
    │  └─ locked / offline / stale / permission / conflict / error 恢复
    └─ Workbench Frame
       ├─ Goal Master
       │  └─ 真实目标列表、阶段数、同步摘要与键盘选择
       ├─ Stage Route Main
       │  ├─ 目标概览
       │  ├─ position 有序阶段、验收标准与前序提示
       │  └─ 按目标 / 阶段聚合的真实任务
       └─ Goal Inspector
          ├─ outcome / target date / weekly effort
          ├─ acceptance / progress / sync
          └─ 能力披露与继续执行入口

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 保持可扫描工作面；320/390 px 采用连续阅读顺序并保证所有区域可达。创建目标和 Vault 解锁进入 Sheet，关闭后焦点恢复到触发器。

## 主任务与交互路径

主任务是“把当前 Workspace / Space 中的目标拆成可验收路线，并继续推进真实任务”：

    自动带入 Workspace / Space / Persona / 权限
    → locked 时从唯一主操作解锁 Vault
    → ready 时从 Goal Master 选择目标，或从唯一主操作新建目标
    → 在 Stage Route 查看 position 顺序、验收标准和前序提示
    → 查看真实 task 与阶段归属
    → 在 Goal Inspector 核对结果、日期、投入与同步状态
    → 前往 Today 继续执行
    → offline / stale / conflict 时使用明确恢复动作

新建阶段与发布计划没有足够正式写合同，因此保留为 capability-disabled 的可发现入口，不伪造本地写入或版本号。

## 组件映射

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份与主操作 | `WorkbenchHeader` | locked 为解锁，ready 为新建目标；每层最多一个 primary |
| 上下文回显 | `WorkbenchContextBar` + `WorkbenchSelect` | 自动带入并持续显示 Workspace、Space、权限、Vault、Sync |
| 三栏工作面 | `WorkbenchFrame` | Goal Master / Route Main / Inspector 稳定 landmarks |
| 目标选择 | route-specific goal list | 点击与 Arrow Up / Down 选择，不离开当前路由 |
| 阶段路线 | route-specific ordered route | 只表达 `position` 顺序与前序提示，不伪造硬依赖 |
| 任务聚合 | route-specific task list | 读取真实 protected `task`，不增加 mock CRUD |
| 低频输入 | `WorkbenchSheet` | 新建目标、Vault 解锁；焦点锁定与关闭恢复 |
| 对象详情 | `InspectorSection` | 结果、日期、投入、验收、同步与能力披露 |
| 状态恢复 | `ProductOperationalStateNotice` | 11 类状态及 button / link recovery，request ID 保留 |

## Function Reachability

| 正式能力 / command | 新入口 | 验证 |
| --- | --- | --- |
| 加载 Session / Workspace / Space / current device | controller + Context Bar | 真实 Session / API 上下文通过 |
| 切换 Workspace / Space | Context Select | 切换、重载与过期响应保护通过 |
| 解锁本地 Vault | locked notice / Unlock Sheet | 真实解锁、错误保留与焦点恢复通过 |
| bootstrap protected entities | controller | `learning_goal` / `task` 可见性通过 |
| 选择目标 | Goal Master | 点击与键盘选择通过 |
| 查看阶段顺序 | Stage Route Main | `position` 排序与前序提示通过 |
| 查看验收标准 | Route Main + Inspector | 真实 phase acceptance criteria 通过 |
| 查看真实任务 | Route Main | goal / phase 归属与未分组任务通过 |
| 创建目标与首阶段 | Header → New Goal Sheet | 正式 payload、默认值、commit 与表单 reset 通过 |
| 同步或离线保留 | Context / Inspector | sync-v1 成功、离线保留与 stale 状态通过 |
| 恢复 409 / error | Operational Notice → Sync | conflict、request ID 与恢复入口通过 |
| 继续执行 | Inspector → Today | 正式路由可达 |

Planning 正式 command 均由新 View 消费或通过明确能力状态呈现，Function Reachability 为 100%。

## 响应式与无障碍

- 320、390、1024、1440 无横向溢出、遮挡或不可达操作。
- 六个 Planning 区域可见并通过合同：`planning-goals`、`planning-stages`、`planning-dependencies`、`planning-tasks`、`planning-inspector` 及上下文 / 状态层。
- Axe 对目标 WCAG 规则集零 unexpected violation。
- 当前可见层 `data-workbench-primary="true"` 不超过 1。
- Goal Master 支持 Arrow Up / Down；Sheet 使用正式焦点锁定、Escape 关闭与触发器焦点恢复。
- `prefers-reduced-motion: reduce` 下动画与过渡满足审计阈值。
- 移动交互目标至少 44 x 44px；320 / 390 保持目标 → 路线 → Inspector 的连续可达顺序。
- 应用内浏览器真实 Session 走查无 console error。

## 验证记录

```text
Planning 竞态压力回归                10/10 passed
完整 Browser matrix                 168 passed / 10 skipped / 0 unexpected / 178 total
Web                                  204/204
Offline                               55/55
Contracts                             12/12
Mobile                                  4/4
Python                                293 passed / 56 deselected
contracts:check                       passed
format:check                          passed
lint                                  passed
typecheck                             passed
build                                 passed / 35 routes
test                                  passed
```

Browser fixture 保持 worker-scope 账号状态，但每个 test 使用独立 `authenticatedContext` / `authenticatedPage`，结束时回写旋转后的 storage state；401 / 403 才重新登录。Vault locked 场景在第二次进入 Today 后等待 `.app-shell-frame` 可见再导航 Planning，避免 Session bootstrap refresh 被中止造成 Cookie 轮换竞态。该修复只稳定测试 Session 使用，不修改产品认证、安全或业务语义。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44 x 44px | WCAG 与移动触达要求 | 只扩大点击区，不改变 GLM 信息层级 | **PO 已接受** |
| 新建阶段为 capability-disabled | sync-v1 没有正式 phase 后续写入能力 | 入口保持可发现，说明能力边界，不伪造 mutation | **PO 已接受** |
| 发布计划不可用 | 正式读取合同不暴露 `expected_plan_version` | 不猜版本号，等待正式合同补齐 | **PO 已接受** |
| `position` 只表达前序提示 | 正式 payload 无 `dependsOn` | 不把顺序冒充强依赖 | **PO 已接受** |
| Before 不是同视口 | 仅存历史 1425 x 891 与 375 x 812 截图 | 原图与哈希保留；不缩放、不裁切、不伪造 | **PO 已接受证据缺口** |
| Target 只提供 390 / 1440 | 批准的 GLM artifact 集没有 320 / 1024 Planning Target | 320 / 1024 验收响应式与布局合同；不伪造 Target | **PO 已接受证据缺口** |

没有其他 route-specific 偏离获批。Planning 当前状态为“Product Owner 独立验收通过”；Review 已获授权启动，Exam 继续锁定。

## Product Owner 验收记录

- **结论**：通过
- **原文**：`Planning 独立验收通过，并接受证据缺口`
- **范围**：Planning 工作台实现、真实任务路径、四断点 After、正式数据语义，以及历史 Before / Target 证据限制。
- **后续门禁**：允许启动 Review；Review 未完成独立验收前不得启动 Exam。

## Product Owner 独立验收任务

请在真实 `http://127.0.0.1:8080/app/planning` 运行实例中，以 1440 和 390 为主要视口，抽查 320 / 1024，并完成：

1. 查看 Workspace / Space / Persona / 权限 / Vault / Sync 持续上下文。
2. 从 locked 状态解锁 Vault，确认错误保留和关闭后的焦点恢复。
3. 新建目标与首阶段，核对结果、投入、目标日期和验收标准。
4. 在 Goal Master 切换目标，检查阶段 `position` 顺序、前序提示与真实任务归属。
5. 从 Inspector 前往 Today，确认当前对象与路线语义没有丢失。
6. 检查 offline / stale / conflict 的恢复入口与 capability-disabled 说明。
7. 对照 390 / 1440 GLM Target 判断主任务、信息密度、三栏层级和操作编排。
8. 明确接受现存 Before / Target 证据缺口，或要求补充可追溯原始证据。

该独立验收通过后，才创建 Review 子计划；Review 通过后再创建 Exam 子计划。
