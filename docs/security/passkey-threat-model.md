# Passkey 威胁模型增量

- 工作包：`L1-002A`
- 状态：实现增量，合并前需独立安全复核
- 最后更新：2026-07-20
- 决策基线：`ADR-0002`
- 密码学实现：`py_webauthn 3.x`，BSD-3-Clause

## 范围

本增量覆盖 Passkey 注册、无用户名登录、凭据列表与撤销。TOTP、恢复码、邮件验证、正式登录界面和账户恢复属于后续独立工作包。

浏览器创建和持有私钥；Logion 只保存 credential ID、COSE 公钥、签名计数器、AAGUID、传输方式和备份状态。服务端 challenge 是短时、单次并绑定用途的数据库记录。

## 威胁与控制

| 威胁                         | 当前控制                                                                                                  | 验证证据                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 伪造注册或登录响应           | 使用 `py_webauthn` 验证 client data、authenticator data、签名和 COSE 公钥，不手写验证密码学               | 本地软件 P-256 attestation/assertion 测试；Linux 集成测试 |
| Challenge 重放               | 128 位以上随机 challenge；服务端存储；用途、用户和过期时间校验；`FOR UPDATE` 后单次消费                   | 集成测试重复提交同一登录 challenge 必须失败               |
| Origin/RP 欺骗               | RP ID 与 Origin 配置校验；生产只允许 HTTPS；验证时绑定本次 HTTP Origin，而不是只匹配允许列表              | 集成测试用同 RP ID 的另一 Origin 构造响应并拒绝           |
| 用户未验证                   | 注册和登录均要求 WebAuthn UV；注册要求 discoverable credential                                            | options 契约和密码学测试验证 `userVerification=required`  |
| 凭据枚举                     | 登录 options 不接收邮箱且不返回 allow list；未知 credential 返回统一错误                                  | 集成测试撤销后登录只返回 `AUTH_PASSKEY_INVALID`           |
| 账户错绑                     | 注册 challenge 绑定当前用户；无用户名登录要求 userHandle 与 credential 所属用户 UUID 常量时间匹配         | 服务层校验和完整登录测试                                  |
| Authenticator 克隆或计数回退 | 对有效签名执行计数器回退检测；非零计数未递增时自动撤销凭据并写安全审计                                    | 集成测试重复有效计数触发撤销                              |
| 恶意或超大响应               | Pydantic 限制 ID、clientData、attestation、signature、transport 数量；未请求扩展时要求空 extension result | OpenAPI schema、422 脱敏错误与单元测试                    |
| 凭据管理 CSRF                | 注册、验证和撤销要求可信 WebAuthn Origin、会话绑定 CSRF 与最近登录                                        | 集成测试通过受保护流程，负向测试由 API 错误契约覆盖       |
| 数据库泄漏                   | 数据库不保存 Passkey 私钥；challenge 短时有效；IP 只保存 HMAC 摘要                                        | 模型与迁移审查                                            |
| 伪造来源地址绕过限流         | 边缘 Nginx 覆盖客户端 `X-Forwarded-For`；API 仅在内部网络信任代理头                                       | Compose/Nginx 配置检查与部署 smoke                        |

## 剩余风险

- 同步 Passkey 常使用恒为零的签名计数器，此时无法用计数器发现克隆；设备平台和账户恢复安全仍是外部信任边界。
- 自动撤销非零计数回退凭据可能在异常 authenticator 实现上产生误报。安全审计必须支持定位，恢复依赖后续 TOTP/恢复码工作包。
- 撤销 Passkey 阻止后续登录，但不会自动终止已签发的其他设备会话；用户可在设备列表单独撤销会话。是否提供“撤销凭据并退出所有设备”需单独产品确认。
- AAGUID、设备类型和传输方式可能形成设备特征，只用于安全与凭据管理，不进入产品分析或公开导出。
- 本增量没有邮件验证和完整恢复方案，不可单独作为公开生产身份系统发布。

## 合并与运行门槛

- 必须由非实现者复核 RP ID、Origin、challenge 消费、userHandle、签名计数器、迁移和错误响应。
- CI 必须完成 `0001 -> 0003 -> base -> 0003` 迁移往返、真实 PostgreSQL/Redis Passkey 流程、OpenAPI 兼容和供应链扫描。
- 正式部署前必须配置稳定 RP ID；RP ID 变更会使既有 Passkey 无法在新域使用，需要迁移沟通而非静默切换。
- 有生产凭据后不得通过 downgrade 删除 Passkey 表；采用前向修复并保留安全审计。
