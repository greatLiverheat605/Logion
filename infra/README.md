# Infrastructure baseline

`compose.yaml` 是首发参考部署，不是生产云平台的最终声明。它建立了 Web、API、Worker、PostgreSQL、Redis、反向代理和 Backup 的隔离边界。

生产前必须补齐：TLS/域名、云端密钥管理、异地加密备份、告警接收人、RPO/RTO、日志保留、镜像签名和真实灰度入口。Backup 服务当前只验证 PostgreSQL dump；附件卷的异地复制必须在云平台选定后实现。

本机没有 Docker 时不得声称 Compose 已运行通过；由 CI 的 `docker compose config` 和具备 Docker 的 staging 执行 smoke 与恢复测试。
