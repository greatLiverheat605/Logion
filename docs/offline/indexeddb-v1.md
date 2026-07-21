# IndexedDB v1 与 Outbox 事务说明

- 工作包：`L2-001A`
- 实现：`packages/offline`
- 输入合同：`sync-v1`（main `63203e8`）

> 本文保留不可变的 v1 历史定义。当前应用 schema 为 v2；Bootstrap 行为见 `docs/offline/indexeddb-v2-bootstrap.md`。

## Schema v1

| Store       | 主键                                   | 主要索引                                                            | 责任                                         |
| ----------- | -------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| `entities`  | `[workspace_id+entity_type+entity_id]` | workspace、workspace/type、workspace/sync_status                    | 当前设备的本地业务副本                       |
| `outbox`    | `operation_id`                         | workspace、workspace/device、workspace/state/time、workspace/entity | 待同步 operation、依赖、重试状态和最小错误码 |
| `syncState` | `workspace_id`                         | device、bootstrap_state                                             | epoch、cursor、bootstrap 与隔离状态          |

数据库按 User UUID 分库，名称不含邮箱或用户输入文案。同一浏览器设备的每个 workspace 仍由复合键与查询上下文隔离。`packages/offline` 只依赖 `packages/contracts`，页面不能直接操作 Dexie Table。

## 原子写流程

1. 在事务外校验 UUID、时间、操作类型、JSON 深度/节点/字段和 Payload 字节上限；
2. 按 RFC 8785 canonical JSON 计算 SHA-256；
3. 开启覆盖 `entities + outbox` 的单一 `rw` 事务；
4. 同 operation ID 检查幂等或 Hash/元数据篡改；
5. 校验 entity 的 server base version、本地 revision 和 create/update/delete/restore 状态；
6. 自动把同实体上一个未完成 operation 加为依赖；
7. 写实体并写 Outbox；任一步失败回滚两张表。

待发送查询同时要求 workspace 与 device 匹配，只返回 `pending`。依赖处于 blocked、conflict、in-flight 或 isolated 时，后继 operation 不进入发送批次；同批 pending operation 使用拓扑顺序。

## 兼容与恢复

- 新建数据库从 v1 开始；反复 open/reopen 不改变数据；
- 旧代码发现 native IndexedDB 版本高于当前 Dexie v1 时返回 `OFFLINE_SCHEMA_UPGRADE_REQUIRED`，不删除、不降级写入；
- IndexedDB 不可用、配额、版本和普通事务错误映射为不含 Payload 的稳定错误码；
- 当前尚无生产 IndexedDB 数据，预发布回滚可删除数据库。产生真实用户数据后，删除数据库不再是回滚方案，必须以 v2+ 升级、只读导出或前向修复处理；
- `syncState` 的 bootstrap/epoch/cursor 事务语义将在 L2-002 实现，不得由页面自行更新。

## L2-002 交接

L2-002A 已通过新增 staging store 和 IndexedDB v2 实现 chunk 下载、恢复与原子快照切换，并覆盖从 v1 升级、升级中断、配额不足、重新打开、旧应用预检 v2 和 epoch Outbox 隔离。v1 历史 schema 未改写。
