# Sync v1 Push 与 Space 创建适配器

`POST /api/v1/workspaces/{workspace_id}/sync/push` 接受权威 `sync-v1` Push 信封。路径、信封、每个操作、认证设备和授权 Workspace 必须指向同一上下文。

## 安全与限制

- Cookie 认证、可信 Origin 和双提交 CSRF 是强制要求。
- 按 Workspace 和用户限速，使用 `LOGION_SYNC_PUSH_LIMIT_PER_MINUTE`、`LOGION_SYNC_MAX_OPERATION_BYTES`、`LOGION_SYNC_MAX_BATCH_BYTES` 配置。
- Pydantic 拒绝未知字段，并在使用前验证 schema 边界。
- 服务端重新计算载荷哈希和操作指纹，绝不信任客户端传入的授权结论或指纹。
- epoch 不匹配返回明确 `rebootstrap_required` 控制消息。

## 事务行为

操作保持输入顺序。每个操作在数据库 savepoint 中运行，因此不支持或未授权操作被拒绝时不会回滚成功兄弟项。依赖失败操作的项返回 `blocked_dependency`。成功 Space 变更、审计事件、已处理操作和变更日志在一个外层事务提交。

初始适配器只支持 `space/create`、`base_version=0`、客户端生成实体 UUID，以及仅含 `name` 和 `visibility` 的精确载荷。其他即使结构有效也返回稳定 `SYNC_*` 错误码，不改变业务数据。

## 恢复

迁移和端点采用前向修复。若需在不丢持久账本的前提下禁用 Push，应从 API 部署移除路由并保留三张同步账本表；客户端保留 Outbox，服务恢复后重试。
