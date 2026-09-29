# v0.3 切换与 A/B 回滚手册

这是发布准备文档，不是执行生产操作的授权。Claude 完成最终审核、所有者完成隔离验收并明确批准具体候选与 A/B 策略后，运维方才执行切换。通用命令、备份及版本保留使用 [生产发布手册](aliyun-production-release.md)；本页补充 v0.3 特有条件。

## 1. 固定候选与证据

R5 先准备，V1–V3 合入 main 且保持默认关闭后，再冻结 `0.3.0-rc1`。固定最终完整 SHA，依次运行 Main → Full capacity profile → Nightly → Release candidate；四道门的 head SHA 必须完全相同。每次修复产生新 SHA，就从 Main 重新收集对应证据，不能拼接旧成功记录。只晋级 Main 已构建并验证的四镜像，不在 Release 重建、不移动已有标签。

保留 manifest、四镜像 digest、SBOM/provenance、安全与许可摘要、容量硬件及数量/延迟、Nightly 浏览器结果、Release 恢复与同步兼容证据。参考硬件不能冒充生产等价批准；物理 Safari、真实论文及所有者签字单列。

回滚 A 另用 `codex/v03-rollback-a`，基线 `fdadebcfe76a341e3915b3c8cb000f280fbe4fb0`。它不合 main，必须具备自身成功 compatibility/candidate 门、四镜像 manifest、`rollback-compatibility.json` 和 `rollback-schema-check.json`。前者绑定旧补丁 SHA 与实际新 schema 来源 SHA/head；后者证明只读检查通过。V1 加法迁移后更新 schema pin 并重新验收。未经修补的 v0.2.x 不具备安全回滚资格。

## 2. 配置清单

保存已有认证、TOTP、邮件、AI、导出、备份密钥和数据卷；不要从新模板覆盖现有配置。新增密钥使用独立随机材料，运行时注入 API/Worker，不把真实值写进 Compose、终端转录或报告。

| 配置                                                                     | 使用方与要求                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `LOGION_RESEARCH_V3_ENABLED`                                             | API 与 Worker，默认 false；准备和迁移期间保持关闭               |
| `LOGION_INTEGRATION_KEYRING`                                             | API 与 Worker，共用同一 keyring；JSON 结构和轮换见文献集成手册  |
| `LOGION_PDF_CACHE_KEYRING`                                               | API，独立于凭据 keyring；必须保留仍被密文缓存引用的历史 key     |
| `LOGION_PDF_MAX_BYTES`                                                   | API，默认 104857600，当前支持下调；宿主机及应用代理上限同步核对 |
| `LOGION_PDF_CACHE_MAX_BYTES`                                             | API，默认 2147483648；预留密文缓存、备份和运行空间              |
| `LOGION_KNOWLEDGE_CURSOR_ACTIVE_KEY_ID` / `LOGION_KNOWLEDGE_CURSOR_KEYS` | API，配置既有签名 keyring；研究搜索缺失时失败关闭               |
| `LOGION_PLANNING_PHASE_REVISION_ENABLED`                                 | API，目标编辑与阶段修订共用；默认关闭，按已批准范围独立开启     |
| V1–V3 Agent 能力开关                                                     | 最终候选按 V1 配置说明核对，v0.3 本次上线保持关闭，之后单独发布 |

基础 Compose 只转发已声明的变量。集成密钥、PDF 密钥/大小/缓存上限、搜索 cursor keys 及 Worker 研究开关必须在受控覆盖文件中显式转发；覆盖文件只引用环境变量，不含实值。可使用如下模板，在部署专用目录保存为未入库文件，并通过原 Compose 包装命令加载：

```yaml
services:
  api:
    environment:
      LOGION_INTEGRATION_KEYRING: ${LOGION_INTEGRATION_KEYRING:?required}
      LOGION_PDF_CACHE_KEYRING: ${LOGION_PDF_CACHE_KEYRING:?required}
      LOGION_PDF_MAX_BYTES: ${LOGION_PDF_MAX_BYTES:-104857600}
      LOGION_PDF_CACHE_MAX_BYTES: ${LOGION_PDF_CACHE_MAX_BYTES:-2147483648}
      LOGION_KNOWLEDGE_CURSOR_ACTIVE_KEY_ID: ${LOGION_KNOWLEDGE_CURSOR_ACTIVE_KEY_ID:?required}
      LOGION_KNOWLEDGE_CURSOR_KEYS: ${LOGION_KNOWLEDGE_CURSOR_KEYS:?required}
  worker:
    environment:
      LOGION_RESEARCH_V3_ENABLED: ${LOGION_RESEARCH_V3_ENABLED:-false}
      LOGION_INTEGRATION_KEYRING: ${LOGION_INTEGRATION_KEYRING:?required}
```

不要打印 `docker compose config` 的完整插值结果。使用 `config --quiet` 检查格式，并用不回显值的检查确认必要变量已传入。研究密钥轮换保留历史 key，不能在仍有历史密文时直接删除。

集成默认白名单只允许 `api.zotero.org`、`dav.jianguoyun.com` 的 HTTPS 443。生产不得使用测试 origin 覆盖，TLS 验证、公开 DNS 检查、禁重定向和禁代理保持。AI 使用独立的既有出站准入与路由配置，只批准实际服务商主机，不扩大集成白名单。测试 origin 仅用于 test 环境的本地假服务。

缓存位于现有附件卷的 `research-pdf`，只含 AES-GCM 密文，逐次校验文献归属。原件在本人 WebDAV；保留集成与缓存 keyring、索引数据库和卷。缓存丢失可按本人权限重新获取，但会消耗下载额度。每月 2.7 GB 提示接近 3 GB，WebDAV 每 30 分钟最多 600 次；不得通过清 Redis 或重复任务绕过。

## 3. 所有者设备同步检查（切换前）

按设备分别填写：设备代号、客户端版本、最后同步时间、Outbox 条数、冲突条数、附件状态、本人确认。只记录计数和结论，不记录私人正文或 Cookie。

1. 所有仍使用的电脑、手机和旧浏览器先联网、登录并解锁旧 Vault，核对正确工作区和空间。
2. 在旧同步页完成同步并处理冲突；检查待上传附件、本机草稿及失败项。“队列为零”不能证明附件和草稿已备份。
3. 在另一台已同步设备检查关键笔记及来源，核对服务器已收到修改；只看到本机内容不算完成。
4. 暂时不能上线的设备标为待处理，保留其全部本机数据。所有者决定是否延后切换；不得自动清空设备或把未核对项记为通过。
5. 新版启用后，`/app/*` 先进入旧数据检查；非空队列继续使用 `/app/sync?legacy=sync`。新版不读取旧内容明文，也不自动迁移或删除 IndexedDB。
6. “清除本机旧数据”仅由本人在核对队列、附件及草稿后主动二次确认；它不是升级必选步骤。保留旧入口，不做 V4。

## 4. 获批后的切换顺序

1. 先完成合成演练；Claude 经批准在停写的已恢复副本上完成迁移核对，保留输出。真实三篇论文与模型对比只在本机隔离环境，由所有者自行提供临时凭据。
2. 确认精确候选、四门、安全报告、设备检查和 A/B 选择签字。进入维护窗口，停业务写入及 Worker，执行最终备份、异机实物校验并保留上版四镜像及原配置。
3. 按 [§5.2 Nginx](aliyun-production-release.md#52-最终-nginx-配置) 核对宿主机 PDF 专用路径 100 MiB、禁请求/响应缓冲与访问日志；`nginx -t` 通过后才允许获批重载。应用代理同样禁缓冲，原文不得进入代理临时文件。此步骤在 R5 只检查文档，不操作主机。
4. 以已验证的新 API 镜像显式执行 `alembic upgrade head`，检查单一目标 head。仅新镜像负责迁移；保持旧版本与备份，禁止 downgrade、修改 version 表或删除新数据。
5. 使用四个固定 digest 启动 API/Web，所有新能力仍关闭；检查 SHA、readiness、登录、Origin/CSRF、旧核心读写与数据数量。检查通过后再启动同版本 Worker，确认健康及队列状态。
6. 经本次批准，先给 API/Worker 配齐独立 keyring、cursor keys、缓存卷及网络，再一致开启研究开关。由本人进入设置配置连接、测试并选择同步目标；配置凭据本身不自动选择空间。检查 PDF prepare/read、草稿接受、本人掌握与旧队列保护。
7. 目标编辑/阶段修订按独立批准启用。Agent、MCP 及收件箱保持关闭；不要用 v0.3 切换授权顺带开启 v0.3.1 功能。
8. 结束维护前核对七服务健康、四镜像身份、错误率、PDF 缓存和下载统计、后台队列、备份及告警，记录时间与结果。观察期满足既有发布标准后，才按 §10.1 收敛版本。

## 5. A：兼容旧应用，新数据库保留

触发故障时先保留日志和候选身份，暂停业务写入及 Worker；由所有者批准执行回滚 A。核对实际数据库 head 与兼容 sidecar 完全一致、四镜像的来源证明和安全门通过。任何不匹配都停止 A，评估 B，不能试着启动未验证旧镜像。

用补丁 API 镜像及现有只读数据库连接运行：

```sh
python -m logion_api.rollback --expected-head <已验证的新-schema-head>
```

检查必须通过，再关闭研究和 Agent 能力，以补丁四镜像 digest 切换应用，保留数据库、Redis、所有卷、keyring 和升级后数据。**不得运行补丁分支自带的 Alembic upgrade/downgrade 或普通旧 Release 迁移流程**。manifest 的 bundled migration head 仍是旧代码附带的版本，实际运行 schema 以 sidecar 为准。

先检查旧页面与核心 API、共享成员无法访问私人数据、sync 含墓碑/冲突、旧格式导出和正常 AI，再恢复业务与旧 Worker。补丁不会执行研究 AI 或研究格式导出，相关队列保持；账户物理清理暂停，申请/取消和历史数据保留。它仅用于应急过渡。回滚期间旧论文新增/导入仍原子映射资源，恢复前向版本后不会遗漏。

恢复前向应用必须使用新的已验收候选，重新核对 schema、keyring、队列和设备同步，再按批准范围恢复开关与账户清理。不将回滚期间的新写入覆盖为旧备份。

## 6. B：仅前向修复

保持已升级 schema 和数据，关闭受影响研究能力并保留必要维护窗口；停止可能重复触发故障的 Worker。保留失败候选与日志，基于当前源码做最小修复，生成新的同 SHA 门禁、manifest、镜像和兼容证据。所有者批准后以新 digest 切换并重复业务验收。

不在生产手改行、不恢复旧备份覆盖新写入、不执行数据库降级；若 A 不满足兼容条件，继续保持维护并采用 B。开关关闭不清除研究数据，恢复后重新检查队列和草稿状态。任何实际生产数据恢复是另外的灾备决策，需要明确范围、数据损失评估和单独批准。

## 7. 保留与交接

上线后按 [§10.1 版本保留](aliyun-production-release.md#101-版本保留) 保留当前和上一版实际所需的镜像、源码、manifest、备份与密钥，按 Image ID 核对；回滚 A 被选定为上一版时应保留其专门补丁候选，不能保留不兼容原版替代它。未完成观察与回滚核验前不清理任何所需制品。

候选证据和失败历史随最终完成包交 Claude；真实凭据、私有数据、设备细节和生产配置留在受控环境。当前阶段不执行 §10.1 的删除命令，也不部署或清理生产。
