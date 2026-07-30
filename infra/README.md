# Infrastructure baseline

`compose.yaml` 是首发参考部署，不是生产云平台的最终声明。它建立了 Web、API、Worker、PostgreSQL、Redis、反向代理和 Backup 的隔离边界。

阿里云 2 核 2 GB、无域名的历史封闭技术测试基线，按照
[`runbooks/aliyun-2c2g-staging-deployment.md`](runbooks/aliyun-2c2g-staging-deployment.md)
执行。服务器已有旧版本时，其中的数据保留替换、加密备份、隔离恢复和稳定后清理流程仍适用。

有正式域名和阿里云邮件推送的 `0.1.0-rc2` 预发布，先按
[`runbooks/aliyun-production-release.md`](runbooks/aliyun-production-release.md) 完成部署和旧版本保留替换，
再按 [`runbooks/aliyun-directmail-prerelease.md`](runbooks/aliyun-directmail-prerelease.md) 验收真实邮件，
并按 [`runbooks/aliyun-real-sync-acceptance.md`](runbooks/aliyun-real-sync-acceptance.md) 验收双浏览器、
离线 Outbox 与恢复回读。

Production 前仍必须补齐 TLS 自动续期、云端密钥管理、Windows 异机加密备份、告警接收人、
RPO/RTO、日志保留、实体手机和 24 小时预发布观察。候选镜像生成 SBOM、provenance 与
GitHub/Sigstore attestation；发布前仍须验证选定云平台的签名策略。Backup 服务将 PostgreSQL
dump、附件和恢复版本元数据放入经认证加密的单一 bundle；同机卷不是最终灾备，密文及校验文件
必须按 [`runbooks/windows-off-host-backup.md`](runbooks/windows-off-host-backup.md) 下载到受控 Windows
电脑，并完成独立恢复演练。项目不使用 OSS。

完整门禁和未完成事项记录在
[`../docs/release/0.1.0-rc2-prerelease.md`](../docs/release/0.1.0-rc2-prerelease.md)。任一阻断项未完成时，
环境保持预发布状态。

本机没有 Docker 时不得声称 Compose 已运行通过；由 CI 的 `docker compose config` 和具备 Docker 的 staging 执行 smoke 与恢复测试。
