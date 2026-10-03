# v0.3 切换与 A/B 回滚手册

这是发布准备文档，不是执行生产操作的授权。所有者已于 2026-10-01 选定回滚 A，B 为后备；Claude 完成最终审核、所有者完成隔离验收并明确批准具体候选和切换后，运维方才执行。通用命令、备份及版本保留使用 [生产发布手册](aliyun-production-release.md)；本页补充 v0.3 特有条件。

## 1. 固定候选与证据

当前待验候选为 `0.3.0-rc4`；`0.3.0-rc1` 至 `0.3.0-rc3` 已被后续依赖安全公告与真实服务修复取代，不再可发布，历史证据保留且不得覆盖。固定最终完整 SHA，依次运行 Main → Full capacity profile → Nightly → Release candidate；四道门的 head SHA 必须完全相同。每次修复产生新 SHA，就从 Main 重新收集对应证据，不能拼接旧成功记录。只晋级 Main 已构建并验证的四镜像，不在 Release 重建、不移动已有标签。

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
| `LOGION_AGENT_API_ENABLED`                                               | API，默认 false；v0.3 本次上线保持关闭，v0.3.1 另行批准         |

基础 Compose 只转发已声明的变量。集成密钥、PDF 密钥/大小/缓存上限、搜索 cursor keys 及 Worker 研究开关必须在受控覆盖文件中显式转发；覆盖文件只引用环境变量，不含实值。可使用如下模板，在部署专用目录保存为未入库文件，并通过原 Compose 包装命令加载：

```yaml
services:
  api:
    networks: [backend, egress]
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

研究开关开启时，API 必须按 [ADR-0065](../../docs/adr/0065-research-api-egress.md) 同时接入 backend 与单独的 egress 网络。以上模板复用基础 Compose 已声明的 egress，基础 `compose.yaml` 不改；PostgreSQL 和 Redis 仍只接 internal backend，不得加入 egress。网络覆盖须由原 `logion-compose` 包装命令在每次 config/up/exec 时一致加载；用固定 digest 重建 API 容器后检查实际网络，仅修改文件不会改变运行中的容器。

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
2. 确认精确候选、四门、安全报告、设备检查、已选回滚 A 的兼容证据和本次切换签字。进入维护窗口，停业务写入及 Worker，执行最终备份、异机实物校验并保留上版四镜像及原配置。
3. 按 [§5.2 Nginx](aliyun-production-release.md#52-最终-nginx-配置) 核对宿主机 PDF 专用路径 100 MiB、禁请求/响应缓冲与访问日志；`nginx -t` 通过后才允许获批重载。应用代理同样禁缓冲，原文不得进入代理临时文件。此步骤在 R5 只检查文档，不操作主机。
4. 以已验证的新 API 镜像显式执行 `alembic upgrade head`，检查单一目标 head。仅新镜像负责迁移；保持旧版本与备份，禁止 downgrade、修改 version 表或删除新数据。
5. 使用四个固定 digest 启动 API/Web，所有新能力仍关闭；检查 SHA、readiness、登录、Origin/CSRF、旧核心读写与数据数量。检查通过后再启动同版本 Worker，确认健康及队列状态。
6. 经本次批准，先给 API/Worker 配齐独立 keyring、cursor keys、缓存卷及网络。加载 §2 覆盖并重建 API 后，按 [§4.1](#41-api-出站网络检查) 用 `docker inspect` 确认 API 在 backend/egress 上，并从 API 容器内对 `api.zotero.org`、`dav.jianguoyun.com` 和已批准的模型主机做不带凭据的 HTTPS 可达性检查；两项通过后再一致开启研究开关。每次重建 API 容器后执行 `logion-compose restart reverse-proxy`：应用内 Nginx 启动时解析上游地址，否则会继续指向旧 API 容器并返回 502。由本人进入设置配置连接、测试并选择同步目标；配置凭据本身不自动选择空间。检查 PDF import/prepare/read、模型发现、草稿接受、本人掌握与旧队列保护。
7. 目标编辑/阶段修订按独立批准启用。Agent、MCP 及收件箱保持关闭；不要用 v0.3 切换授权顺带开启 v0.3.1 功能。
8. 结束维护前核对七服务健康、四镜像身份、错误率、PDF 缓存和下载统计、后台队列、备份及告警，记录时间与结果。观察期满足既有发布标准后，才按 §10.1 收敛版本。

### 4.1 API 出站网络检查

切换第 6 步以及 A/B 切换后都执行以下两项。使用加载了 §2 覆盖的 `logion-compose`，记录
候选 SHA、API 容器 ID、检查时间和结论；不输出完整 inspect、环境变量、凭据或响应正文。

先只查看网络名称：

```sh
for service in api postgres redis; do
  container_id=$(logion-compose ps -q "$service")
  test -n "$container_id" || exit 1
  docker inspect "$container_id" \
    --format '{{.Name}}: {{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}'
done
```

API 必须同时显示本项目的 backend 和 egress（通常带 Compose 项目前缀）；PostgreSQL/Redis
必须只有 backend。不要将其他项目的同名网络视为通过。

再在 API 容器内执行无凭据 HTTPS 探测。将 `approved-model.example` 替换为本次批准的模型
主机名；若有多个，依次作为参数传入。只传主机名，不带协议、端口、路径、账号或 Token。
脚本使用镜像内 Python 标准库直接访问 HTTPS 443 的 `HEAD /`，验证证书，不读取代理、
不加载应用凭据、不跟随重定向且不读取响应正文：

```sh
logion-compose exec -T api python - approved-model.example <<'PY'
import http.client
import re
import sys

model_hosts = sys.argv[1:]
if not model_hosts or any(
    not re.fullmatch(r"[A-Za-z0-9.-]+", host) or host.endswith(".example")
    for host in model_hosts
):
    raise SystemExit("Replace the example with approved model hostnames only")

failed = False
for host in dict.fromkeys(["api.zotero.org", "dav.jianguoyun.com", *model_hosts]):
    connection = http.client.HTTPSConnection(host, 443, timeout=10)
    try:
        connection.request("HEAD", "/", headers={"Accept-Encoding": "identity"})
        response = connection.getresponse()
        print(f"{host}: HTTPS reachable; HTTP {response.status}")
    except (OSError, http.client.HTTPException) as exc:
        failed = True
        print(f"{host}: FAIL {type(exc).__name__}")
    finally:
        connection.close()
raise SystemExit(1 if failed else 0)
PY
```

收到 HTTP 状态（包括 301/302、401/403、404/405）只证明 DNS、连接和 TLS 链路可达；
该探测不跟随 Location，也不证明 API Key、WebDAV 权限、模型列表或业务可用。DNS、连接、
TLS 错误或超时均阻断恢复相关能力，先修正网络再复查；429/5xx 还须排查限流或服务状态。
随后仍须完成第 6 步的带权限业务验收，不得为通过检查关闭 TLS 校验或放宽应用出站规则。

## 5. A：兼容旧应用，新数据库保留（已选策略）

所有者已于 **2026-10-01 选定 A**，见 [ADR-0063](../../docs/adr/0063-upgraded-schema-rollback.md)；B 为兼容条件不满足或 A 无法解决故障时的后备。策略已选不等于批准实际生产回滚。

触发故障时先保留日志和候选身份，暂停业务写入及 Worker；由所有者批准执行回滚 A。核对实际数据库 head 与兼容 sidecar 完全一致、四镜像的来源证明和安全门通过。任何不匹配都停止 A，评估 B，不能试着启动未验证旧镜像。

用补丁 API 镜像及现有只读数据库连接运行：

```sh
python -m logion_api.rollback --expected-head <已验证的新-schema-head>
```

检查必须通过，再关闭研究和 Agent 能力，以补丁四镜像 digest 切换应用，保留数据库、Redis、所有卷、keyring 和升级后数据。**不得运行补丁分支自带的 Alembic upgrade/downgrade 或普通旧 Release 迁移流程**。manifest 的 bundled migration head 仍是旧代码附带的版本，实际运行 schema 以 sidecar 为准。

保留 API 的 backend/egress 网络覆盖；旧 AI 模型发现仍由 API 出站。对已切换的补丁 API 重跑 [§4.1](#41-api-出站网络检查) 两项：用 `docker inspect` 核对 API 在 egress、PostgreSQL/Redis 不在 egress，再从 API 容器内对两个集成主机和已批准模型主机执行无凭据 HTTPS 检查。研究与 Agent 保持关闭；网络可达不代表允许旧应用执行研究集成或 PDF 功能。

先检查旧页面与核心 API、共享成员无法访问私人数据、sync 含墓碑/冲突、旧格式导出和正常 AI，再恢复业务与旧 Worker。补丁不会执行研究 AI 或研究格式导出，相关队列保持；账户物理清理暂停，申请/取消和历史数据保留。它仅用于应急过渡。回滚期间旧论文新增/导入仍原子映射资源，恢复前向版本后不会遗漏。

恢复前向应用必须使用新的已验收候选，重新核对 schema、keyring、队列和设备同步，再按批准范围恢复开关与账户清理。不将回滚期间的新写入覆盖为旧备份。

## 6. B：仅前向修复（后备策略）

保持已升级 schema 和数据，关闭受影响研究能力并保留必要维护窗口；停止可能重复触发故障的 Worker。保留失败候选与日志，基于当前源码做最小修复，生成新的同 SHA 门禁、manifest、镜像和兼容证据。所有者批准后以新 digest 切换并重复业务验收。

新 API 切换后、恢复研究能力前，加载 §2 网络覆盖并重跑 [§4.1](#41-api-出站网络检查) 两项：用 `docker inspect` 确认 API 同时连接 backend/egress、PostgreSQL/Redis 只连接 backend，再从 API 容器内对两个集成主机和已批准模型主机做无凭据 HTTPS 检查。两项通过后才能按批准范围恢复开关，并重做连接、PDF 和模型发现业务验收。

不在生产手改行、不恢复旧备份覆盖新写入、不执行数据库降级；若 A 不满足兼容条件，继续保持维护并采用 B。开关关闭不清除研究数据，恢复后重新检查队列和草稿状态。任何实际生产数据恢复是另外的灾备决策，需要明确范围、数据损失评估和单独批准。

## 7. 保留与交接

上线后按 [§10.1 版本保留](aliyun-production-release.md#101-版本保留) 保留当前和上一版实际所需的镜像、源码、manifest、备份与密钥，按 Image ID 核对；已选回滚 A，须保留其专门补丁候选，不能保留不兼容原版替代它。未完成观察与回滚核验前不清理任何所需制品。

候选证据和失败历史随最终完成包交 Claude；真实凭据、私有数据、设备细节和生产配置留在受控环境。当前阶段不执行 §10.1 的删除命令，也不部署或清理生产。

所有者统一验收使用 [三小时以内的本机验收脚本](v03-owner-acceptance.md)，它不授权生产切换。
