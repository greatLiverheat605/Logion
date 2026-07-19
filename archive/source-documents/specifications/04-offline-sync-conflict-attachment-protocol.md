# 研途 Lab 离线同步、冲突与附件协议

> 协议版本：sync-v1  
> 目标：保证多设备、长时间离线和网络重试情况下不丢失用户数据。

---

## 1. 不变量

1. 用户写入先成功落本地，再等待网络同步；
2. 网络错误不得删除本地变更；
3. 同一操作重复提交不得产生重复副作用；
4. 服务端不得静默覆盖冲突内容；
5. 删除必须作为 tombstone 同步；
6. 笔记正文合并不能依赖最后写入覆盖；
7. 附件只有服务端校验完成后才算云端可用；
8. 服务端业务写入、变更日志和幂等记录必须同事务；
9. 客户端必须能解释当前同步状态；
10. 所有冲突解决都可审计。

---

## 2. 客户端状态

### 2.1 全局同步状态

```text
initializing
online_synced
online_pending
offline_clean
offline_pending
syncing
conflict
error
auth_required
```

### 2.2 实体同步状态

```text
synced
pending_create
pending_update
pending_delete
conflict
failed_retryable
failed_permanent
```

### 2.3 附件本地状态

```text
local_only
queued
initializing_upload
uploading
uploaded_unverified
verified
failed_retryable
failed_permanent
```

---

## 3. 标识与时间

### 3.1 ID

- 客户端和服务端均使用 UUIDv7；
- 离线创建实体时由客户端生成；
- 服务端接受客户端 ID，但验证格式、工作区和唯一性；
- 关联对象可以在同一批同步中引用尚未上传的客户端 ID。

### 3.2 时间

- 客户端记录 `client_occurred_at`；
- 服务端记录 `server_received_at`；
- 排序和审计优先使用服务端 sequence，不信任客户端时钟决定安全顺序；
- 学习计时仍保留客户端时间，因为它描述实际学习活动；
- 服务端检测明显未来时间、负时长和跨设备重叠。

### 3.3 版本

- 每个结构化实体有 `version`；
- 创建成功为 1；
- 每次服务端业务更新加 1；
- 客户端操作携带 `base_version`；
- CRDT 正文不使用单一整数版本判断合并，但笔记元数据仍使用 `version`。

---

## 4. 本地事务

每次本地写操作在一个 IndexedDB 事务中完成：

1. 读取现有实体；
2. 应用本地修改；
3. 增加 `local_version`；
4. 设置同步状态；
5. 写入 Outbox；
6. 写本地活动日志；
7. 提交事务。

如果 Outbox 写入失败，则业务实体修改也必须失败，避免出现永远无法同步的孤立修改。

---

## 5. Outbox 协议

### 5.1 操作结构

```json
{
  "operation_id": "019...",
  "protocol_version": "sync-v1",
  "workspace_id": "019...",
  "device_id": "019...",
  "entity_type": "task",
  "entity_id": "019...",
  "operation_type": "update",
  "base_version": 4,
  "client_occurred_at": "2026-07-20T10:30:00+08:00",
  "dependencies": [],
  "payload": {
    "title": "NumPy 广播练习",
    "status": "in_progress"
  },
  "payload_hash": "sha256..."
}
```

### 5.2 操作合并

客户端可以在尚未发送时合并同一实体的连续普通更新：

- create + update → 一个 create；
- 多个 update → 保留最后字段值，但保留本地历史；
- create + delete → 可取消上传，除非已产生被其他对象引用的事件；
- append_event 不合并；
- crdt_update 可按 Yjs 规则合并；
- 附件状态操作不与业务实体更新混合。

### 5.3 操作依赖

例如证据引用新附件时：

```text
attachment.create
attachment.upload.complete
evidence.create depends_on attachment.complete
verification.create depends_on evidence.create
```

服务端批处理支持依赖拓扑排序。依赖失败时后续操作返回 `blocked_by_dependency`，保留在 Outbox。

---

## 6. Push API

### 6.1 请求

`POST /api/v1/sync/push`

```json
{
  "protocol_version": "sync-v1",
  "device_id": "019...",
  "operations": [],
  "client_cursor": 1288
}
```

限制建议：

- 单批最多 100 个操作；
- 未压缩请求体最多 2 MB；
- CRDT 和附件使用独立接口；
- 客户端按创建顺序发送，但服务端仍检查依赖。

### 6.2 结果

```json
{
  "server_time": "...",
  "results": [
    {
      "operation_id": "019...",
      "status": "applied",
      "entity_id": "019...",
      "entity_version": 5,
      "change_sequence": 1290
    }
  ],
  "next_pull_cursor_hint": 1290
}
```

### 6.3 幂等

服务端以 `operation_id` 为幂等键：

- 第一次处理后保存请求哈希和结果；
- 相同 ID、相同哈希返回原结果；
- 相同 ID、不同哈希返回安全错误；
- 幂等记录保留时间不得短于最长离线与重试窗口；长期个人系统建议永久或至少保留 2 年。

---

## 7. Pull API

### 7.1 请求

`GET /api/v1/sync/pull?cursor=1288&limit=500`

### 7.2 响应

```json
{
  "from_cursor": 1288,
  "next_cursor": 1320,
  "has_more": false,
  "changes": [
    {
      "sequence": 1289,
      "entity_type": "task",
      "entity_id": "019...",
      "operation_type": "update",
      "entity_version": 5,
      "origin_device_id": "019...",
      "changed_at": "...",
      "entity": {}
    }
  ]
}
```

### 7.3 Cursor 规则

- Cursor 是工作区变更日志序号；
- 客户端仅在本批所有变更成功写入本地事务后更新 cursor；
- 中途失败使用旧 cursor 重试；
- 重复变更通过 entity version 和 sequence 安全忽略；
- 服务端若已清理过旧日志，返回 `snapshot_required`。

---

## 8. 首次同步与快照

### 8.1 Bootstrap

`GET /api/v1/sync/bootstrap`

返回：

- workspace 元数据；
- schema 版本；
- 当前 change cursor；
- 分页快照 token；
- 服务器能力；
- 客户端最低版本。

### 8.2 快照顺序

建议按依赖顺序下载：

1. workspace/settings；
2. plans/phases/topics；
3. tasks/resources；
4. notes metadata 和 CRDT snapshot；
5. reviews/quizzes；
6. papers/research/experiments；
7. 附件元数据；
8. 审计摘要，不下载全部安全日志；
9. 记录最终 cursor。

### 8.3 原子切换

快照写入临时本地数据库或临时版本空间。全部校验通过后切换为当前工作副本，防止首次同步中断留下不完整数据。

---

## 9. 结构化实体冲突

### 9.1 冲突条件

当 `base_version != server_version` 时：

1. 读取 base 快照（若可用）；
2. 比较本地修改字段和服务端修改字段；
3. 若字段不相交且业务允许，则自动合并；
4. 若字段相交或属于禁止自动合并字段，创建冲突；
5. 返回 `conflict` 和脱敏后的服务端内容。

### 9.2 自动合并字段

允许：

- 标签集合；
- 不同的说明字段；
- 新增关联；
- 追加事件；
- 不相交的普通元数据字段。

禁止：

- 任务状态；
- 验收结论；
- 掌握度确认；
- 计划和阶段日期；
- 阶段门槛；
- 实验结论；
- Provider URL/密钥；
- 永久删除。

### 9.3 冲突对象

```json
{
  "conflict_id": "019...",
  "entity_type": "task",
  "entity_id": "019...",
  "base_version": 5,
  "server_version": 7,
  "local_changes": {},
  "server_entity": {},
  "auto_merge_candidate": null,
  "conflicting_fields": ["status"],
  "created_at": "..."
}
```

### 9.4 解决方式

```text
use_local
use_server
merge_manual
cancel_local_operation
```

`use_local` 不是直接覆盖：服务端基于当前版本创建一个新更新并记录“用户选择本地版本”。

---

## 10. 笔记 CRDT 协议

### 10.1 分层

- 标题、敏感标记和关联：结构化实体版本；
- Markdown 正文：Yjs 文本文档；
- 可读历史：Markdown snapshot；
- 同步单元：Yjs update 和 state vector。

### 10.2 客户端更新

每个设备为每篇笔记维护：

- `client_id`；
- 本地 clock；
- state vector；
- 未上传 updates；
- 最近服务端 snapshot id。

### 10.3 服务端接口

```text
GET  /notes/{id}/snapshot
GET  /notes/{id}/updates?state_vector=...
POST /notes/{id}/updates
```

### 10.4 压缩

当 updates 数量或字节超过阈值：

1. 后台加载 snapshot 与 updates；
2. 生成新 CRDT state 和 Markdown snapshot；
3. 写 `note_version`；
4. 更新压缩游标；
5. 等待所有活跃设备确认超过游标；
6. 备份完成后清理旧 updates。

### 10.5 CRDT 不解决的问题

CRDT 只保证文本更新合并，不保证语义正确。两台设备可能把同一段改成逻辑冲突内容。系统应提供版本对比和关键笔记手动检查，而不是宣称“无冲突”。

---

## 11. 删除与恢复

### 11.1 软删除

- 客户端删除产生 `delete` 操作；
- 服务端写 `deleted_at` 并增加版本；
- change log 发送 tombstone；
- 其他设备删除本地可见副本，但保留 tombstone；
- 垃圾箱期限内可以 `restore`。

### 11.2 删除冲突

- 一台设备删除、另一台设备更新：创建冲突；
- 默认不自动复活，也不自动丢弃更新；
- 用户选择保留删除、恢复并应用更新或复制为新实体。

---

## 12. 学习会话同步

学习会话采用事件追加：

- 每个 start/pause/resume/stop 有独立 ID；
- 重复事件按 ID 幂等；
- 客户端本地计算即时有效时长；
- 服务端根据事件重算；
- 不合法序列产生修复建议，不直接删除事件；
- 同一用户跨设备重叠超过阈值产生审查发现。

事件排序：

1. 客户端发生时间；
2. 相同时间按事件逻辑顺序；
3. 无法确定时标记需要审查。

---

## 13. 附件上传协议

### 13.1 本地创建

客户端计算：

- 文件名；
- 浏览器报告 MIME；
- 大小；
- SHA-256；
- 本地 attachment ID。

Blob 写 IndexedDB 后才显示“已保存到本设备”。

### 13.2 初始化

`POST /attachments/init`

```json
{
  "attachment_id": "019...",
  "filename": "result.png",
  "reported_media_type": "image/png",
  "size_bytes": 120034,
  "sha256": "..."
}
```

服务端返回：

- 已存在同哈希附件引用；或
- 上传会话和过期时间；
- 允许的最大大小；
- 上传方式。

### 13.3 上传

第一版文件较小，可使用单请求上传。接口必须支持幂等重试，上传写临时文件。

### 13.4 完成

`POST /attachments/{id}/complete`

服务端：

1. 读取临时文件；
2. 检查实际大小；
3. 检测 MIME；
4. 计算 SHA-256；
5. 应用允许列表；
6. 原子移动；
7. 更新状态；
8. 写 change log。

### 13.5 本地清理

客户端收到 `verified` 并再次从服务端变更确认后，才可根据策略清理本地 Blob。用户可以选择“保留离线附件”。

---

## 14. 认证过期与同步

- 离线期间本地解锁不代表 Access Token 有效；
- 联网后先刷新 Token；
- Refresh Token 失效时，暂停同步并要求在线认证；
- 本地 Outbox 保留；
- 用户重新认证后继续；
- 设备被撤销时服务端拒绝刷新和同步；
- 客户端锁定云端同步能力，但不得静默删除未导出的本地内容。

---

## 15. Schema 与客户端升级

### 15.1 版本

- 服务端返回 `sync_protocol_version`；
- 快照包含 `schema_version`；
- 客户端本地数据库使用迁移版本；
- 服务端可声明最低客户端版本。

### 15.2 升级流程

1. 暂停同步；
2. 确认本地数据库备份或回滚点；
3. 执行 IndexedDB 迁移；
4. 验证 Outbox 仍可解析；
5. 恢复同步；
6. 无法迁移时允许导出本地数据。

禁止通过清空 IndexedDB 解决正常升级问题。

---

## 16. 错误码

```text
SYNC_PROTOCOL_UNSUPPORTED
SNAPSHOT_REQUIRED
OPERATION_ID_REUSED
INVALID_BASE_VERSION
ENTITY_CONFLICT
DEPENDENCY_FAILED
DEVICE_REVOKED
AUTH_REFRESH_REQUIRED
ENTITY_NOT_FOUND
ENTITY_DELETED
WORKSPACE_MISMATCH
ATTACHMENT_TOO_LARGE
ATTACHMENT_HASH_MISMATCH
ATTACHMENT_TYPE_REJECTED
CRDT_UPDATE_INVALID
LOCAL_SCHEMA_OUTDATED
```

错误响应必须包含机器码、用户可理解说明、是否可重试和 request_id。

---

## 17. 测试矩阵

至少测试：

- 操作提交后响应丢失并重试；
- 同一操作重复 10 次；
- 批处理中间操作失败；
- 创建实体后立即离线删除；
- 两台设备同时修改不同字段；
- 两台设备同时修改任务状态；
- 删除与修改冲突；
- 两台设备编辑同一笔记；
- 1000 次 CRDT 更新后压缩；
- 手机时钟错误一天；
- Refresh Token 过期但 Outbox 非空；
- 附件上传到 99% 断网；
- 附件响应丢失后重试；
- 首次快照中断后恢复；
- 本地 schema 升级时 Outbox 非空；
- 服务端恢复备份后旧设备重新同步。
