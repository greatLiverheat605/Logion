# V20-15 prerelease RC2 evidence

> 更新时间：2026-08-10（Asia/Shanghai）。
> 状态：**RC2 已部署到受控 prerelease，镜像、备份恢复、迁移、运行时和公网技术检查通过；认证浏览器回归因原会话失效待重新登录，不得视为 Production 发布或完整验收通过。**

## 授权范围

- 用户已确认公网验收账号已登录，并批准将精确候选部署到 prerelease。
- 本记录不授权 Production 发布、流量切换、真实邮件投递或任何敏感生产能力。
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 生产开关继续关闭。

## 候选 provenance

- 合并候选源码 SHA：`2339002cd084950c3b859db561ade66fcfa528f4`。
- Main candidate：`31300835608`，success，head SHA 与候选一致。
- Full capacity profile：`31309153632`，success，head SHA 与候选一致。
- Release candidate `0.2.0-rc2`：`31309364885`，success，head SHA 与候选一致。

候选镜像固定 digest：

| 镜像   | digest                                                                    | 当前 ECS 拉取状态 |
| ------ | ------------------------------------------------------------------------- | ----------------- |
| API    | `sha256:56fd33693b0536e751668fe78fe55f0c8565cac56c519904ded88dc8406eeac6` | 已拉取并运行      |
| Web    | `sha256:11b60d1451d304e05fb10bf587a912e1977b71ca705ee080dfe7ad5bc8964d2f` | 已拉取并运行      |
| Worker | `sha256:cc1ed2b04e8367c772b8a4a461f6d4b49c1d32b4ec1b7e8b17d37b29f4978c1e` | 已拉取并运行      |
| Backup | `sha256:5b9ab60a8c45ef9175be8d3b1c8f60c09c6567af5293b3b0b43e27189f96563d` | 已拉取并运行      |

## ECS prerelease 初始断点（历史记录）

- 目标：受控 ECS 主机（地址与登录身份不入库），正式集成目录对应候选部署窗口。
- 候选源码目录 `/opt/logion` 当前 `git rev-parse HEAD` 为 `2339002cd084950c3b859db561ade66fcfa528f4`。
- 旧目录保留：`/opt/logion.before-20260809T115054Z`。
- 候选 manifest：`/root/logion-upgrade/candidate-manifest.json`，已在 Linux checkout 重新生成并验证。
- 正在运行的唯一拉取进程：
  - PID `2452597`：`docker compose ... pull`
  - PID `2452609`：Compose 插件子进程
- 拉取自 2026-08-09 19:56（Asia/Shanghai）开始；截至本记录约两小时仍在运行，无失败标记。
- PostgreSQL、Redis 保持运行；API/Web/Worker/Reverse Proxy/Backup 尚未启动候选容器。
- 磁盘空间、内存与 GHCR `/v2/` 网络只读检查正常；未切换镜像源、未启动第二个 pull、未杀掉当前 pull。

## 初始断点尚未执行项（历史记录）

- `PULL_OK` 与四个候选 digest 最终核对。
- `0038_local_worker_protocol` migration / Alembic head 核对。
- 候选 API/Web/Worker/Reverse Proxy/Backup 启动与容器健康检查。
- ECS loopback/public health 检查。
- 已登录公网浏览器的人工回归、主题持久化、知识图谱、中文反馈与浏览器控制台检查。
- 更新 `V020_STATUS.md` 的最终 rc2 结论、提交与推送。

当前禁止把此断点描述为“v0.2.0 已上线”或“rc2 验收通过”。

## 2026-08-10 拉取恢复与可用性处理

- 原拉取进程 `2452597` / `2452609` 已随原 SSH 会话结束；它没有产生 `PULL_OK`，API 与 Backup 候选 digest 仍缺失，因此没有执行 migration 或启动 RC2。
- 当时公网 `/health` 返回 HTTP 502，只有 PostgreSQL 与 Redis 运行。为避免慢速拉取期间持续停机，已从保留目录 `/opt/logion.before-20260809T115054Z` 恢复上一版 prerelease 应用层。
- 恢复后 API、Web、Worker、Reverse Proxy、Backup、PostgreSQL、Redis 均运行；loopback 与公网 `/health` 均返回 HTTP 200，响应版本仍为 `0.1.0`；Alembic head 为 `0038_local_worker_protocol`。
- RC2 仅缺 API 与 Backup 镜像；已使用远端后台进程和独立日志 `/root/logion-upgrade/rc2-pull-retry.log` 重新执行 `pull api backup`。Web 与 Worker 候选 digest 保持已拉取状态。
- 后台补拉不启动候选容器、不迁移数据库、不混用旧/新应用镜像。四个 digest 全部核对前，公网继续运行上一版 prerelease。
- RC2 补拉完成后必须重新生成并校验维护备份，因为恢复公网服务后可能出现新的合法写入；此前 2026-08-09 的维护备份不得直接替代下一次迁移前备份。

## 2026-08-10 RC2 拉取完成

- 后台 `pull api backup` 中 Backup 于 00:44（Asia/Shanghai）完成；API 首次连接在 42.06 MB 处被 GHCR 对端重置，任务自然退出且没有生成候选 digest。
- 确认不存在并发 pull 后，使用单进程、失败等待后重试的后台任务只拉取固定 API digest。该次连接完整下载 63.72 MB 层并于 01:57:05 完成。
- 四个应用 digest 随后均通过本机 Docker image inspect；`candidate-manifest.json` 重新验证成功，源码为 `2339002cd084950c3b859db561ade66fcfa528f4`，目标迁移头为 `0038_local_worker_protocol`。
- 镜像齐备前公网一直运行上一版完整应用栈；未混用候选镜像、未迁移数据库、未删除数据卷。

## 维护备份与隔离恢复

- 维护窗口于 `2026-08-09T18:00:26Z` 开始。旧 API、Web、Worker、Reverse Proxy 与 Backup 停止写入，PostgreSQL/Redis 保持健康；旧迁移头为 `0038_local_worker_protocol`，活跃 Owner 数量为 2。
- 迁移前加密备份：`logion-20260809T180418Z-beta-v1.backup`，SHA-256 为 `5a347f926b03eb6112c3a42596e16f6d16fbda52d6e5d2943ffa9c4af0dc02e3`。服务端 checksum、AES-GCM、结构与 `pg_restore --list` 校验通过。
- 该备份已同步到 BitLocker XTS-AES-256、100% 加密且 Protection On 的 `J:\Backups\encrypted`；Windows 重新计算的 SHA-256 与 sidecar 一致。
- 使用该备份恢复到独立临时数据库 `logion_rc2_restore_20260809_1804` 与空附件目录成功：恢复头 `0038_local_worker_protocol`、Workspace 数量 2、`NULL sync_epoch` 数量 0。临时数据库、附件目录所在临时容器均已清理，未覆盖线上库。
- 最终残留检查发现旧失败演练库 `logion_offhost_restore_202608090035`；其 `public` 业务表数量和活动连接数均为 0。按精确名称删除该空库后再次确认不存在，主库 `logion` 与所有数据卷未触碰。
- RC2 启动后的加密备份 `logion-20260809T182125Z-beta-v1.backup` 再次通过服务端完整校验并同步到同一加密卷；manifest 绑定相同 source SHA 与迁移头。

## RC2 启动与运行时证据

- `attachment-init` 退出码为 0；Alembic `upgrade head` 幂等执行后数据库头仍为 `0038_local_worker_protocol`。
- API、Worker、Web、Reverse Proxy 与 Backup 均由候选 Compose 重建并启动；API/Web/Worker/Backup 的运行时 `Config.Image` 与上表四个 digest 逐项一致，OOMKilled 均为 `false`、RestartCount 均为 0。
- API ready 返回源码版本 `2339002cd084950c3b859db561ade66fcfa528f4`，application/database/redis 三项均为 `ok`。
- loopback 与公网 `/health` 返回 HTTP 200；公网连续三次检查均成功，HSTS、nonce CSP、`X-Frame-Options: DENY` 与 `X-Content-Type-Options: nosniff` 均存在。
- 近 15 分钟 API/Worker/Web/Reverse Proxy/Backup 日志没有匹配到 error、exception、traceback、critical、panic 或 fatal；磁盘使用 35%，内存与 swap 仍有余量。
- Web `/health` 的展示版本仍为 `0.1.0`，与 API ready/source SHA 不一致。运行镜像已由精确 digest 独立确认，但该展示版本必须作为 RC2 残余问题记录，不能用它宣称 v0.2.0 正式上线。

## 默认关闭与浏览器断点

- `.env` 未显式开启 Knowledge Space API、Shared Writes、AI Acceptance、Deletion、Attachment Ingest、Local Worker 或 Attachment Scanner，应用配置默认值均为 `false`；Legacy Registration 为 `false`，Bootstrap Owner 为空，数据库中 enabled AI Provider 数量为 0。
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 生产能力继续关闭；未启动本机 Docker，未绕过 SessionBoundary，未发送真实邀请或邮件。
- 原受控 Owner 浏览器会话在候选重建后失效，刷新 `/app/today` 明确进入“需要登录”；已打开 `/auth/login` 等待用户重新登录。未读取浏览器 Cookie、localStorage 或密码，也未伪造认证回归通过。
- 未认证首页与登录页可正常渲染，浏览器控制台的完整认证后回归仍待执行：成功/失败/空值/loading/disabled、防重复提交、搜索、邀请 409、知识图谱、主题持久化与控制台错误检查均保持 `not_run`。

当前结论是 **RC2 已在受控 prerelease 运行且非认证技术门通过；完整浏览器验收、观察期、真实邮件/设备验收和 Production 流量切换仍未完成**。用户重新登录并完成同一组人工回归前，不得关闭 V20-15，也不得宣称 v0.2.0 已正式上线。
