# HarmonyOS 6.x ArkUI Web 生成与验收

## 1. 当前边界

HarmonyOS 必须交付 DevEco Studio 生成并签名的 HAP/APP，不能把 Android APK 当成鸿蒙安装包。首版
只使用 ArkUI Web 加载 `https://logion.work/app/today`，不注册 JavaScript 消息桥，不申请文件、
通知、相机、麦克风、定位或后台运行权限。

仓库当前不提交手写的 DevEco 工程骨架。原因是 HarmonyOS 6.x 工程清单、SDK 级别和签名配置必须
由实际安装的 DevEco Studio 与目标设备生成；未经生成器和真机编译的文件不能冒充可构建工程。

## 2. 环境准备

1. 在 Windows 安装华为官方 DevEco Studio 当前稳定版；
2. 安装与 HarmonyOS 6.x 测试机匹配的 SDK；
3. 手机开启开发者模式和 USB 调试，只授权当前电脑；
4. DevEco Studio 中登录用于个人调试的华为开发者账号；
5. 不把账号口令、签名私钥或设备标识写入仓库。

## 3. 生成权威工程

1. File → New → Create Project；
2. 选择适用于 HarmonyOS 6.x 的 `Empty Ability`（Stage 模型、ArkTS）；
3. 应用名称填写 `Logion`；
4. Bundle Name 填写 `work.logion.app`；
5. 保存到仓库的 `apps/mobile/harmony`；
6. Compatible SDK 选择测试机实际支持的版本，不凭空指定；
7. 完成生成后先运行模板到真机，记录 DevEco、SDK 和设备系统版本。

生成成功后再进行第二个独立 PR：把首页替换为 ArkUI `Web` 组件，固定 HTTPS 域名，开启 DOM 存储，
禁止混合内容和 Web 调试，精确拦截站外导航并交给系统浏览器。该实现必须以生成工程中的真实 API
写法为准，不能从 Android 或旧版 HarmonyOS 示例猜写。

## 4. 验收与发布门禁

- `work.logion.app`、版本号和签名身份一致；
- HAP/APP 验签通过，签名材料未进入 Git；
- 应用内没有通用 JavaScript 消息桥；
- 登录、Vault、16 路由、真实记录、附件、同步、离线、冲突、返回键、外链、软键盘和弱网通过；
- 卸载/重装和签名到期行为已记录；
- 通过恶意软件扫描并生成 SHA-256。

只有上述门禁全绿后，才能把签名 HAP/APP 与校验文件上传 GitHub Release。
