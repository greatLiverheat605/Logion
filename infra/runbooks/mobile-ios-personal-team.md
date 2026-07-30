# iOS 免费 Personal Team 真机流程

## 1. 能做与不能做

本方案需要 Mac、Xcode、Apple ID 和已连接的测试 iPhone。免费 Personal Team 可用于个人真机调试，
签名通常约 7 天失效，需要重新通过 Xcode 安装。它不是 Ad Hoc、TestFlight 或长期 IPA 分发方案。

仓库不保存 Apple ID、证书私钥、Provisioning Profile、设备 UDID 或登录 Cookie。Draft Release 只
保存源码 SHA、测试记录和非敏感日志；不要把 Personal Team 构建描述成长期可安装 IPA。

## 2. Mac 准备

1. 从 App Store 安装当前稳定版 Xcode，首次启动完成组件安装；
2. Xcode → Settings → Accounts → `+` → Apple ID，登录个人账号；
3. iPhone 连接 Mac，在 iPhone 上选择“信任”；
4. iPhone → 设置 → 隐私与安全性 → 开发者模式，按系统提示重启并确认；
5. 安装 XcodeGen：`brew install xcodegen`。

## 3. 生成工程

在仓库根目录执行：

```bash
cd apps/mobile/ios
xcodegen generate
open Logion.xcodeproj
```

`project.yml` 是受版本控制的权威工程定义；生成的 `Logion.xcodeproj` 不提交。应用标识固定为
`work.logion.app`，最低 iOS 版本为 16.0。

## 4. 免费签名并安装

1. Xcode 选择 `Logion` target → Signing & Capabilities；
2. 勾选 Automatically manage signing；
3. Team 选择自己的 Personal Team；
4. 顶部设备选择已连接的测试 iPhone；
5. Product → Clean Build Folder；
6. 点击 Run；
7. 若 iPhone 提示不信任开发者，在“设置 → 通用 → VPN 与设备管理”中按系统提示信任。

不要添加 Associated Domains、推送通知或后台模式 entitlement；免费账号可能不支持，首版也不需要。

## 5. 安全与功能验收

- 应用内只允许 HTTPS `logion.work`；外部 HTTPS 和邮件链接交给系统处理；
- WKWebView 检查器关闭，不存在 `WKScriptMessageHandler` 或通用消息桥；
- ATS 禁止任意加载，App-bound domains 只包含 `logion.work`；
- 首次登录、退出、重新登录、Vault 解锁和重新安装后的恢复提示正确；
- 16 路由、真实记录、附件、同步、离线 Outbox、冲突、返回手势、旋转和软键盘通过；
- 无网时显示原生失败页，点击重新连接不会清除站点数据；
- 站外论文链接在 Safari 打开，返回 Logion 后状态仍正常。

免费签名到期后重复第 3、4 节。未经过当前测试 iPhone 验收的构建不得上传任何 Release。
