# sync-v1 兼容性与失败处理矩阵

- 工作包：`L2-000A`
- 权威机器契约：`packages/contracts/schemas/sync-v1.schema.json`
- 本文用途：记录实现与测试必须遵守的兼容行为；不扩充两份根目录基线。

## 不变量

1. 客户端在 bootstrap、push、pull 前比较 `protocol_version`、`min_supported_version`、`sync_epoch`；未知版本或枚举失败关闭。
2. 业务对象与 Outbox 必须在同一 IndexedDB 事务写入；网络失败不能撤销本地成功。
3. Push 以 `operation_id + payload_hash` 幂等。同 ID、同 Hash 返回 `duplicate`；同 ID、不同 Hash 必须拒绝并产生安全审计。
4. Pull 的 `sequence` 在 workspace/epoch 内严格递增，`next_cursor` 不得倒退；分页应用和 cursor 更新必须同一本地事务提交。
5. Tombstone 不能携带业务正文；关键状态、层级、删除、权限和验收冲突不能采用最后写入获胜。
6. epoch 改变或 cursor 过期时停止 push，将旧 Outbox 隔离为可导出数据，然后重新 bootstrap；不得把旧操作自动重放到恢复后的服务器。
7. Snapshot 必须先完整下载并验证 `snapshot_checksum`，再通过单次本地事务切换；失败时保留上一个可读快照。
8. Bootstrap 以最多 1000 条记录的固定快照 chunk 传输；客户端逐块验证 `chunk_checksum`，且只在全部 chunk 与总 Hash 通过后切换。
9. Push 外层与每个 operation 的 `workspace_id/device_id` 必须完全一致；每个输入 operation 必须产生且只产生一个同序结果，依赖不能指向自身。
10. 冲突响应返回远端版本与 Hash；本地版本继续保留在 Outbox。解决冲突必须携带 `conflict_resolution` 和 `expected_remote_version`，版本再次变化时生成新冲突而不是覆盖。
11. Operation、批次和 snapshot chunk 在读取完整正文前执行传输字节上限；默认建议分别为 256 KiB、4 MiB、4 MiB，且不能超过 capabilities 契约上限。Payload 最大嵌套深度为 20；超限明确拒绝，不能截断后计算 Hash。
12. `payload_hash`、`chunk_checksum` 和 `snapshot_checksum` 均为 RFC 8785 JSON Canonicalization Scheme 字节的 SHA-256；实现不得依赖对象键顺序或平台序列化差异。
13. Bootstrap 首次请求的 `snapshot_id/chunk_index` 必须同时为 null，续传时必须同时非 null；响应还必须满足 `chunk_index < chunk_count`。传输层在 schema 校验后执行这些跨字段不变量。

## 校验和 framing（规范性）

所有 Hash 均对 RFC 8785 规范化结果的 UTF-8 字节计算 SHA-256，并编码为小写 `sha256:<64 hex>`：

- `payload_hash = SHA-256(JCS(payload))`；
- `chunk_checksum = SHA-256(JCS(records))`，其中 `records` 是该响应的数组，顺序保持服务端快照顺序；
- `snapshot_checksum = SHA-256(JCS({"chunks":[{"chunk_index":0,"chunk_checksum":"..."}, ...]}))`。`chunks` 必须按 `chunk_index` 严格升序，从 0 开始、无重复、无缺口，长度必须等于 `chunk_count`。

总 Hash 使用有序 chunk manifest，而不是再次拼接全部记录；因此客户端可逐块校验并在内存有界的情况下验证完整快照。任何 chunk 顺序变化、缺失、重复或内容变化都会改变总 Hash。相同实体键在同一快照内出现多次仍是协议错误，不能依靠后出现记录覆盖。

权威测试向量位于 `packages/contracts/fixtures/sync-v1-checksum-vectors.json`。实现必须同时核对规范化字节和最终 Hash；不得只对供应方给出的 Hash 字符串做格式校验。

## 兼容矩阵

| 场景                               | 服务端响应/本地动作                                    | 是否允许自动继续 |
| ---------------------------------- | ------------------------------------------------------ | ---------------- |
| 当前客户端 `sync-v1` ↔ 当前服务端  | 正常 bootstrap/push/pull                               | 是               |
| 客户端低于 `min_supported_version` | `upgrade_required / PROTOCOL_UNSUPPORTED`              | 否               |
| 客户端发送未知协议或枚举           | schema/transport 拒绝并记录最小审计                    | 否               |
| 服务端返回客户端未知枚举           | 客户端进入升级阻断态，不猜测含义                       | 否               |
| `sync_epoch` 不一致                | `rebootstrap_required / EPOCH_MISMATCH`；隔离 Outbox   | 否               |
| cursor 已被截断                    | `cursor_expired / CURSOR_EXPIRED`；重新 bootstrap      | 否               |
| 重复 operation ID + 相同 Hash      | 返回 `duplicate` 和原 `server_version/sequence`        | 是               |
| 重复 operation ID + 不同 Hash      | `rejected / SYNC_OPERATION_HASH_MISMATCH`              | 否               |
| operation 乱序但依赖已满足         | 可独立处理，结果按请求逐项返回                         | 是               |
| 依赖缺失或冲突                     | `blocked_dependency`，保留 Outbox                      | 仅重试可重试项   |
| 批次部分成功                       | 删除 applied/duplicate；保留 rejected/conflict/blocked | 是，不重放成功项 |
| Pull 重复页面                      | 按 `sequence` 幂等忽略已应用变化                       | 是               |
| Pull sequence 跳跃/倒退            | 停止应用并重新拉取；持续异常则 bootstrap               | 否               |
| Snapshot 校验失败或本地配额不足    | 不切换快照，保留旧数据并显示恢复动作                   | 否               |
| 应用在事务提交前崩溃               | 业务数据、Outbox/cursor 均不发生部分提交               | 重启后重试       |
| 旧应用打开新 IndexedDB schema      | 明确升级阻断或只读导出，禁止降级写入                   | 否               |

## 版本策略

`sync-v1` 是严格冻结契约；由于客户端拒绝未声明字段，服务端不得向 v1 响应添加字段或枚举。任何字段增删、required 变化、Hash/幂等/cursor/epoch 语义变化或枚举扩展均需要新协议版本和双版本迁移窗口。Snapshot schema 与传输协议独立版本化。

## 后续消费者

- `L2-001`：IndexedDB v1、repository 与 Outbox 原子事务；
- `L2-002`：bootstrap 下载、Hash 校验、原子切换和 epoch 隔离；
- `L2-003`：服务端幂等表、change log、push/pull 和租户负测；
- `L2-004`：冲突状态机、用户解决流程、附件队列与同步状态 UI。
