# Exam GLM 一致性验收报告

## 当前结论

Exam 已按批准的 GLM 信息架构完成主体重构与真实任务验收。正式页面从旧的 `ProductPageHeader + ProductPanel + planning-form` 纵向堆叠，整改为 `Exam Master / Coverage Main / Exam Inspector` 三栏备考工作台；考试、科目、大纲、模考、成绩、Vault、Workspace/Space、权限、离线本地保存和 `sync-v1` 语义保持不变。

- 真实认证与 Exam 业务闭环：通过
- 四断点截图、GLM 区域与 Workbench 几何合同：通过
- Axe、键盘、焦点、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%（真实脚本覆盖创建考试、科目、大纲、模考、成绩；其余上下文与同步动作保持可达）
- Product Owner 独立视觉与任务验收：待确认

自动化和真实 API/Vault 任务证明实现可运行、可达且未破坏正式合同，不代替 Product Owner 对首屏层级、信息密度、GLM Target 差异和证据限制的独立结论。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/exam` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、IndexedDB、Bootstrap、ProtectedOfflineRepository、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 111 项；保留用户与计划内既有改动，未自动提交或回滚 |
| Web image | `logion-web@sha256:9ae8ac6ce4f9c8599abf2519a1ef1b16633ad50770f2de0e8b8a476d50ea6c45` |
| Web image Created | `2026-08-27T06:34:02.716073652Z` |
| Web container Started | `2026-08-27T06:34:14.783436057Z` |
| Web mounts | `[]` |
| API container Started (Browser 验收实例) | `2026-08-27T06:27:07.188106185Z` |
| Proxy container Started | `2026-08-27T06:34:25.571104252Z` |
| 运行状态 | Web、API、DB、Redis、Worker、Proxy healthy；`/healthz` 200 |

隔离 Browser 账号创建期间，API 临时使用 `open` registration、`http://127.0.0.1:8080` allowed origin 和匹配的 WebAuthn RP ID；这些变量没有写入仓库。测试结束后 API 已恢复正式 `invite` 注册模式；本轮只清理注册 IP 限流键，没有清理 Workspace、Space、Session 或 Exam 实体。

验收结束后 API 为恢复正式注册策略重新启动，最终实例时间为 `2026-08-27T06:37:11.557275658Z`；当前 `/healthz` 为 `200`，直接注册返回 `410 AUTH_REGISTRATION_UPGRADE_REQUIRED`。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无历史同视口 Before | 未交付该视口 Target | [After](after/app-exam-320x640.png) |
| 390 x 844 | 无历史同视口 Before | [Target](C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_exam-390x844.png) | [After](after/app-exam-390x844.png) |
| 1024 x 768 | 无历史同视口 Before | 未交付该视口 Target | [After](after/app-exam-1024x768.png) |
| 1440 x 900 | 无历史同视口 Before | [Target](C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots\app_exam-1440x900.png) | [After](after/app-exam-1440x900.png) |

Target 文件存在性、视口和 SHA-256 由 `reports/ui-refactor/glm-target-manifest.json` 固定。Exam 没有可用的历史 Before 同视口图像，因此不伪造或缩放 Before；320/1024 使用 GLM specs、布局合同和相邻 Target 交叉验收。

| 证据 | 实际尺寸 | SHA-256 |
| --- | ---: | --- |
| GLM Target mobile | 390 x 844 | `16f61ca0e5286650ad0dac9bb62c6b3c9817cfb794d210847cf22934c3a8f64c` |
| GLM Target desktop | 1440 x 900 | `b5a0897a80d8f8286848c75d9d9733a8c44bd7849a52d18de9120ac72c3e340f` |
| After 320 | 320 x 640 | `b250237d7535e5e1896e04ef6739ffcb58e8c8eef732dfe831603eaba86c2c4c` |
| After 390 | 390 x 844 | `882626a85e2728019474cb00a72d7f17e262d46cf30cc49dafc7e759c5d57014` |
| After 1024 | 1024 x 768 | `adc62209e4939eb956e0e866c40a3e631ba23406be66d5f4c86364de1b419596` |
| After 1440 | 1440 x 900 | `09910dd5f179a614919bee631a24d4c869f0759b113277ec0c06a707749bb17f` |

After 截图来自同一个无挂载生产镜像和一次真实认证任务。截图状态包括解锁 Vault、当前 Space 中新建的考试、科目、大纲节点、模考和成绩；标题仅用于隔离账号验收，不代表固定产品数据。

## 主体结构差异

### Before

```text
Exam Center
├─ ProductPageHeader + 解锁 / 同步操作
├─ locked / empty 状态通知
├─ ProductPanel：考试名称、考试日期、目标分、满分
├─ planning-form：创建考试
├─ 指标卡：考试 / 科目 / 大纲 / 模考
├─ 纵向科目编辑表单
├─ 纵向大纲节点表单
├─ 纵向模考与成绩表单
└─ 权限 / Vault / 同步信息堆叠
```

旧主体把考试创建、覆盖查看、模考和成绩输入串成一条长表单；用户无法稳定地在考试列表、覆盖主工作面和对象上下文之间切换，移动端只是继续拉长页面。

### After

```text
Exam Workbench
├─ Workbench Header
│  └─ 当前上下文唯一 primary：解锁资料 / 创建考试
├─ Context Bar + Toolbar
│  └─ Workspace / Space / 权限 / Vault / Sync
└─ Workbench Frame
   ├─ Exam Master
   │  ├─ 考试列表
   │  ├─ 最近考试倒计时
   │  └─ 选中态与同步标签
   ├─ Coverage Main
   │  ├─ 覆盖概览与科目进度
   │  ├─ 考试大纲树
   │  ├─ 模考与成绩
   │  └─ 薄弱项投影
   └─ Exam Inspector
      ├─ 考试范围、日期、目标分
      ├─ 科目 / 大纲数量
      └─ 权限、Vault、同步状态
```

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 保持 Master/Main 并将 Inspector 进入主列连续区域；320/390 px 按 Master → Main → Inspector 顺序阅读。创建考试、科目、大纲、模考、成绩和 Vault 解锁进入局部 Sheet，成功提交后才关闭并恢复触发器焦点。

## 主任务与交互路径

主任务是“围绕最近考试建立覆盖结构，并用模考成绩反馈薄弱项”。

```text
自动带入 Workspace / Space / 权限
→ locked 时从唯一 primary 打开 Unlock Sheet
→ 解锁本地 Vault 并执行 sync-v1 bootstrap
→ 创建考试并在 Master 中选中
→ 添加科目与权重
→ 添加大纲节点（父节点关系在提交前校验）
→ 安排模考
→ 模考完成后记录得分与实际用时
→ Coverage Main 更新覆盖率、最近得分率和薄弱项
→ stale / offline / permission / error 时使用状态恢复动作
```

低频字段最多进入一层 Sheet；日期状态、目标分/满分的成对校验和父节点依赖仍保持正式对象约束，没有用原型静态数据替代真实 API。

## 组件映射与 Function Reachability

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份与主操作 | `WorkbenchHeader` | unlocked 时创建考试，locked 时解锁资料；每个可见层最多一个 primary |
| 上下文回显 | `WorkbenchContextBar` + `WorkbenchSelect` | Workspace / Space / 权限 / Vault / Sync 持续回显 |
| 三栏工作面 | `WorkbenchFrame` | Master / Main / Inspector 稳定 landmarks |
| 考试浏览 | `ExamMaster` | 列表选择、当前考试倒计时和同步状态 |
| 覆盖主工作面 | `CoverageMain` | 科目、树状大纲、模考成绩和薄弱项按任务顺序组织 |
| 详情检查 | `ExamInspector` | 回显日期、目标分、范围、权限和同步边界 |
| 低频输入 | `WorkbenchSheet` + `FormSheet` | 创建考试、科目、大纲、模考、成绩；失败保留 Sheet 输入 |
| 状态恢复 | `ProductWorkbenchStateNotice` | locked / empty / offline / permission / error / stale 提供动作 |

| 正式能力 / command | 新入口 | 验证 |
| --- | --- | --- |
| `loadContext` / Workspace / Space / device | 首次加载与 Context Bar | 真实认证 Session/API，通过 |
| `unlock` + bootstrap | Header primary → Unlock Sheet | 真实 Vault 初始化与 sync-v1 bootstrap，通过 |
| `createExam` | Header “创建考试” → Sheet | 真实考试 payload、目标分/满分校验、加密保存和同步，通过 |
| `createExamSubject` | Coverage “添加科目” → Sheet | 真实权重写入，通过 |
| `createSyllabusNode` | Syllabus “添加大纲节点” → Sheet | 真实父节点/科目边界，通过 |
| `createMockExam` | Mocks “安排模考” → Sheet | 真实限时模考写入，通过 |
| `createScoreRecord` | Mocks “记录成绩” → Sheet | 真实得分、满分和用时写入，通过 |
| `synchronize` | Context Toolbar | 真实 sync-v1 请求与状态回显，通过 |
| locked / empty / pending / offline / permission / 409 / error / capability-disabled / stale | 状态通知与恢复动作 | controller 状态合同保留；未删除任何正式入口 |

## 响应式与无障碍

- 320、390、1024、1440：无横向溢出、遮挡或不可达操作。
- `exam-list`、`exam-coverage`、`exam-syllabus`、`exam-mocks`、`exam-weaknesses` 和 `exam-inspector` 均通过路由区域合同。
- 四视口 Axe 对 `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa` 零 violation。
- 可见 `data-workbench-primary="true"` 不超过 1；行级添加动作不与页面主操作争抢 primary。
- Exam Master 使用语义 button 列表，选中考试通过 `aria-current` 回显；覆盖率使用标准 `role="progressbar"` 和 `aria-valuenow/min/max`。
- Sheet 使用焦点锁定、Escape 关闭和触发器焦点恢复；action 失败时 Sheet 保留输入，成功后才关闭。
- 移动可点击控件至少 44 x 44px；`prefers-reduced-motion: reduce` 下动画/过渡满足审计阈值。
- Browser console 无业务 warning、error 或 page error。

## 验证记录

```text
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm --filter @logion/web test       54 files / 209 tests passed
pnpm exec playwright test tests/browser/exam-workbench.spec.ts --project=authenticated-chromium
                                    1 passed / 9.4s
pnpm --filter @logion/web build      35 routes built (Docker production build)
docker compose -p logion-b1 ps       Web/API/DB/Redis/Worker/Proxy healthy
```

本轮真实 Browser 任务按“注册/登录 → Exam → 解锁 → 创建考试 → 添加科目 → 添加大纲节点 → 安排模考 → 记录成绩”执行。首次运行发现选中行 `已同步` 标签对比度为 `4.35:1`，随后以 Exam 局部高对比 token 修复；第二次发现覆盖率进度条缺少 `progressbar` 角色，补齐语义属性后在最终无挂载镜像上通过四视口验收。Playwright 项目匹配清单同时补登记 `exam-workbench.spec.ts`，避免测试文件存在但被项目正则漏跑。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44 x 44px | WCAG 与移动触达质量要求 | 仅扩大点击区，不改变 GLM 信息层级 | 待 PO 独立确认 |
| 320 / 1024 无 GLM Target | 批准 artifact 集只交付 390 / 1440 | 用 specs、布局合同与相邻 Target 交叉验收，不伪造 Target | 待 PO 明确知悉 |
| Exam 无历史 Before 同视口 | 现存 Before 不可追溯或不是同视口 | 保留缺口，不缩放/裁切旧图；以布局差异和 Target 对照验收 | 待 PO 明确知悉 |
| 临时 open-registration 运行变量 | 隔离 Browser 账号需要本地注册 | 仅本次本地验收进程，测试结束已恢复 `invite` | 运行证据说明 |

没有删除任何正式功能，也没有复制 GLM fixture store、hash router、mock 数据或手写 overlay。Exam 当前状态为“实现与 AI 自检完成，等待 Product Owner 独立验收”；父计划步骤 8 及后续路由不因本报告自动解锁。

## Product Owner 独立验收任务

请在真实 `http://127.0.0.1:8080/app/exam` 运行实例中，以 1440 和 390 为主要视口，抽查 320 / 1024，并完成：

1. 查看 Workspace / Space / 权限 / Vault / Sync 持续上下文。
2. 在锁定状态从唯一 primary 打开解锁 Sheet，确认失败时输入保留、成功后状态与焦点恢复。
3. 创建考试、科目、大纲节点、模考和成绩，确认每次提交后 Main、Master、Inspector 同步更新。
4. 检查目标分/满分、日期状态、父节点依赖和成绩用时等正式约束没有被简化。
5. 对照 390 / 1440 GLM Target 判断主任务、信息密度、Master / Main / Inspector 层级与移动连续流。
6. 触发同步、stale / offline / permission / error 恢复，确认请求编号和权限边界。
7. 明确接受当前 320 / 1024 Target 与历史 Before 证据缺口，或要求补充可追溯证据。

Product Owner 通过后，才允许将 Exam 子计划标记完成并解锁父计划后续路由。
