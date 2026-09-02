# Logion D0：UX、视觉、无障碍与性能审计

## 1. 总体判断

当前系统不是“功能太少”，而是功能、状态和说明同时堆进大页面，再用同一组 Hero/Metric/Panel/
Disclosure 组织，导致用户难以快速判断当前任务、下一步和完成标准。重构目标是减少上下文切换和错误
猜测，不是增加装饰。

严重度：P0 阻断正式施工或安全；P1 影响核心任务；P2 影响一致性/效率；P3 优化项。

## 2. 信息架构与导航

| 级别 | 证据                                                                      | 问题                                                                                            | 方向                                                                         |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P1   | `app-navigation.ts` 的侧栏只有 12 条 Persona 路由，但系统有 21 条正式路由 | 主导航、命令面板、设置入口和直达 URL 使用不同可发现规则；用户不知道哪些是主任务、哪些是低频治理 | 五个领域区域；只突出今天/工作台/知识库，协作与系统降权；全局命令负责跨域跳转 |
| P1   | `/app/spaces` 与 `/app/workspaces` 都渲染 `WorkspaceCenter`               | “知识库管理”和“协作治理”在 UI 中没有任务分工                                                    | 共享数据源，分别使用 Knowledge Base 管理模板与 Workspace 治理模板            |
| P1   | Self-study、Research、Collaboration 由一个 1607 行组件按模式切换          | 学习、研究、导师工作台的交互性格被实现耦合压平                                                  | 提取共享 context/data/command hooks，三种模板独立呈现                        |
| P2   | Profile/Help 是少量 ProductPanel 占位内容                                 | 低频页面占据正式路由，但不能真正完成账户或故障恢复                                              | 并入 System Center 的列表 + 详情；保留 URL 深链                              |
| P2   | Persona 通过隐藏路由塑造“画像”                                            | 容易把入口可见性误解为权限或完整工作台自定义                                                    | 明示“偏好不改变权限”；之后迁移为受控 Workbench 投影                          |

## 3. 页面层级与视觉语言

| 级别 | 证据                                                                                           | 问题                                                         | 方向                                                                         |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| P1   | TSX 中 `<ProductPanel>` 69、`<ProductMetric>` 64、`<ProductDisclosure>` 34、`<ProductHero>` 10 | 不同工作被同一种仪表盘语法同质化；指标先于行动               | Today、Workbench、Knowledge、Research、Review、System 各用独立页面模板       |
| P1   | `globals.css` 4993 行；全局 `h1` 为 2.25～5.5rem、负字距                                       | 工具页排版受全局营销尺度影响；修改一处难预测全站结果         | 建立 scope 化 tokens/primitives/layouts；页面标题 18～24px，不按视口缩放字体 |
| P2   | `body` 两组 radial gradient + 网格伪元素                                                       | 背景装饰持续竞争内容，和安静专业外壳冲突                     | 使用中性软画布与弱表面梯度；移除全局光晕、装饰网格                           |
| P2   | ProductHero 三层 orbit 圆展示百分比                                                            | 所有领域被套上相似“科技仪表”符号，且百分比容易在无分母时误导 | 进度只在有真实分母时显示为紧凑条/文本；动态图谱只在知识视图局部出现          |
| P2   | Persona 使用 Emoji，产品目标要求 Lucide 风格单一图标族                                         | 功能图标语义与视觉语言不一致                                 | 导航/命令/列表全部使用同一线性图标；自定义项只允许受控图标 ID                |
| P2   | 多层 ProductPanel/Disclosure 在大型页面交错                                                    | 形成页面区块卡片化和卡片套卡片，扫描路径断裂                 | 页面区段保持无框；卡片只用于重复对象、对话框和真正工具表面；列表优先         |

## 4. 命令反馈与错误恢复

| 级别 | 证据                                                                              | 问题                                                     | 方向                                                                         |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P1   | 多个中心组件用单一 `status` 字符串承载所有操作结果                                | 反馈可能离触发器很远，多个并行命令互相覆盖               | 每个命令拥有状态对象；字段错误、行级错误、页面错误和 Toast 分层              |
| P1   | `InlineFormFeedback` 已在 Workspace、Search、Records 等局部使用，但未覆盖所有命令 | 最近 UX 修复形成了可用模式，但尚未产品化为统一 primitive | 抽象 `CommandFeedback`：pending、success、error、request ID、retry、conflict |
| P1   | API client 保留 `code/status/retryable/requestId`，页面常只显示 message           | 可恢复信息在 UI 层丢失                                   | 错误映射层保留稳定码与 request ID；技术细节不暴露，恢复动作明确              |
| P1   | Persona 409 有一次自动合并；邀请 409 有专项文案；其他 409 分散                    | 相同冲突状态在不同页面呈现不一致                         | 统一 Conflict Panel，但按领域选择 reload/merge/copy/cancel，不做通用静默重试 |
| P1   | AI 外部请求具有未知完成风险                                                       | 普通“重试”可能重复计费或泄露内容                         | `uncertain_external` 独立状态；显示 Run ID/预算，不自动重放                  |
| P2   | disabled 按钮常只由布尔条件控制                                                   | 用户未必知道是 Vault、权限、网络还是能力开关导致不可用   | 关键 disabled 控件需就近原因；生产能力关闭时优先不显示主按钮                 |

## 5. 核心页面专项

### 5.1 Today

- 当前 `TodayCenter` 同时承担上下文、同步、任务、会话、证据、验收与大量统计。
- 首屏应该先回答：现在做什么、为什么、完成证据是什么、之后有什么，而不是先展示完成率或多组指标。
- 当前 Session/Evidence/Verification 领域命令是真实资产，应保留语义并拆成可测试模块。
- 任务完成路径必须在 UI 中保持：结束计时、提交证据、验收通过、关闭任务是四个不同动作。

### 5.2 Knowledge Base / Graph

- Review 已能把真实 Topic/Dependency 映射到图谱，并有 loading、移动列表、键盘导航和 150/400
  边界的后端合同基础。
- 历史原型文件约 1606 行，图布局、渲染、Inspector 和状态耦合；正式实现应封装 adapter/layout/render
  三层，领域代码不依赖图库内部对象。
- 动态仅用于进入、聚焦、布局稳定和关系高亮；reduced-motion 下关闭非必要动画。
- 不能默认渲染全库“毛线球”；默认是当前对象 1 跳，用户显式扩到 2 跳。
- 移动端列表/树必须能完成选择、审查关系、回源和接受/拒绝候选，Canvas 不是唯一入口。

### 5.3 Research

- 当前研究模型完整度高于 UI：Paper、Claim、Question、Run、Metric、Feedback 已有正式对象。
- 页面仍混在 SelfStudyCenter 中，来源、编辑和证据没有稳定三栏关系。
- 新模板应让 Source -> Excerpt -> Claim/Evidence -> Finding/Output 始终可见，并区分个人 Research
  所有权与 Shared Space。

### 5.4 System Center

- Security、Sync、Data、Integrations、AI 功能真实且复杂，但分别呈现为不同风格的大面板页。
- 使用设置列表 + 详情；保存、近期认证、危险动作、能力关闭和 409 采用同一反馈骨架。
- Provider、Attachment、Local Worker、Deletion 等关闭能力不能靠视觉上“灰按钮”暗示可立即开启。

## 6. 响应式与信息优先级

| 宽度   | 目标                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| 1440px | 220～256px 主导航；上下文栏；单主工作区；仅在任务需要时显示 300～360px Inspector |
| 1024px | 主导航可收窄/折叠；Inspector 为可切换侧栏；禁止两个完整页面并排                  |
| 390px  | 底部任务入口/抽屉；单列主任务；详情 Sheet；图谱切列表/树；所有命令反馈贴近触发器 |
| 320px  | 不横向溢出；最长中文词/ID 可换行或截断；固定工具栏不遮挡正文/软键盘              |

现有 `authenticated-shell.spec.ts` 已定义四档全路由溢出检查，可直接保留为施工门。D0 本轮没有启动
本地认证栈，因此没有把既有测试记录写成“本次新方案已通过”。

## 7. 无障碍与键盘

可保留：

- skip link、`focus-visible`、Dialog 焦点圈与返回；
- Ctrl/Cmd+K、Escape；
- Light/Dark 主题持久化的安全值；
- `prefers-reduced-motion`；
- 图谱键盘导航和移动等价列表；
- axe Browser 基线。

施工必须新增：

- 所有 IconButton 的可访问名称和 Tooltip；
- 受控分栏/Inspector 的键盘开关与焦点恢复；
- 表格排序、选择、虚拟列表的读屏语义；
- 状态不能只靠颜色，图边关系不能只靠线型/颜色；
- 命令 pending/success/error/409 的 live region 不抢读无关页面更新；
- 触控目标至少 44px（移动），桌面紧凑控件仍提供足够焦点边界。

## 8. React/Next.js 性能审计

| 优先级   | 证据                                            | 风险                                                | 施工要求                                                                 |
| -------- | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Critical | AppShell 先请求 Workspaces，再请求 Notification | 可消除请求瀑布，首屏通知延迟                        | 把独立请求并行，或让服务端/聚合层提供当前上下文；开始 Promise 早、等待晚 |
| Critical | 图谱与大型工作台均为重客户端组件                | 路由 JS、解析与首次交互成本高                       | 图谱按视图动态加载；关闭视图不加载图库/布局；直接 import，避免宽 barrel  |
| High     | 多个工作台重复 Workspace/Device/Space/bootstrap | 重复请求、重复状态和竞态                            | 建立缓存/去重的 App Context 数据层；权限仍由服务端权威检查               |
| High     | 大组件混合数据、命令和展示                      | 任一状态变化可能扩大重渲染范围                      | 拆纯模型、命令 hook、列表行和 Inspector；订阅派生状态而非整个对象        |
| Medium   | 全局 Persona/Vault 上下文覆盖整个壳             | 上下文变化可能使大范围消费者更新                    | 拆独立 context，避免组合大 value；只在需要的组件消费                     |
| Medium   | 长列表没有统一虚拟化                            | Sources、Search、Audit、History 扩大后 DOM 成本上升 | 真实规模压测后使用 TanStack Virtual；小列表不提前虚拟化                  |
| Medium   | `globals.css` 超大且跨页面                      | 样式匹配、回归和维护成本                            | tokens/base/layout/primitives/features 分层；不在同一提交机械搬迁全文件  |
| Medium   | localStorage/IndexedDB 状态多                   | hydration/重复读取风险                              | 继续版本化和严格解析；缓存读取；首屏主题使用现有无闪烁 bootstrap         |

## 9. 可复用、封装、拆分、废弃

| 决定               | 项目                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保留               | SessionBoundary、ApiClient 安全边界、VaultSessionProvider 语义、Theme 安全持久化、AppModal 焦点模式、InlineFormFeedback 思路、ProductWorkbenchState 状态区分、图谱移动/键盘路径 |
| 封装               | App Context、CommandFeedback、RequestError、Conflict、CapabilityBoundary、Inspector、ViewSwitcher、Source identity、Graph adapter/layout/render                                 |
| 拆分               | TodayCenter、ReviewCenter、SelfStudyCenter、ExamCenter、ContentCenter、AppOperationalTools、AppShell                                                                            |
| 渐进废弃           | ProductHero orbit、默认 Metric 首屏、页面级 ProductPanel 瀑布、Emoji 功能图标、全局装饰光晕/网格、营销尺度全局 h1                                                               |
| 不得复用为正式合同 | 历史 Knowledge prototype mock 写入、PersonaSetting 作为 workbench-v1、disabled 按钮作为生产能力证明                                                                             |

## 10. 本轮未运行项

- 未启动 Web/API/Docker 或生产环境。
- 未生成新截图；旧 Browser 截图仅作为历史测试说明，不作为新方向证据。
- 未执行新方案的 1440/1024/390/320、Light/Dark、axe、键盘或性能测量，因为 D1/D2 尚未生成。

这些项目不是“通过”，而是 D1/D2 和正式施工的后续验收门。
