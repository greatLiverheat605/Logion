# 前端重设计双方案任务包

> 用途：分别交给两个专项设计执行方。两者必须基于同一 approved base、使用独立 worktree/分支和
> 不重叠输出目录。它们只做诊断、设计与隔离原型，不修改正式前端，不获得集成或发布权。

## 共同产品事实与硬边界

- Logion 是个人及最多 10 人低频协作的学习、复习与研究工作台，不是营销站、通用企业后台或社交产品。
- 用户明确不习惯当前系统操作页的样式与操作方式；任务不是局部美化，而是完整重构使用体验。
- 当前产品有 21 个受保护路由：Today、Planning、Review、Exam、Templates、Records、Research、Audit、
  Self-study、Collaboration、Search、Workspaces、Security、Sync、Data、Integrations、AI、Spaces、Settings、
  Profile、Help。
- Today 与 Review 是最高频闭环；Workspace/Space/邀请和 Settings/Profile/Security/Sync/Data/Integrations/AI
  是当前“系统操作感”最重、最需要降低认知负担的区域。
- 不增加一级导航目的地；允许合并、分组和渐进披露。考、学、研、导继续共享数据与图谱引擎。
- 知识图谱需要动态、现代、有技术感，但不得变成霓虹赛博背景。桌面支持键盘，移动端提供等价列表/树，
  reduced-motion 下关闭非必要动画。
- 所有正式数据、权限、认证、SessionBoundary、迁移、OpenAPI、sync-v1、AI Gateway 与默认关闭开关不变。
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 不得在原型中伪装为已启用。
- 原型只用合成数据，不请求生产 API，不包含真实邮箱、密码、Token、主机、用户目录或私有内容。
- 用户批准完整原型前，不修改 `apps/web/src/**`，不 commit、push、merge、release 或部署。

## 必须覆盖的完整流程

1. 产品诊断：目标用户、核心任务、当前价值链、页面/能力地图、成功指标和主要矛盾。
2. UX 审查：基于当前页面和源码证据列出可复现问题，按 P0/P1/P2、频率、影响和修复原则排序。
3. 信息架构重构：重组 21 个路由、一级/二级导航、页面归属、对象模型和跨页面入口；给出 before/after。
4. 交互重构：关键任务流、主操作、状态转换、反馈、撤销/确认、错误恢复、键盘和移动等价路径。
5. 视觉重构：双主题、层级、密度、字体、颜色、图标、图谱、空状态和响应式规则。
6. Design System：tokens、组件、状态、内容规则、无障碍、动效与布局规范。
7. 原型设计：可直接在浏览器打开的高保真交互原型，覆盖桌面与移动、明暗主题和关键状态。

共同验收要求：

- 先诊断再设计；每个核心决策必须能追溯到问题和用户任务。
- 不能只换颜色、圆角、阴影或重新排列卡片。
- 不做首页 hero，不做装饰性渐变/光球，不使用卡片套卡片，不用 emoji 充当功能图标。
- 使用同一套 Lucide 风格线性图标；命令用图标或图标+文字，陌生图标带 tooltip。
- 页面是安静的工作台：柔和中性色、一个品牌强调色、清楚边界、紧凑但不拥挤；卡片圆角不超过 8px。
- 使用稳定的应用外壳：桌面以侧栏 + 内容区为主，移动端按任务频率选择抽屉或底部导航；系统设置采用
  标题、说明、分组列表和右侧控件的设置语言，不把每个设置项包成独立卡片。
- 页面区块使用无框分组或完整面板；卡片只用于独立重复对象、模态框和真正需要边界的工具，不做卡片套卡片。
- Light/Dark 都有独立 tokens，不能靠 invert；主题切换可见并持久化，持久化值按不可信输入处理。
- 页面内只保留一个明确主操作；按钮点击必须有 loading/disabled/成功/失败反馈并防重复提交。
- 普通错误在对应控件附近显示并给恢复动作；跨页面完成结果使用克制 toast；危险操作使用明确确认；
  邀请 409 必须表达“冲突原因 + 下一步”，不能只显示状态码。
- 1440、1024、390、320 px 均无横向溢出；固定工具栏、图谱、计数器和按钮使用稳定尺寸。
- 键盘、焦点、读屏、对比度、reduced-motion 和 axe 规则必须进入组件与原型状态矩阵。
- 不在界面中堆放“这是如何使用/有哪些功能/快捷键是什么”的说明性文案；流程应通过结构和控件自然表达。

## 方案 A：产品与 UX 方向型任务包

将下面整段交给偏产品策略、UX 研究、信息架构和视觉方向比较的专项设计执行方。

```text
你负责 Logion 系统操作体验的完整重设计方案 A。不要立即写页面，不要修改正式产品代码。

开始时：
1. 读取 AGENTS.md、docs/product/NEXT_VERSION_ROADMAP.md、docs/development/V020_STATUS.md、
   docs/development/V020_V15_PRERELEASE_RC6_EVIDENCE.md 和主线交接包 00～07。
2. 核对固定 base、独立 worktree/branch 和唯一可写目录。你只能写：
   docs/design/system-redesign-a/** 与 prototype/system-redesign-a/**。
3. 检查当前 Web 路由、导航、Today、Review、Workspace/Space/邀请、Settings/Profile/Security/Sync/Data/
   Integrations/AI 和知识图谱实现。引用具体页面/组件作为证据，但不要修改它们。

按以下顺序交付，不能跳步：
A. 产品诊断：用户、场景、JTBD、价值链、21 路由能力地图、现有高频/低频任务、问题假设与成功指标。
B. UX 审查：至少覆盖导航、系统操作页、表单反馈、错误恢复、空/加载/离线/锁定、移动、键盘、知识图谱；
   输出 severity × frequency × reach 排序和证据索引。
C. 信息架构：给出 before/after 树、全局导航、系统设置分组、对象归属、跨页面路径和命名；不增加一级目的地。
D. 交互重构：为“开始今日行动、完成复习、创建/切换 Space、处理邀请冲突、搜索并回到上下文、调整安全/
   同步/数据设置、浏览知识图谱”画出 happy path、失败、取消、重试和恢复流程。
E. 视觉方向：先给 3 个有明显差异但都适合工作台的方向，比较认知负担、品牌一致性、可访问性、实现成本，
   推荐一个并说明为什么。不要用营销式 hero、霓虹赛博、玻璃拟态或卡片堆叠。
F. Design System：双主题 tokens、字体层级、4px 间距、≤8px 圆角、边框/表面、单一强调色、Lucide 图标、按钮、
   输入、菜单、分段控件、toggle、toast、inline feedback、modal、表格/列表、设置列表、图谱节点/边、移动底栏和所有状态。
G. 高保真原型：实现浏览器可直接打开的交互原型。至少精做 Today、Review+Knowledge Graph、Workspace/Space/
   Invite、Search、System Settings Hub、Profile/Security、Sync/Data、Integrations/AI，并提供 21 路由的完整壳层导航。

原型必须：
- 支持 Light/Dark、1440/1024/390/320 px、键盘焦点和 reduced-motion；
- 使用合成数据，提供 loading、empty、error、offline、locked、saving、success、conflict、disabled 状态切换；
- 每个交互后有可观察反馈；移动端知识图谱有等价列表/树；
- 输出 1440 与 390 的关键页面截图和一份可点击走查清单。

交付文件：
00-product-diagnosis.md
01-ux-audit.md
02-information-architecture.md
03-interaction-flows.md
04-visual-directions.md
05-design-system.md
06-prototype-walkthrough.md
prototype/**

完成后停止，等待用户审批。不得修改 apps/web/src/**，不得提交/推送/部署。返回结构化 handoff，列出实际检查、
未运行项、风险、输出路径和建议用户重点比较的 5 个决策。
```

## 方案 B：代码感知与可施工原型型任务包

将下面整段交给擅长阅读代码、组件建模和实现高保真交互原型的专项设计执行方。

```text
你负责 Logion 系统操作体验的完整重设计方案 B。你必须先完成产品/UX/IA/交互/视觉/Design System，
再写隔离原型；不能直接重构正式 React 页面。

开始时：
1. 读取 AGENTS.md、docs/product/NEXT_VERSION_ROADMAP.md、docs/development/V020_STATUS.md、
   docs/development/V020_V15_PRERELEASE_RC6_EVIDENCE.md 和主线交接包 00～07。
2. 核对固定 base、独立 worktree/branch 和唯一可写目录。你只能写：
   docs/design/system-redesign-b/** 与 prototype/system-redesign-b/**。
3. 只读盘点 apps/web/src：21 个受保护路由、app shell/nav、design tokens、表单命令、状态组件、Today、Review、
   Workspace/Space/邀请、Settings/Profile/Security/Sync/Data/Integrations/AI、知识图谱和相关测试。

先输出代码感知诊断：
- 页面→组件→数据/命令→状态→测试的映射；
- 重复组件、页面职责泄漏、信息密度、静默按钮、反馈延迟、移动断点和可访问性风险；
- 可复用、应重构、应废弃三类清单；不得以“重写全部”为默认答案。

随后完成完整设计链：
A. 产品诊断与任务优先级；
B. UX 审查与问题复现索引；
C. 21 路由 IA 重组和导航 contract；
D. 关键 interaction state machine，包括 loading/disabled/idempotency/conflict/error/retry/undo/confirm；
E. 视觉系统和知识图谱语言；
F. Design System tokens、组件 API、variant/state matrix、responsive contract、a11y contract；
G. 组件化高保真原型与测试走查。

原型要求：
- 可直接运行，组件化但完全隔离于 apps/web/src/**；不调用生产 API，只用类型明确的合成 fixtures；
- 覆盖 Today、Review+Graph、Workspace/Space/Invite、Search、System Settings Hub、Profile/Security、Sync/Data、
  Integrations/AI，并让其余路由通过统一壳层可导航；
- 具备 Light/Dark、1440/1024/390/320、键盘、焦点、reduced-motion、移动图谱列表；
- 可切换 loading、empty、error、offline、locked、saving、success、409 conflict、disabled 等状态；
- 图谱有受控动态感，布局稳定，节点/边有状态语义；不得使用纯装饰粒子、霓虹光球或无限动画；
- 按钮不静默，提交防重复，表单反馈与控件关联，危险动作需要明确确认；
- 系统设置使用设置列表、渐进披露和稳定的保存状态，不使用仪表盘式卡片瀑布流；桌面与移动保持同一信息架构；
- 不使用 emoji 代替图标，不做卡片套卡片，卡片圆角≤8px，使用单一强调色和 Lucide 线性图标。

额外交付一份“批准后施工映射”：
- 建议分批顺序和每批 writable paths；
- 现有组件到新组件的映射；
- 需要保留的 API/权限/状态语义；
- 测试增量、Playwright 场景、axe/响应式/主题门禁；
- 明确哪些设计无法在不改合同的情况下实现，必须单独提案。

交付文件：
00-code-aware-product-diagnosis.md
01-ux-audit.md
02-ia-and-navigation-contract.md
03-interaction-state-machines.md
04-design-system-and-component-contract.md
05-implementation-mapping.md
06-prototype-walkthrough.md
prototype/**

完成后停止，等待用户审批。不得修改 apps/web/src/**，不得提交/推送/部署。返回结构化 handoff，包含 changed files、
实际运行命令、原型启动方式、观察结果、未运行项、风险和建议用户重点验收的交互路径。
```

## 用户比较维度

两份方案完成后，按同一张表评审：

| 维度       | 核心问题                                                    |
| ---------- | ----------------------------------------------------------- |
| 任务效率   | 高频任务是否更少步骤、更明确下一步                          |
| 认知负担   | 系统操作页是否从“配置堆叠”变为可理解的分组和渐进披露        |
| 状态反馈   | 是否消除静默按钮、残缺提示、重复提交和无恢复动作错误        |
| 信息架构   | 21 路由是否有稳定归属且不增加一级导航                       |
| 知识图谱   | 动态感、来源语义、键盘和移动等价路径是否同时成立            |
| 视觉一致性 | 明暗主题、单一强调色、图标、密度和组件状态是否统一          |
| 可访问性   | 320/390、键盘、焦点、读屏、对比度和 reduced-motion 是否完整 |
| 可实施性   | 是否复用现有合同与组件，施工范围和风险是否可控              |

用户可以批准 A、批准 B、要求组合修订或全部退回。没有明确批准，主线执行方不得开始正式前端施工。
