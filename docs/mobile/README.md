# Logion 移动端

Logion 移动端采用“一个 Web/PWA 业务核心 + 三个无 JavaScript 原生桥薄壳”。移动端不复制 API、
权限、同步协议或数据模型，也不在安装包内保存账号、Cookie、AI 密钥、SSH 密钥或恢复密钥。

| 平台      | 技术方案                    | 当前仓库交付                                    | 真机构建环境              |
| --------- | --------------------------- | ----------------------------------------------- | ------------------------- |
| Android   | Chrome Trusted Web Activity | 可构建 Gradle 工程、品牌资源、CI 调试 APK       | JDK 21、Android SDK 36    |
| iOS       | SwiftUI + WKWebView         | XcodeGen 工程源、App-bound domain、安全导航策略 | Mac、Xcode、Personal Team |
| HarmonyOS | ArkUI Web                   | 生成与验收手册；不提交未经 DevEco 生成的伪工程  | DevEco Studio、测试设备   |

正式入口统一为 `https://logion.work/app/today`，应用标识统一为 `work.logion.app`。Android 的正式
APK 还必须与 `https://logion.work/.well-known/assetlinks.json` 中的签名证书指纹匹配。iOS 免费
Personal Team 构建通常约 7 天失效，只用于已连接的测试 iPhone，不作为长期 IPA 分发方案。

详细步骤：

- Android：[mobile-android-release.md](../../infra/runbooks/mobile-android-release.md)
- iOS：[mobile-ios-personal-team.md](../../infra/runbooks/mobile-ios-personal-team.md)
- HarmonyOS：[mobile-harmonyos-6.md](../../infra/runbooks/mobile-harmonyos-6.md)
- 安全边界：[mobile-shell-threat-model.md](../security/mobile-shell-threat-model.md)

首版真机验收必须覆盖：登录与退出、Vault 解锁、16 个业务路由、创建和编辑真实记录、双设备同步、
离线 Outbox、冲突处理、外链、返回手势、旋转、软键盘、弱网、恢复联网和清除站点数据提示。
