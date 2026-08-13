# Logion D0：D1 三套设计方向输入简报

> 本文件只定义方向差异与比较标准，不代表 G1 选择，也不授权正式 Web 施工。

## 1. 三套方向共享的不变量

- IA：今天、工作台、知识库、协作空间、系统中心；前三者为主要入口。
- 单窗口专业工作区；上下文栏 + 单主工作区 + 可控 Inspector，不嵌套两个完整页面。
- Light/Dark 双主题；中性软画布、单一品牌蓝、必要语义色；4px 网格；卡片圆角不超过 8px。
- 无 Hero、光球、玻璃拟态、霓虹、彩虹节点、装饰粒子、Emoji 功能图标或卡片套卡片。
- Today 优先行动；Knowledge Base 对应 Space；Workbench 不改变权限且不复制正式对象。
- Source/Excerpt/正式对象可追踪；AI 只生成候选；敏感能力关闭时没有假操作。
- 桌面/移动任务等价；Light/Dark、键盘、焦点、读屏和 reduced-motion 是一等状态。
- 知识图谱只有局部克制动态，默认有界局部图，必须有列表/树替代。

## 2. 方向 A：Focus Lane / 专注行动线

**核心观点**：尽量少的常驻 UI，把产品塑造成从 Today 进入的一条清晰行动线。

| 维度           | 方案                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 外壳           | 220px 文本侧栏；顶部只保留上下文、搜索和全局创建；Inspector 默认关闭 |
| Today          | 一张主行动表面：Now -> Evidence -> Complete；Next 是短队列           |
| Knowledge      | Sources/Topics/Review 为主列表/阅读器；Graph 是二级切换，不常驻      |
| Research       | 两栏来源 + 编辑；证据 Inspector 按需抽屉                             |
| Workbench 个性 | 学/考/研/导通过任务模板和默认过滤区分，视觉差异最小                  |
| 动态语言       | 只在进入/完成/图聚焦时短暂 150～200ms；品牌蓝                        |
| 移动           | 底部 3 主入口 + 更多；详情全屏 Sheet；一步一任务                     |

优势：学习成本低、Today 极清楚、移动端自然。风险：重度研究用户频繁开关 Inspector；知识图谱的
差异化较弱。

## 3. 方向 B：Evidence Studio / 证据工作室

**核心观点**：围绕来源、声明、证据与关系建立更高信息密度的专业研究桌面。

| 维度           | 方案                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| 外壳           | 232px 主导航 + 细上下文栏；Research/Knowledge 中 Inspector 桌面常驻        |
| Today          | 按“待行动/待证据/待验收”三段队列组织；当前会话固定在顶部                   |
| Knowledge      | Sources 列表、阅读器、Inspector 是主结构；Graph 可与列表受控切换或局部分栏 |
| Research       | 稳定三栏：Source 列表 / Reader-Editor / Evidence Inspector                 |
| Workbench 个性 | Research/Knowledge 最鲜明；学习/考试采用较紧凑状态列表                     |
| 动态语言       | 图节点聚焦、证据链路径和候选边轻量流动；仍只使用单一品牌蓝及语义状态色     |
| 移动           | Sources -> Reader -> Inspector 的栈式导航；Graph 默认列表                  |

优势：最适合学术/技术研究与可追踪证据，是明显的产品差异化。风险：普通学习用户可能感到密度偏高；
1440 以下需要严格降级，不能把三栏硬压到移动。

## 4. 方向 C：Adaptive Desk / 自适应认知桌面（推荐进入 G1 比较）

**核心观点**：保持一个稳定壳层，但让 Today、Knowledge、Research、Review 和 System 使用各自最合适
的工作模板；Inspector 根据任务受控常驻。

| 维度           | 方案                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| 外壳           | 240px 可折叠侧栏 + 40～44px 上下文栏；Inspector 在 Knowledge/Research 常驻、其他页按需 |
| Today          | Now 主行动 + Why/Evidence 侧区 + 有限 Next 队列；不显示无行动价值的指标                |
| Knowledge      | Inbox/Sources/Topics/Graph/Review/History 统一 View Switch；列表/阅读器/图按任务切换   |
| Research       | 三栏模板，但可把 Source 列表或 Inspector 收起；状态保留并可恢复                        |
| Workbench 个性 | 学习看路线/成果，考试看大纲/薄弱项，研究看证据，导师看 Rubric/反馈；共享同一对象内核   |
| 动态语言       | 外壳安静；只在 Graph、证据路径和同步状态使用局部 150～220ms 动态                       |
| 移动           | Today/捕获/Review 为主；详情 Sheet 和对象历史栈；每个桌面视图定义移动等价任务          |

优势：平衡学习与研究，符合已批准“共享内核 + 专业模板”，能分阶段迁移现有 21 路由。风险：模板和
Inspector 规则比 A 复杂，Design System 与状态恢复必须先做好。

## 5. G1 比较用关键帧

每个方向进入 D1 时必须使用同一组合成中文数据，分别提供：

| 页面            | 1440px                                          | 390px                             | Light/Dark                   |
| --------------- | ----------------------------------------------- | --------------------------------- | ---------------------------- |
| Today           | Now、Why、Evidence、Next、当前会话、offline/409 | 当前行动、证据提交、下一项        | 两套都显示 ready/error       |
| Knowledge/Graph | Sources/Topics/Graph/Inspector、1/2 跳、截断    | Graph 等价列表、节点详情 Sheet    | 两套都显示选中/候选边        |
| Research        | Source/Reader/Claim/Evidence、AI Draft          | 栈式 Source -> Reader -> Evidence | 两套都显示 stale/permission  |
| System Center   | 设置列表、详情、保存/冲突/能力关闭              | 单列列表到详情                    | 两套都显示 disabled/危险动作 |

不能只提交静态首页：导航、视图切换、选择、Inspector、主题、错误恢复和移动路径必须可操作。

## 6. 推荐理由与待 Owner 选择

D0 推荐 **C 作为主方向、吸收 B 的 Research/Knowledge 三栏证据结构，并保留 A 的 Today 极简行动线**。
这不是自动批准：G1 必须由产品 Owner 明确选择 A、B、C，或批准上述 `C + B证据结构 + A的Today` 组合。

G1 选择后才能制作 D2 完整高保真交互原型；D2 获 G2 批准后才能生成无占位符的正式施工任务包。
