# Infrastructure baseline

`compose.yaml` 是首发参考部署，不是生产云平台的最终声明。它建立了 Web、API、Worker、PostgreSQL、Redis、反向代理和 Backup 的隔离边界。

生产前必须补齐：TLS/域名、云端密钥管理、异地加密备份、告警接收人、RPO/RTO、日志保留和真实灰度入口。候选镜像已生成 SBOM、provenance 与 GitHub/Sigstore attestation；发布前仍须验证选定云平台的签名策略。Backup 服务将 PostgreSQL dump、附件和恢复版本元数据放入经认证加密的单一 bundle，并在 Nightly/RC 做空环境恢复；同机卷不是最终灾备，异地复制必须在云平台选定后实现。

本机没有 Docker 时不得声称 Compose 已运行通过；由 CI 的 `docker compose config` 和具备 Docker 的 staging 执行 smoke 与恢复测试。
