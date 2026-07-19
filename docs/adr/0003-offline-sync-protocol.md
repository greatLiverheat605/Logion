# ADR-0003：离线优先同步协议

- 状态：Accepted
- 日期：2026-07-19
- 决策人：Logion project owner

## 背景

所有核心任务、资料和笔记必须完整离线编辑并跨设备同步。普通请求缓存无法保证崩溃恢复、幂等、冲突可见和服务器恢复后的数据安全。

## 决策

客户端以 IndexedDB 为本地权威副本。业务变更与 Outbox operation 在同一本地事务提交。服务端 push 按 `operation_id + payload_hash` 幂等，在同一数据库事务写业务记录、幂等记录、变更日志和审计。

Pull 使用 `(sync_epoch, cursor)`；bootstrap 使用版本化、带校验和的快照并原子切换。服务器恢复或日志截断提升 epoch，旧 Outbox 隔离等待导出/人工处理。关键状态、删除、层级、权限和验收冲突必须人工确认；文本协作可使用 Yjs 更新流，但保留可读 Markdown 快照。

## 后果

- `packages/contracts` 维护协议版本、operation 和错误 schema；
- IndexedDB schema 与服务器协议分别版本化并建立兼容矩阵；
- Phase 2 必须验证重复、乱序、断线、部分成功、崩溃、旧 cursor 与双设备冲突；
- 不支持的旧客户端必须明确进入 upgrade/re-bootstrap 状态，不能静默运行。
