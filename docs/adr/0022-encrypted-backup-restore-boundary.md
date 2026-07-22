# ADR 0022: 服务器备份使用加密版本包，恢复必须在空环境提升 sync epoch

- 状态：Accepted
- 日期：2026-07-23
- 范围：Phase 5 / L5-023

## 决策

Backup 容器每天生成 PostgreSQL custom dump 和附件树，并与应用版本、Alembic head、非秘密 key ID、时间和恢复语义组成 `logion-backup-v1` tar.gz。完整 bundle 使用 secret file 提供的 AES-256-GCM key 流式加密，密文原子落盘并生成 SHA-256 sidecar。镜像、Compose 环境、数据库、日志和 manifest 均不保存 key。

验证顺序固定为密文 checksum、GCM tag、archive member allowlist、manifest schema、`pg_restore --list`。恢复 helper 只接受空数据库和 `/tmp`/`/restore` 下的空附件目录；恢复后强制为每个 workspace 生成新 `sync_epoch`，再输出机器可读计数/manifest 报告。Nightly 在空数据库中验证迁移版本、tenant 数、附件内容和 epoch 改变。

## 理由

只验证 `pg_restore --list` 无法证明附件、版本或客户端恢复语义完整；未加密 dump 会把正文和服务端加密元数据暴露给卷或备份管理员。恢复后沿用旧 epoch 会允许旧客户端把灾难点之后的 Outbox 直接重放到恢复数据。

## 后果

- 本机 backup volume 仍不是异地灾备；正式发布前必须配置独立账户/区域的 immutable copy 和告警。
- 所有业务 keyring 需要单独 escrow，数据库备份不会包含运行时 secret 明文。
- 附件生产卷的最终 promotion 故意不自动化，必须在人工批准、停写和已验证 rehearsal 后执行。
