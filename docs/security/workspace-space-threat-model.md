# Workspace 与 Space 授权威胁模型

- 工作包：`L1-003A`
- 追踪：Issue #21
- 上游：PR #16、PR #18、PR #20
- 状态：实现中，合并前必须由非实现者独立复核

## 范围与不变量

本增量建立 Workspace 租户边界、WorkspaceMembership 角色关系、Private/Shared Space 可见性边界、命名权限注册表和最小 Workspace/Space API。邀请、角色变更、Owner 转移、成员撤销、学习业务对象和离线同步属于后续工作包。

以下不变量不可由 UI 或调用方覆盖：

1. 用户可属于多个 Workspace；服务端不能从“默认 Workspace”推断授权。
2. Workspace 查询必须同时包含请求的 `workspace_id`、当前 `user_id` 和 active membership。
3. Space 查询必须同时包含 `space_id` 和 `workspace_id`，不能先按 Space ID 查询再过滤。
4. Private Space 仅 `owner_user_id` 可见；Workspace Owner/Admin 也不能读取其他成员的 Private Space。
5. Shared Space 需要 active Workspace membership，并按中心命名 permission 判断写操作。
6. 客户端传入的 Workspace、Space、角色、owner 和资源归属均不可信。

## 资产与边界

| 资产/边界           | 安全要求                                                                          |
| ------------------- | --------------------------------------------------------------------------------- |
| Workspace           | 租户、配额、导出、备份与未来计费边界；不得跨 Workspace 聚合用户正文               |
| WorkspaceMembership | 用户与租户的权威关系；角色只允许 `owner/admin/editor/contributor/reviewer/viewer` |
| Private Space       | 仅 owner 可见；管理 Workspace 不授予正文读取权                                    |
| Shared Space        | active membership 可见；创建和后续写入由命名 permission 决定                      |
| 对象标识符          | UUID 仍视为可猜测；知道 ID 不构成授权                                             |
| 审计事件            | 记录 actor、Workspace、permission 和结果，不记录正文或请求 payload                |

## 威胁、控制与验证

| 威胁                                       | 控制                                                                                        | 验证                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| IDOR：用户猜测其他 Workspace UUID          | `Workspace + Membership` 联合范围查询；非成员统一返回 `RESOURCE_NOT_FOUND`                  | PostgreSQL 集成测试让用户 B 访问用户 A Workspace，验证 404             |
| 用正确 Space ID 搭配错误 Workspace         | Space 查询同时约束 `Space.id` 与 `Space.workspace_id`                                       | 集成测试使用错配 Workspace/Space ID，验证 404                          |
| Workspace Owner/Admin 越权读取成员私人正文 | Private Space 查询额外要求 `owner_user_id == current_user`，不检查管理角色例外              | 集成测试在同一 Workspace 中验证 Owner 无法读取 Viewer 的 Private Space |
| 普通成员创建 Shared Space                  | 角色仅通过中心 `ROLE_PERMISSIONS` 解析 `space.create_shared`                                | 单元矩阵测试和 Viewer 创建 Shared Space 的 403 集成测试                |
| 客户端权限契约与服务端授权漂移             | 权限契约 v2 枚举每个角色的完整 grant；测试逐项对比服务端 `ROLE_PERMISSIONS`，漂移即阻断合并 | 全角色 × 全权限参数化测试；契约版本、角色顺序和 legacy alias 精确断言  |
| 会话存续期间角色降级、暂停或撤销           | 每次请求重新读取 active membership；不把角色或 Workspace grant 缓存在浏览器会话中           | 同一登录会话中 editor→viewer、suspended、revoked 后立即拒绝的集成测试  |
| 前端伪造角色或 owner                       | 创建 API 不接受 role/owner 字段；owner 从认证上下文产生                                     | OpenAPI 契约审查；集成测试检查新 Private Space owner                   |
| 撤销/暂停成员继续访问                      | 所有 Workspace 解析要求 membership `status=active`                                          | 同一会话的 suspended/revoked 负测已覆盖；状态变更 API 仍属于 L1-003B   |
| 探测资源是否存在                           | 非成员、跨 Space 和 private 越权统一返回同一 404 机器码和消息                               | 集成测试比较跨租户与 private 拒绝路径                                  |
| 拒绝事件未留证或泄漏正文                   | 拒绝路径提交最小化 audit，只含 actor、Workspace、target type、permission/role               | 集成测试验证拒绝审计已持久化                                           |
| 注册后出现无租户账户                       | 用户、会话、个人 Workspace、owner membership 和默认 Private Space 在同一数据库事务提交      | 集成测试注册后立即读取唯一 owner Workspace 和 Private Space            |
| 已认证用户耗尽持久化资源                   | Workspace/Space 创建使用 Redis 用户级限流；数据库锁定用户或 Workspace 后原子检查可配置配额  | 单元测试覆盖独立限流主体；集成测试覆盖配额拒绝；代码审查确认行锁       |
| 权限逻辑在路由中分叉                       | 规范角色、permission 和默认 grant 只定义于 `workspaces/permissions.py`                      | 单元测试枚举完整性；代码审查禁止重复角色矩阵                           |

## 角色与隐私说明

Owner 拥有全部 Workspace 级命名权限，但这不改变 Private Space 的 owner-only 规则。Admin 不拥有安全/账单权限。Editor 可创建 Shared Space；Contributor、Reviewer 和 Viewer 不能创建 Shared Space，但可在 Workspace 中创建自己的 Private Space。后续业务对象必须使用相同 AuthorizationService，而不能复制角色条件。

## 迁移与回退

`0005_workspace` 是现有 `0004_totp` 之后的唯一 Alembic head，创建 `workspaces`、`workspace_memberships` 和 `spaces`。迁移为升级前已存在的每个 user 回填一个个人 Workspace、owner membership 和 Private Space，并写入迁移审计，避免旧账户处于无租户状态。空环境可执行 downgrade；一旦产生真实 Workspace 或 Space 数据，只允许前向修复。直接降级会删除租户关系和可见性边界，生产环境不得执行。

## 残余风险与后续门槛

- 本切片没有邀请、角色变更、成员撤销或 Owner 转移 API；不得宣称协作管理已经完成。
- “最后一个 Owner 不得离开”和 Owner 双重确认将在角色管理切片实现并测试。
- L1-004 必须增加 suspended/revoked membership、批量 IDOR、枚举模糊测试及并发角色变更测试。
- 后续每种业务对象都必须带 `workspace_id` 和 `space_id`，repository 查询从两个范围开始。
- 搜索、通知、导出、AI、备份和 worker 尚未实现；实现时必须复用相同授权边界。
- 独立 reviewer 必须尝试跨用户 UUID、Workspace/Space 错配、Owner 私有越权、暂停成员、事务部分失败和审计旁路。
