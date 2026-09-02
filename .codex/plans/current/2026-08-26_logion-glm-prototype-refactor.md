# 任务计划：基于 GLM 原型重构 Logion 21 条正式路由

## 元信息

- 计划 ID：`logion-glm-refactor-2026-08-26`
- 创建时间：`2026-08-26T00:00:00+08:00`
- 状态：已被整改计划取代（保留 A1-A5 完成记录；B1 视觉验收撤销）
- 替代计划：[`2026-08-26_logion-glm-design-conformance-remediation.md`](2026-08-26_logion-glm-design-conformance-remediation.md)
- 预估复杂度：高
- 预估步骤数：23 步（按决策门分 5 个阶段）
- 预估工作量：24-36 人日；以逐页真实任务验收为准，不以视觉完成度估算
- MCP 同步：已同步 23 个任务
- 正式仓库：`C:\Users\Administrator\.codex\worktrees\25db\ai_study`
- GLM 原型：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace`
- 计划边界：Gate 0 已于 2026-08-26 通过；按 Gate 1 边界执行三样板，未批准前不批量迁移后续路由

---

## 任务目标

以 GLM 原型已经成立的视觉语言、信息架构和三类工作台范式为目标体验基线，渐进式重构 Logion 的 21 条正式应用路由及公共流程；保留现有 U0-U4、Session、Vault、API、权限、Workspace、Space、sync-v1 和正式对象语义，保持 Function Reachability 100%。

---

## 审查结论

### 总体判断

GLM 原型可以作为正式重构的视觉与 IA 基线，但不能直接作为生产代码基线。它已经解决了旧版主体最核心的问题：Today、Search、Records 分别形成执行工作台、检索工作台和对象编辑工作台；其余路由也不再机械复用纵向表单和卡片堆叠。浏览器抽查 21 条路由在 `1440x900` 与 `390x844` 下没有横向溢出。

正式实施前仍需补齐生产级交互合同。原型使用 fixture store、hash router 和手写 overlay；这些实现不能替代真实 Session/API/权限，也不能满足完整键盘与焦点管理要求。

### 可保留的设计成果

- Today：Master（今日序列）+ Main（NEXT ACTION 与执行反馈）+ Inspector（上下文、依赖、证据、验收）。
- Search：Command/Search Bar + 类型/范围筛选 + 分组结果 + 详情预览；搜索框是主任务起点。
- Records：Master（对象列表）+ Inline Editor（主编辑区）+ Inspector（属性、关联与同步状态）。
- 其他路由已按领域采用 Tabs、Table/List、Sheet、Popover、Inspector、危险操作隔离区，而非一套通用卡片模板。
- Workspaces 与 Spaces 已拆分职责；AI 不再把 Provider 与 Run 两个 Center 纵向拼接。
- 中性表面、稳定网格、有限强调色和紧凑信息密度符合长时间知识工作的方向。

### 必须在正式实现中优化的问题

| 编号 | 发现                   | 证据                                                                               | 正式实现要求                                                                    |
| ---- | ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| O1   | “每页唯一主操作”未兑现 | 全局快速捕获也是 primary，Today/Review/Records 等页面出现多个可见 primary          | 全局捕获降为普通 icon action；合同定义为“当前可见交互层最多一个 primary”        |
| O2   | Tabs 只有点击行为      | `prototype/src/components/states.tsx` 的 Tabs 无 Arrow/Home/End 与 roving tabindex | 使用 Radix Tabs；自动化验证左右键、Home/End、焦点与选中状态                     |
| O3   | Overlay 语义不完整     | Command Menu、Popover、移动 Drawer、State Switcher 为手写实现                      | 使用单一 Headless UI 提供 focus trap、焦点恢复、Escape、触发器关联与 modal 语义 |
| O4   | 可访问名称缺失         | Records 标题输入只有 placeholder；Workspaces 与 AI 存在无名称 ellipsis 按钮        | 所有输入有可编程 label；所有 icon button 有可访问名称和 Tooltip                 |
| O5   | 移动触达目标偏小       | `390 px` 下顶栏菜单约 `31x21`、搜索约 `33x28`、通知约 `30x30`                      | 关键移动控件目标尺寸至少 `44x44`，紧凑桌面控件不得牺牲可达性                    |
| O6   | 状态报告夸大           | State Switcher 无 loading；success/error 多为 fixture 或静态说明                   | 由真实 controller 状态驱动 11 类状态，并逐项测试恢复动作                        |
| O7   | 文档与实现漂移         | 默认 Persona、React/TS 版本、审计文档路径、移动指标互相矛盾                        | 正式仓库与自动化结果为真相源；实施前修订设计合同                                |
| O8   | 原型路由不可机械复制   | 原型含 `#/auth/passkey`，正式项目为 `/auth/callback`；注册 `?mode=` 仅用于演示     | 迁移视觉与任务流，不新增虚构正式路由                                            |

### 当前主体未重构的正式代码证据

- `apps/web/src/features/execution/today-center.tsx`：约 1743 行。
- `apps/web/src/features/memory/review-center.tsx`：约 1742 行。
- `apps/web/src/features/self-study/self-study-center.tsx`：约 1620 行，同时承载 Self-study、Research、Collaboration。
- `apps/web/src/features/exam/exam-center.tsx`：约 1292 行。
- `apps/web/src/features/content/content-center.tsx`：约 1081 行。
- `apps/web/src/features/sync/offline-sync-center.tsx`：约 828 行。
- `apps/web/src/features/planning/planning-center.tsx`：约 826 行。
- `apps/web/src/features/growth/growth-center.tsx`：约 795 行。
- `apps/web/src/features/ai/provider-center.tsx` 与 `run-center.tsx`：约 752/629 行。
- `apps/web/src/features/integrations/integration-hub.tsx`：约 673 行。
- `apps/web/src/features/engagement/engagement-center.tsx`：约 586 行。

这些 Center 同时持有 API/Vault/repository/sync 副作用、权限状态、页面选择与旧视图结构。仅改 CSS 或在外层套新容器无法完成主体重构，也会放大功能回归风险。

---

## 技术方案

### 迁移架构

采用渐进式 Controller/View 分离，不重写正式业务层：

```text
现有 Center
  -> 提取页面 controller hook（保留 API、Vault、repository、sync-v1 与权限调用）
  -> 映射为显式 view-model + domain commands
  -> GLM 工作台 View（不直接访问 API/database/vault）
  -> 旧/新功能可达性与合同对照
  -> 通过逐页验收后删除旧主体 DOM
```

建议接口边界：

```ts
type WorkbenchContext = {
  workspaceId: string;
  workspaceName: string;
  spaceId?: string;
  spaceName?: string;
  persona: string;
  permission: string;
  capability: string;
  syncState: string;
  vaultState: string;
};

type RecoveryAction = {
  id: string;
  label: string;
  kind: "retry" | "navigate" | "unlock" | "resolve" | "dismiss";
  href?: string;
  requiredPermission?: string;
};

type WorkbenchState<T> =
  | {
      kind:
        | "loading"
        | "empty"
        | "locked"
        | "permission"
        | "error"
        | "capability-disabled";
      recoveries: RecoveryAction[];
      requestId?: string;
    }
  | {
      kind: "pending" | "success" | "offline" | "conflict-409" | "stale";
      data?: T;
      recoveries: RecoveryAction[];
      requestId?: string;
    }
  | { kind: "ready"; data: T };
```

`WorkbenchState` 只统一状态语义与恢复动作，不统一领域 payload。每页 controller 返回自己的 `{ context, state, selection, viewModel, commands, capabilities }`，例如 `TodayCommands.startFocus(taskId)`、`SearchCommands.search(query, filters)`、`RecordsCommands.saveNote(noteId, draft, revision)`。

### 共用组件边界

新建或重构的共享层只覆盖真正共用的工作台能力：

- `WorkbenchFrame`：稳定的 Master/Main/Inspector 网格、landmarks 与移动 pane 切换。
- `ContextBar`：持续回显 Workspace、Space、Persona、权限、Vault 与 Sync 上下文。
- `CommandBar`：页面主任务入口；不隐式改变已知上下文。
- `WorkbenchStateView`：11 类状态的语义、影响范围和恢复动作。
- `Dialog/Sheet/Popover/DropdownMenu/Tabs/Tooltip/Select/ContextMenu` adapter。
- `DataList/DataTable/InlineEditor/InspectorSection`：只封装交互和视觉原语，不内置领域字段。

继续复用 `useSession`、`useVaultSession`、`browserApiClient`、`@logion/contracts`、`@logion/offline`、Persona/Workspace/capability services、现有业务模型和 request ID 错误语义。`ProductPanel` 不再作为新页面骨架；已有小型 Tag、Progress、Chart 等可按适配性保留。

### Headless UI 选型提案（需单独批准）

推荐：**Radix UI**，且不混用 Base UI 或 React Aria Components。

| 维度               | Radix UI                                                                                   | Base UI                                             | React Aria Components                                  |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------ |
| React 19 / Next 16 | 稳定包的 peer 范围明确覆盖 React 19；客户端 primitive 可在 Next 16 Client Component 中使用 | 当前候选为 `1.0.0-rc.0`，全站迁移押在 RC 上风险偏高 | 兼容且能力完整                                         |
| 可访问性           | Dialog、Popover、Menu、Tabs、Tooltip、Select、ContextMenu 的键盘/焦点合同成熟              | API 现代，但版本稳定性暂不占优                      | 最完整，但行为与现有组件迁移面更大                     |
| 迁移范围           | 可逐包引入，适配现有 CSS/token                                                             | 中等                                                | 较大，容易牵动现有交互模型                             |
| 包体参考           | 7 个直接包 npm unpacked size 合计约 `0.96 MB`；不是浏览器传输体积                          | 待实施 spike 实测                                   | 主包 npm unpacked size 约 `6.4 MB`；不是浏览器传输体积 |

批准后仅引入：

- `@radix-ui/react-dialog`
- `@radix-ui/react-popover`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-tabs`
- `@radix-ui/react-tooltip`
- `@radix-ui/react-select`
- `@radix-ui/react-context-menu`

Sheet 由 Dialog primitive 适配；Command Menu 由 Dialog 管理 modal/focus，命令过滤、active option 和 `aria-activedescendant` 仍由 Logion 实现。禁止引入 Radix Themes、cmdk、shadcn 整套主题或其他重型视觉体系。三样板后用构建产物记录真实 route chunk 增量，若超出批准预算则暂停扩散。

---

## 决策门

### Gate 0：实施启动

Product Owner 需明确批准以下项目后才能开始业务代码施工：

- [x] GLM 原型作为视觉/IA 基线，而非源码基线。
- [x] Radix UI 单一 Headless UI 选型和上述 7 个包的迁移范围。
- [x] 全局“快速捕获”降为普通 icon action；页面当前交互层保留唯一 primary。
- [x] Controller/View 渐进式迁移，不重写 API、Vault、权限与 sync-v1。
- [x] 样板验收不通过时停止批量迁移。

### Gate 1：三样板批准

Today、Search、Records 必须分别使用真实 Session/API/权限/Vault/Sync 状态完成桌面与移动任务走查，并交付同视口 Before/After、结构差异与 Function Reachability 对照。Gate 1 未批准时，步骤 10-22 不得启动。

### Gate 2：发布批准

21 条应用路由与公共流程完成全量合同、业务、无障碍、响应式与真实任务验收后，方可移除迁移期间的旧主体分支并进入发布。

---

## 步骤分解

### 阶段 A：冻结合同与基础设施

#### 步骤 1：冻结正式路由与功能可达性基线

- **状态**：已完成 ✓（via [sub-001](2026-08-26_logion-glm-prototype-refactor/sub-001_route-function-contract.md)）
- **执行时间**：`2026-08-26T01:50:00+08:00`
- **AI 评分**：87/100
- **目标**：把 21 条应用路由、公共流程、正式对象、权限动作、危险操作与恢复路径固化成机器可检查的迁移合同。
- **涉及文件**：`docs/product/PROJECT_FUNCTION_MAP.md`、`apps/web/src/features/productization/prototype-view-manifest.ts`、`tests/browser/prototype-productization.spec.ts`、GLM `specs/03-route-matrix.md` 与 `reports/function-reachability.md`。
- **具体操作**：纠正 Persona、React/TS 版本、正式 auth 路由、失效审计路径与移动指标漂移；为每页记录主任务、全部可达功能、权限门、真实状态来源、危险操作影响与恢复路径；记录当前用户未提交改动，执行时逐文件增量合并。
- **验证方法**：路由矩阵与 Next 路由一一对应；无 `/auth/passkey` 等虚构正式路由；现有 manifest/contract tests 通过。

#### 步骤 2：完成 Radix 决策 spike 与依赖门

- **状态**：已完成 ✓（via [sub-002](2026-08-26_logion-glm-prototype-refactor/sub-002_radix-compatibility-spike.md)）
- **执行时间**：`2026-08-26T02:01:00+08:00`
- **AI 评分**：94/100
- **目标**：验证 7 个 Radix 包在 React 19.2 / Next 16.2、SSR/hydration、键盘与 bundle 上满足项目约束。
- **涉及文件**：`apps/web/package.json`、`pnpm-lock.yaml`、临时/测试用 adapter 与 bundle 报告。
- **具体操作**：安装固定版本；构建 Dialog、Sheet、Popover、Tabs、Menu 最小 adapter；验证 Server/Client 边界、hydration、Portal、焦点恢复；记录安装前后 route chunk；不引入主题包或第二套 Headless UI。
- **验证方法**：`pnpm --filter @logion/web typecheck/test/build` 通过；键盘 smoke test 通过；bundle 报告经 PO 确认。

#### 步骤 3：建立 Workbench 与 Overlay primitives

- **状态**：已完成 ✓（via [sub-003](2026-08-26_logion-glm-prototype-refactor/sub-003_workbench-overlay-primitives.md)）
- **执行时间**：`2026-08-26T02:24:00+08:00`
- **AI 评分**：94/100
- **目标**：提供不绑定领域数据的工作台布局和生产级 overlay。
- **涉及文件**：`apps/web/src/components/product/`、`apps/web/src/components/app-shell/app-modal.tsx`、新增对应单元测试与样式文件。
- **具体操作**：实现 `WorkbenchFrame`、Master/Main/Inspector、移动 pane switcher、Dialog/Sheet/Popover/DropdownMenu/Tabs/Tooltip/Select/ContextMenu adapter；定义稳定尺寸、landmark、焦点顺序、Escape 与焦点恢复。
- **验证方法**：组件测试覆盖受控/非受控状态、Arrow/Home/End、roving focus、modal focus trap、关闭恢复、reduced-motion；无嵌套卡片和布局位移。

#### 步骤 4：统一 Context Bar、状态系统与主操作合同

- **状态**：已完成 ✓（via [sub-004](2026-08-26_logion-glm-prototype-refactor/sub-004_context-state-primary-contract.md)）
- **执行时间**：`2026-08-26T02:45:00+08:00`
- **AI 评分**：94/100
- **目标**：让系统已知上下文持续回显，并让 11 类状态有专门视觉、影响范围和恢复动作。
- **涉及文件**：`product-workbench-state.tsx`、`app-shell.tsx`、`app-operational-tools.tsx`、`globals.css` 及测试。
- **具体操作**：扩充公共状态语义；保持领域 payload 在各 controller；实现 Workspace/Space/Persona/权限/Vault/Sync Context Bar；全局 capture 降级；定义当前可见交互层 primary 数量断言。
- **验证方法**：loading、empty、pending、success、offline、locked、permission、409、error、capability-disabled、stale 均能从测试状态进入并执行恢复；上下文切换后持续回显；每层 primary `<= 1`。

#### 步骤 5：建立截图、响应式与无障碍验收夹具

- **状态**：已完成 ✓（via [sub-005](2026-08-26_logion-glm-prototype-refactor/sub-005_browser-acceptance-harness.md)）
- **执行时间**：`2026-08-26T03:29:00+08:00`
- **AI 评分**：93/100
- **目标**：在改页面前先让 Before/After 与 4 断点验收可重复。
- **涉及文件**：`tests/browser/`、`playwright.config.ts`、`reports/` 下生成物规范。
- **具体操作**：建立 `320x...`、`390x844`、`1024x...`、`1440x900` 项目；捕获批准视口的旧版截图；增加横向溢出、固定操作可达、Axe、键盘、焦点恢复、reduced-motion、主操作计数辅助断言；使用真实测试 Session/API，不用 GLM fixture。
- **验证方法**：现有页面基线可稳定重复；失败时报告具体路由、视口、元素与状态，不接受只看截图的人工判断。

### 阶段 B：三套真实数据样板

#### 步骤 6：Today 执行工作台样板

- **状态**：执行中（子计划 [sub-006](2026-08-26_logion-glm-prototype-refactor/sub-006_today-workbench.md)）
- **目标**：把 Today 从巨型表单/卡片主体重构为 Queue + NEXT ACTION + Inspector，并保留任务、会话、证据、验收、冲突和 Persona 信号。
- **涉及文件**：`features/execution/today-center.tsx`、新增 `use-today-controller.ts`、`today-workbench.tsx`、领域样式与测试。
- **具体操作**：先为现有 sync/repository/permission 副作用加 characterization tests；提取 controller 与 view-model；主操作随状态在“开始专注/结束会话/提交验收”之间切换；创建/阻塞/证据使用 Sheet 或 inline；计时器局部更新。
- **验证方法**：真实登录、Vault locked/unlocked、在线/离线、权限、409、stale 路径；原任务/会话/证据/验收全部可达；4 断点、键盘、Axe 与 Before/After 通过。

#### 步骤 7：Search 检索工作台样板

- **状态**：待执行
- **目标**：以搜索输入为唯一主任务入口，完成范围筛选、分组结果、键盘选中、详情预览和订阅动作。
- **涉及文件**：`features/engagement/engagement-center.tsx`、新增 Search controller/view-model/workbench、领域样式与测试。
- **具体操作**：保留通知/订阅与 API 语义；取消过期请求或忽略旧响应；结果区使用 active selection 与 Inspector；无结果时 primary 切为“清除筛选”；移动端预览进入全宽 Sheet。
- **验证方法**：空查询、无结果、loading、error、offline/stale、权限、键盘上下移动/Enter/Escape；搜索/订阅/导航 Function Reachability 100%；4 断点无溢出。

#### 步骤 8：Records 对象编辑工作台样板

- **状态**：待执行
- **目标**：以对象列表 + Inline Editor + Inspector 重构 Notes/Links/PDF/附件操作，保留 Yjs、附件队列、sync-v1 与 revision 冲突语义。
- **涉及文件**：`features/content/content-center.tsx`、新增 Records controller/view-model/workbench、领域样式与测试。
- **具体操作**：编辑 draft 局部化；标题提供显式 label；dirty/save/pending/success/conflict 状态可见；低频元数据进 Inspector；新建/导入进入 Sheet；外链继续通过安全 URL 校验。
- **验证方法**：真实 Vault、离线保存、同步、附件 capability、Yjs 文档、409/版本冲突、permission、stale；输入名称、焦点和移动编辑均通过；原全部功能可达。

#### 步骤 9：执行三样板 Product Owner Gate

- **状态**：待执行
- **目标**：确认视觉方向与目标任务流可批量推广。
- **涉及文件**：`reports/` 中 Today/Search/Records Before/After、结构差异、任务脚本、bundle 与可访问性报告。
- **具体操作**：按真实角色与权限走查三页 80% 高频任务；逐页对照功能矩阵；记录问题并只在样板内修正；PO 未签字则不启动阶段 C/D。
- **验证方法**：三页所有验收项通过，PO 在计划/报告中明确批准 Gate 1。

### 阶段 C：学习、研究与对象路由

#### 步骤 10：Planning 路线规划工作台

- **状态**：待 Gate 1
- **目标**：将目标、阶段与任务关系改为路线/阶段 Master-Detail，低频字段进入 Sheet/Inspector。
- **涉及文件**：`features/planning/planning-center.tsx`、`planning-workbench-model.ts` 与测试。
- **验证方法**：目标/阶段/任务创建编辑、上下文、空/锁定/权限/离线状态、4 断点和 Before/After 全通过。

#### 步骤 11：Review 复习队列工作台

- **状态**：待 Gate 1
- **目标**：实现到期队列、全部知识点、错因模式、周期审查 Tabs，以及 Sheet 作答/揭示/自评流程。
- **涉及文件**：`features/memory/review-center.tsx`、`review-workbench-model.ts`、知识图谱组件与测试。
- **验证方法**：知识点、依赖、复习题、周期审查、图谱和人工确认全部可达；Tabs 与答题焦点合同通过。

#### 步骤 12：Exam 备考覆盖工作台

- **状态**：待 Gate 1
- **目标**：围绕大纲覆盖、薄弱点、模考与成绩形成可扫描的分析/行动布局。
- **涉及文件**：`features/exam/exam-center.tsx`、`exam-workbench-model.ts` 与测试。
- **验证方法**：科目、大纲、模考、成绩、复习计划与风险信号保持真实语义；移动数据表降级为可读列表。

#### 步骤 13：Self-study 项目与成果工作台

- **状态**：待 Gate 1
- **目标**：实现收件箱分诊、路线/项目看板和成果时间线，避免与 Today/Planning 重复入口。
- **涉及文件**：`features/self-study/self-study-center.tsx`、`self-study-workbench-model.ts` 与测试。
- **验证方法**：捕获、分诊、项目、交付成果与跨页导航全部可达；全局 capture 只有普通强调级别。

#### 步骤 14：Research 与 Collaboration 领域拆分

- **状态**：待 Gate 1
- **目标**：从共享的 `self-study-center.tsx` 拆出独立 controller/view；Research 聚焦问题-声明-证据-实验，Collaboration 聚焦 Rubric-Review-Feedback。
- **涉及文件**：`features/self-study/self-study-center.tsx`、research/collaboration models、comparison 组件与测试。
- **验证方法**：共享 repository 逻辑不重复；两条路由有不同 IA；证据方向、论文来源、实验指标、成员权限和反馈链保持可达。

#### 步骤 15：Templates 对象安装与分享工作台

- **状态**：待 Gate 1
- **目标**：以模板库/详情/安装与分享流程替代 Growth Center 的纵向表单堆叠。
- **涉及文件**：`features/growth/growth-center.tsx`、`public-share.tsx` 与测试。
- **验证方法**：创建、安装独立副本、导入、分享和 capability-disabled 状态完整；不伪造连接器能力。

### 阶段 D：工作区、系统与设置路由

#### 步骤 16：Workspaces 与 Spaces 职责拆分

- **状态**：待 Gate 1
- **目标**：Workspaces 管成员/邀请/信息/危险操作，Spaces 管空间列表/权限/上下文，不再共用一套页面主体。
- **涉及文件**：`features/workspaces/workspace-center.tsx`、两个 route page、邀请模型与测试。
- **验证方法**：角色/成员/邀请/撤销/所有权转让/删除影响与恢复路径可见；所有 ellipsis 有名称；真实权限下操作可达。

#### 步骤 17：Sync 诊断与冲突工作台

- **状态**：待 Gate 1
- **目标**：建立状态摘要 + Outbox/冲突/附件/设备 Tabs；409 冲突使用双栏对比和显式三选一。
- **涉及文件**：`features/sync/offline-sync-center.tsx`、`sync-diagnostics.ts`、`sync-system.css` 与测试。
- **验证方法**：sync-v1 消息与 epoch 不变；bootstrap、push/pull、附件、设备撤销、merge 全可达；永不静默覆盖。

#### 步骤 18：AI 与 Integrations 治理工作台

- **状态**：待 Gate 1
- **目标**：AI 用 Tabs/Inspector 区分运行草稿、Provider、发送预检与审计；Integrations 用 capability/status 驱动连接器管理。
- **涉及文件**：`features/ai/provider-center.tsx`、`run-center.tsx`、`features/integrations/integration-hub.tsx`、entry 与测试。
- **验证方法**：Provider 密钥、发送来源确认、预算预检、草稿运行、集成 capability/权限/错误 requestId 均保留；无名称 icon button 清零。

#### 步骤 19：Security、Data 与 Audit 治理路由

- **状态**：待 Gate 1
- **目标**：以安静的 settings list、data table、危险操作隔离区呈现安全、数据主权和审计，不把高风险动作混入普通表单。
- **涉及文件**：`features/security/security-center.tsx`、`features/portability/data-sovereignty-center.tsx`、`features/audit/audit-log.tsx` 与测试。
- **验证方法**：最近认证、TOTP/凭据、导入导出、审计筛选、删除/恢复路径与权限影响完整；危险操作需明确 phrase/影响/恢复说明。

#### 步骤 20：Settings、Profile 与 Help 工作区

- **状态**：待 Gate 1
- **目标**：分别提供偏好设置、个人身份与支持资源，不继续把 IntegrationHubEntry 或静态 route page 当成通用主体。
- **涉及文件**：三个 route page、persona/user settings services、integration entry 与测试。
- **验证方法**：Persona、主题、用户设置、互操作边界、个人信息和帮助导航全部可达；每页有专属主任务与状态。

### 阶段 E：公共流程与全量发布验收

#### 步骤 21：Auth、Callback 与 Onboarding 公共流程

- **状态**：待 Gate 1
- **目标**：把批准的视觉语言迁移到 Login/Register/Verify/Recover/Callback/Onboarding，同时保持现有安全、token 与设备命名语义。
- **涉及文件**：`features/auth/*form*.tsx`、`auth-form-shell.tsx`、`features/onboarding/`、对应 route page 与测试。
- **具体操作**：不创建 `/auth/passkey`；保留正式 `/auth/callback`；与用户当前 `login-form`、`auth-form-shell`、`device-name` 未提交改动增量合并。
- **验证方法**：登录、MFA、注册、验证、恢复、回调、Persona/Workspace/Space 引导真实流程通过；公共 Axe 与移动键盘通过。

#### 步骤 22：Invitation、Share 与 Deletion 公共流程

- **状态**：待 Gate 1
- **目标**：完成邀请接受、公开分享、账号删除恢复的专用任务布局与风险反馈。
- **涉及文件**：`accept-invitation-form.tsx`、`public-share.tsx`、`account-deletion-recovery.tsx`、对应 route page 与测试。
- **验证方法**：匿名/登录/无权限/过期 token/最近认证/恢复会话状态完整；危险操作显示影响、权限、确认和恢复路径。

#### 步骤 23：全量 Function Reachability 与发布 Gate

- **状态**：待执行
- **目标**：对 21 条应用路由及公共流程做最终逐页验收，移除已通过页面的旧主体分支。
- **涉及文件**：`tests/browser/`、业务/合同测试、`reports/`、构建与 bundle 报告。
- **具体操作**：运行格式、lint、typecheck、unit、browser、build、contracts；每页生成同视口 Before/After 与结构差异；真实角色/权限/Vault/在线/离线/409/capability 场景；人工键盘与 Screen Reader 走查；扫描 CSS 颜色、溢出、文本遮挡与触达尺寸。
- **验证方法**：Gate 2 所有完成条件通过，PO 以真实任务签字；失败页面保留回退点，不用测试跳过或 mock 截图掩盖。

---

## 依赖关系

```text
步骤 1 -> Gate 0 -> 步骤 2 -> 步骤 3 -> 步骤 4 -> 步骤 5
                                               -> 步骤 6 / 7 / 8
                                               -> 步骤 9 (Gate 1)
                                               -> 步骤 10-22（按领域可有限并行）
                                               -> 步骤 23 (Gate 2)
```

同一巨型 Center 或共享模型上的步骤不得并行修改：步骤 13 与 14 串行；Shell/Auth 未提交改动涉及的步骤 4 与 21 串行。其他领域在 Gate 1 后可按文件所有权并行，但每个页面仍独立验收。

---

## 风险评估

| 风险                                           | 可能性 | 影响 | 缓解措施                                                                           |
| ---------------------------------------------- | ------ | ---- | ---------------------------------------------------------------------------------- |
| controller 提取改变 sync/repository 副作用顺序 | 高     | 高   | 先加 characterization tests；不改 transport/repository/contract 签名；逐页双轨对照 |
| 旧 Center 被外层新容器保留，形成“假重构”       | 中     | 高   | 验收布局树与 DOM 结构；新 View 禁止渲染旧 ProductPanel 页面树                      |
| Function Reachability 因二级披露丢失           | 中     | 高   | 逐页功能矩阵；最多两层；每个动作记录入口与权限态                                   |
| 手写 overlay 与 Radix 混用造成焦点冲突         | 中     | 高   | 单一 adapter；迁移完成即删除对应手写焦点逻辑；不引入第二套 Headless UI             |
| Radix 实际客户端体积超预算                     | 低/中  | 中   | 逐包引入、无 Themes、三样板后 route chunk 对比，超预算暂停                         |
| 状态视觉只有 fixture，没有真实恢复             | 高     | 高   | controller 状态驱动；测试真实 Session/API/权限/Vault/Sync 与 recoveries            |
| 移动端为了紧凑牺牲触达尺寸                     | 中     | 中   | 关键目标至少 `44x44`；320/390 自动溢出与人工触达检查                               |
| 用户未提交 Shell/Auth 改动被覆盖               | 中     | 高   | 每步先读 `git diff`；基于当前内容增量编辑；禁止 reset/checkout/revert              |
| 21 页视觉重新模板化                            | 中     | 高   | 只共享 primitives；每页必须有专属布局树、主任务和交互路径                          |
| Before/After 截图受数据波动影响                | 中     | 低   | 使用真实测试 Session/API 的确定性 seed，不用 GLM fixture；固定视口与等待条件       |

---

## 总体验收标准

### 完成条件

- [ ] 21 条正式应用路由与公共流程均有专属布局树、主任务、交互路径和组件映射。
- [ ] 每条批准路由提供旧版/新版同视口截图和结构差异说明。
- [ ] 当前可见交互层最多一个 primary，80% 高频任务从该入口开始。
- [ ] Workspace、Space、对象、Persona、权限、Vault 与 Sync 上下文自动带入并持续回显。
- [ ] 必要输入保留，低频字段最多二级披露；所有正式功能仍可发现和操作。
- [ ] 11 类状态均由真实 controller 语义驱动并有恢复动作。
- [ ] `320`、`390`、`1024`、`1440 px` 无横向溢出、遮挡、布局位移和不可达操作。
- [ ] Tabs、Menu、Dialog、Sheet、Popover、Command Menu 通过键盘、焦点恢复和 Screen Reader 验收。
- [ ] reduced-motion、主题与移动触达目标验收通过。
- [ ] Function Reachability 100%，现有合同、业务、Persona、Workspace、Sync、AI、Integrations 测试全部通过。
- [ ] `pnpm ci:fast` 与 Playwright 正式验收通过；无跳过测试或伪造状态。
- [ ] Product Owner 按真实任务批准 Gate 0、Gate 1 和 Gate 2。

### 推荐验证命令

```powershell
pnpm --filter @logion/web lint
pnpm --filter @logion/web typecheck
pnpm --filter @logion/web test
pnpm build
pnpm contracts:check
pnpm test:browser
```

---

## 执行记录

| 时间             | 操作                                                   | 结果                                                                              |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 2026-08-26       | 审查 GLM 原型、正式仓库、21 路由、移动端与组件可访问性 | 完成；原型可作为视觉/IA 基线，识别 8 类正式化缺口                                 |
| 2026-08-26       | 生成本地计划                                           | 完成；未修改正式业务代码                                                          |
| 2026-08-26       | MCP 任务同步                                           | 完成；23 个任务按 Gate 0 / Gate 1 / Gate 2 建立依赖                               |
| 2026-08-26 01:50 | 步骤 1：冻结正式路由与功能可达性基线                   | 87/100；MCP 已同步，E2E 待 A5 真实栈补跑                                          |
| 2026-08-26 02:01 | 步骤 2：完成 Radix 决策 spike 与依赖门                 | 94/100；MCP 已同步，137 tests/build 通过                                          |
| 2026-08-26 02:24 | 步骤 3：建立 Workbench 与 Overlay primitives           | 94/100；MCP 子任务已同步，145 tests/build 通过，静态构建增量 +43,617 bytes        |
| 2026-08-26 02:45 | 步骤 4：统一 Context Bar、状态系统与主操作合同         | 94/100；11 类可恢复状态、真实上下文、单一 primary、160 tests/build 通过           |
| 2026-08-26 03:29 | 步骤 5：建立截图、响应式与无障碍验收夹具               | 93/100；99 项浏览器合同、17/17 真实认证测试、12 张 Before、可见走查与 A5 报告完成 |

---

## 用户确认

- [ ] 我已批准 Gate 0 的 5 项决策
- [ ] 我已审阅并批准此计划

**批准后执行**：`/do-plan 2026-08-26_logion-glm-prototype-refactor.md`
