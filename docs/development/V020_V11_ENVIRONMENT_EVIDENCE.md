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
