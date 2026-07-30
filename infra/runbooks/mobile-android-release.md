# Android TWA 构建、签名与真机验收

## 1. 前置条件

- JDK 21；
- Android Studio 与 Android SDK 36；
- 一台启用 USB 调试的真实 Android 手机；
- `logion.work` 已通过 HTTPS 对外提供当前版本；
- 独立 Android release keystore，并至少保存一份离线备份。

当前 Windows 未安装 JDK/Android SDK 时，可先依赖 GitHub `Mobile builds` 工作流验证无签名调试 APK；
调试产物只保留 7 天，不得放入 GitHub Release。

## 2. 本地基础校验

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @logion/mobile test
pnpm --filter @logion/mobile android:check
```

最后一条会运行 Android lint、单元测试并生成调试 APK：

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## 3. 首次创建正式签名

签名只创建一次。不要把 keystore、口令或命令输出粘贴到 Issue、PR、聊天或仓库。使用 JDK 自带
`keytool` 以交互方式创建，避免把口令写入命令历史：

```powershell
keytool -genkeypair -v `
  -keystore F:\LogionMobileSigning\logion-android-release.jks `
  -alias logion `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

把 keystore 复制到另一块离线介质；两份都应限制为当前 Windows 用户可读。丢失正式 keystore 后，
同一应用标识无法安全延续升级。

## 4. 获取公开证书指纹

证书 SHA-256 指纹不是秘密，但必须来自正式 keystore：

```powershell
keytool -list -v `
  -keystore F:\LogionMobileSigning\logion-android-release.jks `
  -alias logion
```

复制输出中的 `SHA256`，保留冒号分隔的 32 组十六进制字节。在服务器 `/opt/logion/.env` 设置：

```dotenv
LOGION_ANDROID_CERT_SHA256_FINGERPRINTS=["AA:BB:...:FF"]
```

该值公开且不是口令。重新发布 Web 容器后验证：

```bash
curl --fail --silent https://logion.work/.well-known/assetlinks.json
```

返回内容必须同时包含包名 `work.logion.app` 和刚才的完整 SHA-256 指纹。空配置应返回 404，格式
错误返回 503；这两种状态都不能构建正式包。

## 5. 构建正式 APK

构建脚本只从进程环境读取签名信息，不读取仓库内明文口令文件。为当前构建进程设置以下四项：

- `LOGION_ANDROID_KEYSTORE_PATH`
- `LOGION_ANDROID_KEYSTORE_PASSWORD`
- `LOGION_ANDROID_KEY_ALIAS`
- `LOGION_ANDROID_KEY_PASSWORD`

然后执行：

```powershell
pnpm --filter @logion/mobile android:release
```

任何一项缺失都会停止构建。完成后清除当前终端中的四个环境变量并关闭终端。正式 APK 位于：

`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

## 6. 验签与安装

```powershell
apksigner verify --verbose --print-certs `
  apps\mobile\android\app\build\outputs\apk\release\app-release.apk

Get-FileHash `
  apps\mobile\android\app\build\outputs\apk\release\app-release.apk `
  -Algorithm SHA256

adb install --replace `
  apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

`apksigner` 输出的证书 SHA-256 必须与网站 `assetlinks.json` 一致。安装后检查 App Links：

```powershell
adb shell pm verify-app-links --re-verify work.logion.app
adb shell pm get-app-links work.logion.app
```

`logion.work` 必须显示已验证；打开应用时不应出现地址栏。出现地址栏说明 TWA 已降级，不能发布。

## 7. 真机验收和发布

至少完成：登录/退出、Vault 解锁、16 路由、真实记录创建编辑、附件、双设备同步、离线 Outbox、
冲突、返回键、外链、软键盘、旋转、弱网恢复和站点数据清除提示。随后执行恶意软件扫描并生成
APK SHA-256。

只有人工确认上述结果后，才把签名 APK 和校验文件上传 GitHub Release。不要上传 keystore、口令、
调试 APK、ADB 日志中的个人数据或包含设备标识的文件。
