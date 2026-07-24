# Workspace 成员管理威胁模型

## 范围

L1-003C 覆盖管理者对非 Owner membership 的列表和修改。Owner 转移、主动退出、邀请投递、通知和 UI 属于其他工作包。

## 授权规则

- Owner 可管理任何非 Owner membership，并分配 `admin` 或更低角色。
- Admin 只能管理/分配 `editor`、`contributor`、`reviewer`、`viewer`。
- 任何人都不能通过本 API 修改自己的 membership。
- Owner membership 在这里不可变，必须使用 ownership-transfer 事务。
- 恢复 revoked membership 需要 Owner 权限。
- 每次写入在锁定 Workspace 后重新解析 actor，再锁定目标 membership。

## 威胁与控制

| 威胁                              | 控制                                                                      | 验证                                       |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Admin 提升自己或同级接管          | 中央层级拒绝 self-change、Owner 目标、同级 Admin 目标和 Admin 分配 Admin  | 纯角色矩阵及 PostgreSQL 集成测试           |
| 被撤销管理者利用过期授权完成写入  | 先解析以隐藏跨租户 ID；锁 Workspace 后重新解析活动 actor，再锁目标        | 集成与独立并发审查                         |
| 两个管理者静默覆盖角色            | 要求精确 `expected_version`，锁行并原子递增版本                           | 过期版本返回 `MEMBERSHIP_VERSION_CONFLICT` |
| 旧浏览器会话在暂停/撤销后继续访问 | 每个请求实时解析 active membership；会话不缓存 role                       | 状态改变后同会话立即收到 404               |
| 跨租户 membership ID 探测         | actor/target 均限定请求 Workspace；外部人员统一收到不透明 404             | 跨租户列表/更新测试                        |
| 审计或列表泄露多余身份数据        | 邮箱只对 `workspace.manage_members` 可见；审计只存 ID 与 role/status 差异 | Viewer 列表拒绝及审计断言                  |
| Admin 重新激活 revoked 成员       | 只有 Owner 可执行 `revoked → active`，低角色修改不得绕过                  | 恢复层级测试                               |

## 残余风险与后续

- 本端点不包含 Owner 转移和最后 Owner 保护，绝不能用它模拟。
- 角色改变和撤销通知尚未投递。
- 大型 Workspace 分页及历史 revoked 身份保留/脱敏需要后续隐私与规模决策。
