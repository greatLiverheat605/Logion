# 任务与学习会话同步适配器

状态：L3-002B 实现基线

## 支持的操作

| 实体            | 操作     | 服务端行为                                    |
| --------------- | -------- | --------------------------------------------- |
| `task`          | `create` | 校验完整创建 DTO，并创建 backlog/planned 任务 |
| `task`          | `update` | 仅按预期版本执行允许的状态机转换              |
| `study_session` | `create` | 仅当关联任务为 `in_progress` 时开始会话       |
| `study_session` | `update` | 完成或放弃活动会话，但不自动完成任务          |

每个已应用操作在同一事务内写入领域记录、已处理操作身份、变更账本和最小化隐私的审计事件。重放返回原序列和服务端版本；不支持、畸形或未授权操作失败关闭。

## 离线因果链

用户可离线创建任务并在收到服务端版本前转换状态，也可用同样方式开始/结束会话。此类更新的 `base_version = 0`，必须依赖同一 Workspace、device、entity type 和 entity ID 的已处理前序操作。服务端只能通过这一明确因果前序解析当前版本，无前序则拒绝。

开始会话绝不能隐式改变任务。离线客户端先将任务转换为 `in_progress` 入队，再让会话创建依赖该操作。

## 冲突与可见性

- 过期任务/会话更新返回明确 `status` 冲突，包含已授权远端版本及允许方案，不作为已应用变更追加。
- 浏览器将受保护冲突载荷存入 `vaultRecords`，冲突行只含 `encrypted_payload_ref`。
- Pull/Bootstrap 只投影可见 Shared Space 或当前用户拥有的 Private Space 中的任务与会话。
- Pull cursor 可跨过不可见私人变更；客户端接受严格递增但不要求连续的可见序号。

## 受保护本地数据

任务和会话载荷在进入 IndexedDB 前加密，实体/Outbox 行只含加密引用和哈希。明文仅在同步传输与 React 渲染时短暂解密。任务描述、会话反思和远端冲突正文不得进入实体、Outbox、冲突、遥测或审计元数据。

## 兼容与恢复

迁移 `0012_session_sync_fields` 从 `created_by` 回填 `updated_by`、增加 `deleted_at`，再强制更新者外键。`sync-v1` 框架不变，API 开始发送已定义的冲突结果。epoch 不匹配仍隔离 Outbox，并要求新的原子 Bootstrap 后才可 Push。
