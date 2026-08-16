# V20-15 RC7 受控 prerelease 部署证据

> 更新时间：2026-08-16（Asia/Shanghai）。
> 本文件记录受控 prerelease 更新，不代表 Production 发布、正式流量切换或敏感能力启用。

## 候选身份

- 产品源码：`480adc721600243308fa7b5a32200044efd88f07`
- Candidate manifest SHA-256：`0dbe60ce2d8044867dc85b8ffb0ca61006bdc96a3654b3842f8cf68c9f7d05b5`
- Main candidate：`31672956241`
- Full capacity：`31673689291`
- Release candidate：`31673881951`
- Alembic head：`0038_local_worker_protocol`

## 受控切换

- ECS 活动目录 `/opt/logion` 已原子切换到 RC7；旧目录 `/opt/logion.before-rc7-20260813T130605Z` 保留。
- 切换前最终备份：`logion-20260813T130618Z-beta-v1.backup`
- 服务器与 BitLocker `J:\LogionBackups\encrypted` 副本 SHA-256：
  `76bd5d7b441fefb0999b08d460042fb3cd6fe37cb3a20c00ac454de86076022f`
- 数据库、附件、PostgreSQL、Redis 数据卷未删除或替换。

## 运行时核验

| 服务   | 固定 digest                                                               | 结果            |
| ------ | ------------------------------------------------------------------------- | --------------- |
| API    | `sha256:baa67d44c2982b9312934a0b2aed8cc215ef130eb0f72550a7057b1a8ad5acaa` | running/healthy |
| Backup | `sha256:898dd72251a95a4123fcb4a3b5c89b0f34ba95cf8d72e9bdbb91699cdff82528` | running         |
| Web    | `sha256:489e8e6eab7b19e069a2d92a959aef55946dd63fcfd1ea2a5c049fbe17c670d3` | running/healthy |
| Worker | `sha256:786bccd8d76a9b0169ca96d6ebfc437c2a7efb1de4a9e7faaffe5b87171175e4` | running/healthy |

- 公网 `https://logion.work/health` 返回 HTTP 200。
- Compose 反向代理的 `8080` 仍仅绑定 `127.0.0.1`；公网入口仍为 80/443。
- Backup secret 权限首次随 staging 变为 `root:root 0600`，导致启动前检查失败并累计 19 次重启；密钥内容未读取或更换。已修复为 `root:10001 0640`，修复后容器稳定运行，新的容器退出码为 0。
- `LOGION_REGISTRATION_MODE=invite`；Shared Write、Deletion、Attachment ingest、Local Worker、sync-v1、AI Acceptance 与 Production 流量切换继续关闭，AI Provider 启用数为 0。
- 邮件 Provider 实际为 `aliyun_directmail`，不得误记为关闭；本轮只读观察没有发送真实邀请邮件。

## 24 小时观察收口

- 观察窗口从 `2026-08-13T13:06:05Z` 起算。`2026-08-16T05:23:17Z` 通过受控 SSH 只读复核时，活动源码仍为 `480adc721600243308fa7b5a32200044efd88f07`，Alembic 仍为 `0038_local_worker_protocol`。
- API readiness 的 application、database、redis 均为 `ok`；API、Web、Worker、Reverse Proxy、PostgreSQL、Redis 均健康，Backup 正常运行，Attachment init 退出码为 0。
- 所有容器均为 `OOMKilled=false`、`RestartCount=0`。根磁盘使用率为 40%，可用内存为 933 MiB，Swap 共 2047 MiB、已用 395 MiB。
- 最新备份 `logion-20260815T133314Z-beta-v1.backup` 距复核时约 15.8 小时，`logion-verify-backup` 返回 OK；备份记录的源码和迁移头与当前 RC7 一致。
- 过去 24 小时系统 error/alert 计数为 0。Web 记录的 7 条 Server Reference ID 格式错误经反向代理日志聚合核对，共 565 个请求、无 5xx；异常请求均以 404 拒绝，属于畸形请求或探测噪声，不构成观察失败。
- 公网 `/health` 连续 3 次返回 HTTP 200；HSTS、CSP、X-Frame-Options、X-Content-Type-Options 与 Referrer-Policy 均存在。
- 结论：RC7 至少 24 小时技术观察已真实通过。该结论只允许 PR 进入用户合并审批，不等于 Production 发布、流量切换、敏感能力启用或回滚点清理授权。

## 未完成门禁

- 真实受邀邮件、实体移动设备验收和 Production 授权仍未完成，不能标记为通过或发布。
- 历史协调 Run 的 encoded-content safe-scan budget 限制仍独立保留，未改写为通过。
