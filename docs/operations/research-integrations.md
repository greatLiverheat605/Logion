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

本次实现提供凭据管理，文献同步与 PDF 获取将在后续阅读链路接入；“已连接”只代表最近一次连接测试成功。
