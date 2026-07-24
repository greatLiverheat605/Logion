# Phase 3 受保护离线载荷

Phase 3 的目标描述、结果、阶段标准、笔记、资料和证据可能泄露私人学习/研究上下文，不能以明文保存在 IndexedDB 实体、Outbox、Bootstrap staging 或 Pull 记录中。

`ProtectedOfflineRepository` 先将完整载荷封存到 `vaultRecords`，再原子提交实体/Outbox。这些运行记录只含不透明 `encrypted_payload_ref`；payload Hash 仍是明文载荷的 RFC 8785 Hash。覆盖 Vault 前先验证重复 operation，载荷变化的重放不能破坏原加密数据。

`SyncClient` 要求 Vault 已解锁，并只在传输前短暂补全受保护 Outbox 操作；绝不将明文写回实体或 Outbox。受保护 Pull 变更在实体/cursor 事务前封存。崩溃后重放页面是安全的，只替换同一实体引用的密文。

`BootstrapRepository` 根据收到的明文响应验证 record/chunk/snapshot Hash，再封存受保护记录后暂存。Vault 缺失或锁定时 Bootstrap 失败关闭。服务端仍是加密传输边界内的可信端点，依然要求 TLS 及认证租户/Space 授权。

Vault 使用 AES-256-GCM、Workspace/record AAD 及 PBKDF2-SHA-256 派生的不可导出内存密钥。关闭已认证规划组件会丢弃数据库和 Vault 引用。网络失败时离线操作保持 pending，用户重新解锁后才恢复。
