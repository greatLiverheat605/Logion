# Data GLM 一致性验收报告

## 当前结论

`/app/data` 已完成主体工作台重构，旧 `DataSovereigntyCenter` 的
`ProductPageHeader + ProductHero + Metrics + Disclosure + ProductPanel + planning-form`
结构不再作为运行主体。页面现在以 Workspace 数据边界为上下文，采用
`Export / Import Master`、`Data View Main` 和隔离的 `Danger Inspector`。

- 导出、导入预览、Private Space 目标、账户删除与恢复入口均保留。
- 导入严格分为“生成预览”与“确认写入”两步；选择目标不会提交 API。
- 导出和导入沿用真实 `integrationCapabilityService`，没有 fixture 或 mock 数据。
- mutation 刷新后保留成功提示；刷新失败会同时说明已完成的操作和列表刷新恢复动作。
- 浏览器 `online/offline` 事件会立即更新 Context Bar、状态栏和 Inspector 恢复文案。
- 无 Workspace、无自有 Private Space 的 capability-disabled 状态分别提供管理入口。
- loading、offline、permission、recent-auth、409 和 error 状态会同步禁用相关 mutation capability，避免错误状态仍可提交。
- 定向 Data tests、Web 全量 Vitest、typecheck、lint 均通过。

真实 Session/API 四断点截图和人工走查尚未在本报告中伪造，待无源码挂载的最新 8080 镜像完成后补齐。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无可复核的历史同视口原图 | 未交付该视口 Target；按 GLM 响应式合同验收 | 待真实浏览器走查 |
| 390 x 844 | 无可复核的历史同视口原图 | `app_data-390x844.png`（manifest SHA-256 `69ca3576f4ff1bdc03ef404a2e7c05da9534ce7809651bd7cf2adfbb3cc9b595`） | 待真实浏览器走查 |
| 1024 x 768 | 无可复核的历史同视口原图 | 未交付该视口 Target；按 GLM Workbench 几何与无障碍合同验收 | 待真实浏览器走查 |
| 1440 x 900 | 无可复核的历史同视口原图 | `app_data-1440x900.png`（manifest SHA-256 `3cfaa6cba59c4e89af6933e57e4c9bf81df5649588032a45676584d36449fda3`） | 待真实浏览器走查 |

不缩放、不裁切、不伪造 Before / After。After 截图必须来自完成登录、Workspace/Space 读取和真实导出/导入任务的最新无源码挂载 Web 镜像。

## 主体结构差异

### Before

```text
DataSovereigntyCenter
├─ 页面头部与说明 Hero
├─ Workspace / Space / 认证字段纵向表单
├─ 导出、导入和账户删除混在 ProductPanel
└─ 状态反馈与危险操作同层
```

### After

```text
Data Workbench
├─ Workbench Header + 唯一 primary：创建加密导出
├─ Context Bar：Workspace、权限、实时 API / 离线
├─ Export / Import Master
│  ├─ Workspace 选择与数据分区
│  ├─ 导出任务、导入预览列表
│  └─ 无 Workspace / 无 Private Space 的恢复入口
├─ Data View Main
│  ├─ 导出详情：状态、大小、有效期、SHA-256、下载
│  └─ 导入详情：对象计数、源哈希、警告、目标 Space、明确确认
└─ Isolated Danger Inspector
   ├─ 当前数据边界与最近读取
   ├─ 状态、近期认证、权限、409、离线恢复
   └─ 删除账户影响范围、宽限期和恢复页入口
```

## 主任务与交互路径

主任务是“创建一个可验证的加密导出”；导入是同一数据边界内的二级任务：

```text
自动带入 Workspace / 权限 / Private Space
→ 唯一 primary 打开创建加密导出 Sheet
→ 输入 EXPORT 确认短语
→ 创建后台任务并在列表回显 queued/running/succeeded/failed
→ 成功后提供短期下载和 SHA-256

导入路径：
生成导入预览 Sheet
→ 真实 API 安全解析并展示计数、源哈希和警告
→ 选择自己的 Private Space（只更新本地选择）
→ 点击“确认写入 Private Space”才调用 commit API
→ 409 / 权限 / 离线失败保留上下文并提供重试
```

## Function Reachability 与状态

| 能力 | 新入口 | 真实语义 |
| --- | --- | --- |
| Workspace / Space 上下文 | Master Select + Context Bar + Inspector | 真实 Workspace/Space API，导入目标只过滤 `visibility=private` |
| 创建加密导出 | Header 唯一 primary → Export Sheet | `POST /data-exports`，EXPORT 短语，后台状态和短期下载 |
| 取消导出 | Export Detail / 任务行 | `expected_version`，409 时提示刷新 |
| 导入预览 | Master secondary → Import Sheet | `POST /data-imports/preview`，1 MiB、格式和源文件字段保留 |
| 确认导入 | Import Detail → 明确确认按钮 | `POST /data-imports/{id}/commit`，目标必须为当前 Workspace 的 Private Space |
| 账户删除 | Danger Inspector → Deletion Sheet | 影响范围、近期认证、DELETE MY ACCOUNT、宽限期恢复页 |
| 成功 / pending / error | 状态标签、详情、Inspector | mutation 成功提示不会被刷新覆盖；刷新失败给出恢复动作 |
| offline / permission / 409 / recent-auth | Context Bar + 状态栏 + Inspector | 真实错误映射、请求编号和重新读取/登录入口 |
| empty / capability-disabled | Master EmptyState / Capability Note | 无 Workspace → `/app/workspaces`；无 Private Space → `/app/spaces` |

## 验证记录

```text
pnpm --filter @logion/web exec vitest run src/features/data/data-workbench.test.tsx
  passed: 1 file / 3 tests
pnpm --filter @logion/web test
  passed: 66 files / 247 tests
pnpm --filter @logion/web typecheck
  passed
pnpm --filter @logion/web lint
  passed
```

静态合同覆盖：唯一 primary、Master/Main/Inspector 区域、旧 `product-panel` / `planning-form`
主体不再出现、导入确认按钮、Private Space 边界、空 Workspace 与 capability-disabled 文案。

## 证据缺口与下一步

| 缺口 | 原因 | 下一步 |
| --- | --- | --- |
| 320 / 390 / 1024 / 1440 After 截图 | 当前工作区没有在本轮重建无源码挂载镜像 | 重建 `logion-web:dev`，使用真实测试 Session/API 走查并记录镜像摘要与 SHA-256 |
| Before 同视口原图 | 历史审计资产未提供 Data 页面四断点原图 | 保留缺口，不伪造；由 Product Owner 决定是否接受 |
| 真实导出/导入/删除走查 | 本轮仅完成静态与业务合同验证 | Browser 走查 queued → succeeded → download、preview → confirm、recent-auth/409/offline、删除恢复 |
| Screen Reader / Axe / reduced-motion | 需在最新运行镜像验证 | 与截图走查同一 Browser harness 执行并归档结果 |

在真实 Browser 证据与 Product Owner 独立验收前，不宣称 Data 页面完成 Gate 2 视觉验收。
