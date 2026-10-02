# Windows 异机加密备份手册

## 1. 目标与边界

Logion 不使用 OSS。生产服务器每天生成已经通过 AES-256-GCM 认证加密的 `.backup` 及其
`.sha256`；Windows 电脑经 WireGuard 隧道、使用受限 SSH 密钥把密文副本下载到
`<本地密文备份根目录>`，下载完成后再次核对 SHA-256。恢复密钥单独保存在
`<独立恢复密钥文件路径>`，不得与备份一起上传、同步
或提交到 Git。

该方案适合个人及最多 10 人的低频自托管，但必须理解：Windows 电脑关机、休眠或未登录时，任务
不会执行。至少每周确认一次最新文件日期，每季度完成一次隔离恢复演练。

## 2. 安全条件

- 所有者已于 2026-10-01 关闭 ECS 公网 SSH 22；SSH 仅经 WireGuard 隧道并使用专用 Ed25519 密钥登录，不接受密码登录；
- 先确认 WireGuard 隧道服务运行，再执行手动拉取或注册计划任务；计划任务不会自动启动或修复隧道；
- 私钥和 known_hosts 分别由 `<SSH 私钥文件路径>`、`<SSH known_hosts 文件路径>` 指定，仅当前任务用户可访问，不放入仓库；
- 首次连接由人工核对服务器 host key，脚本固定使用 `StrictHostKeyChecking=yes`；
- 脚本只读取完整命名的 `logion-*.backup` 和 `.sha256`，不读取 `.env`、数据库明文或恢复密钥；
- 本地目录不得被公共网盘、聊天软件或未经评审的同步工具自动上传；
- BitLocker 应覆盖所选备份目录所在磁盘，Windows 账户应有强口令和自动锁屏。

管理通道、设备 peer 登记与阿里云控制台 VNC 应急入口见
[生产手册 §2.1](./aliyun-production-release.md#21-管理通道)。首次改用隧道地址时，通过受信任的
控制台 VNC 核对 SSH 主机指纹，再将已核验的隧道地址/主机 key 绑定写入所选 known_hosts；
不能因为地址变化而关闭 host key 校验。WireGuard 设备密钥与 SSH 登录密钥分别管理。

## 3. 首次手动同步

在仓库根目录打开 PowerShell，先将以下占位符替换为受控环境中的实际值。后续命令沿用这些
变量，不依赖脚本内的默认盘符或文件路径。`<隧道地址>` 使用隧道 IPv4 地址或仅解析到该地址的
主机名，符合现有拉取脚本的参数格式；不填写 ECS 公网 IP。

```powershell
$backupRoot = "<本地密文备份根目录>"
$backupRemoteUser = "<备份 SSH 用户>"
$backupIdentityFile = "<SSH 私钥文件路径>"
$backupKnownHostsFile = "<SSH known_hosts 文件路径>"
$backupTaskName = "<计划任务名称>"
$backupDailyAt = "<每日执行时间 HH:mm>"
$wireGuardServiceName = 'WireGuardTunnel$<隧道名称>'

$tunnelService = Get-Service -Name $wireGuardServiceName -ErrorAction Stop
if ($tunnelService.Status -ne 'Running') {
  throw '先确认 WireGuard 隧道服务运行，再拉取备份。'
}
```

服务名称使用本机已安装的隧道服务名。服务 Running 只是前置条件，还须确认对应 peer 的握手
和路由正常；实际拉取成功才证明隧道内 SSH/SCP、权限与文件校验均可用。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\operations\sync-latest-backup.ps1 `
  -RemoteHostName "<隧道地址>" `
  -RemoteUser $backupRemoteUser `
  -BackupRoot $backupRoot `
  -IdentityFile $backupIdentityFile `
  -KnownHostsFile $backupKnownHostsFile
```

成功时会输出本地文件路径，并在所选备份根目录下的 `status/last-run.json` 和按日日志中记录不含凭据
的结果。重复执行会重新验证本地最新文件，不会下载数据库明文。脚本默认保留最近 30 份日备份，
并额外保留最近 12 个自然月中每月最新的一份；清理范围严格限定在
所选备份根目录的 `encrypted` 子目录中符合 Logion 完整备份命名的文件，不删除服务器副本，也不触碰
恢复密钥。

核对最新文件：

```powershell
Get-ChildItem -LiteralPath (Join-Path $backupRoot 'encrypted') -Filter 'logion-*.backup' |
  Sort-Object Name -Descending |
  Select-Object -First 3 Name, Length, LastWriteTime
```

## 4. 注册每日任务

按 `$backupDailyAt` 指定的本地时间执行；电脑须开机、当前用户已登录且 WireGuard 隧道服务保持
运行。先完成 §3 的手动同步，再用同一组变量注册。路径应为本机绝对路径，不使用共享目录或
目录链接；任务名用于后续查询和触发，须与实际登记名称一致。

当前 `register-backup-sync-task.ps1` 未把自定义备份目录和 SSH 文件参数传给拉取动作。
为确保配置在定时执行时同样生效，本手册使用 Windows 原生计划任务命令显式传参：

```powershell
$backupRemoteHost = "<隧道地址>"
$automationDirectory = Join-Path $backupRoot 'automation'
New-Item -ItemType Directory -Path $automationDirectory -Force | Out-Null
$installedScript = Join-Path $automationDirectory 'Sync-LatestLogionBackup.ps1'
Copy-Item -LiteralPath .\scripts\operations\sync-latest-backup.ps1 -Destination $installedScript -Force

$taskArguments = (
  '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
  '-File "{0}" -RemoteHostName "{1}" -RemoteUser "{2}" ' +
  '-BackupRoot "{3}" -IdentityFile "{4}" -KnownHostsFile "{5}"'
) -f $installedScript, $backupRemoteHost, $backupRemoteUser, $backupRoot, $backupIdentityFile, $backupKnownHostsFile
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments -WorkingDirectory $automationDirectory
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @(
  New-ScheduledTaskTrigger -Daily -At $backupDailyAt
  New-ScheduledTaskTrigger -AtLogOn -User $taskUser
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $backupTaskName -Action $action -Trigger $triggers `
  -Settings $settings -Principal $principal | Out-Null
```

注册不保存 Windows 密码，任务使用当前用户的交互登录令牌。错过运行时间后，Windows 会在
下次满足条件时尽快补跑。若同名任务已存在，先核对是否属于本备份，再由运维方更新其配置，
不要直接覆盖其他任务；迁移后停用旧公网地址任务，避免两套任务重复执行。查看状态：

```powershell
Get-ScheduledTask -TaskName $backupTaskName |
  Get-ScheduledTaskInfo
```

手动触发一次并等待几分钟后检查历史：

```powershell
Start-ScheduledTask -TaskName $backupTaskName
Get-Content -LiteralPath (Join-Path $backupRoot 'status/last-run.json')
```

## 5. 日常检查与失败处理

每天至少应有一份服务器加密备份；Windows 本地副本最多允许落后 48 小时。发现落后时依次检查：

1. 电脑是否在计划时间开机且已登录；
2. 所选备份目录所在磁盘是否在线且空间充足；
3. WireGuard 隧道服务、对应 peer 握手和隧道地址路由是否正常，安全组是否保留 UDP 51820；
4. SSH host key 是否发生预期外变化；
5. 服务器 Backup 容器是否运行、最近 `.backup` 与 `.sha256` 是否成对存在。

host key 变化、哈希不一致或同名文件内容不同都必须停止，不得使用关闭校验、覆盖文件或重新生成
恢复密钥的方式绕过。

隧道无法恢复时，使用阿里云控制台 VNC 排障；不临时开放公网 22，也不改为密码 SSH 登录。

## 6. 恢复演练与保留

- Windows 默认保留最近 30 份日备份，并额外保留最近 12 个月每月最新的一份；
- 服务器仍按 Compose 的保留期维护本机副本，Windows 清理不会影响服务器；
- 每月抽查本地 SHA-256，每季度把一份备份复制到隔离临时目录并按
  [备份与恢复操作手册](./backup-restore.md#空环境演练)恢复；
- 演练只使用明确命名的空数据库和空附件目录，不覆盖生产；
- 恢复密钥若丢失，现有加密备份无法恢复。密钥变更必须保留旧代际直到对应备份全部过期并完成
  抽样恢复。
