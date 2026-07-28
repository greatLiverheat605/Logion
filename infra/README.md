# Infrastructure baseline

`compose.yaml` 是首发参考部署，不是生产云平台的最终声明。它建立了 Web、API、Worker、PostgreSQL、Redis、反向代理和 Backup 的隔离边界。

阿里云 2 核 2 GB、无域名、个人及最多 10 人使用的封闭技术测试部署，按照 [`runbooks/aliyun-2c2g-staging-deployment.md`](runbooks/aliyun-2c2g-staging-deployment.md) 逐步执行。该手册包含服务器已有旧版本时的数据保留替换、加密备份、隔离恢复、回滚边界与稳定后清理流程；真实 FastAPI、双浏览器、离线 Outbox 与恢复回读按照 [`runbooks/aliyun-real-sync-acceptance.md`](runbooks/aliyun-real-sync-acceptance.md) 验收。两份手册都不批准 Production，也不能替代域名/HTTPS、异地备份、真实邮件、告警和面向实际人数的容量验证。

生产前必须补齐：TLS/域名、云端密钥管理、异地加密备份、告警接收人、RPO/RTO、日志保留和真实灰度入口。候选镜像已生成 SBOM、provenance 与 GitHub/Sigstore attestation；发布前仍须验证选定云平台的签名策略。Backup 服务将 PostgreSQL dump、附件和恢复版本元数据放入经认证加密的单一 bundle，并在 Nightly/RC 做空环境恢复；同机卷不是最终灾备，异地复制必须在云平台选定后实现。

本机没有 Docker 时不得声称 Compose 已运行通过；由 CI 的 `docker compose config` 和具备 Docker 的 staging 执行 smoke 与恢复测试。
