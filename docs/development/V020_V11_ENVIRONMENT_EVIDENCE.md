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

## 已解决的历史基础设施阻塞

- 早先因 Redis/PostgreSQL 未启动而出现的 `AUTH_RATE_LIMIT_UNAVAILABLE` 与连接拒绝已在本轮复核前解决。服务来自非 C 盘安装，不启动 Docker；本轮通过结果以新的成功 observation 为准，历史失败 observation 保留不覆盖。

## 外部环境证据仍缺失

- 当前 ClamAV 仅完成干净 Polyglot/HTML/PNG/文本语料扫描；尚未取得经批准的恶意样本检测命中证据（EICAR 会被 Windows Defender 自动删除），不能把“未命中”写成 Malware gate 通过。
- 知识空间 Local Worker 仍无启用路径；Lease 与 Job/Space/输入摘要绑定、撤销/过期拒绝、Crash/Reboot/中断残留清理及 Worker offline 时的真实认证核心流程均未取得证据。

## 决策

V20-11 继续保持硬停止：迁移、加密卷、ACL、默认关闭边界和真实集成已通过，但恶意样本检测命中、Local Worker lease/残留清理与 worker-offline 认证核心流程仍缺失。在这些证据齐备并由 Codex 重新观察前，不进入 V20-12，不启动本机 Docker，也不打开 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 的生产开关。
