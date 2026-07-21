# 服务端同步账本

- 工作包：`L2-003A`
- 输入契约：`sync-v1`（main `db55612`）
- 范围：PostgreSQL epoch、operation 幂等与 change log；尚不开放 HTTP 同步入口

## 表与不变量

| 表                          | 主键                       | 责任                                                                            |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `workspace_sync_states`     | `workspace_id`             | 当前 `sync_epoch`、workspace 单调 sequence、保留游标下界与 snapshot schema      |
| `processed_sync_operations` | `operation_id`             | 将全局 operation ID 绑定到 workspace、device、实体、操作类型和请求 Payload Hash |
| `sync_changes`              | `(workspace_id, sequence)` | 保存一次已提交领域变更的 pull 投影、server version、epoch 与 tombstone          |

状态行通过锁定 active Workspace 后惰性创建，因此同一 workspace 的并发首次写不会产生两个 epoch。Push 事务必须先锁状态行；每次成功领域变更把 `last_sequence` 加一，并在同一事务写入 processed operation 与 change。不同 workspace 各自从 sequence 1 开始，互不阻塞。

`operation_id` 全局唯一。重放只有在 workspace、device、Payload Hash、服务端计算的完整 operation fingerprint、实体 ID/类型和 operation type 全部一致时才返回原 change 的 sequence/version；同 ID 换 Payload Hash 返回 `SYNC_OPERATION_HASH_MISMATCH`，其余身份变化返回 `SYNC_CONTEXT_MISMATCH`。Fingerprint 在 L2-003B 由校验后的完整 operation 规范化计算，用于捕获同 Payload 但 base version、依赖、时间或冲突解决元数据被替换；客户端不能提供或覆盖它。不能把另一个租户的 operation 当作“未处理”重新执行。

`device_id` 作为幂等身份的历史 UUID 保留，不对 Device 表建立删除阻断外键；否则账户删除会被历史 operation 阻塞。HTTP 入口仍必须在每次 push 时验证 Device 存在、属于当前用户且未撤销，删除或撤销设备不删除已提交 change，也不能再次使用该设备 push。

数据库使用复合外键确保 change 的 workspace/entity/operation 与 processed operation 完全一致。Check constraints 限制 Hash、实体类型、operation 类型、sequence/version、JSON object 和 tombstone：delete 必须是空 Payload 且有 `deleted_at`；非 delete 不能伪装 tombstone。`trg_sync_changes_enforce_head` 还要求 INSERT 的 sequence 与 epoch 必须等于当前 workspace 状态行，应用无法绕过服务制造缺口、倒退或旧 epoch change。两个 ledger 表的 UPDATE trigger 禁止事后改写；DELETE 只留给 workspace 数据删除与后续受控 retention 事务。

## 事务消费约束

L2-003B 的 push use case 必须在一次数据库事务中执行以下顺序：

1. 服务端重新验证会话、设备未撤销、active membership 与写权限；
2. 锁定 workspace sync state；
3. 查询并分类 operation 重放；
4. 非重放时调用真实领域 use case，校验 base version 和状态机；
5. 追加 processed/change/audit；
6. 一次 commit。任何失败全部 rollback。

禁止先提交领域对象再补写账本，也禁止把客户端 workspace 授权结论、server version、sequence 或 epoch 当作可信输入。当前账本不记录 Cookie、Token、CSRF、异常正文或日志文案；change Payload 属于私有 workspace 数据，只能通过后续授权后的 sync API 读取。

## 迁移与恢复

`0009_sync_ledger` 在尚无同步生产数据时支持 downgrade。开始写入真实 operation 后，迁移视为不可变；应用回滚必须保持表可读，结构修复使用新 revision。提升 epoch、change retention 与备份恢复演练在 L2-003C/Phase 2 集成审计完成。
