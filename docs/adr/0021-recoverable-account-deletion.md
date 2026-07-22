# ADR 0021: 账户删除采用立即撤权、受限恢复会话与延期去标识化清理

- 状态：Accepted
- 日期：2026-07-23
- 范围：Phase 5 / L5-022

## 决策

账户删除需要 recent authentication、CSRF、独立限流和精确短语 `DELETE MY ACCOUNT`。若用户仍是有其他 active 成员的 workspace Owner，请求以稳定 409 阻止，必须先转移所有权；只有该用户一名 active 成员的 workspace 记录为随账户清理的 workspace。

请求成功后立即把用户置为 `pending_deletion`，撤销全部既有 session、refresh token、设备、公开分享和日历 feed，并请求取消仍在执行的 AI run。默认宽限期 14 天，由配置限制在 1–30 天。pending 用户可以通过原密码/TOTP/恢复码或 Passkey 建立“受限恢复会话”：普通认证依赖仍只接受 active 用户，只有账户删除状态和取消端点接受 pending 用户。取消需要 recent auth、CSRF、version 和 `KEEP MY ACCOUNT`，成功后恢复 active；新恢复会话随即成为正常会话。

宽限期到期后 worker 删除无人协作的自有 workspace、用户私有 Space、个人备考/复习/自学/研究数据、会话凭据、通知、导入导出产物，并清除用户 AI 输入、草稿与终态运行。共享 workspace 中作为团队记录保留的贡献仍引用同一不可登录用户 ID；用户邮箱替换为用途域哈希生成的无效域 pseudonym，状态改为 deleted。最小审计保留但 actor 和 user target 被置空，metadata 收敛为保留原因。

## 理由

立即物理删除会使误操作不可恢复，也可能遗留 workspace 无 Owner。仅停用账户却保留 bearer link 和 session 不满足撤权。受限恢复会话允许用户在既有登录安全控制下取消，同时避免 pending 用户继续访问学习正文。

## 后果

- 共享内容的所有权和法律保留政策必须在隐私说明中清楚表述；当前实现保留去标识化 actor ID，不保留可登录身份和私人 Space。
- 备份中的历史副本按备份保留期自然过期；系统不能声称请求完成时已从所有备份即时擦除。
- 生产上线前必须由法律/隐私负责人确认 14 天默认宽限期、审计最小保留范围和共享贡献处理规则。
