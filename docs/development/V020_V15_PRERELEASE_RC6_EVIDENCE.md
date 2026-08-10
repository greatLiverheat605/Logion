# V20-15 prerelease RC6 evidence

> 更新时间：2026-08-10（Asia/Shanghai）。
> 状态：**RC6 已部署到受控 prerelease；候选身份、迁移、运行镜像、健康、加密备份、异机校验和隔离恢复通过。用户已报告当前浏览器会话登录，但认证 UX 实际走查仍为 `not_run`，不得视为 Production 发布或完整验收通过。**

## 授权与边界

- 用户批准继续受控 prerelease 发布与验收流程。
- 本记录不授权 Production 发布、真实邮件投递、敏感能力启用或旧回滚点清理。
- Shared Write、Deletion、Attachment、Local Worker、AI Provider、sync-v1 与 AI Acceptance 继续关闭。
- 仓库操作只在正式集成工作区和 `codex/v020-rc6-closeout` 分支执行；保留的临时 RC2/RC4 证据目录不提交、不删除、不格式化。

## 候选身份

- Source SHA：`c47aa376d95b179200d59986c20289b796740959`。
- Main candidate：`31337611805`，success，head SHA 一致。
- Full capacity：`31338032379`，success，head SHA 一致。
- Release candidate `0.2.0-rc6`：`31338128822`，success，head SHA 一致。
- 候选 manifest SHA-256：`12280604e31621ef3cad437ec712a1b9e80dfccb64c2d7326509c0354f1624e7`。
- 目标迁移头：`0038_local_worker_protocol`。

运行镜像固定为：

| 服务   | 不可变 digest                                                             |
| ------ | ------------------------------------------------------------------------- |
| API    | `sha256:c3217977c27b81339a594ea0684ce92c98f3af5ff1e9cd2a96c5f0e592c5fa9f` |
| Backup | `sha256:796522b2fb7c39e9346ef9de5e095ee273aa723cdfecb94484b5edb9780d5449` |
| Web    | `sha256:7efedf5db209b354c123ddbc9ba7262780c2e5267338c3823bf648a289bd112a` |
| Worker | `sha256:9325b72649688cc422d0946e4b7f6fb42abd70e129ea327ab84002795efa1eb0` |

## 原子切换与回滚点

- 切换前维护备份 `logion-20260809T224908Z-beta-v1.backup` 已通过服务器校验、异机 SHA-256 复核和隔离恢复。
- 原 RC2 源码保留为独立只读回滚目录；数据卷、旧镜像和备份均未删除。
- RC6 候选目录原子晋级为正式应用目录，manifest 同步晋级；迁移以幂等 `upgrade head` 执行。
- API ready 返回 `status=ready`、source SHA 与候选一致，application/database/redis 均为 `ok`。
- 四个运行应用镜像与候选 manifest 逐项一致后，切换于 `2026-08-09T22:59:03Z` 完成；失败回滚 trap 未触发。

## 发布后备份与恢复

- RC6 Backup 容器生成 `logion-20260809T225859Z-beta-v1.backup`；manifest 绑定 RC6 source SHA、
  `0038_local_worker_protocol`、`beta-v1` key ID 和 `restore_requires_sync_epoch_bump=true`。
- 服务器 sidecar 与 `logion-verify-backup` 均通过；密文大小 101096 bytes，SHA-256 为
  `cd423291ebf372a35484e839e4788125027959379f2d07ae90fea605654dcf99`。
- 密文和 sidecar 已同步到 BitLocker XTS-AES-256、100% 加密且 Protection On 的受控 Windows 异机卷；
  Windows 独立哈希复核一致，恢复密钥未进入仓库、日志或聊天。
- 同一备份恢复到精确命名的隔离空数据库和空附件目录成功：迁移头
  `0038_local_worker_protocol`、Workspace 2 个、`NULL sync_epoch` 0 个。
- 演练结束后只删除精确命名的临时数据库与临时附件目录，并确认二者均无残留；线上数据库、附件卷、
  备份卷和应用数据未被覆盖或删除。

## 运行时与安全复核

- API、Worker、Web、Reverse Proxy、PostgreSQL 与 Redis 健康；Backup 正常运行。所有服务
  OOMKilled 为 `false`，RestartCount 为 0。
- 公网 `/health` 为 HTTP 200；HSTS、nonce CSP、Frame、MIME sniffing 与 Referrer Policy 头均存在。
- 切换后 20 分钟内 API、Worker、Web、Reverse Proxy 与 Backup 的严重日志关键字计数均为 0。
- 磁盘使用 37%；可用内存 758 MiB；Swap 使用 125 MiB。应用容器均低于 Compose 内存上限。
- Knowledge Space API、Shared Write、Deletion、Attachment Ingest、Local Worker、AI Acceptance 和
  Legacy Registration 均解析为 `false`；启用 AI Provider 数量为 0，sync-v1 未变。

## 认证 UX 断点

- 用户报告已登录，但该页面与协调员可控标签不属于同一浏览器会话。可控标签直接进入
  `/app/review` 后由 SessionBoundary 返回“需要登录”；备用浏览器也没有可接管的 Logion 标签。
- 可控浏览器已显示 Logion 登录页并交还用户。当前不读取 Cookie、localStorage、密码或浏览器会话文件，
  也不伪造认证状态。
- 待在用户报告已登录的同一可控会话中真实执行：`/app/today`、`/app/review`、21 个受保护路由、工作区/Space、邀请 409、按钮反馈、
  loading/disabled、防重复提交、搜索、知识图谱桌面键盘与移动列表、主题持久化及浏览器控制台错误检查。

## 当前结论

RC6 已完成受控 prerelease 的技术部署、恢复能力和首轮运行时门禁，但认证 UX、真实受邀邮件、实体移动设备、
至少 24 小时观察和最终 Production 授权仍未完成。观察期从 `2026-08-09T22:59:03Z` 起算；在剩余门禁完成前，
继续保留 RC2 回滚源码、旧镜像、部署前后备份和全部数据卷，并维持所有敏感生产开关关闭。
