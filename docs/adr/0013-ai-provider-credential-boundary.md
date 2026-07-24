# ADR 0013：AI Provider 凭据与网络边界

状态：Phase 5 L5-001 已接受

## 决策

- AI Provider 配置属于 Workspace 范围，仅 Owner/Admin 可通过明确的 `ai.configure` 权限操作；前端可见性不构成授权。
- L5-001 只支持 `openai_compatible` Provider 元数据。创建、更新或删除配置不发起外部请求，也不能影响核心学习流程。
- Provider 凭据使用每记录 AES-256-GCM 数据密钥，并由版本化服务端 keyring 包裹。AAD 将密文绑定到 Workspace、Provider ID 和 key ID。API 只暴露 `credential_configured`；浏览器存储、日志、审计元数据和导出绝不能收到凭据材料。
- Base URL 必须是公网 HTTPS，不含用户信息、查询或片段，只允许受限端口，禁止回环/私有/保留 IP 字面量及本地/内部主机名。运行时 DNS 解析、重定向复核和连接健康属于 L5-002，必须逐跳重新验证。
- 删除 Provider 是软删除元数据墓碑，同时立即清空全部凭据密文和包裹数据密钥字段；允许复用已删除名称。

## 兼容与恢复

迁移 0023 为增量迁移。密钥轮换先增加新 key ID、切换活动 ID，再重新包裹数据密钥，之后才能停用旧密钥。备份必须保留解密现有记录或保留备份代际所需的全部密钥。产生生产凭据后，回滚应禁用 AI 路由/UI 并前向修复，不得删除 Provider 表或加密密钥。
