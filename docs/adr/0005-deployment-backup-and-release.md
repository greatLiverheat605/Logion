# ADR-0005：部署、备份与发布

- 状态：Accepted
- 日期：2026-07-19
- 决策人：Logion project owner

## 背景

首发部署到云服务器，同时要求多设备同步、服务器备份和长期可恢复。应用、数据库、附件和备份不能混为一个不可迁移单元。

## 决策

Phase 0 使用 Docker Compose 建立 Web、API、Worker、PostgreSQL、Redis、反向代理和 Backup 服务的参考部署。数据库、Redis、附件和备份不直接暴露公网。应用镜像非 root、固定版本并带健康检查；TLS 在反向代理/云入口终止。

CI 构建一次不可变候选产物，环境只晋级相同 digest。发布采用 staging → 人工批准 → 小比例灰度 → 扩大。数据库变更使用 expand/backfill/contract；不安全的二进制回滚改用停写/功能开关和前向修复。

PostgreSQL、附件、加密配置元数据和版本信息进入加密备份；同机副本不算灾备。每月验证可读、每季度空环境恢复并记录 RPO/RTO 与 sync_epoch。

## 后果

- Docker Compose 是首发参考，不排除后续迁移到托管数据库或编排平台；
- 生产密钥通过云端 secret 管理注入，不进镜像和仓库；
- AI/CI 无权自动批准生产；
- 本机缺少 Docker 时只能做配置静态验证，正式 Phase 0 退出仍需 CI 或另一台机器完成容器 smoke。
