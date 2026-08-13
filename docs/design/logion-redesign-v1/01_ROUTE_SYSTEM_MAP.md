# Logion D0：21 路由系统映射

> 计数合同：下表恰好 21 条正式业务路由。`/app` 与 `/app/knowledge-prototype` 在表后单列。

## 1. 共享壳层

所有正式路由由 `apps/web/src/app/app/layout.tsx` 包裹：

```text
SessionBoundary(requireOnboarding)
  -> PersonaProvider
    -> VaultSessionProvider
      -> AppShell
        -> route page
```

页面文件多数是薄服务端组件，但其主要 feature center 都是大型客户端组件。共享在线 API 入口为
`apps/web/src/lib/api/client.ts`；离线路径通过 `@logion/offline`、IndexedDB、加密 Vault 和 sync-v1。

状态缩写：`L` loading、`E` empty、`R` ready、`P` pending/saving、`S` success、`X` error、
`O` offline/stale、`K` locked、`D` permission/capability disabled、`C` 409 conflict。

## 2. 正式路由逐条映射

|   # | 路由与页面/主组件                                           | 数据、边界与主要命令                                                                                                                      | 当前状态与测试证据                                                                | 新 IA 与迁移建议                                                                          |
| --: | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
|   1 | `/app/today`；`app/today/page.tsx` -> `TodayCenter`         | 客户端；Workspace/Device/Space API + Vault/IndexedDB/sync-v1；创建/转换 Task，开始/结束 Session，提交 Evidence，验收/拒绝，关闭已验收任务 | L/E/R/P/S/X/O/K/C；Browser 全路由、Persona、命令工具；缺完整组件测试              | **今天**；增量拆分为 Context、Now、Session、Evidence、Verification，首屏去指标化          |
|   2 | `/app/self-study`；`SelfStudyCenter` 的学习模式             | 客户端；个人学习实体 + Vault/sync-v1；创建 Track/Project/Inbox/Deliverable                                                                | L/E/R/P/S/X/O/K；模型测试与 Browser productization                                | **工作台/学习**；从三模式大组件拆出共享数据内核和学习模板                                 |
|   3 | `/app/research`；同一 `SelfStudyCenter` 的研究模式          | 客户端；Paper/Claim/Question/Run/Metric/Feedback + Vault/sync-v1；记录来源、声明、问题、运行、指标、反馈                                  | L/E/R/P/S/X/O/K；研究模型测试与 Browser 权限门                                    | **工作台/研究**；改为来源列表 + 阅读/编辑 + 证据 Inspector 三栏                           |
|   4 | `/app/exam`；`ExamCenter`                                   | 客户端；Exam/Subject/Syllabus/Mock/Score + Vault/sync-v1；创建考试、大纲、模考和成绩                                                      | L/E/R/P/S/X/O/K/C；模型测试与 Browser productization                              | **工作台/考试**；按大纲、模拟、薄弱项组织，薄弱项回流 Today/Review                        |
|   5 | `/app/collaboration`；同一 `SelfStudyCenter` 的协作模式     | 客户端；仅 Shared Space 的 Rubric/Review Request/Feedback/Report + Vault/sync-v1；创建审阅与反馈                                          | L/E/R/P/S/X/O/K/D；共享空间排除模型测试与 Browser 权限门                          | **工作台/导师**；共享内核，清楚显示角色与 Space 边界，不因 Persona 提权                   |
|   6 | `/app/planning`；`PlanningCenter`                           | 客户端；Goal/Plan/Phase + Vault/sync-v1；创建目标与阶段计划                                                                               | L/E/R/P/S/X/O/K/C；阶段序列模型测试与 Browser                                     | **工作台/共享计划模块**；不再作为指标仪表盘，回跳 Today/成果                              |
|   7 | `/app/templates`；`GrowthCenter`                            | 客户端；Template Package/Installation/Share Snapshot API；创建、安装、导入模板，创建/撤销分享                                             | L/E/R/P/S/X/D/C；无中心组件单测，Browser 壳层覆盖                                 | **工作台/模板库**；明确“安装为副本”，模板不改变权限                                       |
|   8 | `/app/records`；`ContentCenter`                             | 客户端；Note/Resource + Vault/Yjs/sync-v1，附件本地队列；保存笔记、来源、重命名、排队附件                                                 | L/E/R/P/S/X/O/K/D/C；Browser real-data controls；缺完整组件测试                   | **知识库/Sources**；重构为来源列表、阅读器、摘录与 Inspector；Attachment 关闭时隐藏伪操作 |
|   9 | `/app/review`；`ReviewCenter` + `ReviewKnowledgeSpaceGraph` | 客户端；Topic/Dependency/Mastery/Schedule/Quiz/Error/Audit Review + Vault/sync-v1；创建 Topic/依赖/题目，答题、确认掌握、处理审查         | L/E/R/P/S/X/O/K/D/C，图谱 loading/empty/truncated；模型、图适配、Browser 图谱测试 | **知识库/Review 与 Graph**；复习和图谱为等价视图，Inspector 回到 Source/Task/Research     |
|  10 | `/app/spaces`；`WorkspaceCenter`                            | 客户端；Workspace/Space/Member/Invitation API；创建 Workspace/Space、邀请、改角色                                                         | L/E/R/P/S/X/D/C；邀请 409 文案单测与 Browser 壳层                                 | **知识库/知识库管理**；用户语言改为 Knowledge Base，底层仍是 Space；与协作治理分责        |
|  11 | `/app/search`；`EngagementCenter`                           | 客户端；服务端 Search/Notification/Calendar + 解锁后的本地搜索回退；搜索、偏好、已读、创建/撤销日历                                       | L/E/R/P/S/X/O/K/D/C；通知模型与 Browser 壳层；无完整组件测试                      | **应用壳/知识库**；命令面板给快速结果，完整页保留筛选和原对象回跳                         |
|  12 | `/app/workspaces`；`WorkspaceCenter`                        | 与 `/app/spaces` 当前完全同组件、同 API、同命令                                                                                           | 同上                                                                              | **协作空间**；保留 URL，显示成员、邀请、共享 Space 与治理；不再和知识库管理同屏复制       |
|  13 | `/app/audit`；`AuditLog`                                    | 客户端只读；个人/Workspace audit API；筛选目标、结果、关键字和可追踪 ID                                                                   | L/E/R/X/D；过滤模型测试与 Browser 壳层                                            | **协作空间/审计**；低频、只读优先，明确当前范围和返回对象                                 |
|  14 | `/app/settings`；`PersonaSettings` + `IntegrationHubEntry`  | 页面壳 + 客户端 Persona；UserSetting `persona` 版本化保存，切换/创建/删除 Persona，409 一次合并重试                                       | L/E/R/P/S/X/C；Persona service/context/Browser 测试                               | **系统中心/偏好**；设置列表 + 详情；Persona 只作为旧兼容入口，不能冒充 Workbench          |
|  15 | `/app/profile`；静态 Product primitives                     | 当前无资料编辑数据路径，只展示账户/画像说明                                                                                               | R；仅全路由 Browser                                                               | **系统中心/账户**；当前为占位，后续只连接已有身份字段，不虚构个人资料合同                 |
|  16 | `/app/security`；`SecurityCenter`                           | 客户端；Device/Passkey/TOTP API；撤销设备/Passkey，注册 Passkey，启停 TOTP，重建恢复码                                                    | L/E/R/P/S/X/D/C；Browser 诊断；缺中心组件单测                                     | **系统中心/安全**；设置列表 + 详情，高风险命令需近期认证、影响预览和恢复说明              |
|  17 | `/app/sync`；`OfflineSyncCenter`                            | 客户端；Device + Vault/IndexedDB/sync-v1/Attachment transport；解锁/锁定、清本机、同步、冲突解决、附件上传                                | L/E/R/P/S/X/O/K/D/C；诊断/附件 transport 单测与 Browser 清理流程                  | **系统中心/同步与设备**；显式本地/远端/队列/冲突；不把新知识实体加入 sync-v1              |
|  18 | `/app/data`；`DataSovereigntyCenter`                        | 客户端；Export/Import/Account Deletion API；创建/取消导出，预览/提交导入，请求删除                                                        | L/E/R/P/S/X/D/C；Integration service 测试与 Browser 间接覆盖                      | **系统中心/数据**；预览、近期认证、影响、恢复；删除生产能力关闭时不给假成功               |
|  19 | `/app/integrations`；`IntegrationHub`                       | 客户端；Calendar Feed + Export/Import 的既有 API 聚合；创建/撤销日历、复制一次性 URL、导入导出                                            | L/E/R/P/S/X/D/C；较完整 Vitest 与 Browser 真流程                                  | **系统中心/互操作**；只展示真实能力，Zotero/Connector 自动化仍标为未开放                  |
|  20 | `/app/ai`；`AIRunCenter` + `ProviderCenter`                 | 客户端；Workspace AI Provider/Model/Budget/Route/Run/Draft API；预览发送、发送/取消、Draft 决策、Provider/模型/预算/路由管理              | L/E/R/P/S/X/D/C/不确定外呼；AI 预览测试与 Browser 权限门                          | **系统中心/AI 治理**；不是主业务首页；Draft 决策与正式 Knowledge Acceptance 分层          |
|  21 | `/app/help`；静态 Product primitives                        | 无业务 API；只解释 Persona 与权限                                                                                                         | R；仅全路由 Browser                                                               | **系统中心/帮助**；改为按当前错误/能力提供可操作帮助，移除占位说明堆积                    |

## 3. 非正式业务路由

| 路由                       | 当前作用                                                  | 决定                                                                  |
| -------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `/app`                     | 服务端 `redirect('/app/today')`                           | 保留为认证后承接页，不计入 21 条业务路由                              |
| `/app/knowledge-prototype` | 历史/验收用 `KnowledgeSpaceShell`，含 mock 状态与动态图谱 | 保留为隔离历史证据，不进正式导航、不计入 21，不把 mock 写入当生产能力 |

## 4. 测试覆盖解释

- `tests/browser/authenticated-shell.spec.ts` 明确列出全部 21 路由，并检查 1440/1024/390/320px、
  横向溢出、axe、Light/Dark、命令焦点和 reduced-motion。
- `tests/browser/prototype-productization.spec.ts` 覆盖主要学习、知识、研究与系统工作台的真实边界。
- `tests/browser/knowledge-space-prototype.spec.ts` 覆盖历史原型与 Review 真实图谱入口、移动列表、键盘和
  主题持久化恶意值。
- Today、Content、Security、Workspace 等大型中心组件缺少与命令规模相称的完整组件测试；现有
  Browser 壳层覆盖不能替代每个命令状态机的单元/集成测试。

## 5. 迁移总则

1. URL、认证、权限、API 与 sync-v1 先保持不变。
2. 先建立 Design System、Command Feedback 和 Shell，再逐页拆大型客户端中心。
3. 每页先抽数据/命令 hook 与纯模型，再迁移呈现，避免一次重写同时改变行为和视觉。
4. `/app/spaces` 与 `/app/workspaces` 共享数据源但使用不同任务模板；不得简单删除任一 URL。
5. 能力关闭时展示原因、影响和下一步，不渲染会发出必失败请求的伪可用按钮。
