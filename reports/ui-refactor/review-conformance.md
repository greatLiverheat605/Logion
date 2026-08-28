# Review GLM 一致性验收报告

## 当前结论

Review 已按批准的 GLM 信息架构完成实现与 AI 自检。正式页面从旧 `ReviewCenter` 的 ProductPanel、指标卡、Disclosure 和纵向表单堆叠，整改为 ReviewTabs、DueQueue、AnswerSheet、KnowledgeInspector，并将知识图谱、掌握确认、错因模式和周期审查组织在同一复习工作面。Session、Workspace、Space、权限、Vault、BootstrapRepository、ProtectedOfflineRepository、sync-v1 及正式 Review payload/副作用顺序保持不变；没有复制 GLM fixture store、hash router、mock 数据或手写 overlay。

- 真实认证与 Review 业务闭环：通过
- 四断点截图、GLM 区域与 Workbench 几何合同：通过
- Axe、键盘选择、Sheet 焦点、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%（真实脚本覆盖创建知识点、创建回忆题、回答并保存；其余正式动作由 View 入口和 controller action 保持可达）
- Product Owner 视觉与任务验收：**待独立确认**

自动化和真实任务通过证明实现可运行、可达且未破坏正式合同，不代替 Product Owner 对首屏层级、信息密度、GLM Target 差异和证据限制的独立结论。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/review` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、IndexedDB、Bootstrap、ProtectedOfflineRepository、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 103 项；保留用户与计划内既有改动，未自动提交或回滚 |
| Web image | `sha256:247bedbca17935e267da04521e94640912b5bd5b03f65eec59f547f6610a2b55` |
| Web image Created | `2026-08-26T19:29:42.243179253Z` |
| Web container Started | `2026-08-26T19:30:00.143951673Z` |
| Web mounts | `[]` |
| API container Started | `2026-08-26T19:29:48.920970549Z` |
| Proxy container Started | `2026-08-26T19:30:10.925896588Z` |
| 运行状态 | Web、API、Proxy healthy；`/healthz` 200 |

本轮生产构建使用无源码挂载的 Web 镜像。为让隔离 Browser 账号可在本地真实注册，API 运行时临时使用 `open` registration、当前验收地址的 allowed origin 和匹配的 WebAuthn RP ID；数据库连接复用了现有持久化 PostgreSQL 的运行密码。上述变量只存在于本次 Compose 进程，没有写入仓库 `.env` 或报告。测试后仅清理了 Redis 中本轮注册 IP 限流键，没有清理 Workspace、Space、Session 或业务实体。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无历史同视口 Before | 未交付该视口 Target | [After](after/app-review-320x640.png) |
| 390 x 844 | 历史图像实际为 375 x 812 | [Target](C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_review-390x844.png) | [After](after/app-review-390x844.png) |
| 1024 x 768 | 无历史同视口 Before | 未交付该视口 Target | [After](after/app-review-1024x768.png) |
| 1440 x 900 | 历史图像实际为 1425 x 891 | [Target](C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_review-1440x900.png) | [After](after/app-review-1440x900.png) |

Target 文件存在性、视口和 SHA-256 由 `reports/ui-refactor/glm-target-manifest.json` 固定。Before 不缩放、不裁切、不伪造为同视口；320/1024 仅依据 GLM specs、响应式合同与相邻 Target 交叉验收。

| 证据 | 实际尺寸 | SHA-256 |
| --- | ---: | --- |
| Before mobile | 375 x 812 | `6eb197f7f7e10a9bb8ffd1145ddd5c736ba8dcb5dcec44cc88b975509ddb75ab` |
| Before desktop | 1425 x 891 | `602dec45dd8c01a05a0159c2599bc6832392cf50e3c7560a139b59646425cca9` |
| GLM Target mobile | 390 x 844 | `2d00bc822d2f018ca3e15b8a7bb7e7010bdbc2cb7ba32fde45ccdcbf7fb09b6c` |
| GLM Target desktop | 1440 x 900 | `b5a0897a80d8f8286848c75d9d9733a8c44bd7849a52d18de9120ac72c3e340f` |
| After 320 | 320 x 640 | `fdb676c9d30962870e84a8e154ca373574d3425154f80b5cac67348a2f6a26a9` |
| After 390 | 390 x 844 | `a797fa1d367185ff63cf2cdfebe8824fbcd59de1450e896ae4e31aa9495d6713` |
| After 1024 | 1024 x 768 | `ec05114c02ac46484317057e423cf6eca38ef0faa03d3cd2152a56088fdcec35` |
| After 1440 | 1440 x 900 | `c5a310defcdd959b205e856294de0b97c9f774a09182501003588b19e112c209` |

After 截图来自同一个无挂载生产镜像和一次真实认证任务。截图状态包括已解锁 Vault、当前 Space 中新建的知识点、形成性回忆题和一次已保存答题记录；随机测试标题只用于隔离账号验收，不代表固定产品数据。

## 主体结构差异

### Before

```text
Review Center
├─ ProductPageHeader + 解锁 / 同步操作
├─ locked / empty 状态通知
├─ ProductWorkflowStage: 到期回忆 → 掌握 → 错因
├─ 指标卡：知识点 / 掌握 / 待复习 / 错因
├─ Vault / Workspace / Space Disclosure
├─ 掌握度图表与未来 7 天图表
├─ 知识图谱 Disclosure
│  ├─ 新增知识点纵向表单
│  └─ 先修依赖纵向表单
├─ 掌握确认 task-card 列表
├─ 主动回忆 task-card + 答题长表单
├─ 错因 task-card
└─ 审查记录 task-card + 发现表单
```

旧主体按功能区块从上到下堆叠，队列、当前知识点、答题和 Inspector 没有稳定关系；掌握确认、题目创建、审查和同步状态互相争抢首屏；移动端只是继续拉长同一页面。

### After

```text
Review Workbench
├─ Workbench Header
│  └─ 当前上下文唯一 primary：解锁资料 / 开始回忆
├─ Context Bar + Toolbar
│  └─ Workspace / Space / 权限 / Vault / Sync
└─ Workbench Frame
   ├─ DueQueue Master
   │  ├─ 到期摘要
   │  ├─ 语义 list + 键盘选择
   │  └─ 知识点与先修关系摘要
   ├─ ReviewTabs Main
   │  ├─ 到期复习：Due Now / Answer entry / 7-day load
   │  ├─ 掌握与图谱：图谱或掌握确认
   │  ├─ 错因模式：开放模式与显式解决
   │  └─ 周期审查：发现、解决、明确完成
   └─ KnowledgeInspector
      ├─ 当前知识点、掌握与复习状态
      ├─ 回忆题、作答与错因关系
      └─ 继续主动回忆
```

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 保持 Master/Main 并让 Inspector 进入主列连续区域；320/390 px 按 Queue → Main → Inspector 顺序阅读。创建知识点、回忆题、依赖、周期审查和 Vault 解锁进入 Sheet，不跳离当前 Review 上下文。

## 主任务与交互路径

主任务是“清空当前 Space 的到期主动回忆队列，并把结果沉淀为掌握、错因和周期审查”。

```text
自动带入 Workspace / Space / 权限
→ locked 时从唯一 primary 打开 Unlock Sheet
→ 解锁本地 Vault 并执行 sync-v1 bootstrap
→ 从 DueQueue 选择知识点
→ 开始回忆，先输入答案
→ 进入确认阶段后填写信心、用时和错因
→ 保存本地加密 quiz_attempt，联网后由服务端判定并回流
→ 在掌握页明确确认 mastery
→ 在错因模式明确标记解决
→ 创建审查草稿，添加发现并明确完成
→ stale / conflict / offline 时使用 Context 或状态恢复动作
```

答案与解析在提交前不会披露；系统建议不自动变成掌握确认；答题、错因和审查完成均保留人工确认。

## 组件映射

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份与主操作 | `WorkbenchHeader` | unlocked 时开始回忆，locked 时解锁资料；每个可见层最多一个 primary |
| 上下文回显 | `WorkbenchContextBar` + `WorkbenchSelect` | Workspace / Space / 权限 / Vault / Sync 持续回显 |
| 三栏工作面 | `WorkbenchFrame` | DueQueue / ReviewTabs / KnowledgeInspector 稳定 landmarks |
| 队列浏览 | `ReviewMaster` + semantic list | 点击与 Arrow Up / Down / Home / End 选择知识点 |
| 复习模式 | `WorkbenchTabs` + `WorkbenchTabPanel` | 到期、掌握、错因、周期审查分离；关键区域 force-mounted 以满足可审计合同 |
| 主动回忆 | `QueuePanel` + `AnswerSheet` | 先回答，再进入确认阶段；成功保存后关闭，错误保留 Sheet |
| 知识掌握 | `KnowledgePanel` + `KnowledgeGraphView` | 图谱/列表切换；掌握度必须明确提交 |
| 错因与审查 | `ErrorsPanel` + `ReviewsPanel` | 开放错因/发现保持可见，解决和完成均为显式动作 |
| 低频输入 | `WorkbenchSheet` | 新建知识点、题目、依赖、审查和解锁；关闭后焦点恢复 |
| 状态恢复 | `ProductWorkbenchStateNotice` + `ProductOperationalStateNotice` | locked / empty / offline / permission / conflict / error / stale 恢复入口 |

## Function Reachability

| 正式能力 / command | 新入口 | 验证 |
| --- | --- | --- |
| `loadContext` / Workspace / Space / current device | 首次加载与 Context Bar | 真实认证 Session/API，通过 |
| `setWorkspaceId` / `setSpaceId` | Context Select | Space 选择与隔离，通过 |
| `unlock` + bootstrap | Header primary → Unlock Sheet | 真实 Vault 初始化、sync-v1 bootstrap，通过 |
| 选择知识点 | DueQueue Master | 真实点击、选中态、Inspector 同步与键盘选择，通过 |
| `createTopic` | Master “新建知识点” → Sheet | 真实加密本地保存并同步，通过 |
| `createDependency` | 掌握页“添加先修依赖” → Sheet | 入口保留；正式 payload 与权限门保留 |
| `confirmMastery` | 掌握页列表 → 明确确认 | action 与正式 mastery payload 保留 |
| `createQuizItem` | 掌握页“新建主动回忆题” → Sheet | 真实题目创建、答案不在列表披露，通过 |
| `submitQuizAttempt` | DueQueue 题目 → Answer Sheet | 真实先回答、确认阶段、加密保存与同步，通过 |
| `resolveErrorPattern` | 错因模式 → 标记解决 | 入口保留；仅允许开放且已同步对象 |
| `createAuditReview` | 周期审查 → Sheet | 入口保留；草稿语义保留 |
| `addReviewFinding` | 审查草稿 → 添加发现 | 入口保留；发现与审查依赖保留 |
| `completeAuditReview` | 审查草稿 → 明确完成 | 入口保留；不会隐式完成 |
| `resolveFinding` | 审查发现 → 标记解决 | 入口保留；状态显式变化 |
| `synchronize` | Context Toolbar / conflict recovery | 真实 sync-v1、pending/conflict 状态保留 |
| 知识图谱与先修关系 | 掌握与图谱 Tab | `KnowledgeGraphView` 与正式依赖 payload 保留 |
| locked / empty / pending / offline / permission / 409 / error / capability-disabled / stale | 状态通知 + Sheet/Toolbar 恢复 | shared state 合同与请求编号保留 |

## 响应式与无障碍

- 320、390、1024、1440：无横向溢出、遮挡或不可达操作。
- Review 关键区域均通过合同：`review-tabs`、`review-due-queue`、`review-answer`、`review-misconceptions`、`review-cycle`、`review-inspector`。
- 四视口 Axe 对 `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa` 零 violation。
- 可见 `data-workbench-primary="true"` 不超过 1；Header 与行级“开始回忆”不在同一可见层争抢 primary。
- DueQueue 使用 `role=list > listitem > button`；空状态也满足 listitem 语义。
- DueQueue 支持 Arrow Up / Down / Home / End；Tabs 使用 Radix 键盘语义。
- Unlock / Topic / Quiz / Dependency / Audit / Answer Sheet 使用焦点锁定、Escape 关闭和触发器焦点恢复；action 失败时 Sheet 保留输入，成功后才关闭。
- 移动可点击控件至少 44 x 44px；`prefers-reduced-motion: reduce` 下动画/过渡满足审计阈值。
- Browser console 无业务 warning、error 或 page error；Playwright 的 Service Worker blocked 固定噪音已按其他样板合同过滤。

## 验证记录

```text
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm --filter @logion/web test       52 files / 204 tests passed
pnpm exec playwright test tests/browser/review-workbench.spec.ts --project=authenticated-chromium
                                    1 passed / 10.1s
pnpm --filter @logion/web build      35 routes built（Docker production build）
git diff --check                     passed
/healthz                             200
```

真实 Browser 任务使用隔离账号完成：注册/登录 → Review → Unlock Sheet 与本地 Vault 初始化 → sync-v1 bootstrap → 新建知识点 → 新建主动回忆题 → 选中知识点 → 先回答后确认 → 保存加密答题记录。随后在 320 / 390 / 1024 / 1440 四视口完成关键区域、几何、overflow、primary、Axe、reduced-motion 与 runtime console 审计。没有注入业务 fixture、直接修改数据库或豁免 Axe。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44 x 44px | WCAG 与移动触达质量要求 | 仅扩大点击区，不改变 GLM 信息层级 | 待 PO 独立确认 |
| 320 / 1024 无 GLM Target | 批准 artifact 集只交付 390 / 1440 | 用 specs、布局合同与相邻 Target 交叉验收，不伪造 Target | 待 PO 明确知悉 |
| Before 非同视口 | 历史 Before 实际为 375 x 812、1425 x 891 | 保留原图、实际尺寸和 hash，不缩放/裁切 | 待 PO 明确知悉 |
| Tab 关键区域 forceMount | 机器合同要求关键区域可审计；Radix 默认未选中内容不挂载 | 仅 Review 四个内容 Tab；隐藏内容仍由 Radix `hidden` 控制，不增加可见操作 | 待 PO 知悉 |
| 临时 open-registration 运行变量 | 隔离 Browser 账号需要本地注册；正式默认仍为 invite | 仅本次本地验收进程，未写仓库配置或生产部署 | 运行证据说明 |

没有删除任何正式功能，也没有新增 route-specific 语义偏离。Review 当前状态为“实现与 AI 自检完成，等待 Product Owner 独立验收”；Exam 仍锁定。

## Product Owner 独立验收任务

请在真实 `http://127.0.0.1:8080/app/review` 运行实例中，以 1440 和 390 为主要视口，抽查 320 / 1024，并完成：

1. 查看 Workspace / Space / 权限 / Vault / Sync 持续上下文。
2. 输入本机口令解锁 Vault，确认失败时 Sheet 保留、成功后焦点和状态恢复。
3. 新建知识点与主动回忆题，确认题目答案在作答前不可见。
4. 从 DueQueue 开始回忆，先回答，再确认信心、用时与错因并保存。
5. 在掌握与图谱中切换图谱/列表，明确提交掌握度。
6. 查看错因模式与周期审查，完成发现解决和审查完成动作。
7. 触发同步与 stale / conflict 恢复，确认请求编号和权限边界。
8. 对照 390 / 1440 GLM Target 判断主任务、信息密度、Master / Main / Inspector 层级与交互编排。
9. 明确接受当前 320 / 1024 Target 缺口与历史 Before 非同视口限制，或要求补充可追溯证据。

Product Owner 通过后，才允许创建 Exam 子计划；当前不启动 Exam。
