# ADR-0002：浏览器认证与会话边界

- 状态：Accepted
- 日期：2026-07-19
- 决策人：Logion project owner

## 背景

首发需要密码、Passkey、TOTP、恢复码、多设备撤销和完整离线编辑。浏览器不能持有 AI Provider 密钥、TOTP secret、恢复码明文或长期认证秘密。

## 决策

服务端承担全部认证判定。密码使用版本化 Argon2id；Passkey 使用 WebAuthn 并校验 challenge、origin、RP ID 与计数器；TOTP secret 信封加密；恢复码只保存慢哈希且单次使用。

浏览器认证使用 Secure、HttpOnly、合理 SameSite 的 Cookie。短期 access 会话与轮换 refresh 会话分离，检测 refresh 重用；写请求增加 CSRF 防护。设备和会话可枚举、撤销，撤销立即停止服务端同步。离线 PIN/设备密钥只解锁本地副本，不代表在线身份。

## 后果

- 前端不能读取或记录认证 Token；
- 撤销无法抹除已经离线缓存的明文风险，产品必须披露；
- Phase 1 实现前需再确定 WebAuthn RP ID、邮件验证和恢复最少组合；
- 认证、恢复和 Provider 测试使用独立限流与审计。
