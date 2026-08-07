# V20-11 附件扫描、隔离与恢复 Runbook

状态：候选实现已接入，生产开关仍默认关闭。只有 V20-11 的协调账本记录全部真实验收证据后，才允许进入 V20-12 评审；本 Runbook 本身不授予任何生产启用权。

## 1. 不可变边界

- `knowledge_space_attachment_ingest_enabled`、Local Worker、Shared Write、Deletion、Provider、sync-v1 和 AI Acceptance 继续默认关闭。
- 附件只有在服务端完成大小、MIME、SHA-256 和 ClamAV 扫描后，才能从 staging 原子落入 verified。
- 扫描器只允许连接 loopback 的 clamd TCP 端口；远程主机名、远程地址和 URL 均拒绝。
- 扫描命中、超时、不可用、内容变化和隔离失败全部 fail-closed，不产生 verified 文件。
- 审计只记录固定错误码、大小、声明 MIME 和附件 ID；不记录原始文件名、文件内容、token、连接串或病毒签名文本。

## 2. 状态与错误码

| 情况             | 数据库状态 | API 错误码                        | 处置                                |
| ---------------- | ---------- | --------------------------------- | ----------------------------------- |
| 扫描通过         | `verified` | 无                                | 原子写入 verified，清理 staging     |
| 命中恶意样本     | `failed`   | `ATTACHMENT_MALWARE_FOUND`        | 尝试移动到加密隔离区，产生告警审计  |
| 扫描器不可用     | `failed`   | `ATTACHMENT_SCANNER_UNAVAILABLE`  | 不重试写入，等待服务恢复            |
| 扫描超时         | `failed`   | `ATTACHMENT_SCANNER_TIMEOUT`      | 记录告警，使用新版本重试            |
| 隔离移动失败     | `failed`   | `ATTACHMENT_QUARANTINE_FAILED`    | 保留 fail-closed 结果，人工检查残留 |
| 扫描前后内容变化 | `failed`   | `ATTACHMENT_SCAN_CONTENT_CHANGED` | 丢弃 staging，禁止 finalize         |

## 3. 日常运行

1. 确认加密卷处于 `FullyEncrypted`、保护状态为 `On`，且 `J:\Attachments`、`J:\AttachmentQuarantine`、`J:\ClamAVData` 的 ACL 仅包含 Administrator、Administrators 和 SYSTEM。
2. 确认 `ClamAV ClamD` 服务为 Automatic/Running，监听地址为 `127.0.0.1:3310`；不得对外开放端口。
3. 确认 clamd 的数据库、临时目录、日志、PID 和隔离目录均在加密卷。
4. 检查 staging 中的 `.part` 残留；只有确认没有活动上传后，才执行受控清理并记录残留数量。
5. 任何 scanner unavailable/timeout 都先恢复 clamd 和病毒库，再用同一附件 ID 的新版本重试；不得直接把状态改为 verified。

## 4. 验收演练

- 干净样本：使用 PDF、PNG、HTML、纯文本等不含恶意内容的样本，通过 `INSTREAM` 扫描并核对扫描哈希与最终文件哈希一致。
- EICAR：只通过内存 `INSTREAM` 发送，不把 EICAR 写入仓库、日志或长期目录；必须观察命中结果并确认没有 verified 写入。
- MIME/polyglot：声明 MIME 与魔数不一致时，在扫描前拒绝，状态为 `failed`。
- 超时/不可用：让 loopback scanner 不响应或停止服务，必须得到固定错误码且不产生 receipt/verified 文件。
- 隔离成功：使用受控的无害测试载荷模拟恶意判定，确认 staging 原子移动到加密隔离目录且无 `.part` 残留。
- 隔离失败：当主机防护拦截移动或目标目录不可写时，必须得到 `ATTACHMENT_QUARANTINE_FAILED`，保留告警并 fail-closed。
- Crash/Reboot/上传中断：强制终止写入进程或中断请求；新实例必须拒绝旧租约/旧版本，清扫 `.part`，且不得产生 verified 文件或重复 receipt。
- 重试/幂等：同一版本的 complete 只返回同一 verified 结果；失败版本必须使用更高版本重试，不得重复计费或重复审计写入。

## 5. 人工处置

1. 记录 request ID、attachment ID、固定错误码和残留数量，不复制文件内容或原始文件名。
2. 不打开、下载或移动隔离样本到非加密卷；由管理员在隔离目录执行后续安全分析。
3. 修复 clamd、病毒库、ACL 或磁盘问题后，先运行干净样本与残留清理演练，再恢复在线流量。
4. 任何人工删除必须先确认没有活动上传、没有 verified 引用，并保留审计事件；不得手工修改数据库状态绕过扫描。

## 6. 恢复后准入条件

V20-12 前必须由 Windows Codex 重新观察并记录：加密/ACL、真实 clamd clean/EICAR、扫描超时/不可用、隔离成功/失败、Crash/Reboot/上传中断、worker-offline 核心流、整仓门禁和生产开关状态。未观察到的项目保持 `not_run`，不得宣称通过。
