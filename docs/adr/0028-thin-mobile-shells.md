# ADR-0028：三端薄壳移动应用

- 状态：Proposed
- 日期：2026-07-30
- 决策人：待 Logion project owner 确认签名与设备条件

## 背景

Logion 已有响应式 Web/PWA、端侧加密 Vault、IndexedDB、Outbox 和服务端权限边界。个人使用需要
Android、iOS 和鸿蒙安装包，但当前规模不适合维护三套独立业务实现，也不能让移动包形成不同的
权限、同步或数据模型。

## 提案

Web/PWA 继续作为权威产品核心。Android 和 iOS 使用 Capacitor 薄壳，鸿蒙 NEXT 使用 ArkUI Web
薄壳，均只加载正式 HTTPS 域名并复用现有 Cookie 会话、API 和同步协议。首版原生桥接保持最小，
只在通过单独威胁模型后加入系统分享、通知或文件选择；不实现后台常驻同步。

应用标识暂定为 `work.logion.app`。安装包及校验文件由 GitHub Actions 从固定源码 SHA 构建，签名
材料只保存在 GitHub Environments/Secrets 或操作系统签名存储中，不进入仓库、构建日志或安装包
资源。移动包不得内置账号、Cookie、API 密钥、恢复密钥、服务器 SSH 密钥或 AI Provider 凭据。

## 发布边界

- Android：发布 release-signed APK 与 SHA-256；keystore 和口令不上传；
- iOS：必须由 macOS/Xcode 和 Apple 签名身份产生可安装 IPA。Ad Hoc 描述文件可能包含设备 UDID，
  因此不得上传到公开 Release；只进入 Draft Release、私有构建产物或用户控制的私有仓库；
- 鸿蒙：根据实体设备系统版本选择 Android APK 兼容验证或 HarmonyOS NEXT 签名 HAP/APP；
- 所有包先经过恶意软件扫描、依赖清单、签名验证、真机登录/Vault/同步/弱网测试，再由人工创建
  GitHub Release；失败包不得复用版本号。

## 待确认

1. 是否有 Mac/Xcode、Apple Developer 签名方式和测试 iPhone；
2. 华为测试机是 HarmonyOS 4.x 还是 HarmonyOS NEXT 5.x 及以上；
3. 是否接受 `work.logion.app`，以及 iOS 产物使用 Draft Release/私有产物保存。

确认前只开展不依赖签名的共享壳设计和 Android 调试验证，不承诺可长期安装的 IPA/HAP。
