# V20-11 环境验收证据（2026-08-07）

本记录只保存本轮在正式集成工作树中实际观察到的结果，不把计划命令或外部环境要求写成通过。

## 已执行并通过

- `uv run --package logion-api pytest apps/api/tests/test_knowledge_space_contract.py apps/api/tests/test_attachments.py -q`：40 passed。
- `pnpm --filter @logion/offline test`：7 个测试文件、55 tests passed。该包的结果只证明离线库的加密、校验与同步边界，不等同于 Local Worker 准入。
- 静态 Compose 附件边界与备份挂载检查：7 passed，覆盖 `staging`/`verified` 目录权限、只读消费者、备份只读挂载和 staging 排除。
- 在完整测试环境变量和本机服务已启动后，`uv run --package logion-api pytest -m integration apps/api/tests/test_attachment_integration.py -q`：1 passed。
- 同一环境下，`uv run --package logion-api pytest -m integration apps/api/tests/test_knowledge_space_migration_integration.py -q`：3 passed；覆盖知识空间迁移约束、往返生命周期与 PostgreSQL 18 `RESTRICT` 返回码。
- 核心组合复核：知识空间核心与 AI acceptance 集成 3 passed；搜索第二页在正确游标密钥、Origin、PostgreSQL 和 Redis 环境下通过，未发现服务实现缺陷。
- `pnpm audit --prod --audit-level high`：No known vulnerabilities found；`uv run --group dev pip-audit`：No known vulnerabilities found（工作区包因不发布到 PyPI 被明确跳过）。
- `pnpm ci:fast`：完整上下文校验、格式、lint、typecheck、Python/前端测试、构建和合同检查通过（382 Python tests selected，前端 224 Vitest tests）。
- 方案 1 的本机加密环境已实测：`J:` 为 G: 上的 `LogionV20.vhdx` 挂载卷，BitLocker XTS-AES 256、100% 已加密、Protection On；恢复密钥仅保存于桌面，未写入 Git 或本账本。`J:\Attachments`、`staging`、`verified` ACL 已收紧，当前无 `.part` 残留。
- ClamAV 便携版已使用 `J:\ClamAVData` 扫描 `J:\ClamAVCorpus` 中的 PDF/HTML、PNG/PDF 和纯文本语料，退出码 0。该结果只证明语料扫描完成且未命中，不等同于恶意样本检测通过。
- ClamAV 临时回环守护进程使用 J: 病毒库，通过 `clamdscan --stream` 从内存扫描标准 EICAR，实际返回 `Eicar-Test-Signature FOUND`、退出码 1；同一引擎对上述三个干净语料返回 `OK`、退出码 0。临时配置、日志、PID 和进程已清理，Windows Defender 未关闭，样本未写入仓库。
- Local Worker 候选安全内核单测：6 passed；覆盖短租约、job/workspace/space/input hash 绑定、过期/撤销拒绝、单调阶段、output hash、检查点篡改、部分残留清理、重启后旧租约拒绝和终态清理。该内核没有 API/数据库/Provider 接入，不构成生产启用授权。
- Worker 进程未启动时，使用加密卷上的 PostgreSQL/Redis，知识空间核心 + AI acceptance 真实集成 3 passed；证明核心在线流程不依赖 Worker 进程。

## 已解决的历史基础设施阻塞

- 早先因 Redis/PostgreSQL 未启动而出现的 `AUTH_RATE_LIMIT_UNAVAILABLE` 与连接拒绝已在本轮复核前解决。服务来自非 C 盘安装，不启动 Docker；本轮通过结果以新的成功 observation 为准，历史失败 observation 保留不覆盖。

## 外部环境证据仍缺失

- 尚未完成受控部署环境中的正式恶意样本/Polyglot 扫描器接入契约与告警处置演练；本轮 EICAR 仅证明临时 ClamAV 引擎能够命中，不等同于生产 Attachment gate 已批准。
- Local Worker 仍无启用路径；候选安全内核已具备租约/检查点负测，但尚未接入真实远端 job、撤销 API、Crash/Reboot/上传中断恢复和生产 worker offline 认证流程，因此不能开启 Local Worker。

## 决策

V20-11 继续保持硬停止：迁移、加密卷、ACL、默认关闭边界、临时 ClamAV 命中与核心在线流程已通过；但正式恶意扫描器接入/处置演练及 Local Worker 真实远端协议、崩溃恢复和生产离线流程仍缺失。在这些证据齐备并由 Codex 重新观察前，不进入 V20-12，不启动本机 Docker，也不打开 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 的生产开关。

## 持久化 Local Worker API 候选复核（2026-08-07）

- 真实认证集成 `test_knowledge_space_local_worker_integration.py`：3 passed；覆盖默认关闭优先级、CSRF/Origin/近期认证、Private Space owner 隔离、lease/checkpoint/result 生命周期、撤销、受限 recovery 和幂等 replay/冲突。
- `0038_local_worker_protocol` 已在验收数据库升级；`alembic -c apps/api/alembic.ini check` 报告无新升级操作；迁移集成 3 passed。
- token 只在 lease 响应返回一次，数据库持久化 SHA-256 摘要；候选 API 的错误响应对 Local Worker 路径统一 `Cache-Control: private, no-store`。
- 本节只证明候选 API/迁移在隔离验收环境可运行，不证明生产准入。Crash/Reboot/上传中断恢复、正式扫描器接入/处置和完整 worker-offline 认证流程仍是硬停止，所有敏感生产开关继续关闭。

## V20-11 收口复核：常驻扫描器与恢复演练（2026-08-08）

- 本机安全环境复核：`J:` 为 XTS-AES-256、100% 加密、Protection On、Automatic Unlock Disabled；`J:\ClamAVData`、`J:\ClamAVConfig`、`J:\ClamAVLogs`、`J:\ClamAVTmp` 和 `J:\AttachmentQuarantine` ACL 仅保留 Administrator、Administrators、SYSTEM。
- ClamAV 1.5.2 已锁定在 G:，病毒库、配置、日志、PID、临时目录和隔离目录均在 J:；`ClamAV ClamD` 服务为 Automatic/Running，仅监听 `127.0.0.1:3310`。
- 真实 loopback clamd 验收：干净 PDF 通过 `ClamdInstreamScanner`；同一 clamd 的内存 `INSTREAM` EICAR 实际返回命中；受控无害载荷的隔离移动成功；staging `.part` 残留为 0。Windows Defender 对落盘 EICAR 的移动拦截被记录为真实 `ATTACHMENT_QUARANTINE_FAILED` fail-closed 场景，未关闭 Defender、未将样本写入仓库。
- 扫描器合同/单元门禁：`test_attachment_scanner.py`、`test_attachments.py`、知识空间合同合计 `45 passed`；覆盖 loopback 限制、INSTREAM framing、clean/malware、timeout/unavailable、大小上限、TOCTOU 哈希复核、隔离和残留清理；Ruff lint/format、API strict mypy 均通过。
- 真实认证附件集成：在本机 PostgreSQL/Redis、真实认证和受控测试 scanner 下 `test_attachment_integration.py` 为 `1 passed`；验证租户边界、MIME/hash fail-closed、verified 幂等、审计不含文件名/hash。生产默认仍要求 scanner flag，未打开 Attachment。
- 真实 clamd API 路径：在 J: 附件根目录、常驻 loopback clamd、本机 PostgreSQL/Redis 和真实认证下，`test_attachment_integration.py -k real_loopback` 为 `1 passed, 1 deselected`；干净 PDF 经过 API finalize 后为 `verified`，未使用测试 scanner 替身。
- Crash/Reboot/上传中断恢复：`test_local_worker_security.py` 与 `test_local_worker_recovery_integration.py` 合计 `11 passed`；真实子进程强制退出后，新实例拒绝旧内存租约并清理 `checkpoint.json`/`.part`，未知工件仍 fail-closed。
- Worker offline 核心流：无 Local Worker 进程、使用本机 PostgreSQL/Redis 和测试 Origin/游标密钥，知识空间核心 + AI acceptance `3 passed, 1 deselected`；在线核心不依赖 Worker。

本节证据仍不授权打开任何敏感生产开关；下一步是整仓门禁、协调账本和 V20-11 admission 决策复核。

## 最终 admission 复核（2026-08-08）

- 扫描器/附件/知识合同 `45 passed`；真实附件、Local Worker API 与迁移组合 `9 passed`；Local Worker 安全与真实子进程恢复 `11 passed`；worker offline 在线核心与 AI acceptance `3 passed, 1 deselected`。
- 搜索游标整秒截断造成的同秒分页空页已复现并修复：cursor schema v2 保存微秒级 cutoff；游标回归 `5 passed`，在线核心组合重新运行通过。
- `pnpm ci:fast` 通过：402 Python tests、118 协调状态测试、224 Web Vitest，格式、lint、strict mypy、typecheck、build 与 contracts 全绿。依赖审计无已知漏洞；`alembic check` 无新升级操作。
- 复核时 J: 仍为 XTS-AES-256、100% 加密、Protection On、Automatic Unlock Disabled；clamd Automatic/Running、仅 `127.0.0.1:3310`；附件、隔离、ClamAV 数据/配置/日志/临时目录 ACL 仅为 Administrator、Administrators、SYSTEM，`.part` 残留为 0。
- 常驻 clamd 的干净 API finalize 与内存 `INSTREAM` 恶意样本命中均已重新观察。Windows Defender 保持开启，未将恶意样本写入仓库或长期目录。
- 默认配置实测保持关闭：知识空间 API、Shared Write、Deletion、Attachment、Local Worker、AI Acceptance、attachment scanner 均为 `false`，邮件 Provider 为 `disabled`；未启动 Docker，未绕过 SessionBoundary。

据此 V20-11 的硬停止条件已经解除，允许进入 V20-12 默认关闭集成门。该结论不授权启用任何敏感生产能力，也不等同于发布批准。
