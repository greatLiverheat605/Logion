# ADR 0019: 数据导出使用后台任务、版本化开放格式与独立信封加密

- 状态：Accepted
- 日期：2026-07-22
- 范围：Phase 5 / L5-020

## 决策

用户从任一有效 workspace 成员关系发起“本人有权读取内容”的导出。服务端先解析 workspace 和 Space 权限：共享 Space 可导出，私有 Space 仅 owner 可导出；带 `user_id` 的备考、复习、自学和研究对象仅导出当前请求者记录。成员、邀请、凭据、会话、恢复材料、Provider 配置、AI 输入、分享/日历令牌和附件二进制不进入数据包。

导出由 PostgreSQL 持久队列和 worker 异步生成。ZIP 同时包含 `manifest.json`、版本化 `data.json`、笔记 Markdown、任务 CSV 和论文 BibTeX。产物先计算 SHA-256，再使用独立于 AI/TOTP/邮件密钥的 AES-256-GCM keyring 加密；AAD 绑定 workspace、job 和 key ID。数据库保存密文、nonce、key ID、摘要和到期时间，下载时重新授权、解密并校验摘要。

产物默认 24 小时到期，响应使用 `private, no-store`、`nosniff` 和 attachment disposition。创建、成功和取消进入审计，但审计不保存正文、产物或密钥。

## 理由

大型 workspace 无法安全地在请求线程内导出。单一 JSON 虽适合机器迁移，却不满足用户脱离 Logion 后直接阅读笔记、任务和文献的需求。独立 keyring 避免跨用途密钥复用，并允许保留旧 key 解密短期产物后再轮换。

## 后果

- 导出是权限时点快照；后续修改不改变已生成包，但到期或取消后服务端不再提供下载。
- 附件二进制暂不进入可移植包，资源索引仍包含文件名、页索引与 SHA-256；附件对象存储导出属于后续容量工作包。
- `logion-export-v1` 只能以向后兼容方式扩展；破坏性变更使用新 schema version 和迁移适配器。
- 导入必须先预览、重新校验 schema，并生成新 ID；不能直接恢复导出中的权限或原始 ID。
