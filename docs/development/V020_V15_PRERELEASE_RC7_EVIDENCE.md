# V20-15 RC7 受控 prerelease 部署证据

> 更新时间：2026-08-13（Asia/Shanghai）。
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

| 服务 | 固定 digest | 结果 |
| --- | --- | --- |
| API | `sha256:baa67d44c2982b9312934a0b2aed8cc215ef130eb0f72550a7057b1a8ad5acaa` | running/healthy |
| Backup | `sha256:898dd72251a95a4123fcb4a3b5c89b0f34ba95cf8d72e9bdbb91699cdff82528` | running |
| Web | `sha256:489e8e6eab7b19e069a2d92a959aef55946dd63fcfd1ea2a5c049fbe17c670d3` | running/healthy |
| Worker | `sha256:786bccd8d76a9b0169ca96d6ebfc437c2a7efb1de4a9e7faaffe5b87171175e4` | running/healthy |

- 公网 `https://logion.work/health` 返回 HTTP 200。
- Compose 反向代理的 `8080` 仍仅绑定 `127.0.0.1`；公网入口仍为 80/443。
- Backup secret 权限首次随 staging 变为 `root:root 0600`，导致启动前检查失败并累计 19 次重启；密钥内容未读取或更换。已修复为 `root:10001 0640`，修复后容器稳定运行，新的容器退出码为 0。
- `LOGION_REGISTRATION_MODE=invite`；Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 与 Production 流量切换继续关闭。

## 未完成门禁

- 至少 24 小时 RC7 观察期尚未收口，仍需复核健康、日志、OOM/restart、资源、备份新鲜度和告警。
- 真实受邀邮件、实体移动设备验收和 Production 授权仍未完成，不能标记为通过或发布。
- 历史协调 Run 的 encoded-content safe-scan budget 限制仍独立保留，未改写为通过。
