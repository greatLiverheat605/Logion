# V20-11 环境验收证据（2026-08-07）

本记录只保存本轮在正式集成工作树中实际观察到的结果，不把计划命令或外部环境要求写成通过。

## 已执行并通过

- `uv run --package logion-api pytest apps/api/tests/test_knowledge_space_contract.py apps/api/tests/test_attachments.py -q`：40 passed。
- `pnpm --filter @logion/offline test`：7 个测试文件、55 tests passed。该包的结果只证明离线库的加密、校验与同步边界，不等同于 Local Worker 准入。
- 静态 Compose 附件边界与备份挂载检查：7 passed，覆盖 `staging`/`verified` 目录权限、只读消费者、备份只读挂载和 staging 排除。

## 已执行但未通过（基础设施阻塞）

- 在提供完整测试环境变量后运行 `uv run --package logion-api pytest -m integration apps/api/tests/test_attachment_integration.py -q`。注册阶段返回 `503 AUTH_RATE_LIMIT_UNAVAILABLE`，原因是本机 Redis 服务不可用；附件协议断言尚未执行，不能计为通过。
- 在同一环境运行 `uv run --package logion-api pytest -m integration apps/api/tests/test_knowledge_space_migration_integration.py -q`。3 个测试均因 PostgreSQL 连接被拒绝而结束；迁移往返、约束和回滚断言尚未执行，不能计为通过。

## 外部环境证据仍缺失

- 本机 `C:` 卷观察到 BitLocker 为 `Fully Decrypted`、`Protection Off`；这不是生产 `attachments_data` 命名卷的加密证明。生产卷的静态加密、恢复密钥托管和最小 ACL 仍需在受控部署环境提供证据，文档不记录恢复密钥本身。
- 没有经批准的 Malware/Polyglot 扫描器和语料包；现有 MIME/魔数校验不能描述为 Malware Scan。恶意文件、Polyglot、HTML/Markdown/URL 和文件名语料验收仍未运行。
- 知识空间 Local Worker 仍无启用路径；Lease 与 Job/Space/输入摘要绑定、撤销/过期拒绝、Crash/Reboot/中断残留清理及 Worker offline 时的真实认证核心流程均未取得证据。

## 决策

V20-11 继续保持硬停止：在上述证据齐备并由 Codex 重新观察前，不进入 V20-12，不启动本机 Docker，也不打开 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 的生产开关。
