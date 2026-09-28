# 文献集成

本功能遵循 ADR-0040 与 ADR-0013，受 `LOGION_RESEARCH_V3_ENABLED` 控制，默认关闭。迁移 `0046_integration_credentials` 只新增凭据表；表中存在数据时禁止降级。

## 配置与轮换

API 进程从环境变量 `LOGION_INTEGRATION_KEYRING` 读取 JSON，结构为 `{"active":"key-id","keys":{"key-id":"<base64url encoded 32 random bytes>"}}`。占位内容不能直接使用。由部署者在隔离环境生成独立 32 字节随机密钥，通过密钥管理设施注入；不得提交到仓库、日志或验收报告。未配置有效 active key 时，保存失败关闭。

每条凭据使用随机 AES-256-GCM 数据密钥，keyring 包裹数据密钥；认证附加数据绑定账户、服务和记录 ID，包裹层还绑定 key ID。坚果云账号同样在密文内。轮换时增加新 key 并修改 active，同时保留旧 key，以便解密历史记录；本人重新保存凭据或成功测试 Zotero 后使用当前 active key。不要在旧记录仍引用旧 key 时删除它。备份恢复需要同时保留对应 keyring，但密钥须与数据库备份分开托管。

## 连接边界

生产默认只访问 `api.zotero.org` 和 `dav.jianguoyun.com` 的 HTTPS 443 端口。DNS 必须解析为公网地址，请求固定解析结果并保留原 Host/SNI；TLS 校验开启，不跟随重定向，不继承系统代理。Zotero 传输只允许 GET，连接测试验证个人库读取权限并拒绝任何写权限。

仅 `LOGION_ENV=test` 可通过 `LOGION_ZOTERO_ORIGIN`／`LOGION_WEBDAV_ORIGIN` 覆盖到 IP 回环地址的本地假服务；测试中的 HTTPS 也必须通过证书验证。不要用关闭 TLS 校验处理连接失败。

## 接口与状态

所有接口均要求登录，功能关闭时返回 404；`provider` 仅接受 `zotero`／`webdav`。

| 方法   | 路径                                            | 行为                                                   |
| ------ | ----------------------------------------------- | ------------------------------------------------------ |
| GET    | `/api/v1/research/integrations/{provider}`      | 读取本人的连接状态                                     |
| PUT    | 同上                                            | 设置或替换凭据；请求含 credential，坚果云另需 username |
| DELETE | 同上                                            | 清除本人的连接凭据，保留内容                           |
| POST   | `/api/v1/research/integrations/{provider}/test` | 明确发起连通性与权限检查                               |

写入、测试和撤销沿用可信 Origin、CSRF、近期认证，且每账户每小时最多 30 次。响应只含 provider、configured、connected、last_sync_at、last_error_code。审计只记录动作、服务与结果，账号、凭据、正文不进入审计。账户最终清理同时删除其集成凭据。

常见错误：`INTEGRATION_AUTH_FAILED` 表示凭据被拒绝；`ZOTERO_READ_ONLY_KEY_REQUIRED` 表示未授予个人库读取或包含写权限；`INTEGRATION_KEY_UNAVAILABLE` 表示服务器密钥缺失或无法解密；`INTEGRATION_UNAVAILABLE` 表示网络、TLS 或服务失败。重新配置后需再次测试。

## 隔离验证

自动测试只用本地假 Zotero／WebDAV 服务和合成凭据。`tests/fixtures/research_services.py` 由 `playwright.research.config.ts` 启动，真实 API/Web 浏览器测试覆盖设置、测试、刷新和撤销；安全测试覆盖跨账户隔离、近期认证、TLS 拒绝、密文绑定和非空降级。

“已连接”只代表最近一次连接测试成功。PDF 获取在后续阅读链路接入。

## Zotero 同步

API 和 Worker 使用相同的集成 keyring，并同时开启研究功能。本人在设置页选择当前空间并点击“立即同步 Zotero”；该目标随后每 30 分钟同步一次。每个目标的游标、分页位置、集合名称映射和条目去重映射记录在 `zotero_sync_states`。集合不新建实体表，只形成 `collection:` 标签。

新增接口 `/api/v1/workspaces/{workspace_id}/spaces/{space_id}/zotero-sync`：GET 返回本人的同步状态，POST 在可信 Origin、CSRF、当前空间权限和写入限流校验后入队，返回 202。配置凭据不会自行决定同步空间。状态包含已配置、是否待处理、已完成库版本、最近完成时间、退避时间和脱敏错误码。

Worker 每次只处理一个有界响应，顺序为集合、顶层条目、PDF 附件、文字批注和删除记录。请求使用 `If-Modified-Since-Version` 与 `since`，比较 `Last-Modified-Version`；远端在一轮中改变版本时，从上次完整游标重新读取。分页已应用的版本可安全重放。成功响应的 Backoff、429 的 Retry-After（秒数或 HTTP 日期）均会持久化，手动触发和连接测试不会绕过退避。每页最多 100 项，响应最多 4 MiB；集合、条目映射和文献数有上限。超限或格式异常不推进完整游标。

元数据按同一空间、本人 DOI／arXiv／PMID 去重；多个 Zotero 条目可映射到同一文献。集合改名会更新未改变的文献标签；普通文献编辑不能改集合标签或已绑定的 Zotero 身份。Zotero 文字批注采用 NFC/LF 规范化，页码从 1 开始；更新产生新的只读摘录版本，原摘录标记过期并保留正文及引用。Zotero 删除条目时，资源标记已归档且停止同步，不硬删用户内容。

每次 Worker 操作重新检查账户、工作区、成员与空间状态。旧知识空间读写、图和 AI 接受路径排除私人研究摘录；研究 AI 原有上下文入口仍按 Resource 归属检查。撤销凭据删除关联同步状态并停止任务，既有文献与摘录保留。账户最终删除按引用、摘录、文献顺序清理，避免外键遗留。迁移 `0047_zotero_sync` 是单 head 加法，有新增同步或批注数据时拒绝降级。

常见同步错误：`ZOTERO_RATE_LIMITED` 表示等待服务允许继续；`ZOTERO_IDENTIFIER_CONFLICT` 表示远端条目的多个标识符分别匹配不同已有文献，需要本人先核对；`ZOTERO_SYNC_ACCESS_REVOKED` 表示目标空间已无法访问；`ZOTERO_RESPONSE_INVALID` 表示本页未成功解析或违反约束。错误不会输出远端正文或凭据。
