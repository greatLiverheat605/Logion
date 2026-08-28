# B2 Search GLM 一致性验收报告

## 当前结论

Search 已按批准的 GLM 信息架构完成实现与 AI 自检。正式页面从 `EngagementCenter` 中的 `ProductPanel`、纵向筛选表单和混合工具区，整改为 Sticky Search Command、类型/权限 Segmented、Grouped Results、Preview Inspector，以及独立的通知与 Calendar Tabs/Sheet。服务端搜索、离线搜索、Vault、通知偏好、标记已读和 Calendar Feed 仍由正式 controller 与 API 驱动，没有复制 GLM fixture、mock 数据、hash router 或手写 overlay。

- 自动化真实流程：通过
- 四断点截图、几何与区域合同：通过
- Axe、键盘、Sheet 焦点恢复、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%
- Product Owner 视觉与任务验收：**待 Gate 1 明确签字**

自动化结果只证明实现可运行、可达且未破坏正式合同，不代表 Product Owner 已批准视觉层级。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/search` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、OfflineSearchRepository、通知与 Calendar Feed |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 55 项；保留用户与计划内既有改动，未自动提交或回滚 |
| Web image | `sha256:11b5077cd11747ce0bc9c2bd000e62a94aeba7c3dd6309d38a1ed588b2363899` |
| Web image Created | `2026-08-26T08:47:46.651469465Z` |
| Web container Started | `2026-08-26T08:47:47.416422812Z` |
| Proxy container Started | `2026-08-26T08:29:09.090769684Z` |
| 运行状态 | Web、Proxy healthy；`/healthz` 200；Web mounts 为 0 |

本轮只重建并强制重建 Web；API、Postgres、Redis、worker、Proxy 和已有数据卷未重建、未清空。由于正式 API 处于 invitation registration 模式，真实 E2E 使用同镜像、同数据库但仅在 Docker backend 内可达的临时 open-registration API 创建一次性验收账号；测试仍访问正式 `8080`，临时容器在测试后已销毁。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | [Before](before/app-search-320x640.png) | `app_search-320x640.png` | [After](after/app-search-320x640.png) |
| 390 x 844 | [Before](before/app-search-390x844.png) | `app_search-390x844.png` | [After](after/app-search-390x844.png) |
| 1024 x 768 | [Before](before/app-search-1024x768.png) | `app_search-1024x768.png` | [After](after/app-search-1024x768.png) |
| 1440 x 900 | [Before](before/app-search-1440x900.png) | `app_search-1440x900.png` | [After](after/app-search-1440x900.png) |

全部 Before/After 图片的像素尺寸与文件名一致。Target 文件存在性、视口和 SHA-256 由 `reports/ui-refactor/glm-target-manifest.json` 固定。

| 视口 | Target SHA-256 | After SHA-256 |
| --- | --- | --- |
| 320 | `ace9e512f42c6e44d7cfbb2a62ad696d0e84be9be5de8f79865c0494058e8544` | `8f3378b624674d6afd36b6d6921bface379ad9ffb36e826affd70e0c84d9cfe3` |
| 390 | `b952e1d532b1cacd72fb77ff2c49de117a0f376e44e11fb7313627ffec9dda69` | `359be78476b1c3c17e5ed8728cdd3339ce91dea63011fceb15c45c515fcd98c1` |
| 1024 | `9c0e0ea422cfd8b04486c9fe4ec2b2e14a58d28e324c3622ac60429170a4feda` | `be42524e7a57c8fee738273421e04309871fc7d5ce8fcbe07e1849aede8d1427` |
| 1440 | `4dad990bf0e9d23f1febbddb5b799455a895b825274d08fff7790e3630af0f2f` | `270e19c46f910b8d35a8f19a3890feb85b12be73cbc5a887aa276014ee20bd42` |

GLM Target 展示 dark theme 的 idle 状态，After 展示正式 light theme 的真实 ready/results 状态。按照 Conformance Contract，不做 full-page pixel match；同视口验收比较布局树、关键区域、几何、密度、主任务与交互编排。双主题 token 和正式数据语义均保留。

## 主体结构差异

### Before

```text
Engagement Center
├─ Header
├─ ProductPanel: 搜索
│  ├─ Workspace Select
│  ├─ Query Input
│  ├─ Object Type Select
│  ├─ Permission Scope Select
│  └─ Search Button
├─ ProductPanel: 结果与预览
├─ ProductPanel: 通知偏好与记录
└─ ProductPanel: Calendar Feed 表单与列表
```

旧主体把三个模式和全部输入纵向堆在同一页，搜索上下文、结果浏览和工具管理缺少主次；移动端只是把旧表单继续向下排。

### After

```text
Search Workbench
├─ Workbench Header
│  └─ 搜索、通知、Calendar 的模式说明
└─ Tabs
   ├─ Search
   │  ├─ Sticky Command Master
   │  │  ├─ Query
   │  │  ├─ Type Segmented
   │  │  ├─ Permission Scope Segmented
   │  │  └─ Workspace Context
   │  ├─ Grouped Results Main
   │  └─ Result Preview Inspector / Mobile Sheet
   ├─ Notifications
   │  ├─ Preference Inline Editor
   │  └─ Notification Inbox + Mark Read
   └─ Calendar
      ├─ Feed List
      ├─ Create Feed Sheet + One-time URL
      └─ Revoke Sheet + REVOKE phrase gate
```

1440 px 保持 264px Master、弹性 Main、316px Inspector；1024 px 保持筛选和结果连续可见，Preview 下移；320/390 px 按 Command → Results 连续纵向阅读，点击结果后使用全宽 Sheet 预览，Escape 关闭并恢复到触发结果行。

## 主任务与交互路径

默认主任务是“从统一入口检索正式对象并进入下一步行动”。路径不离开 Search 上下文：

```text
自动带入 Workspace 与权限范围
→ 输入查询并提交
→ 用类型和权限 Segmented 收窄结果
→ 键盘或指针选择分组结果
→ Inspector / Mobile Sheet 检查权限来源与匹配片段
→ 打开对象所在正式路由
```

搜索输入是 ready/idle 状态的唯一 primary；无结果时“清除筛选”成为唯一 primary。通知和 Calendar 是独立 Tabs，不与搜索主任务抢夺首屏注意力。

## 组件映射

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份 | `WorkbenchHeader` | 明确统一入口及隐私边界 |
| 模式切换 | `WorkbenchTabs` / `WorkbenchTabPanel` | Search、Notifications、Calendar 键盘可切换 |
| 搜索命令 | route-specific command form + Segmented buttons | 输入唯一 primary；类型与范围用原生 button group |
| Workspace 上下文 | `WorkbenchSelect` | 自动带入且持续回显真实 Workspace/role |
| 分组结果 | 语义 section/list/button | Arrow Up/Down 移动焦点并同步 Preview |
| 桌面预览 | `ResultPreview` Inspector | 显示类型、Space、权限来源、时间和正式深链 |
| 移动预览 | `WorkbenchSheet` | 全宽 Sheet、Escape、显式关闭、焦点恢复 |
| 通知设置 | Inline Editor + notification list | 保存偏好、未读计数、逐条标记已读 |
| Calendar 管理 | `WorkbenchSheet` | 创建、一次性 URL、撤销影响说明与 phrase gate |
| 状态恢复 | `ProductOperationalStateNotice` | 真实 loading/offline/locked/permission/error/stale 与 recovery |

## Function Reachability

| 正式能力 | 新入口 | 真实验证 |
| --- | --- | --- |
| Workspace、权限、Vault、在线状态 | Search Master 持续回显 | 真实上下文通过 |
| 服务端统一搜索 | Sticky Search Command | Goal/Task/Note 真实创建与检索通过 |
| 正式五类型筛选 | Type Segmented | `goal/task/note/resource/paper` 合同测试通过 |
| 私有/共享权限范围 | Scope Segmented | `permission_source` 过滤通过 |
| 旧响应竞态保护 | Controller request id + Workspace id | controller test 通过 |
| 键盘浏览结果 | Result rows | Arrow Down 选择与 Preview 同步通过 |
| 正式对象深链 | Preview “打开所在页面” | 五类型 route mapping 通过 |
| 离线搜索与 Vault 解锁 | Offline/locked recovery | OfflineSearchRepository 与 locked UI 通过 |
| 通知偏好 | Notifications Tab | 真实保存与 success live status 通过 |
| 标记通知已读 | Notification row | component command reachability 通过 |
| Calendar Feed 创建 | Calendar Tab → Create Sheet | 真实创建与一次性 URL 通过 |
| Calendar Feed 撤销 | Feed row → Revoke Sheet | 影响范围、权限、不可恢复性、恢复路径及 `REVOKE` gate 通过 |
| loading/empty/pending/success/offline/locked/permission/409/error/capability-disabled/stale | Controller + shared operational state | 可达性合同与恢复动作保留 |

`SearchControllerResult.commands` 的全部正式 command 均由新 View 消费或通过可发现入口触达，Function Reachability 为 100%。

## 响应式与无障碍

- 320、390、1024、1440：document 和可见元素无横向溢出、遮挡或不可达操作。
- 四视口 GLM 五区域均存在：`search-command`、`search-modes`、`search-results`、`search-preview`、`search-utilities`。
- 四视口 Axe 对 `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa` 零 violation。
- 当前可见层 `data-workbench-primary="true"` 不超过 1，且 primary 位于可达区域。
- 结果支持 Arrow Up/Down；Radix Tabs 支持 Arrow/Home/End。
- Calendar 与移动 Preview Sheet 支持 Escape；关闭后焦点分别恢复到创建按钮和结果触发行。
- `prefers-reduced-motion: reduce` 下 animation/transition duration 满足审计阈值。
- 移动控件至少 44x44px；图标为统一 `AppIcon`，装饰图标从 accessibility tree 隐藏。
- 选中结果的辅助文字达到 4.5:1；通知与 Calendar 的成功/错误状态使用 `aria-live`。

## 验证记录

```text
pnpm --filter @logion/web test       48 files / 182 tests passed
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm --filter @logion/web build      35 routes built
git diff --check                     passed
search-workbench.spec.ts             1 passed / 10.6s
```

真实 E2E 使用正式 Session/API 完成 Goal、Task、Note 创建与搜索、类型/权限筛选、键盘选择、无结果恢复、通知偏好、Calendar 创建/一次性 URL/撤销、离线 locked、四断点、Axe、几何、primary 与 reduced-motion。未注入业务 fixture 或直接修改数据库。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44x44px | WCAG 与移动触达质量要求 | 仅扩大点击区，不改变 GLM 信息层级 | 待 Gate 1 一并确认 |
| Target 为 dark/idle，After 为 light/ready | Target 固定原型状态；正式验收必须使用真实 Session/API 数据 | 按合同比较结构、几何、层级与交互；双主题 token 均保留 | 待 Gate 1 一并确认 |
| 原型含“知识点/考试”筛选，正式实现不含 | 正式 Search API 对象合同仅允许五类型 | 保留 `goal/task/note/resource/paper`，不伪造类型 | 待 Gate 1 一并确认 |
| 图标继续使用 `AppIcon` | 仓库未声明 `lucide-react`，新增依赖受 PO 审批门限制 | 复用项目统一矢量图标层，不引入第二套视觉体系 | 待 Gate 1 一并确认 |

没有其他 route-specific 偏离获批。Search 当前状态为“实现及 AI 自检完成，等待 Gate 1”，不得写成 Product Owner 已验收。

## Product Owner Gate 1 任务

Product Owner 需在真实 `127.0.0.1:8080` 运行实例中，以 1440 和 390 为主要视口，抽查 320/1024，并完成以下任务：检索正式对象、切换类型与权限范围、键盘选择结果、移动端打开/关闭 Preview、保存通知偏好、标记通知已读、创建 Calendar Feed、查看一次性 URL、按影响说明撤销 Feed、切换离线并验证恢复动作。验收时对照同视口 GLM Target，明确判断主任务、信息密度、结果层级与工具分区，不以“测试全绿”或“看着更漂亮”代替签字。
