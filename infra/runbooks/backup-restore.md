# 备份与恢复操作手册

## 范围与产物

Backup 服务生成 `logion-TIMESTAMP-KEYID.backup`，这是一个 AES-256-GCM 加密包，包含：

- PostgreSQL custom-format dump；
- 服务端附件目录树；
- 版本化 manifest，记录应用版本、Alembic head、备份 key ID、时间戳和强制 `sync_epoch` 变更语义。

相邻 `.sha256` 校验密文字节，AES-GCM 验证解密包。备份密钥是 base64url 编码的随机 32 字节值，挂载到 `/run/secrets/logion_backup_key`，绝不能进入镜像、数据库、manifest、环境变量或日志。`LOGION_BACKUP_KEY_ID` 非秘密，只标识单独托管的密钥代际。

Compose volume 只是服务端恢复副本，不是最终灾备。Production 必须把不可变加密产物及 sidecar 复制到不同账户/区域并启用保留锁。TOTP、邮件、AI、导出和备份 keyring 均需分别托管；丢失全部代际将导致加密记录或备份不可恢复。

## 配置

1. 在仓库外生成密钥：`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`。
2. 存入密钥管理器，或仅 Owner 可读的 `./secrets/backup.key`，不得提交。
3. 将 `LOGION_BACKUP_SECRET_SOURCE` 指向宿主机文件，将 `LOGION_BACKUP_KEY_ID` 设为稳定代际标签。
4. 启动 Backup 服务。它先写临时密文，再原子重命名并写 checksum。
5. 确认异地复制和保留监控；本地 `LOGION_BACKUP_RETENTION_DAYS` 默认 14 天。

## 安全校验

选择操作员明确控制的精确路径，再执行：

```sh
docker compose exec -T backup logion-verify-backup /backups/logion-TIMESTAMP-KEYID.backup
```

校验包括密文 SHA-256、GCM 认证、归档路径/类型白名单、manifest schema 及 `pg_restore --list`，绝不解压到操作员提供的生产路径。

## 空环境演练

1. 在 Backup 容器的 `/tmp` 或 `/restore` 下创建隔离空 PostgreSQL 数据库和空附件目录。
2. 停止或隔离所有面向演练目标的写入者。
3. 执行：

```sh
docker compose exec -T postgres createdb -U logion logion_restore
docker compose exec -T backup logion-restore-backup \
  /backups/logion-TIMESTAMP-KEYID.backup \
  logion_restore \
  /tmp/logion-restore-attachments
```

工具拒绝非空数据库，校验归档成员，以 `--no-owner --no-privileges` 恢复，只将附件写入安全空演练路径，并改变每个 `workspace_sync_states.sync_epoch`。旧设备因此必须重新 Bootstrap 并隔离旧 Outbox。

成功恢复时 stdout 只输出一份 JSON 报告，checksum 与进度诊断写入 stderr，自动化无需剥离人类文本即可校验报告。

4. 比对 manifest/Alembic 版本、租户/成员/Space 数量、附件哈希、审计序列和代表性认证导出。
5. 对演练环境执行 API/Web smoke 及跨租户负向测试。
6. 保存 JSON 恢复报告及 RPO/RTO、产物 checksum、key ID、数量和 reviewer 签字。
7. 解析并验证目标后，只销毁明确命名的演练数据库/路径。

## 生产恢复

Production 恢复需要人工批准、变更记录和恢复前当前状态副本。工具有意只接受 `/tmp` 或 `/restore` 下的附件目标；操作员必须先验证演练、停止写入者，再使用单独审查的步骤提升到生产附件卷。若旧二进制无法读取恢复后的 schema，禁止二进制回滚，应部署兼容应用或数据库前向修复。

密钥轮换不会重写旧产物。每个旧密钥必须保留到最长产物保留期结束，抽样验证后才按批准的密码学销毁流程删除。

Release Candidate 工作流通过 `scripts/release/rc_recovery.sh` 自动执行隔离子集，其 JSON 证据绑定候选 source SHA 和 digest 固定的 Backup 镜像。它不会提升恢复数据、批准 Production、证明异地灾备，也不能替代季度人工演练。
