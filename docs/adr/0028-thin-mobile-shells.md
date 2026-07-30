# ADR-0028：三端薄壳移动应用

- 状态：Accepted
- 日期：2026-07-30
- 决策人：Logion project owner

## 背景

Logion 已有响应式 Web/PWA、端侧加密 Vault、IndexedDB、Outbox 和服务端权限边界。个人使用需要
Android、iOS 和鸿蒙安装包，但当前规模不适合维护三套独立业务实现，也不能让移动包形成不同的
权限、同步或数据模型。

## 提案

Web/PWA 继续作为权威产品核心。Android 和 iOS 使用 Capacitor 薄壳，鸿蒙 NEXT 使用 ArkUI Web
薄壳，均只加载正式 HTTPS 域名并复用现有 Cookie 会话、API 和同步协议。首版原生桥接保持最小，
只在通过单独威胁模型后加入系统分享、通知或文件选择；不实现后台常驻同步。

应用标识确认为 `work.logion.app`。安装包及校验文件由 GitHub Actions 从固定源码 SHA 构建，签名
材料只保存在 GitHub Environments/Secrets 或操作系统签名存储中，不进入仓库、构建日志或安装包
资源。移动包不得内置账号、Cookie、API 密钥、恢复密钥、服务器 SSH 密钥或 AI Provider 凭据。

## 发布边界

- Android：发布 release-signed APK 与 SHA-256；keystore 和口令不上传；
- iOS：使用 Mac、Xcode 和免费 Apple Personal Team 做个人开发签名，只用于已连接的测试 iPhone。
  该签名通常约 7 天后失效，需要重新安装；免费账号不承诺 Ad Hoc 分发或长期可安装 IPA。测试构建
  记录只能进入 Draft Release 或私有构建产物，不得公开设备标识、描述文件或签名材料；
- 鸿蒙：测试机已确认为 HarmonyOS 6.x，按 HarmonyOS NEXT 原生应用处理，交付签名 HAP/APP，
  不把 Android APK 当作鸿蒙安装包；
- 所有包先经过恶意软件扫描、依赖清单、签名验证、真机登录/Vault/同步/弱网测试，再由人工创建
  GitHub Release；失败包不得复用版本号。

## 确认状态

已确认：

- 有测试 iPhone；
- 有可用 Mac；
- Apple 账号使用免费 Personal Team，不加入付费 Apple Developer Program；
- 同意 iOS 测试构建只进入 Draft Release/私有构建产物；
- 有真实 Android 手机用于 APK 验收；
- 华为测试机为 HarmonyOS 6.x；
- 接受应用标识 `work.logion.app`。

因此 iOS 首版验收方式固定为 Mac/Xcode 连接测试 iPhone 安装，不把免费 Personal Team 构建描述为
可长期安装的发行 IPA。HarmonyOS 6.x 的 HAP 仍需 DevEco Studio、开发者模式和华为签名材料完成
真机验收。
