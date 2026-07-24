# Sync v1 Pull、Bootstrap 与客户端循环

服务端在每个 Workspace 下提供已认证、受租户边界约束的 `pull` 和 `bootstrap` 端点。Pull 页面按 Workspace 序列排序并使用排他 cursor；epoch 不匹配和超出保留期的 cursor 返回明确控制信封，不能伪装成空页成功。

Bootstrap 根据 Workspace、epoch、head cursor 和 RFC 8785 checksum 生成确定性快照身份。每个 chunk 最多 100 条记录；chunk 校验和及框架快照校验和采用 `sync-v1-checksum-vectors.json` 中冻结的契约。快照变化时拒绝续传并要求重启，防止混合版本激活。

离线 `SyncClient` 按依赖顺序 Push Outbox 操作，以运行时同步 schema 验证每个响应，在 IndexedDB 事务内应用确认和 Pull 页，只在页面连续时推进 cursor。epoch、cursor 保留和协议控制会更新本地 Bootstrap 状态。远端变更绝不覆盖待发送本地实体，而是将实体标记为冲突，交由冲突中心处理。

当前 Bootstrap 已覆盖第一个真实同步实体适配器 `Space`。以后每个实体适配器必须在与其 Push 适配器相同的工作包中加入快照投影和测试。
