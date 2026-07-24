# 不可变候选与 RC 操作手册

## Main 候选

1. 将已审查代码合并到 `main`，Main 运行 Fast 检查和 Compose 校验。
2. Main 推送四个以完整 Git SHA 标记的 GHCR 镜像，附带 SBOM 和 provenance；生成 `candidate-manifest.json`，再以精确 digest 和 `--no-build` 启动，将空临时数据库迁移到记录的 Alembic head。
3. 有界、已认证的 Workspace 列表门禁必须以并发 10 完成 200 个请求，p95 严格低于 500 ms。
4. 记录成功 Main run ID、完整 source SHA、manifest 产物、四个 digest 和性能证据。失败或取消的 run 不是候选。

该门禁可发现候选回归，但不满足完整容量发布门禁。应在成功 Main SHA 上运行 **Full capacity profile** 并保留数值 run ID。工作流在专用数据库生成 100,000 个任务、1,000,000 个事件、50,000 条笔记/资料、10,000 条附件记录及文件、5,000 篇论文和 100,000 次 AI run。证据记录生成器版本、硬件、预热、样本量、p50/p95/p99、错误、查询计划和饱和信号。`github-hosted-reference` 仅供参考，保持 `production_equivalent_approved=false`；公开 Production 前必须在批准的生产等价硬件重跑。

## RC 晋级

1. 在 Release candidate 选择 **Run workflow**，填写显示版本、完整 Main source SHA、数值 Main run ID 和同源 Full capacity profile run ID。
2. 只批准 staging 环境，不得在此流程批准 Production。
3. 确认 preflight 校验两个 run 的 workflow、branch、conclusion 和 source SHA，再验证精确容量数量及 p95 决策。
4. 在登录容器仓库或启动 Compose 前确认 manifest 校验通过。
5. 日志必须显示 `docker compose pull` 和 `up --no-build`；出现任何构建步骤都会使 RC 无效。
6. 在同一候选身份下保留 manifest、Compose 状态及后续 L6-002/L6-003 证据。
7. 确认 `recovery-evidence.json` 记录匹配的迁移 head/对象数量、附件哈希匹配、已变化 `sync_epoch`、RPO/RTO 和 digest 固定的 Backup 镜像。
8. 确认离线兼容测试要求 `upgrade_required` 或 `rebootstrap_required`，并隔离旧 Outbox 而非重放。
9. 确认 Chromium、Firefox、WebKit、移动 Chrome 和移动 Safari 模拟通过公开/认证浏览器门禁。自动化不等于物理 Safari/iOS 或屏幕阅读器证据，须单独收集人工签字。
10. 确认 5/25/100 发布策略演练使用 `mode=rehearsal`、`sample_source=synthetic_policy_rehearsal`、候选 source SHA 和 `changes_traffic=false`。它只证明策略引擎，绝不是有效 Production 遥测或流量批准。

## 失败与撤销

候选失败时不得删除不可变镜像。将其标记为拒绝、保留证据，并通过新源码 commit/Main 候选修复。digest 或 provenance 无法验证时停止晋级。镜像回滚不隐含数据库回滚：必须执行兼容矩阵；旧二进制无法读取迁移 schema 时优先前向修复。
