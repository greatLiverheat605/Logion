# Logion D0：核心流程与命令状态映射

## 1. 统一命令合同

正式重构不得再把“按钮被点击”当成反馈。所有有副作用的命令统一使用以下状态机：

```text
idle
  -> validating
  -> pending
  -> success
  -> idle

validating -> validation_error
pending -> conflict | permission_denied | capability_disabled
        | offline_queued | uncertain_external | error
error/conflict/offline_queued -> retry | inspect | cancel/compensate
```

| 状态                  | 必须可见的 UI 语义                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| `validating`          | 错误贴近字段/对象；不发送请求；首个错误可聚焦                             |
| `pending`             | 触发器显示进行中并禁用重复提交；相关区域 `aria-busy`；可取消时给取消      |
| `success`             | 在触发位置确认结果，并给“查看对象/继续下一步”；短暂 Toast 不能是唯一证据  |
| `validation_error`    | 中文原因和修复动作；不只依赖浏览器原生气泡                                |
| `conflict`            | 显示冲突对象、远端/本地版本影响和重新加载/合并/保留副本动作；不得静默覆盖 |
| `permission_denied`   | 不泄露对象存在性；说明当前范围/角色和可请求的下一步                       |
| `capability_disabled` | 不渲染假可用主按钮；显示为何关闭、已有数据是否可读、启用需要的门禁        |
| `offline_queued`      | 区分“只保存在本机”“已进入 Outbox”“不能离线执行”，不得统一写“已保存”       |
| `uncertain_external`  | Provider 等外部请求未知时禁止自动重放；显示运行 ID、预算状态和人工检查    |
| `error`               | 就地错误 + 稳定错误码/请求编号 + 可用的重试、返回或帮助动作               |

客户端防抖和禁用按钮只改善体验；幂等键、乐观版本与数据库唯一约束仍是正式防重边界。

## 2. 十条核心流程

|   # | 流程                                                                       | 当前真实路径                                                                                          | 当前完成度                                                                             | D1/D2 必须表达                                                                               |
| --: | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
|   1 | 登录后进入 Today 并判断下一步                                              | SessionBoundary 校验会话/Onboarding；`/app` 重定向 Today；Today 加载 Workspace/Space/Vault 和真实对象 | **部分完成**：能到达并显示画像化概览，但首屏仍先展示多组指标/面板                      | 5 秒内看见 `Now / Why / Evidence / Next`；无上下文、Vault 锁定、离线陈旧分开                 |
|   2 | 计划/复习/研究缺口进入 Today                                               | Today 从 Goal/Task/Review/Persona dashboard 投影真实对象；Planning/Review/Research 各自存在           | **部分完成**：对象存在，跨域“为什么成为 Today 下一步”的可追踪原因不统一                | 每个 Today 项显示来源原因并一键回到 Goal、Review、Research Question 或 Inbox                 |
|   3 | 执行、计时、提交证据、验收                                                 | `TodayCenter` 创建/转换 Task、开始/结束 Session、提交 Evidence、决定 Verification、关闭 Task          | **已实现但 UI 耦合**：正式状态语义存在，大组件内命令反馈不统一                         | 当前会话常驻；“结束计时 != 完成任务”“提交证据 != 验收通过”必须明确                           |
|   4 | 创建/选择 Knowledge Base                                                   | `/app/spaces` 与 `/app/workspaces` 共用 WorkspaceCenter，创建底层 Space                               | **数据完成、产品语言未完成**                                                           | 选择/创建“知识库”，说明 Private/Shared；底层始终写 Space，不创建平行实体                     |
|   5 | 捕获 Source、重复识别、确认、回源                                          | Records 可创建 Resource/Note；快速捕获可写现有本地实体；Import 有 preview                             | **缺完整闭环**：没有统一 Source Inbox、规范身份与重复合并确认                          | `captured -> duplicate check -> preview -> confirm -> readable`；重复项关联/合并，不静默复制 |
|   6 | Topic、Review、Graph、Source 导航                                          | Review 真实 Topic/Dependency 图可进入节点；Records 和 Review 分离                                     | **部分完成**：真实图有节点与移动/键盘路径，但 Source/Excerpt/Topic/Review 的回跳不完整 | 全局图/局部图、1/2 跳、列表等价路径；Inspector 回 Source、Review、Task、Research             |
|   7 | Research Question -> Source -> Excerpt -> Claim/Evidence -> Finding/Output | Paper/Claim/Question/Run/Metric/Feedback 正式模型存在；SourceExcerpt/Citation API 默认关闭            | **领域部分完成、产品闭环缺失**                                                         | 三栏工作台；正式对象与 AI Candidate 分层；每个 Claim 最多两步回来源定位                      |
|   8 | Workspace 邀请及 409                                                       | WorkspaceCenter 调用 Invitation API；`workspaceActionError` 已把常见 409 变成可操作中文反馈           | **基础完成**：仍需在完整协作页验证角色/到期/重复邀请差异                               | 表单内 pending、防重、409 原因/影响/下一步、请求编号；不发送真实邀请做原型验收               |
|   9 | Persona 保存及 409 合并                                                    | `PersonaSettingService` 用版本保存，409 后重新加载、按 ID 合并并仅重试一次                            | **当前 Persona 完成，Workbench 未实现**                                                | 迁移说明；固定 Workbench 与自定义 Workbench 分离；第二次冲突必须停下人工处理                 |
|  10 | 离线、同步、锁定、权限不足、能力关闭                                       | Vault、sync-v1、ProductWorkbenchState、API Error、Feature Flag 均有基础                               | **覆盖不均**：大型页面常用一个全局 status；disabled 原因不总可发现                     | 每个关键命令状态矩阵；离线可做/排队/禁止，锁定、权限、能力关闭和 409 不得互相代替            |

## 3. 命令族详细映射

| 命令族                        | 触发与前置校验                                     | Pending 与防重复                                      | 成功反馈                                          | 错误、恢复与补偿                                                                    |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 切换 Workspace/Knowledge Base | 壳层上下文选择；必须已认证且目标可访问             | 切换期间锁定相关写命令，取消旧请求                    | 上下文栏显示名称、隐私和同步状态                  | 403 不泄露对象；404 返回选择器；保留上一可用上下文                                  |
| 创建 Workspace                | Workspace 页面表单；名称规范、配额                 | 提交按钮 pending；客户端一次提交，服务端配额/幂等约束 | 就地成功并进入新 Workspace                        | 422 聚焦字段；409/配额给处理建议；不能只弹 Toast                                    |
| 创建 Knowledge Base/Space     | 先选 Workspace；名称、可见性、权限                 | 同上                                                  | 新库成为当前上下文，显示 Private/Shared           | 403/409/配额明确；创建失败不切换本地上下文                                          |
| 邀请成员                      | 合法邮箱、角色、Workspace 权限                     | pending，禁止重复点击和回车重复提交                   | 显示受邀邮箱、角色、有效期和可撤销入口            | 409 区分已是成员/已有邀请/状态冲突；显示 request ID；没有授权不重试                 |
| 修改成员角色                  | 角色变更、不能越权、Owner 约束                     | 行级 pending，其他行可读                              | 行内显示新角色和审计入口                          | 409 重新加载成员版本；危险降权前确认影响；失败恢复旧选择                            |
| 创建/转换 Task                | Workspace/Space/Goal、标题和状态合法               | 对象级 pending；幂等/版本由服务端保证                 | Task 出现在 Now/Next，并可开始会话                | 离线时只在现有 sync-v1 支持范围入 Outbox；冲突显示远端状态                          |
| 开始/结束 Session             | Task 可执行、无冲突活动会话                        | 计时器启动/结束按钮互斥；不靠重复点击                 | 常驻计时与已记录时长；结束后进入证据步骤          | 恢复中断会话；结束失败不把任务标完成；跨设备冲突需选择                              |
| 提交 Evidence                 | Task、证据类型/内容、当前版本                      | pending；同一证据幂等；上传类需独立进度               | 显示“已提交，待验收”及证据定位                    | 失败保留草稿；附件隔离/扫描失败不得显示成功；可删除草稿但不误删正式对象             |
| 决定 Verification             | 需要相应角色/所有权、最新证据                      | 行级 pending；版本锁定                                | 显示通过/退回、决定者与时间；给关闭任务或补证动作 | 409 重新读取；403 保持证据可读；退回不删除证据                                      |
| 关闭 Task                     | 仅已通过验收的任务；二次确认状态                   | pending；服务端重新检查                               | 关闭结果和下一行动                                | 验收已变化时 409；不得以结束 Session 替代关闭                                       |
| 创建/编辑 Note                | Knowledge Base 可写、Vault 已解锁；内容长度        | 自动/显式保存显示 saving；Yjs/版本防冲突              | “本机已保存/远端已同步”分开                       | 离线入既有队列；冲突保留副本/合并；不把本机保存写成云端成功                         |
| 捕获 Resource/Source          | URL/标识符/手工来源合法；目标库可写                | 捕获任务 pending；重复检查期间禁确认                  | 进入 Inbox 并显示身份、来源与下一步               | 重复时选择关联/合并/新版本；不自动复制；解析失败保留来源身份                        |
| 创建 Topic/Dependency         | Topic 同 Space；依赖两端不同；权限                 | pending；依赖去重/环规则由服务端                      | 图/列表同步出现正式关系                           | 409/无效环就地说明；AI 候选不能直接成为正式边                                       |
| 掌握确认/答题/复习安排        | 用户本人、目标存在、回答已提交                     | 每题/每 Topic 独立 pending                            | 回忆结果、人工确认和下一次复习分开                | 离线按现有 sync 支持排队；评分失败保留回答；不把系统建议当确认                      |
| Research 对象写入             | 个人 Research 范围；Source/Question/Claim 引用有效 | 对象级 saving，版本防重                               | 新对象进入三栏上下文，保持回源                    | 跨 Space/跨用户引用拒绝；AI 只生成候选；正式关系需人工确认                          |
| 图谱展开/筛选/布局            | 授权根节点，1/2 跳，150/400 上限                   | 查询 loading；旧请求取消；布局可中止                  | 显示范围、过滤、节点/边计数和截断                 | timeout/截断不显示成空；恢复默认布局；移动端切列表；reduced-motion 关动画           |
| 全局搜索                      | 至少满足查询长度；范围/筛选明确                    | 输入防抖，旧请求取消，不阻塞页面                      | 结果显示类型、来源上下文和回跳                    | 单字符就地提示；离线只标本机结果；网络失败给重试和 request ID                       |
| Persona/旧偏好保存            | Schema、长度、唯一 ID、必需路由                    | 全表单 pending                                        | 显示已同步版本                                    | 首次 409 自动合并一次；第二次 409 停止；未知版本/污染键拒绝                         |
| Workbench v1 保存             | **尚无合同**；必须先有 ADR/Schema/迁移             | 原型只能模拟状态                                      | 不能在正式 UI 声称已保存                          | 未获合同批准前不得复用 Persona JSON 偷渡布局/属性                                   |
| 导入                          | 文件/格式、目标 Private Space、近期认证            | 先 preview，commit 单独 pending                       | 显示对象计数、跳过/冲突和导入收据                 | 失败可重试/清理；不能直接提交未预览内容                                             |
| 导出                          | 范围、格式、近期认证                               | 后台 queued/running，可取消                           | 完成后给校验与下载                                | 取消清理未完成产物；失败显示阶段，不伪造下载                                        |
| 删除/危险动作                 | 影响预览、近期认证、能力开关、确认文本             | pending，禁止重复；不可与普通保存同 Toast             | 显示宽限/撤销/最终清理状态                        | 功能关闭时不发请求；可恢复期给撤销；正式写入后按前向修复                            |
| AI Run                        | 显示 Provider/模型/字段/摘录/预算/保留；用户确认   | 预览和发送分步；幂等；未知外呼不自动重放              | Run、预算和 Draft 可审查                          | uncertain 状态人工检查；超预算/权限/Provider 关闭明确；不得自动换 Provider 泄露内容 |
| AI Draft 决策                 | Draft 最新、目标/来源/版本仍有效                   | pending；仅决策 Draft                                 | 显示 accepted/rejected，但不宣称正式知识已写      | stale/409 返回审查；AI Acceptance 开关关闭时不给“应用成功”                          |
| 安全凭据命令                  | 近期认证、浏览器能力、用户确认                     | 每个凭据行级 pending                                  | 新凭据/撤销结果与恢复码提示                       | Passkey 不支持、TOTP 错误、409 单独处理；恢复码只显示一次                           |
| 同步与冲突解决                | Vault 解锁、设备/Workspace 上下文、网络            | 单一同步实例；进度与 outbox 状态                      | 明确 pushed/pulled/conflicted/blocked 数量        | 冲突逐项选本地/远端/副本；清本机是危险动作且不可恢复                                |

## 4. 跨页面回跳合同

- Today 项必须回到产生原因的 Goal、ReviewSchedule、ResearchQuestion 或 Inbox Item。
- Topic/Claim/Note 必须能回到 SourceExcerpt，再回 Resource 的页码/URL/版本定位。
- Search 结果必须回到原对象页面和选中状态，不只回到页面顶部。
- 图谱 Node Inspector 必须能打开 Source、Review、Task、Research；返回图谱时恢复根节点、过滤、缩放和
  选中项。
- System Center 错误可跳到 Security、Sync、Data、Integrations 或 Help 的精确段落；返回后保留原表单。

## 5. D0 结论

现有后端和离线模型已经支持大量真实命令，主要缺口是命令状态的统一呈现、跨页面上下文恢复，以及
Source/Excerpt/Claim 的完整产品路径。正式重构应先统一反馈合同再迁移页面，不能在每个大组件里继续
增加独立 `status: string` 分支。
