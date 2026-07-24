# IndexedDB v4 附件授权交接

Schema v4 保留全部 v3 store 和索引，并增加离线附件通过服务端协议出队所需授权元数据：`space_id`、`target_type`、`target_id` 和最后服务端版本。保存 Blob 前必须校验所有 UUID。

旧 v3 附件行没有目标 Space/对象。前向迁移保留 Blob，但将该行改为 `failed` 和 `OFFLINE_ATTACHMENT_METADATA_REQUIRED`；不得上传、猜测、删除或静默附到其他位置。UI 可以提供导出/移除，但用户创建完整限定的新队列项前禁止自动重试。

上传 worker 按以下顺序处理一个 pending 项：

1. 携带元数据、大小和客户端 SHA-256 发起已认证 `init`；
2. 以有界二进制 `PUT` 上传 Blob；
3. 使用上传响应版本调用 `complete`；
4. 保留 `verified` 和服务端版本，或稳定、脱敏的失败码。

IndexedDB 不保存网络异常详情和响应正文。当前格式条目失败后必须由用户明确重试。禁止 schema 降级；不兼容客户端必须进入升级/重新 Bootstrap 流程，不能盲目重放附件行。
