# Self-study GLM 一致性验收报告

## 当前结论

Self-study 已完成主体工作台实现，正式页面从旧 `ProductPageHeader + ProductPanel + planning-form` 纵向堆叠改为 `Inbox Master / Route & Project Board / Deliverable Timeline` 三类专属工作面，并保留 `learning_track`、`study_project`、`inbox_item`、`deliverable` 的真实对象语义、Vault、Workspace/Space、权限和 `sync-v1` 链路。

- 结构与静态组件合同：通过
- Web TypeScript、ESLint、Self-study/Workbench 单测：通过
- 真实 8080 页面：新镜像已部署，登录会话已确认
- 真实捕获 → 路线 → 项目 → 成果：已完成；对象均写入当前 Space 的本地加密资料
- 真实同步：两次重试均返回 offline，记录保留在本机 Outbox，未伪造“已同步”
- Product Owner 独立视觉与任务验收：待确认

自动化和静态渲染不代替真实 Session/API/Vault 任务，也不代替 Product Owner 对首屏层级、信息密度和 GLM Target 的人工结论。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/self-study` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、IndexedDB、Bootstrap、ProtectedOfflineRepository、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Web image | `sha256:ba3117f9adde407737b0defff1cbccc910e2ea7c3c56342fc5d11eba84ec18e0` |
| Web container Started | `2026-08-27T07:23:19.275284573Z` |
| Web mounts | `[]` |
| API registration | 正式 `invite` 模式，未为本轮修改 |
| 运行状态 | Web、API、DB、Redis、Worker、Proxy healthy；`/healthz` 200 |
| 真实任务时间 | `2026-08-27`；当前会话 `logion-test-20260827041248` |
| 同步结果 | 两次点击“同步当前 Workspace”均显示“网络暂不可用；内容仍保存在本机 Outbox” |

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无历史同视口 Before | 未交付该视口 Target | [`app-self-study-320x640.png`](after/app-self-study-320x640.png)，SHA-256 `9BA3262AC3917158328F57818CE02BDFED02F93A7CF41543E5713806287656A3` |
| 390 x 844 | 无历史同视口 Before | `app_self-study-390x844.png`（SHA-256 `b633400989c298857c01805e40e25ac72b967321a7380ed841afad0b4de43c4c`） | [`app-self-study-390x844.png`](after/app-self-study-390x844.png)，SHA-256 `4094DD37F8CE129807C4AD182900098ADE8039B7AD346EAF54F69986B84DC29A` |
| 1024 x 768 | 无历史同视口 Before | 未交付该视口 Target | [`app-self-study-1024x768.png`](after/app-self-study-1024x768.png)，SHA-256 `E1A4884373B6DF3EE47F01D7DBB3B13426E6345C67AE01BB9258C53CB87B01AF` |
| 1440 x 900 | 无历史同视口 Before | `app_self-study-1440x900.png`（SHA-256 `546bdd3820910188a72fd5ee2d3ac380c27cd401d55ef9528a41a2ea0dcb351b`） | [`app-self-study-1440x900.png`](after/app-self-study-1440x900.png)，SHA-256 `373A05DD8E3D355259A1754914F02206B8948B994B5CDC80CE63AFB51E43A68F` |

不缩放、不裁切或伪造 Before；320/1024 使用 GLM specs、布局合同和相邻 Target 交叉验收。

## 主体结构差异

### Before

```text
Self-study Center
├─ ProductPageHeader + locked / empty 状态
├─ Hero + 四项指标
├─ Workspace / Space / Vault Disclosure
├─ 快速收件箱纵向表单与任务列表
├─ 学习漏斗图表
├─ 路线与项目纵向创建表单
└─ 路线、项目与成果 task-card 堆叠
```

### After

```text
Self-study Workbench
├─ Workbench Header + 当前上下文唯一 primary
├─ Context Bar + Toolbar
└─ Workbench Frame
   ├─ Inbox Master
   │  ├─ 待分诊收件箱
   │  └─ 路线与项目树
   ├─ StudyTabs Main
   │  ├─ 收件箱分诊动作
   │  ├─ 路线下项目 Board
   │  └─ 成果 Timeline
   └─ Object Inspector
      ├─ 类型、父对象、权限
      └─ Vault / Sync 边界
```

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 让 Inspector 进入连续主列；移动端按 Master → Main → Inspector 展开。低频字段进入 Radix Sheet，失败时保留输入，成功后才关闭。

## 主任务与 Function Reachability

```text
自动带入 Workspace / Space / 权限
→ locked 时从唯一 primary 打开 Unlock Sheet
→ 解锁 Vault 并执行 sync-v1 bootstrap
→ 快速捕获 Inbox
→ 选择条目并分诊为路线
→ 路线下建立项目
→ 项目下记录带完成时间和证据摘要的成果
→ Inspector / Timeline 回显父依赖、权限和同步状态
```

| 正式能力 | 新入口 | 当前验证 |
| --- | --- | --- |
| Workspace / Space / device 加载 | Context Bar 与首次加载 | 真实登录会话已确认 |
| `unlock` + bootstrap | Header primary → Unlock Sheet | 真实解锁成功；页面回显 Vault `已解锁` |
| `inbox_item` 创建 | Header “开始捕获”或 Master “快速收集” | 真实创建 1 条，页面回显 `1` 条 Inbox |
| 路线分诊 | Inbox Detail → “建立路线” | 真实创建 1 条 `learning_track`，路线树回显 `1` 条 |
| `study_project` 创建 | Route Board → “新建项目” | 真实创建 1 个 `study_project`，项目回显 `1 项目` |
| `deliverable` 创建 | Project Detail/Timeline → “记录成果” | 真实追加 1 项成果，时间线回显 `1`、项目进度 `100%` |
| `synchronize` | Context Toolbar | 两次真实重试进入 offline 恢复态，内容保留 Outbox |
| locked / empty / offline / permission / error / stale | State Notice 与 Context Bar | locked/empty/成功/offline 已真实观察；其余由正式 state 合同保留 |

## 验证记录

```text
pnpm --filter @logion/web typecheck                         passed
pnpm --filter @logion/web lint                              passed
pnpm --filter @logion/web exec vitest run                  passed
  Self-study + model + shared Workbench: 3 files / 8 tests
pnpm --filter @logion/web build                             passed in Docker image
docker compose logion-b1 Web/API/DB/Redis/Worker/Proxy      healthy
git diff --check                                             passed (仅 CRLF warning)
in-app browser authenticated task                         passed: 1 inbox → 1 route → 1 project → 1 deliverable
in-app browser geometry                                    passed: 320/390/1024/1440 scrollWidth == viewportWidth
in-app browser primary/regions/logs                         passed: 1 visible primary; 3 tabs; Inspector; no console warnings/errors
sync recovery                                               offline twice; local Outbox retained
pnpm exec playwright test tests/browser/self-study-workbench.spec.ts --project=authenticated-chromium
                                                             blocked before test: global setup received HTTP 410 (`AUTH_REGISTRATION_UPGRADE_REQUIRED`) because API is in formal invite mode
```

真实浏览器已确认 `Personal workspace`、`Private` Space、`owner` 权限和新 Workbench；真实对象写入本机加密资料并在页面回显。同步服务不可用时页面明确展示 offline/Outbox 恢复路径；未把本地保存冒充服务器同步，也未把被 `invite` 注册策略拦截的 Playwright fixture 记为页面失败。

### 真实浏览器断点结果

| 视口 | `scrollWidth` / viewport | 可见 primary | 关键区域 | 证据 |
| --- | --- | --- | --- | --- |
| 320 x 640 | `320 / 320` | `1`（开始分诊） | 3 Tabs、Inspector、移动连续流 | [`app-self-study-320x640.png`](after/app-self-study-320x640.png) |
| 390 x 844 | `390 / 390` | `1`（开始分诊） | 3 Tabs、Inspector、移动连续流 | [`app-self-study-390x844.png`](after/app-self-study-390x844.png) |
| 1024 x 768 | `1024 / 1024` | `1`（开始分诊） | Master/Main/Inspector、frame 几何 | [`app-self-study-1024x768.png`](after/app-self-study-1024x768.png) |
| 1440 x 900 | `1440 / 1440` | `1`（开始分诊） | 264px Master、316px Inspector、frame 填满 | [`app-self-study-1440x900.png`](after/app-self-study-1440x900.png) |

### 证据边界

- 本轮 in-app browser 已真实完成对象写入、Inspector/Timeline 回显、四断点溢出/primary/区域检查和 runtime console 检查。
- live Axe、键盘遍历、焦点恢复和 reduced-motion 的仓库 Playwright 用例未进入页面阶段：global setup 在正式 `invite` 注册模式下返回 `410 AUTH_REGISTRATION_UPGRADE_REQUIRED`。这属于测试账号 provisioning 环境限制，不代表 Self-study 页面本身通过了这些机器门。
- 同步 API 两次重试均进入 offline；页面保留 Outbox 和重试入口，服务器端同步成功需要恢复 API 网络后再次点击同步。

## 待完成门禁

请由 Product Owner 以 1440/390 为主视口、抽查 320/1024，确认结构、密度、连续流、offline 恢复路径和证据缺口，并回复 `Self-study 独立验收通过` 或指出具体问题。

在该独立验收通过前，不创建 Research、Collaboration 或 Templates 子计划。
