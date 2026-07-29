# Windows 异机加密备份手册

## 1. 目标与边界

Logion 不使用 OSS。生产服务器每天生成已经通过 AES-256-GCM 认证加密的 `.backup` 及其
`.sha256`；Windows 电脑通过受限 SSH 密钥把密文副本下载到 `F:\LogionBackups`，下载完成后再次
核对 SHA-256。恢复密钥单独保存在 `F:\LogionRecoveryKey\backup.key`，不得与备份一起上传、同步
或提交到 Git。

该方案适合个人及最多 10 人的低频自托管，但必须理解：Windows 电脑关机、休眠或未登录时，任务
不会执行。至少每周确认一次最新文件日期，每季度完成一次隔离恢复演练。

## 2. 安全条件

- 服务器 SSH 只允许当前固定公网 IP，并使用专用 Ed25519 密钥；
- 私钥保存在当前 Windows 用户的 `~/.ssh` 下，不放入仓库；
- 首次连接由人工核对服务器 host key，脚本固定使用 `StrictHostKeyChecking=yes`；
- 脚本只读取完整命名的 `logion-*.backup` 和 `.sha256`，不读取 `.env`、数据库明文或恢复密钥；
- 本地目录不得被公共网盘、聊天软件或未经评审的同步工具自动上传；
- BitLocker 应覆盖 `F:` 所在磁盘，Windows 账户应有强口令和自动锁屏。

## 3. 首次手动同步

在仓库根目录打开 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\operations\sync-latest-backup.ps1 `
  -RemoteHostName "<ECS 公网 IP 或主机名>"
```

成功时会输出本地文件路径，并在 `F:\LogionBackups\status\last-run.json` 和按日日志中记录不含凭据
的结果。重复执行会重新验证本地最新文件，不会下载数据库明文。脚本默认保留最近 30 份日备份，
并额外保留最近 12 个自然月中每月最新的一份；清理范围严格限定在
`F:\LogionBackups\encrypted` 中符合 Logion 完整备份命名的文件，不删除服务器副本，也不触碰
恢复密钥。

核对最新文件：

```powershell
Get-ChildItem F:\LogionBackups\encrypted\logion-*.backup |
  Sort-Object Name -Descending |
  Select-Object -First 3 Name, Length, LastWriteTime
```

## 4. 注册每日任务

电脑每天 03:30 处于开机且当前用户已登录时执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\operations\register-backup-sync-task.ps1 `
  -RemoteHostName "<ECS 公网 IP 或主机名>"
```

注册脚本不保存 Windows 密码，任务使用当前用户的交互登录令牌。错过运行时间后，Windows 会在
下次满足条件时尽快补跑。查看状态：

```powershell
Get-ScheduledTask -TaskName "Logion encrypted backup sync" |
  Get-ScheduledTaskInfo
```

手动触发一次并等待几分钟后检查历史：

```powershell
Start-ScheduledTask -TaskName "Logion encrypted backup sync"
Get-Content F:\LogionBackups\status\last-run.json
```

## 5. 日常检查与失败处理

每天至少应有一份服务器加密备份；Windows 本地副本最多允许落后 48 小时。发现落后时依次检查：

1. 电脑是否在计划时间开机且已登录；
2. `F:` 是否在线且空间充足；
3. 当前公网 IP 是否仍在 ECS 安全组 SSH 白名单；
4. SSH host key 是否发生预期外变化；
5. 服务器 Backup 容器是否运行、最近 `.backup` 与 `.sha256` 是否成对存在。

host key 变化、哈希不一致或同名文件内容不同都必须停止，不得使用关闭校验、覆盖文件或重新生成
恢复密钥的方式绕过。

## 6. 恢复演练与保留

- Windows 默认保留最近 30 份日备份，并额外保留最近 12 个月每月最新的一份；
- 服务器仍按 Compose 的保留期维护本机副本，Windows 清理不会影响服务器；
- 每月抽查本地 SHA-256，每季度把一份备份复制到隔离临时目录并按
  [备份与恢复操作手册](./backup-restore.md#空环境演练)恢复；
- 演练只使用明确命名的空数据库和空附件目录，不覆盖生产；
- 恢复密钥若丢失，现有加密备份无法恢复。密钥变更必须保留旧代际直到对应备份全部过期并完成
  抽样恢复。
