# 基础设施

`compose.yaml` 提供 Web、API、Worker、PostgreSQL、Redis、Nginx 和 Backup 的参考自托管拓扑，数据库与 Redis 位于内部网络。`attachment-init` 负责一次性附件目录初始化。

完整操作入口是[部署与运维手册](../docs/operations/README.md)。

| 任务                 | 手册                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| 生产部署与升级       | [生产发布](runbooks/aliyun-production-release.md)                                  |
| 备份、校验与恢复     | [备份恢复](runbooks/backup-restore.md)                                             |
| 异机密文保存         | [Windows 异机备份](runbooks/windows-off-host-backup.md)                            |
| 邮件接入与投递       | [DirectMail](runbooks/aliyun-directmail-prerelease.md)                             |
| 双设备与离线同步验证 | [真实同步](runbooks/aliyun-real-sync-acceptance.md)                                |
| 附件扫描与隔离       | [附件扫描](runbooks/attachment-scanner.md)                                         |
| 候选安全和恢复       | [安全门禁](runbooks/candidate-security.md) · [恢复](runbooks/release-candidate.md) |
| 资源受限部署参考     | [2 核 2 GB](runbooks/aliyun-2c2g-staging-deployment.md)                            |

发布时使用同一源码提交对应的不可变镜像和 manifest。运行版本、环境配置、外部服务、备份与观察结果由具体部署记录，不用文档里的示例版本替代现场检查。

生产环境需要独立密钥、TLS 续期、受邀注册、真实邮件、异机备份与有效告警。已有环境升级时保留原密钥、配置和数据卷；同机备份须配合异机副本与独立恢复演练。
