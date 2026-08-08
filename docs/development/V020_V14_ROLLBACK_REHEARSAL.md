# V20-14 隔离回滚演练记录

> 日期：2026-08-08（Asia/Shanghai）
> 分支：`codex/v020-integration`
> 范围：非生产、非 C 盘的本机隔离 PostgreSQL 临时集群；不启动 Docker

## 1. 结论

V20-14 的隔离演练通过。空环境可以完成 `upgrade head → downgrade 0035 → upgrade head`，
备份恢复后的数据库回到最新迁移头且引用闭包扫描为零；一旦存在正式知识或 Local Worker 数据，
破坏性降级会失败关闭并保留数据与迁移头。生产敏感能力仍保持默认关闭，因此本结论不代表生产
发布批准。

## 2. 实际演练

### 空环境迁移往返

- PostgreSQL 18.4 临时隔离集群完成全量 `upgrade head`；
- `downgrade 0035_add_user_settings` 成功，`alembic current` 为 `0035_add_user_settings`；
- 再次 `upgrade head` 成功，`alembic current` 为 `0038_local_worker_protocol`；
- `alembic check` 报告 `No new upgrade operations detected`；
- 知识空间迁移约束与生命周期集成测试 `3 passed`。

### 备份恢复与引用闭包

- 对最新迁移头的空环境生成 PostgreSQL custom-format 备份并恢复到独立数据库；
- 恢复库迁移头为 `0038_local_worker_protocol`；
- `knowledge_citations → source_excerpts` 与 `source_excerpts → resources` 两组孤儿引用扫描均为 `0`；
- 恢复库随后被删除，临时集群、备份文件和回环端口均已清理。

### 首次正式写入后的降级停止线

- 在隔离库写入一条有效 SourceExcerpt/Citation 后执行降级：命令非零退出，迁移头仍为
  `0038_local_worker_protocol`，Citation 行仍保留；错误为 `V20-02 downgrade stopped`；
- 清除 Citation/Excerpt 后写入一条有效 Local Worker Job 再执行降级：命令非零退出，迁移头仍为
  `0038_local_worker_protocol`，Job 行仍保留；错误为 `V20-11 downgrade stopped`；
- 这证明首个正式写入后不能用破坏性 downgrade 回滚，必须采用禁用能力、保持数据可读/可导出和
  前向迁移。

### Feature-off 复核

默认 `Settings()` 实测以下开关全部为 `false`：知识空间 API、Shared Write、AI Acceptance、
Deletion、Attachment ingest、Local Worker 与附件 scanner；默认关闭合同测试 `2 passed`。

## 3. 限制与下一步

本轮不接触生产数据库、生产备份、真实云发布或 Provider 凭据；不启动本机 Docker、不绕过
SessionBoundary。V20-15 只做最终 acceptance manifest、差异/秘密/路径复核和发布前门禁；只有用户
另行明确批准后，才讨论任何生产发布或敏感能力启用。Attachment、Local Worker、Shared Write、
Deletion、Provider、sync-v1 与 AI Acceptance 继续关闭。
