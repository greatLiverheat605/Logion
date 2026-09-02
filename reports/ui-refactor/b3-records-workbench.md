# B3 Records GLM 一致性验收报告

## 当前结论

Records 已按批准的 GLM 信息架构完成实现与 AI 自检。正式页面从 `ContentCenter` 中混合的 `ProductPanel`、重复编辑区、纵向资料与附件表单，整改为 Document Tree、Inline Markdown Editor / Safe Preview、Metadata / Relation / Sync Inspector，以及承载低频输入的 Radix Sheet。Session、Workspace、Space、权限、Vault、`ProtectedOfflineRepository`、`YjsNoteRepository`、Links/PDF、附件 SHA-256 队列、revision 与 sync-v1 仍由正式 controller、repository 和 API 驱动，没有复制 GLM fixture、mock 数据、hash router 或手写 overlay。

- 自动化真实流程：通过
- 四断点截图、几何与区域合同：通过
- Axe、键盘、焦点恢复、reduced-motion、overflow、唯一 primary：通过
- Function Reachability：100%
- Product Owner 视觉与任务验收：**待 Gate 1 明确签字**

自动化通过只证明实现可运行、可达且未破坏正式合同，不代表 Product Owner 已批准视觉层级。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/records` |
| Compose project | `logion-b1` |
| 数据链路 | 正式 Session Cookie、API、Workspace、Space、权限、Vault、IndexedDB、`ProtectedOfflineRepository`、`YjsNoteRepository`、附件队列、revision、sync-v1 |
| 业务 mock | 无 |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 62 项；保留用户与计划内既有改动，未自动提交或回滚 |
| Web image | `sha256:a0e0e230207f251feb5370f9679131bb4fcc3536ca7d3f1c9d869c2cd3743137` |
| Web image Created | `2026-08-26T09:43:57.099351764Z` |
| Web container Started | `2026-08-26T09:45:48.382615886Z` |
| API image | `sha256:9aa32a6244840c91518b4279d7e853140a3e3a1b9b5d1da3c52d6081dcd8331b` (`logion-api:dev`) |
| API container Started | `2026-08-26T09:45:37.102690388Z` |
| Proxy container Started | `2026-08-26T09:45:59.287938943Z` |
| 运行状态 | Web、API、worker、Proxy healthy；`/healthz` 200；Web mounts 为 0 |

本轮只 build 了 Web 镜像，没有 build API。首次 recreate 时 Compose 因继承容器内 `LOGION_VERSION=0.1.0`，曾把 API 进程误切到旧 `logion-api:0.1.0` 镜像；发现后立即显式锁定 `LOGION_API_IMAGE=logion-api:dev`，恢复到整改前的 API image digest，再开始验收。Postgres、Redis、worker 和数据卷没有重建或清空。最终截图与 E2E 只接受恢复后的上述运行摘要，误切期间不计入验收证据。

正式 API 处于 invitation registration 模式。真实 E2E 使用同一 `logion-api:dev` 镜像和同一数据库、但仅在 Docker backend 网络可达的临时 open-registration API 创建一次性验收账号；测试仍通过正式 `8080` 登录并访问正式 API，临时容器在 `finally` 中销毁。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | [Before](before/app-records-320x640.png) | `app_records-320x640.png` | [After](after/app-records-320x640.png) |
| 390 x 844 | [Before](before/app-records-390x844.png) | `app_records-390x844.png` | [After](after/app-records-390x844.png) |
| 1024 x 768 | [Before](before/app-records-1024x768.png) | `app_records-1024x768.png` | [After](after/app-records-1024x768.png) |
| 1440 x 900 | [Before](before/app-records-1440x900.png) | `app_records-1440x900.png` | [After](after/app-records-1440x900.png) |

全部 Before/After 图片的像素尺寸与文件名一致。Target 文件存在性、视口和 SHA-256 由 `reports/ui-refactor/glm-target-manifest.json` 固定。

| 视口 | Target SHA-256 | After SHA-256 |
| --- | --- | --- |
| 320 | `25771196e316e90e344fad6f01ad9e49971bf3309af8f1ec41a607c6c6fe3ce8` | `a2f77c84145d9cab5cbb91faf1fba97d35704b798c691d0b082525da82f6aeaf` |
| 390 | `7c07c68ad2f5330dfc83dddc3b739bd28e251013e88c19092588f64528a7b865` | `63bcdcdec03fa189bd88576666452d4c2a52b7499071c79d904c8ae1f0b5badb` |
| 1024 | `c05d801dbf46ad278a6ad1471541b4761a20aceeb5a6babce8d97e07bf6df83a` | `c8edde4eb260c83de57fbbd534ddf3c0b54ca5640377af4ddf921827c5c317ab` |
| 1440 | `c51d888bdb2c3980b0cc7de7f87c9360c204c68d35623c46cd932eaa5010f744` | `a27986fb980951267e7fcb5d7dd3d1006b2b320afd0a995cc747dee3b4a332ce` |

320 Target 本身存在重复拼接伪影，因此只用于文件完整性和视口验收，不作为像素匹配依据；该视口的结构判断采用 GLM specs，并与 390/1024/1440 Target 交叉核对。Target 展示 dark/idle 原型数据，After 展示正式 light/真实 `stale`、queued、synced 状态；按 Conformance Contract 比较布局树、区域、几何、密度、主任务与交互编排，不做 full-page pixel match。

## 主体结构差异

### Before

```text
Content Center
├─ Header 与 Workspace / Space 表单
├─ ProductPanel: Vault / Sync 状态
├─ ProductPanel: Markdown 笔记
│  ├─ 笔记列表
│  ├─ 重复标题与正文编辑表单
│  └─ 保存 / 预览操作
├─ ProductPanel: Links / PDF
│  └─ 类型、URL、页码与索引字段纵向平铺
└─ ProductPanel: 附件
   └─ 文件输入、队列与状态纵向平铺
```

旧主体把对象浏览、编辑、资料登记、附件和同步恢复按表单区块堆叠。选中对象没有稳定工作面，元数据与关系散落在不同区块；移动端只是把同一长表单继续向下排。

### After

```text
Records Workbench
├─ Workbench Header
│  ├─ 登记资料 Dropdown → Link / PDF Sheet
│  └─ 新建笔记唯一页面 primary → Note Sheet
├─ Context Bar
│  └─ Workspace / Space / 权限 / Vault / Sync 持续回显
├─ Operational Notice
│  └─ offline / locked / permission / conflict / error / stale 恢复
└─ Workbench Frame
   ├─ Document Tree Master
   │  ├─ Type Segmented + Search
   │  ├─ Notes
   │  ├─ External Resources
   │  └─ Attachment Queue
   ├─ Inline Editor Main
   │  ├─ Edit / Safe Preview Segmented
   │  ├─ dirty / pending / success Save Status
   │  └─ Local Save Command
   └─ Metadata / Relation / Sync Inspector
      ├─ Revision、size、sync metadata
      ├─ related work objects
      └─ attachment / sync / conflict utilities
```

1440 px 保持 264px Master、弹性 Main、316px Inspector；1024 px 保持 Master/Main，Inspector 进入主列下方的 Inline Inspector；320/390 px 按 Context → Recovery → Document Tree → Editor → Inspector 连续纵向阅读，不使用不可发现的 pane switcher。移动端 Sheet 为全宽交互层，触发器在关闭后恢复焦点。

## 主任务与交互路径

主任务是“创建或选中笔记，在同一工作区编辑正文并连接外部资料与附件”。路径不离开 Records 当前上下文：

```text
自动带入 Workspace / Space / 权限
→ 解锁本地 Vault
→ 新建或从 Document Tree 选择笔记
→ 编辑标题与 Markdown 正文
→ 安全预览，不执行正文 HTML
→ 保存本地 revision / Yjs 更新并尝试 sync-v1
→ 通过资料 Dropdown 登记 HTTP(S) Link 或 PDF 页码索引
→ 通过 Inspector 添加真实附件队列
→ 在 stale / conflict / offline 时使用明确恢复动作
```

“新建笔记”是 ready 状态的唯一页面 primary；保存是当前对象局部命令。登记资料、添加附件、重命名和解锁均为 secondary Dropdown/Sheet，不与主任务争抢首屏层级。

## 组件映射

| 页面职责 | 正式组件 | 交互合同 |
| --- | --- | --- |
| 页面身份与创建 | `WorkbenchHeader` | 新建笔记唯一页面 primary；资料登记为 Dropdown Menu |
| 上下文回显 | `WorkbenchContextBar` + `WorkbenchSelect` | 自动带入正式 Workspace/Space 并持续显示权限、Vault、Sync |
| 三栏工作面 | `WorkbenchFrame` | Document Tree / Main Editor / Inspector 稳定 landmarks |
| 对象筛选 | route-specific Segmented + Search | 全部、笔记、链接、PDF、附件；保留真实对象类型 |
| 对象选择 | 语义 button list | Arrow Up/Down 移动焦点并同步编辑对象 |
| 正文编辑 | Inline inputs + textarea | draft 局部化；dirty/pending/success 明确；不改变 repository payload |
| 安全预览 | route-specific Markdown renderer | 渲染结构文本，不注入或执行正文 HTML |
| 低频输入 | `WorkbenchSheet` | 新建、Link、PDF、附件、解锁、重命名；最多二级披露 |
| 对象元数据 | `InspectorSection` | revision、同步、关联、附件与恢复命令扫描式呈现 |
| 状态恢复 | `ProductOperationalStateNotice` | 11 类状态及 button/link recovery，request ID 保留 |

## Function Reachability

| 正式能力 / command | 新入口 | 验证 |
| --- | --- | --- |
| `loadContext` / Workspace / Space / 权限 | Context Bar 与首次加载 | 真实 Session/API 上下文通过 |
| `setWorkspaceId` / `setSpaceId` | Context Select | Space 隔离与过期刷新拒绝合同通过 |
| `unlock` | locked notice / Unlock Sheet | 真实 Vault 解锁通过 |
| `createNote` | Header “新建笔记” → Sheet | 真实创建、选中和 revision 通过 |
| `selectNote` | Document Tree | 点击与 Arrow Up/Down 通过 |
| `saveNote` | Inline Editor “保存” | 真实标题/正文、dirty/success、Yjs/commit 分支通过 |
| Safe Preview | Editor Segmented | `<script>` 以文本显示且 DOM 中无可执行 script |
| `createResource` Link | 登记资料 → HTTP(S) Sheet | 真实保存；非 HTTP(S) 继续被拒绝 |
| `createResource` PDF | 登记资料 → PDF Sheet | 真实文件名、总页数、索引页、标签与笔记通过 |
| `renameResource` | Resource row menu → Rename Sheet | 真实重命名通过 |
| `queueAttachment` | Inspector “添加附件” → Sheet | 真实 `text/plain` 文件、64 位 SHA-256 与本地队列通过 |
| `synchronize` | Context / Inspector “立即同步” | 正式 sync-v1、revision 与刷新通过 |
| 搜索与类型筛选 | Document Tree command area | Note、Link、PDF、Attachment 元数据检索通过 |
| offline / locked / permission / conflict / error / capability-disabled / stale | Operational Notice + Inspector | 状态优先级、恢复链接/命令与 request ID 合同通过；真实附件队列触发 stale 通过 |

`RECORDS_COMMAND_KEYS` 的 11 个正式 command 全部由新 View 消费或通过可发现入口触达，Function Reachability 为 100%。

## 响应式与无障碍

- 320、390、1024、1440：document 和可见元素无横向溢出、遮挡或不可达操作。
- 四视口 GLM 五区域均存在：`records-tree`、`records-editor`、`records-save-status`、`records-inspector`、`records-attachments`。
- 四视口 Axe 对 `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa` 零 violation。
- 当前可见层 `data-workbench-primary="true"` 不超过 1，且 primary 位于可达区域。
- Document Tree 支持 Arrow Up/Down；Dropdown、Sheet 与 Segmented 使用正式语义和焦点管理。
- 新建笔记 Sheet 首字段自动获得焦点；Escape 关闭后焦点恢复到“新建笔记”。
- `prefers-reduced-motion: reduce` 下 animation/transition duration 满足审计阈值。
- 移动控件至少 44x44px；320/390 保持 Tree → Editor → Inspector 连续 DOM 与视觉顺序。
- 首轮真实 stale 状态发现 `.product-tag.tone-warn` 对比度仅 4.286:1；浅色 `--text-warning` 从 `#9c5e00` 调整为 `#875100` 后，在相同 `#ece8e2` 背景达到 5.365:1，dark token 未改。
- 应用内 Browser console 无业务 warning、error 或 page error。

## 验证记录

```text
pnpm --filter @logion/web test       50 files / 193 tests passed
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm --filter @logion/web build      35 routes built（Docker production build）
git diff --check                     passed
records-workbench.spec.ts            1 passed / 21.5s
```

真实 E2E 使用一次性真实账号与正式 Session/API 完成 Vault 解锁、笔记创建、标题/正文编辑、Yjs/commit 保存、安全预览、HTTP(S) Link、PDF 页码索引、资料重命名、真实 `text/plain` 附件与 SHA-256 队列、搜索/类型筛选、键盘选择、四断点、Axe、几何、primary、焦点与 reduced-motion。未注入业务 fixture、未直接修改数据库、未豁免 Axe。

## 偏离与审批

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 移动控件至少 44x44px | WCAG 与移动触达质量要求 | 仅扩大点击区，不改变 GLM 信息层级 | 待 Gate 1 一并确认 |
| 320 Target 不做像素对比 | Target PNG 有重复拼接伪影 | 保留哈希/尺寸；采用 specs 与其余三视口交叉验收 | 待 Gate 1 一并确认 |
| Target 为 dark/idle，After 为 light/真实 stale/queued | 正式验收必须使用真实 Session/API/Vault 数据 | 按合同比较结构、几何、层级与交互；双主题 token 均保留 | 待 Gate 1 一并确认 |
| 1024 Inspector 进入主列下方 | 316px Inspector 与 264px Master 同时常驻会压缩 Markdown 工作面 | 保留 Master/Main，Inspector 连续可达；1440 使用完整三栏 | 待 Gate 1 一并确认 |
| API 进程在镜像刷新时被意外 recreate | Compose 依赖图和继承的 `LOGION_VERSION` 触发旧 tag | 未 build API；验收前恢复原 `logion-api:dev` digest，数据卷未动；完整记录运行摘要 | 运行偏离，待 Gate 1 知悉 |

没有其他 route-specific 偏离获批。Records 当前状态为“实现及 AI 自检完成，等待 Gate 1”，不得写成 Product Owner 已验收。

## Product Owner Gate 1 任务

Product Owner 需在真实 `127.0.0.1:8080` 运行实例中，以 1440 和 390 为主要视口，抽查 320/1024，并完成以下任务：解锁 Vault、新建并编辑笔记、切换安全预览、登记 HTTP(S) Link、登记 PDF 页码索引、重命名资料、添加允许类型附件并检查 SHA-256、搜索与切换对象类型、键盘选择对象、查看 Inspector、执行同步与 stale 恢复。验收时对照同视口 GLM Target，明确判断主任务、信息密度、Document Tree 层级、编辑工作面和工具分区，不以“测试全绿”或“看着更漂亮”代替签字。
