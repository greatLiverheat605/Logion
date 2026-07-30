# 移动薄壳威胁模型

## 资产与信任边界

需要保护的资产包括登录会话、端侧 Vault、IndexedDB/Outbox、研究资料、同步内容、APK/HAP/iOS
签名身份以及恢复密钥。权威业务边界仍位于 `https://logion.work` 和现有 API；移动壳只负责打开
该 HTTPS 应用，不拥有额外权限或服务端凭据。

## 主要威胁与控制

| 威胁                       | 控制                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| 安装包被替换或重签名       | 固定源码 SHA 构建；验证平台签名；发布 SHA-256；禁止复用泄露的版本号 |
| Android 壳被导向仿冒站     | TWA + Digital Asset Links；固定 `logion.work`；只允许 HTTPS         |
| iOS 壳导航到仿冒站         | WKAppBoundDomains；导航代理精确匹配 HTTPS 主机；站外链接交给 Safari |
| 网页借原生桥扩大权限       | 三端首版不注册 JavaScript 消息桥，不添加文件、通知或后台同步桥      |
| 明文或用户 CA 中间人       | 禁止 cleartext/mixed content；Android 壳不信任用户 CA；iOS ATS 开启 |
| 系统备份复制应用私有状态   | Android `allowBackup=false`；iOS 不创建第二份凭据或自定义令牌存储   |
| 构建日志或仓库泄露签名材料 | keystore、证书、Profile、口令、UDID 进入忽略规则和受保护密钥存储    |
| 调试包被误当正式发布       | 调试 APK 只作为 7 天 CI 产物；正式 Release 必须签名、验签和真机通过 |
| Web 内容进程崩溃或网络中断 | 原生失败提示和显式重试；不得因此自动清除 Cookie、Vault 或站点数据   |

## 剩余风险

- Android TWA 依赖受支持的浏览器；数字资产链接失败时会降级显示浏览器界面，不能当作正式验收通过。
- TWA 与 Chrome 共享网站存储；清除 Chrome 的 Logion 站点数据会清除本机 Vault，需要沿用现有恢复流程。
- iOS 免费 Personal Team 签名短期失效；重新安装前不能保证应用可启动。
- WKWebView 与 Safari 不共享全部网站数据，iPhone 首次安装需要重新登录和解锁 Vault。
- HarmonyOS Web 内核和系统签名行为必须在目标 HarmonyOS 6.x 真机上验证，不能由 Android 结果替代。

## 后续原生能力门禁

系统分享、文件选择、通知、生物识别或后台任务每项都必须单独说明数据流、最小权限、撤销方式、
日志去敏和失败回退，并经过独立 PR 审查。不得引入接收任意网页消息的通用桥。
