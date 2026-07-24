# IndexedDB v3 韧性、本地保险箱与残留数据

Schema v3 新增持久化的 `conflicts`、`attachmentQueue`、`vaultMetadata` 和 `vaultRecords` store，不重写 v1 实体/Outbox 或 v2 Bootstrap 暂存数据。升级中断仍由 IndexedDB version-change 事务处理。

冲突会保留本地和远端载荷，直到用户明确保留本地、保留远端、合并或忽略。解决方案和实体同步状态在同一事务中改变。忽略会有意保留实体的冲突标记，不能构成静默获胜。

附件在启用上传前作为本地 Blob 保存。队列拒绝路径分隔符、MIME/扩展名不匹配、空文件、不支持类型及超过 20 MB 的文件，并记录 SHA-256。服务端上传与验证由后续适配器实现；只有 `verified` 附件可成为正式证据。

未来受保护的笔记/研究载荷使用 `OfflineVault`：PBKDF2-SHA-256（310,000 次）从本地口令派生不可导出的 AES-256-GCM 密钥；每条记录使用随机 96 位 IV 和 Workspace/record AAD。密钥只在内存中，锁定时丢弃。Phase 2 同步的 Space 只含名称/可见性元数据；Phase 3 敏感实体正文必须进入 `vaultRecords`，禁止以明文写入 `entities.payload`。

注销和设备撤销无法可靠远程擦除离线浏览器，UI 必须明确提示残留数据风险。撤销设备保持本地锁定。在共享设备上，`wipeLocalData()` 以单个 IndexedDB 事务清除 Vault 密钥、加密记录、实体、Outbox、冲突和附件 Blob；该破坏性操作必须由用户选择。

回滚只能前向处理：旧客户端检测到 schema v3 后必须进入升级要求，不能打开或降级数据库。恢复方式是安装兼容客户端后从服务端 Bootstrap。
