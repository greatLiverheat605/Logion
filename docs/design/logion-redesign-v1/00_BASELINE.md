# Logion 产品重构 D0 事实基线

> 核对日期：2026-08-11（Asia/Shanghai）
>
> 诊断基线：`e2b85987d816baf53a089007e674cd440e9ce64f`
>
> 分支：`codex/v020-rc6-closeout`

## 1. 范围与证据边界

本轮只读取 Git、产品文档、ADR、Web/API/合同源码和现有测试，写入
`docs/design/logion-redesign-v1/**`。没有修改正式 Web、API、Worker、合同、迁移、Manifest、
锁文件、生产配置或 Feature Flag，也没有访问生产环境或真实用户数据。

工作树开始时只有两个既有未跟踪目录：`.tmp-v020-rc2/` 与 `.tmp-v020-rc4/`。它们不属于本轮，
保持不读、不改、不提交。

`.agents/coordination/current-run.json` 指向历史 Run
`run-v020-v11-remediation`。实际执行状态校验仍失败，原因是 `graph.json` 与 `tasks.jsonl` 的编码内容
超出安全扫描预算。该问题禁止新 Worker 派发，但不改变 Git、源码和实际检查的事实优先级；本轮不改写
历史账本。

## 2. 已批准产品基线

- 产品定位：认知作业空间；Today 是行动入口，Knowledge Base 是长期资产中心。
- 一个用户可见 Knowledge Base 对应一个后端 `Space`。
- Workbench 只是正式对象的受控投影，不改变权限，不复制正式对象。
- Source 继续复用 `Resource`；Topic 先修关系继续唯一使用 `TopicDependency`。
- AI 只产生 Draft/Suggested，正式写入必须经过用户接受事务。
- 新知识实体首版 online-only，不能加入 sync-v1。
- 桌面端采用单窗口专业工作区；移动端提供任务等价路径，不复制桌面三栏密度。
- Shared Write、Deletion、Attachment ingest、Local Worker、Provider、sync-v1 扩展与 AI Acceptance
  的生产开关继续关闭。

权威产品文件：

- `docs/product/SYSTEM_BLUEPRINT_REVIEW.md`
- `docs/product/PRODUCT_DIRECTION_MARKET_ANALYSIS.md`
- `docs/product/PRODUCT_REDESIGN_EXECUTION_PLAN.md`
- `docs/adr/0029-adaptive-knowledge-space.md`

## 3. Web 技术事实

| 项目         | 当前事实                                                                               | D0 判断                                        |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 框架         | Next.js `16.2.11`、React/React DOM `19.2.7`、TypeScript `5.9.3`                        | 保留，不因重构升级框架                         |
| 路由         | App Router；21 条正式 `/app/*` 业务路由，另有 `/app` 承接页和历史原型路由              | 保留 URL，重组可见 IA                          |
| 正式 UI 依赖 | 没有通用组件库、图标库、图谱库、表格或虚拟化库                                         | D1/D2 后按决策门引入最小依赖                   |
| 应用壳       | `SessionBoundary -> PersonaProvider -> VaultSessionProvider -> AppShell`               | 保留认证/Vault 边界，重构壳层呈现与数据装配    |
| API          | `browserApiClient` 只允许同源 `/api/v1`，自动 CSRF、15 秒超时、JSON 严格错误、请求编号 | 保留并把请求编号接入统一命令反馈               |
| 离线         | `@logion/offline`、IndexedDB、加密 Vault、sync-v1 bootstrap/push/pull                  | 保留现有实体；新知识实体不得混入               |
| 主题         | 根节点 `data-theme`，Light/Dark 独立 tokens，持久化值有安全校验                        | 保留机制，重整 tokens 与组件消费边界           |
| 样式         | `apps/web/src/app/globals.css` 4993 行，另有功能 CSS                                   | 需要分层迁移，禁止一次性全量重写               |
| 测试         | Vitest、Playwright、axe；Browser 覆盖 21 路由、断点、主题、键盘、reduced-motion        | 作为重构回归基线扩展，不把旧通过冒充新方案通过 |

## 4. 规模与耦合事实

主要客户端中心组件行数：

| 组件                                                           |               行数 | 主要问题                                     |
| -------------------------------------------------------------- | -----------------: | -------------------------------------------- |
| `features/memory/review-center.tsx`                            |               1772 | 数据装配、离线、命令、复习、审查与图谱同文件 |
| `features/execution/today-center.tsx`                          |               1732 | 上下文、任务、会话、证据、验收和展示同文件   |
| `features/self-study/self-study-center.tsx`                    |               1607 | 学习、研究、协作三种模式共享超大组件         |
| `features/knowledge-space-prototype/knowledge-space-graph.tsx` |               1606 | 图布局、渲染、键盘、Inspector 与状态同文件   |
| `features/exam/exam-center.tsx`                                |               1291 | 考试层级、离线提交和展示同文件               |
| `features/content/content-center.tsx`                          |               1119 | Note、Resource、附件队列和同步同文件         |
| `components/app-shell/app-operational-tools.tsx`               |   1120（历史统计） | 快速捕获与专注流程集中在壳层组件             |
| `components/app-shell/app-shell.tsx`                           | 约 525（历史统计） | 导航、命令、通知、移动导航和状态耦合         |

正式 TSX 中实际使用 `<ProductPanel>` 69 次、`<ProductMetric>` 64 次、`<ProductDisclosure>`
34 次、`<ProductHero>` 10 次。数量本身不是缺陷，但它证明不同任务页面被同一套仪表盘语法过度
同质化。

## 5. 应用壳与导航事实

- 侧栏只列 12 条 Persona 路由；其余正式路由通过命令面板、设置入口或直达 URL 可访问。
- Persona 只影响入口可见性，不改变 Workspace/Space 权限。
- 命令面板已经支持 `Ctrl/Cmd+K`、焦点圈、Escape 返回以及快速捕获/专注动作。
- AppShell 先请求 Workspace，再请求第一个 Workspace 的通知，形成可消除的串行请求瀑布。
- 各大型工作台重复加载 Workspace、Device、Space、Vault、bootstrap 与 sync 状态，缺少统一的
  上下文装配层。
- `/app/spaces` 与 `/app/workspaces` 当前都渲染同一个 `WorkspaceCenter`，URL 语义尚未在 UI 中分离。
- `/app/profile` 与 `/app/help` 仍是轻量占位页，不能作为完整 System Center 设计依据。

## 6. 视觉与交互事实

- 当前 Light/Dark 表面层级和单一蓝色强调色可保留。
- `body` 使用两组径向光晕和网格背景；`ProductHero` 使用三层轨道圆与大百分比，这与已批准的克制
  专业外壳冲突。
- 全局 `h1` 使用 `clamp(2.25rem, 8vw, 5.5rem)` 和负字距，容易把应用工具页标题带入营销 Hero
  尺度；正式重构应使用页面级排版 tokens。
- 已有 `focus-visible`、`prefers-reduced-motion`、320px 最小宽度、移动底栏、图谱键盘导航和移动
  列表路径，这是可保留的质量基础。
- Persona 定义和自定义选择仍直接使用 Emoji 图标，和单一线性图标族目标不一致。
- 部分近期修复已加入就地反馈，但多数大型工作台仍共享一个页面级 `status` 字符串；命令状态、
  错误位置、请求编号与恢复动作没有形成统一组件合同。

## 7. 当前能力分层

| 层级                      | 能力                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已实现并可作为重构数据源  | 认证、Workspace/Space、Task/Session/Evidence、Note/Resource、Topic/Review、Exam、Self-study、Research、Collaboration、Search/Notification/Calendar、Security、Sync、Portability、AI Run/Draft/Provider 管理 |
| 已实现但受能力/环境门控制 | Attachment 上传与扫描、本地 Worker、知识 API、AI 正式接受、账户删除等                                                                                                                                       |
| 已集成的历史/验收原型     | `/app/knowledge-prototype` 与 Review 内真实只读知识图谱入口                                                                                                                                                 |
| 尚无完整正式合同          | Collection、Saved View、`workbench-v1`、受控自定义属性、正式/探索关系转换、统一 Source 阅读器与完整证据 Inspector                                                                                           |

## 8. 本轮不作出的结论

- 不把现有 PersonaSetting 说成 `workbench-v1`。
- 不把历史原型 mock 写入说成生产知识写入。
- 不因 UI 有按钮就认定对应生产能力已开启。
- 不把现有 Browser 通过记录当作尚未制作的新原型验收结果。
- 不在 D0 决定数据库、权限、迁移、OpenAPI、Provider 或生产开关。
