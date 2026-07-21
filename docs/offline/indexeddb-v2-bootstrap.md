# IndexedDB v2 Bootstrap 快照

- 工作包：`L2-002A`
- 实现：`packages/offline`
- 输入契约：`sync-v1`（main `166ea19`）

## Schema v2

v2 只新增 store，不改写已进入主线的 v1 定义：

| Store                | 主键                                                           | 主要索引                                       | 责任                                                  |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `bootstrapManifests` | `[workspace_id+snapshot_id]`                                   | workspace、workspace/status                    | 固定设备、epoch、cursor、总 Hash、已接收 chunk 与进度 |
| `bootstrapRecords`   | `[workspace_id+snapshot_id+chunk_index+entity_type+entity_id]` | snapshot、snapshot/chunk、唯一 snapshot/entity | 尚未激活的快照记录及原始顺序                          |

`entities`、`outbox`、`syncState` 的 v1 store 定义在 v2 中原样保留。旧 v1 数据库升级只创建两个 staging store；升级事务中断时浏览器保留 v1。native 版本高于应用支持版本时继续返回 `OFFLINE_SCHEMA_UPGRADE_REQUIRED`，不删除或降级写入。

## 校验与激活流程

1. 调用方传入期望的 `workspace_id/device_id`；运行时校验器先拒绝未知版本、字段、枚举和错误格式。
2. 再校验 context、UUID、`chunk_index < chunk_count`、Payload 的有限 JSON 约束以及 chunk 内实体唯一性。
3. 先对完整 `records` 计算 L2-000C 的 RFC 8785 chunk Hash 和字节上限，再并行核对每条记录的 `payload_hash`，避免在超大输入上放大计算。
4. 单个 `rw` 事务核对 manifest 元数据、同 chunk 重放和跨 chunk 实体唯一性，然后只写 staging。相同 Hash 重放幂等返回进度；不同 Hash 或元数据失败关闭。
5. 所有 chunk 齐全且索引无缺口后，对有序 chunk manifest 计算 `snapshot_checksum`。
6. 最终事务同时替换当前 workspace 的可见实体、更新 cursor/epoch、隔离失效 Outbox、标记 manifest 完成并删除 staging records。任一步失败会回滚整个最终 chunk 和切换，旧快照保持可读。

成功完成后保留不含正文的 complete manifest，用于识别重复响应；下一份快照完成时清理旧 complete manifest。中断下载可通过 `getProgress` 恢复；服务器换发 snapshot 时，调用方必须用匹配 workspace/device/snapshot 的 `discardStaging` 显式丢弃旧 staging，不能由任意响应静默清除。

## 本地编辑与 epoch

- 同一 epoch 重新 bootstrap 时，`pending/conflict` 本地实体作为 overlay 保留，服务器快照只替换 clean 实体；原 Outbox 继续作为版本冲突的权威依据。
- epoch 改变意味着旧 operation 不再能安全重放。最终切换在同一事务中把当前 workspace/device 的 Outbox 标为 `isolated / SYNC_EPOCH_MISMATCH`，不保留旧本地 overlay，改为显示已验证的服务器快照。
- 隔离 operation 仍保留 Payload，供后续冲突中心导出或人工处理；不得自动重放到新 epoch。

## 错误、恢复与回滚

公开错误只序列化 `code/retryable`，不包含记录、Payload、AJV 参数、数据库 cause 或远端原始消息。验证、Hash、重复实体和 context 错误不可重试同一坏数据；配额或普通事务错误可在释放空间后重试。

当前尚无产品 UI 消费 v2。首个真实用户版本发布后不得用删除数据库回滚；v2 迁移和 store 定义保持不可变，修复必须新增 v3 前向迁移或提供只读导出。真实浏览器配额、Safari/iOS PWA 和进程级崩溃注入仍在 Phase 2 集成审计中验证。
