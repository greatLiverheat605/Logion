# Logion GLM 设计一致性合同

## 合同目的

本文冻结 Product Owner 已批准 GLM 原型的视觉、信息架构、布局树与交互路径，防止正式实现只保留新 Shell、主体却退回旧 Center、长表单和卡片堆叠。它与 [Logion 路由与功能可达性合同](./LOGION_ROUTE_FUNCTION_CONTRACT.md) 配套使用：

- 正式 API、Session、权限、Workspace、Space、Vault、sync-v1、对象和恢复语义决定“系统做什么”。
- GLM `specs/01-05`、批准截图和本文决定“任务如何组织与呈现”。
- 当前正式 DOM/CSS 不是设计真相源，不得反向覆盖已批准布局。
- GLM fixture store、hash router、手写 overlay、演示数据和 `/auth/passkey` 路由不得进入正式工程。

机器可读目标位于 `reports/ui-refactor/glm-target-manifest.json`。截图仍留在隔离工作区，manifest 只记录绝对来源、相对路径、视口和 SHA-256。

## 固定设计基线

| 范围         | 合同                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 视觉语言     | 冷灰中性表面、单一靛蓝强调、紧凑 4px 网格、内容优先、无装饰性大卡片                          |
| Light / Dark | `#f5f6f8 / #0e1116` 背景，`#ffffff / #151a21` 主表面，`#3056d3 / #4a75e0` 强调色             |
| 字体         | 13px 正文、12px 辅助、11px 非关键标注；不以小字号掩盖密度问题                                |
| 几何         | Desktop Sidebar 232px、Topbar 48px；Workbench Master 264px、Inspector 316px，容差 4px        |
| 圆角与动效   | 4/6/10px；120/180ms；`prefers-reduced-motion` 下归零                                         |
| 响应式       | ≥1100px 完整三栏；720-1099px Inspector 收起或并入 Main；<720px Sidebar 抽屉、Master 顶部折叠 |
| 触达         | GLM 桌面控件 28/34px；正式移动端可点击区域至少 44x44px，作为无障碍批准偏离                   |
| 主操作       | 当前可见交互层 `[data-workbench-primary="true"]` 不超过 1 个；只读页可以没有写入 primary     |
| 披露         | L1 列表/工作面 → L2 Inline、Popover、Sheet 或 Inspector；不得出现第三层弹窗                  |

## 应用路由目标

表中布局树是必须可识别的主体结构，不是建议。Target 文件名均指向 manifest 中带 SHA-256 的批准资产。

| 路由                 | 主任务                      | 批准布局树                                                                              | Primary                        | 必须可见的关键区域                                                 | GLM Target             | 偏离 |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ | ---------------------- | ---- |
| `/app/today`         | 推进下一步动作并补证据验收  | AppShell → Queue Master / NEXT ACTION Main / Task Context Inspector                     | 开始专注 / 结束会话同位切换    | 今日序列、下一动作、证据与人工验收、今日信号、14 天趋势、Inspector | `app_today-*` 四视口   | 无   |
| `/app/self-study`    | 分诊收件箱并推进项目成果    | AppShell → Inbox / Route & Project Board / Deliverable Timeline Tabs                    | 分诊                           | 收件箱、路线与项目、成果时间线                                     | `app_self-study-*`     | 无   |
| `/app/records`       | 写笔记并关联资料与任务      | AppShell → Document Tree / Inline Markdown Editor / Metadata Inspector                  | 新建笔记                       | 文档树、编辑/预览、保存状态、关联对象、附件队列                    | `app_records-*` 四视口 | 无   |
| `/app/review`        | 清空到期回忆队列            | AppShell → Review Tabs / Due Queue / Answer Sheet / Knowledge Inspector                 | 开始回忆                       | 到期队列、全部知识点、错因、周期审查                               | `app_review-*`         | 无   |
| `/app/exam`          | 围绕最近考试推进覆盖与模考  | AppShell → Exam Master / Coverage Main / Exam Inspector                                 | 创建考试 / 开始模考            | 考试列表、科目权重、大纲、模考、薄弱项                             | `app_exam-*`           | 无   |
| `/app/planning`      | 把目标拆成可验收路径        | AppShell → Goal Master / Stage Route Main / Goal Inspector                              | 新建目标 / 新建阶段            | 目标、阶段依赖、任务、验收标准                                     | `app_planning-*`       | 无   |
| `/app/templates`     | 预览并安装独立模板副本      | AppShell → Category Master / Template List / Install Sheet                              | 安装独立副本                   | 分类、预览、安装差异、已安装副本                                   | `app_templates-*`      | 无   |
| `/app/audit`         | 筛选并解释安全事件          | AppShell → Filter Command Bar / Audit Timeline / Inline Event Detail                    | 无写操作；首交互为筛选         | 时间范围、事件类型、事件时间线、展开详情                           | `app_audit-*`          | 无   |
| `/app/spaces`        | 管理个人与共享空间边界      | AppShell → Space Directory / Access Detail / Move Confirm Sheet                         | 创建空间                       | 空间目录、成员访问、epoch、移入共享空间                            | `app_spaces-*`         | 无   |
| `/app/settings`      | 调整画像与界面交互偏好      | AppShell → Grouped Settings List / Secondary Sheet                                      | 当前设置动作                   | 画像、主题与密度、交互、导航偏好                                   | `app_settings-*`       | 无   |
| `/app/profile`       | 查看账户与本人活动          | AppShell → Account Summary / Personal Activity / Account Actions                        | 无强制写入 primary             | 身份、验证状态、本人活动、安全与删除入口                           | `app_profile-*`        | 无   |
| `/app/help`          | 离线自助排查与恢复          | AppShell → Help Search / Environment Diagnostics / Recovery Paths / FAQ                 | 搜索帮助                       | 诊断、恢复深链、FAQ                                                | `app_help-*`           | 无   |
| `/app/research`      | 维护问题、声明与证据链      | AppShell → Research Tabs / Claims Main / Evidence Inspector                             | 新建问题 / 添加声明            | 问题、论文、声明、证据、实验指标                                   | `app_research-*`       | 无   |
| `/app/collaboration` | 完成待办审阅并形成行动      | AppShell → Review Master / Rubric & Feedback Main / Member Inspector                    | 提交反馈                       | 审阅队列、Rubric、反馈时间线、不可变快照                           | `app_collaboration-*`  | 无   |
| `/app/ai`            | 审查 AI 草稿或管理 Provider | AppShell → Draft/Provider Segmented / Review Split / Audit Inspector                    | 采纳草稿 / 测试并发现模型      | 来源引用、草稿、Provider、模型、运行审计                           | `app_ai-*`             | 无   |
| `/app/sync`          | 处理 Outbox 与冲突          | AppShell → Sync Summary / Operational Tabs / Conflict Compare                           | 立即同步 / 处理冲突            | Outbox、冲突、附件、设备、epoch                                    | `app_sync-*`           | 无   |
| `/app/security`      | 完成安全清单并管理设备      | AppShell → Security Checklist / Settings Sections / Recent-auth Sheet                   | 第一个未完成安全项             | Passkey、TOTP、恢复码、设备与会话                                  | `app_security-*`       | 无   |
| `/app/data`          | 发起可验证的加密导出        | AppShell → Export / Import / Isolated Danger Zone                                       | 创建加密导出                   | 范围、进度、校验和、预览、高风险操作                               | `app_data-*`           | 无   |
| `/app/search`        | 从单一入口找到内容与行动    | AppShell → Sticky Search Command / Mode Segmented / Grouped Results / Utility Inspector | 搜索框 Enter；无结果为清除筛选 | 搜索、分组结果、预览、通知偏好、日历订阅                           | `app_search-*` 四视口  | 无   |
| `/app/workspaces`    | 管理成员、邀请与 Workspace  | AppShell → Members/Invites/Info/Danger Tabs / Data View / Sheets                        | 邀请新成员                     | 成员、邀请、信息、所有权与删除                                     | `app_workspaces-*`     | 无   |
| `/app/integrations`  | 连接已有能力并解释边界      | AppShell → Capability Summary / Connector List / Detail Inspector                       | 创建日历订阅                   | Calendar、开放格式、附件状态、延期能力                             | `app_integrations-*`   | 无   |

## 公共与辅助流程目标

| 路由                  | 主任务                                       | 批准布局树                                                         | Primary                  | GLM Target                                 | 偏离                                                                             |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `/auth/login`         | 建立设备会话                                 | PublicShell → Identity → Credentials → Recovery/Registration Links | 登录                     | `pub_login-*`                              | Passkey 保留为登录方式，不建立 `/auth/passkey` 页面                              |
| `/auth/register`      | 按部署策略或邀请注册                         | PublicShell → Policy State → Registration Form                     | 创建账户 / 使用邀请      | `pub_register-*`                           | open/invite/closed 都必须来自正式部署策略                                        |
| `/auth/verify`        | 验证邮箱并设置凭据                           | PublicShell → Token State → Credential Setup                       | 验证并继续               | `pub_verify-1440x900.png`                  | 无                                                                               |
| `/auth/recover`       | 请求或完成密码恢复                           | PublicShell → Recovery Form → Privacy Feedback                     | 继续恢复                 | `pub_recover-1440x900.png`                 | 不泄露账户存在性                                                                 |
| `/auth/callback`      | 完成正式认证回调                             | PublicShell → Transient Status → Error Recovery                    | 自动完成；失败时返回登录 | `pub_login-*` 仅作 Shell 参考              | GLM 无独立 callback；允许正式瞬时状态替代，但必须保持 PublicShell 几何与错误出口 |
| `/onboarding`         | 配置 Persona、Workspace、Space、Vault 与目标 | PublicShell → Stepper → Current Step → Persistent Context          | 当前步骤继续             | `pub_onboarding-*`                         | 正式七步状态与真实 API 优先                                                      |
| `/invitations/accept` | 核对目标 Workspace/角色并接受                | PublicShell → Invitation Summary → Auth/Accept Action              | 接受邀请                 | `pub_invite-1440x900.png`                  | 匿名用户先登录，过期/撤销不伪装成功                                              |
| `/shares/[token]`     | 查看短期只读分享                             | Wide Public View → Share Metadata → Read-only Snapshot             | 打开允许的深链           | `pub_share-valid-*`、`pub_share-revoked-*` | 失效态不得泄露私有对象存在性                                                     |
| `/account/deletion`   | 删除确认或恢复受限会话                       | PublicShell → Impact Scope → Recovery Window → Phrase Gate         | 确认删除 / 恢复账户      | `pub_deletion-1440x900.png`                | 正式最近认证与恢复窗口优先                                                       |
| `/offline`            | 解释离线边界并提供恢复                       | PublicShell → Offline State → Local/Sync Recovery                  | 重试连接 / 前往同步      | `pub_offline-*`                            | 无                                                                               |
| `404`                 | 从无效地址恢复导航                           | PublicShell → Not-found State → Recovery Links                     | 返回 Today / 登录        | `pub_not-found-1440x900.png`               | 实际由 Next `not-found.tsx` 提供，不新增 `/404` 业务路由                         |

## 关键区域与测试标记

每条路由在 manifest 中声明稳定 `data-testid`。测试只依赖语义区域，不依赖旧 DOM 层级。共享 Shell 使用：

- `app-sidebar`
- `app-topbar`
- `app-main`
- `workbench-master`
- `workbench-main`
- `workbench-inspector`

路由专属区域使用 `<route>-<region>`，例如 `today-evidence`、`search-results`、`records-save-status`。步骤 2-15 在对应页面实施时接入；R1 只冻结名称和断言 helper，不通过修改当前 DOM 伪造完成。

## 证据与偏离规则

每条验收路由必须提供同视口 `Before / GLM Target / After`：

1. Target 通过 manifest 的外部路径和 SHA-256 校验，禁止复制到正式源码或以新截图覆盖。
2. After 必须来自重建后的 8080 Web 镜像，报告记录 Git SHA、dirty 摘要、image ID、CreatedAt、StartedAt 与 URL。
3. 动态内容不做全页像素硬匹配；机器检查 Shell/Workbench 几何、关键区域、唯一 primary、四断点溢出和可达性。
4. 允许偏离必须写明 `scope`、`reason`、`approvedBy`、`approvedAt`、`recovery`；缺任一字段视为未批准。
5. 全局已批准偏离只有移动触达从 GLM 40px 提升到至少 44px，以及正式语义优先于原型 fixture。
6. Product Owner 仍需按真实任务核验层级、密度、首屏区域与操作路径；测试通过不得替代人工签字。

## 状态与可访问性门

`loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 必须来自真实 controller，并提供可执行恢复动作。每页还必须通过 320、390、1024、1440 px 溢出检查、键盘、焦点恢复、Screen Reader、Axe 与 reduced-motion 验收。
