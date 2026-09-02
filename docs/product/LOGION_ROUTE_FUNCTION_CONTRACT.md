# Logion 路由与功能可达性合同

## 合同边界

本文是主体 UX 重构期间的正式路由与 Function Reachability 真相源。视觉层可以重排，但 Session、Vault、API、权限、Workspace、Space、sync-v1、正式对象和恢复语义不得改变。Persona 只改变导航优先级，不改变权限。

应用路由由 `APP_PRODUCT_ROUTES` 机器校验：12 条 Persona 主路由加 9 条二级工作台，共 21 条。公共流程以 Next App Router 文件为准；原型中的 `/auth/passkey` 和注册演示参数不是正式路由。

## 应用路由

| 路由                 | 主任务与目标布局                              | 必须可达的正式功能                                         | 上下文、权限与恢复                                            |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `/app/today`         | 今日队列 / NEXT ACTION / Inspector            | 任务、专注会话、阻塞、证据、人工验收、Persona 信号         | Workspace + Space + Vault；离线保留本地写入；409 前往冲突处理 |
| `/app/self-study`    | 收件箱 / 项目看板 / 成果时间线                | 捕获、分诊、路线、项目、里程碑、交付成果                   | Private/Shared Space 写权限；locked/offline/stale 可恢复      |
| `/app/records`       | 对象列表 / Inline Editor / Inspector          | Markdown/Yjs 笔记、链接、PDF 元数据、附件队列、搜索筛选    | Vault + Space；附件 capability；冲突显式解决                  |
| `/app/review`        | 到期队列 / 作答 Sheet / 知识 Inspector        | 知识点、先修关系、主动回忆、自评、错因、周期审查、图谱     | Vault + Space；无数据引导创建；权限失败不伪装为空             |
| `/app/exam`          | 科目/考试 Master / 覆盖分析 / Inspector       | 考试、科目、大纲、模考、成绩、薄弱项和复习安排             | Vault + Space；锁定、离线和错误提供恢复入口                   |
| `/app/planning`      | 目标路线 Master / 阶段与任务 / Inspector      | 目标、阶段、任务、依赖、投入与目标日期                     | Vault + Space；Shared Space 写入受权限控制                    |
| `/app/templates`     | 模板库 / 详情 / 安装与分享 Sheet              | 创建、版本、安装独立副本、导入、短期只读分享、撤销         | Workspace + Space；capability-disabled 解释边界               |
| `/app/audit`         | 筛选 Command Bar / 审计 Data View             | 分页、事件筛选、最小元数据、拒绝事件                       | Workspace 管理权限；错误保留 request ID 与重试                |
| `/app/spaces`        | Space 列表 / 权限与上下文                     | Private/Shared Space、选择、创建、权限展示                 | Workspace 自动带入；无创建权限时说明管理员路径                |
| `/app/settings`      | 设置列表 / 二级 Sheet                         | Persona、主题、用户设置、onboarding 状态、互操作边界       | 用户级设置；409 版本冲突不得静默覆盖                          |
| `/app/profile`       | 身份与账户工作区                              | 账户信息、当前画像和相关安全入口                           | 当前 Session；敏感修改进入最近认证流程                        |
| `/app/help`          | 支持导航与可搜索帮助                          | 产品边界、恢复入口和诊断导航                               | capability/部署差异明确，不伪造未开放功能                     |
| `/app/research`      | 问题 Master / 声明证据 / 来源与实验 Inspector | 问题、论文、声明、支持/反驳证据、实验、指标、反馈          | Vault + Space；来源 URL 校验；共享写入受权限控制              |
| `/app/collaboration` | Review 队列 / Rubric 与反馈 / 成员 Inspector  | Rubric、Group Review、反馈、建议动作和报告快照             | Shared Space + 成员角色；Private Space 不外泄                 |
| `/app/ai`            | Run/Provider Tabs / 发送预检 / 审计 Inspector | Provider、模型发现、预算、持久运行、取消重试、草稿批准拒绝 | Workspace 管理权限；发送来源显式确认；密钥不回显              |
| `/app/sync`          | 状态摘要 / Outbox、冲突、附件、设备 Tabs      | Bootstrap、Push/Pull、Outbox、409 三选一、附件、设备撤销   | Workspace + device + epoch；永不静默覆盖                      |
| `/app/security`      | 安全设置列表 / 最近认证 Sheet                 | 密码、Passkey、TOTP、恢复码、设备与会话                    | 最近认证；危险撤销显示影响和恢复路径                          |
| `/app/data`          | 导入导出 Data View / 危险操作隔离区           | 预览后导入、加密导出、manifest/hash、删除入口              | 最近认证 + Workspace 权限；失败保留请求编号                   |
| `/app/search`        | 搜索 Command Bar / 分组结果 / 预览 Inspector  | 本地内容搜索、通知偏好、静默时间、Calendar Feed            | Vault 决定内容可见性；无结果可清筛选；旧请求不可覆盖新结果    |
| `/app/workspaces`    | 成员/邀请/信息/危险操作 Tabs                  | 成员角色、邀请撤销、所有权转让、Workspace 删除             | Owner/Admin 权限；最后 Owner 保护；危险动作显示恢复边界       |
| `/app/integrations`  | 连接器列表 / 状态与详情 Inspector             | Calendar、开放格式导入、加密导出和明确的延期能力           | capability + 权限；错误保留 request ID，不模拟成功            |

## 公共流程

| 路由                  | 正式任务                                        | 状态与恢复                                     |
| --------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `/auth/login`         | 密码、MFA 或 Passkey 登录并建立设备会话         | 统一隐私错误、request ID、恢复与注册入口       |
| `/auth/register`      | 按部署策略或邀请注册                            | open/invite/closed 策略真实回显                |
| `/auth/verify`        | 验证邮箱并设置凭据                              | 过期或已使用 token 提供重新开始路径            |
| `/auth/recover`       | 请求和完成密码恢复                              | 不泄露账号是否存在；失败可重试                 |
| `/auth/callback`      | 完成正式认证回调                                | 校验状态后进入 onboarding 或应用；失败返回登录 |
| `/onboarding`         | Persona、Workspace、Space、Vault 与今日目标设置 | 七步状态可恢复，不能伪造创建成功               |
| `/invitations/accept` | 查看目标 Workspace/角色并接受邀请               | 匿名先登录；过期、撤销和无权限有明确出口       |
| `/shares/[token]`     | 查看短期只读分享                                | 过期/撤销/capability-disabled 不泄露私有内容   |
| `/account/deletion`   | 确认删除或建立受限恢复会话                      | 显示影响范围、恢复窗口和不可恢复边界           |

## 通用状态合同

每页只在当前可见交互层显示一个 primary。系统已知的 Workspace、Space、对象、Persona、权限、Vault 与 Sync 上下文自动带入并持续回显。

`loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 必须来自真实 controller 状态。非 ready 状态至少提供一个适用的恢复动作：重试、解锁、导航、解决冲突或关闭反馈。

危险操作必须显示对象范围、所需权限、确认内容和恢复路径。移动端关键触达目标至少 `44 x 44 px`；键盘、焦点恢复、Screen Reader 与 reduced-motion 属于功能合同，不是视觉加分项。
