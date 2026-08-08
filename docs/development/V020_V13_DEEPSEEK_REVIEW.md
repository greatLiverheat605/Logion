# V20-13 DeepSeek V4 Flash 只读终审记录

> 日期：2026-08-08（Asia/Shanghai）
> 终审模型：DeepSeek V4 Flash（固定 OpenCode 只读工作树）
> 审查目标：`7d50e675be19b2779613ed61ba31dc821afa73dc`
> 基线：`08babebcd5a09861106c9b05accf32bd8f2ea01c`
> Orca Task：`task_66a2bdb9ab08`
> Dispatch：`ctx_ce22e673e7fd`

## 1. 终审结论

DeepSeek 对完整候选 diff 执行了只读安全、合同和回归审查，覆盖租户隔离、PostgreSQL 约束、
stale acceptance、重放/计费边界、XSS/CSP、DoS、sync-v1、删除/回滚和默认开关。无 High 或
Medium finding；5 个 Low/Info finding 已由 Windows Codex 修复并重新验证，因此 V20-13 接受。

该接受只表示候选终审闭环，不表示生产发布批准，也不授权打开任何敏感能力。

## 2. Findings 与处置

| 级别     | Finding                                          | Codex 处置                                                                                                          | 复核证据                                                                |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Low/Info | `.env.example` 缺少附件 ingest 与知识游标示例    | 增加默认关闭的 ingest flag、active/previous key、TTL 与 clock-skew 示例                                             | `apps/api/tests/test_knowledge_space_contract.py`；默认设置实测全为关闭 |
| Low/Info | deletion flag 开启时路由仍恒定 404，语义容易误导 | Settings 在 deletion 尚未接线期间始终 fail-closed，并以明确错误拒绝                                                 | deletion flag 回归测试通过                                              |
| Low/Info | 附件集成测试硬编码 Windows `J:\ClamAVTmp`        | 改为 `LOGION_TEST_ATTACHMENT_TMP_ROOT`，未配置时使用系统临时目录                                                    | 真实附件集成 3 passed                                                   |
| Low/Info | 图谱 excerpt preview 查询没有统一总时间预算      | `_attach_previews` 使用 `GRAPH_STATEMENT_TIMEOUT_SECONDS` 单调 deadline；超时安全返回无 preview 并记录 `TIME_LIMIT` | 图谱相关门禁与 strict mypy 通过                                         |
| Low/Info | 每类搜索最多 101 个候选，深分页可能静默丢结果    | 搜索响应新增 `truncated` / `truncation_reasons`；候选上限和字节上限显式披露，候选窗口不足时不伪造可恢复游标         | 合同测试、OpenAPI/TypeScript 生成和整仓测试通过                         |

## 3. 真实验证矩阵

- 针对性知识空间合同、图内核、附件静态回归：`69 passed`。
- 整仓质量门：协调状态 `118`、Python `402`、Web Vitest `224`，lint、typecheck、Mypy、
  build 全部通过；合同生成后的差异为本次新增搜索响应字段，已纳入提交。
- `pnpm audit --audit-level=high`：无已知漏洞。
- `pip-audit`：无已知漏洞；`logion-api` 与 `logion-worker` 是工作区包，按工具规范标记为非 PyPI 项。
- 隔离 PostgreSQL（非 C 盘临时集群）：`upgrade head`、`alembic check` 与真实认证附件集成 `3 passed`。
- 真实 Redis 与常驻 loopback ClamAV 参与附件集成；临时 PostgreSQL 集群测试结束后已停止并清理。
- 未启动 Docker，未绕过 SessionBoundary；生产敏感开关仍保持关闭。

## 4. 只读工作树完整性

DeepSeek 审查工作树目标 SHA 正确。审查结束后发现 OpenCode 生成的 `.omo` 会话元数据残留；
协调员通过 Orca 清理该工具残留，并再次核对 `git status --short` 无输出、HEAD 仍为审查目标 SHA。
该残留不属于项目源码，也未形成提交或推送。

## 5. 下一阶段

V20-14 在 staging/隔离恢复环境演练迁移 `upgrade/downgrade/upgrade`、空环境恢复、feature-off、
孤儿扫描与引用闭包。首个正式知识写入后禁止破坏性 downgrade；回滚必须采用禁用能力、保留数据
可读/可导出和前向修复。V20-14 不授权开启 Attachment、Local Worker、Shared Write、Deletion、
Provider、sync-v1 或 AI Acceptance。
