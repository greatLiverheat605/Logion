# Logion 产品重构 D0 任务包

> 状态：已准备，尚未派发
>
> 日期：2026-08-10（Asia/Shanghai）
>
> Gate：G0 已通过；本任务只执行 D0，完成后停止
>
> 不绑定具体模型、厂商或客户端

## 1. 任务合同

**标题**：Logion 产品重构 D0：代码感知诊断与基线冻结

**执行方**：由产品 Owner 后续指定的单一设计执行方。

**目标**：把已批准的产品方向映射到真实代码、路由、数据、命令、状态和测试，形成可审查的设计输入。不得制作完整视觉方案，不得开始正式前端施工。

**仓库与基线**：

- 仓库：Logion；
- 产品分析基线提交：`769f61f9bd2166b73e7dd45671b4e468ade0eeed`；
- 批准文档首次落地提交：`65c6cb323f544b9b20cf8f995ec5f1aabe3a2521`；
- D0 不可变执行基线：派发时由协调方填写，必须是包含本任务包及三份批准产品文档的远端可达提交；没有精确完整 SHA 时不得启动；
- 基线分支：`codex/v020-rc6-closeout`；
- 目标工作区与工作分支：派发时由协调方填写；
- 开始前必须确认派发指定的完整 SHA 可达且当前 HEAD 与其一致，并报告实际绝对路径、分支、HEAD 和工作树状态；
- 若目标工作区看不到本任务列出的三份批准文档或本任务包，必须停止并报告，不得根据聊天摘要自行补写或跨机器猜测内容。

## 2. 必读资料

按顺序完整读取：

1. `AGENTS.md`；
2. `docs/development/AGENT_DELIVERY_WORKFLOW.md`；
3. `docs/development/V020_EXECUTION_PLAN.md`；
4. `docs/development/V020_STATUS.md`；
5. `docs/development/V020_V15_PRERELEASE_RC6_EVIDENCE.md`；
6. `docs/product/SYSTEM_BLUEPRINT_REVIEW.md`；
7. `docs/product/PRODUCT_DIRECTION_MARKET_ANALYSIS.md`；
8. `docs/product/PRODUCT_REDESIGN_EXECUTION_PLAN.md`；
9. 适用 ADR、OpenAPI、sync-v1 合同、Web 源码和测试。

若文档与实际代码冲突，以用户最新明确指令、Git、合同、源码和真实运行结果为准，并在差异清单中记录，不得静默选择一方。

## 3. 允许与禁止范围

唯一允许写入：

- `docs/design/logion-redesign-v1/**`；
- `prototype/logion-redesign-v1/**`，仅限 D0 必需的静态基线或证据，不得在本阶段建设高保真原型。

禁止修改：

- `apps/web/src/**`；
- `apps/api/**`；
- `apps/worker/**`；
- `packages/contracts/**`；
- `packages/offline/**`；
- 数据库迁移；
- 根 `package.json`、`pnpm-lock.yaml` 和其他 Manifest/lockfile；
- `.agents/coordination/**`；
- 部署、生产配置、Feature Flag、密钥或 Provider 配置；
- 既有 `.tmp-v020-rc2/`、`.tmp-v020-rc4/`；
- 旧的 `docs/design/system-redesign-a/**`、`docs/design/system-redesign-b/**`、`prototype/system-redesign-a/**`、`prototype/system-redesign-b/**`。

不得启动本机 Docker，不得请求生产 API，不得发送真实邮件、邀请或通知，不得读取或记录真实账户、邮件、Token、主机、终端句柄、用户目录或私有内容。

## 4. 已批准且不可自行改写的产品决定

1. 产品定位是“认知作业空间”：Today 是行动入口，Knowledge Base 是长期资产中心。
2. 一个用户可见知识库直接对应一个后端 `Space`，不得另造平行权限实体。
3. Workbench 是正式对象的受控投影，不是数据孤岛，不改变权限。
4. 正式对象只有一份；需要时有主要归属，可被多个工作台引用。
5. 捕获采用双轨：轻量捕获与 Zotero 元数据先行，PDF 安全链独立建设，其他 Connector 后置。
6. 学术研究与技术研究共享研究内核，同时使用专业模板。
7. 正式关系和探索关系分层；AI 关系只能先成为候选。
8. 采用单窗口专业工作区、受控分栏、Inspector、历史与命令切换；应用标签和多窗口后置。
9. 设计采用安静、可信的专业外壳，双主题、单一品牌强调色和局部克制的图谱动态。
10. AI 采用上下文触发、Draft-first，不得静默改变正式判断。
11. sync-v1 保持冻结，新知识实体首版 online-only。
12. Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 扩展和 AI Acceptance 等敏感生产能力继续关闭。

## 5. 必须核对的 21 条正式路由

逐条核对，不得遗漏或合并计数：

```text
/app/today
/app/self-study
/app/research
/app/exam
/app/collaboration
/app/planning
/app/templates
/app/records
/app/review
/app/spaces
/app/search
/app/workspaces
/app/audit
/app/settings
/app/profile
/app/security
/app/sync
/app/data
/app/integrations
/app/ai
/app/help
```

`/app/knowledge-prototype` 是历史/验收原型路由，不属于 21 条正式业务路由；`/app` 是入口重定向/承接页。两者都要说明，但不能加入正式业务路由数量。

## 6. D0 工作分解

### D0-01：事实基线

记录：

- Git branch、HEAD、工作树和未跟踪文件；
- Web 技术栈、主要依赖和目录边界；
- 应用壳、导航、主题、Persona、API client、错误处理和测试入口；
- 当前生产/候选状态只引用已有状态文档，不访问生产环境复核。

### D0-02：21 路由系统映射

每条正式路由至少包含：

- Next 页面文件；
- 主要组件和共享壳层；
- 服务端/客户端边界；
- 数据来源、API/本地存储/离线依赖；
- 用户命令及其副作用；
- loading、empty、ready、pending、success、error、offline、locked、permission denied、409、capability disabled 状态；
- 已有单元、集成和 Browser 测试；
- 建议：保留、增量重构、拆分、迁移或废弃；
- 新 IA 中的归属和跨页面回跳。

### D0-03：核心流程与命令状态

至少映射：

1. 登录后进入 Today 并判断下一步；
2. 计划/复习/研究缺口进入 Today；
3. 执行、计时、提交证据和验收；
4. 创建/选择 Knowledge Base（底层 Space）；
5. 捕获 Source、重复识别、确认和回到来源；
6. Topic、Review、Graph、Source 之间导航；
7. Research Question、Source、Excerpt、Claim/Evidence、Finding 和 Output；
8. Workspace 邀请及 409；
9. Persona 设置、版本化保存和 409 合并；
10. 离线、同步、锁定、权限不足和能力关闭。

每个命令必须明确触发点、前置校验、pending、防重复提交、成功反馈、错误位置、恢复动作、请求编号、撤销/补偿条件和危险确认。

### D0-04：领域对象与合同差距

输出对象表，至少覆盖：Workspace、Space/Knowledge Base、Collection、Saved View、Workbench、Task、Source、Note、Excerpt、Topic、ReviewSchedule、Claim、Evidence、Research、Attachment、AI Draft。

逐项说明：

- 当前是否有正式模型/API/Schema；
- 权限与主要归属；
- 可否跨 Workbench 引用；
- 是否进入 sync-v1；
- UI 当前如何呈现；
- 新设计能否直接实现；
- 若不能，所需 ADR/合同/迁移决策。

必须单独审查现有 `PersonaSetting`。不得把它描述成已支持完整 `workbench-v1`；必须记录当前只覆盖名称、图标、说明和路由，以及版本、长度校验和 409 合并行为。

### D0-05：UX 与视觉证据

按证据而不是主观形容词记录：

- 页面层级、导航密度、卡片套卡片、指标化首页、说明文字占位；
- 点击无反馈、错误不完整、409、重复提交和恢复路径；
- 1440、1024、390、320px 的溢出和信息优先级；
- Light/Dark、键盘、焦点、读屏、reduced-motion；
- 图谱的节点规模、截断、动态、键盘和移动等价路径；
- 现有组件中可复用、应封装、应拆分和应废弃的部分。

允许使用合成数据与本地静态截图。任何无法真实运行的检查必须标为未运行并写明原因，不能用旧截图冒充本次结果。

### D0-06：开源组件候选

至少评估：

- Radix UI 与 React Aria；
- Cytoscape.js + fCoSE 与 React Flow/XYFlow；
- TanStack Table 与 TanStack Virtual；
- Floating UI；
- Lucide React。

每个候选记录精确版本、许可证、维护状态、安全记录、Next.js 16/React 19/SSR 兼容、包体与 Tree Shaking、键盘/读屏/焦点/移动/reduced-motion、主题封装、供应链与升级策略。D0 只提出建议，不修改依赖。

### D0-07：D1 输入简报

只形成三套方向的约束和差异轴，不制作完整方案：

- 外壳密度与导航；
- Today 的行动组织；
- Knowledge Base 中列表、阅读器与图谱的权重；
- Inspector 常驻程度；
- 学习/研究工作台的个性；
- 强调色与图谱局部动态语言。

三套方向必须共享已批准 IA、对象合同和安全边界，不得只换颜色。D0 完成后停止，等待协调方审查后才进入 D1。

## 7. 必须交付的文件

执行方应在允许目录内交付：

```text
docs/design/logion-redesign-v1/
├── 00_BASELINE.md
├── 01_ROUTE_SYSTEM_MAP.md
├── 02_CORE_FLOW_COMMAND_MAP.md
├── 03_DOMAIN_CONTRACT_GAPS.md
├── 04_UX_VISUAL_AUDIT.md
├── 05_OPEN_SOURCE_EVALUATION.md
├── 06_D1_DIRECTION_BRIEF.md
├── D0_ACCEPTANCE_REPORT.md
└── evidence/
```

可以添加必要的索引或合成截图，但不得创建与上述内容重复的平行事实文档。

## 8. 验收标准

D0 只有在以下条件全部满足时才可报告 `complete`：

1. 21 条正式路由逐条映射，数量和源码一致；
2. `/app` 与 `/app/knowledge-prototype` 被单独说明；
3. Today、Knowledge Base、Research、System Center 和 Workbench 的数据/命令/状态/测试完成映射；
4. 已实现、默认关闭、未来能力和无合同支持的设想严格分开；
5. Persona/Workbench 缺口与 ADR 决策点明确；
6. 所有 UX 问题有源码、测试、真实运行或截图依据；
7. 开源依赖只完成评估，没有修改 Manifest/lockfile；
8. 无生产访问、真实用户数据、秘密、本机路径或 Provider 信息进入产物；
9. 只修改允许目录；
10. D1 输入简报完成，但没有越权制作或批准某套正式方案。

## 9. 必须实际执行的检查

```text
pnpm exec prettier --check docs/design/logion-redesign-v1
git diff --check
git status --short --branch
```

还必须运行适合当前产物的 Markdown 链接/路径核对，并用 `rg` 对比 21 条路由与 `apps/web/src/app/app/**/page.tsx`。若仓库没有现成 Markdown 链接检查器，只能记录人工核对结果，不得临时增加依赖。

D0 不修改可执行产品代码，因此 Web/API 测试不是本任务的默认验收门。若为获取真实诊断证据运行了已有测试或本地 Web，必须逐条记录命令和观察结果；未运行时说明“文档诊断范围未修改产品行为”，不能写成测试通过。

## 10. 必须使用的交接格式

```text
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```

## 11. 停止并询问的条件

出现任一情况立即停止：

- 基线提交不可达或目标工作区缺少三份批准产品文档；
- 允许路径与现有不明改动重叠；
- 需要修改正式 Web、API、合同、迁移、依赖或生产配置才能继续；
- 需要真实账户、生产数据、秘密、外部写入或发送邮件；
- 发现已批准产品决定互相冲突；
- 21 路由与源码事实无法一致解释；
- 旧 A/B 产物与新计划冲突且无法作为历史参考隔离；
- 需要决定 `workbench-v1` 的 ADR、Schema 或持久化方案；
- 被要求 commit、push、merge、deploy 或打开敏感能力，但没有对应的最新明确授权。

完成 D0 后必须停止。不得自行进入 D1、D2 或 I0。
