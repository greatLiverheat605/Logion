# v0.3 隔离迁移演练

本流程只准备并验证候选，不连接生产。生产备份恢复副本由 Claude 在最终审核时经所有者批准后执行；当前开发验收只用合成数据。任何失败都保留原输出目录，以新目录重跑；脚本不恢复备份、不删除数据库、不降级、不启动 Worker。

## 前置

使用锁文件安装 Python 依赖，源代码固定到批准的完整 SHA。数据库只能是回环 PostgreSQL，名称以 `_rehearsal` 或 `_capacity` 结尾；连接从 `LOGION_REHEARSAL_DATABASE_URL` 注入，禁止 URL 参数、远程地址及复用业务库。合成 API 冒烟另需独占的回环 Redis 非零数据库，通过 `LOGION_REHEARSAL_REDIS_URL` 注入。

两个工作树分别固定前向源码与回滚 A 补丁 SHA。回滚树安装其锁文件依赖。运行前记录两份 `git rev-parse HEAD` 与工作树状态；迁移目录必须干净、只有一个 head。以专用本地 PostgreSQL 实例和不含生产网络路由的运行环境进一步隔离，名称校验不能证明一个数据库不含生产数据。

## 合成模式

预先创建一个全新空数据库，不使用已有库。脚本先迁移到 `0042_knowledge_source_links`，复用容量生成器写入 100000 任务、1000000 事件、25000 笔记、25000 资源、10000 附件记录、5000 论文和 100000 AI run。此处验证数据库迁移；附件文件容量与延迟仍由独立 Full capacity profile 门验证。

```sh
uv run --group dev python scripts/release/rehearse_v03.py \
  --mode synthetic \
  --expected-source <前向源码完整-SHA> \
  --expected-rollback-source <回滚补丁完整-SHA> \
  --rollback-root <回滚补丁工作树> \
  --output .local/rehearsal-synthetic-001
```

生成全新进程内测试 keyring，排除继承的 `LOGION_*` 设置；不使用真实凭据或调用 Zotero、WebDAV、AI。演练在旧 schema 上采集全部旧表的旧列摘要，然后升级全部新增迁移并复算旧行；旧论文派生资源另行核对数量、所有权和字段，研究声明映射也必须一致。最后依次执行新文献 API 与旧补丁私人边界的真实 PostgreSQL 冒烟。API 测试只在合成模式运行，可能新增合成测试记录。

成功产物 `rehearsal.json` 必须同时显示 `status=passed`、`api_smoke=forward_and_rollback_passed`。`migration-verification.json` 只代表迁移核对完成，不能当作整个演练通过。保留旧 schema／前向迁移／两组 API 的日志及产物哈希。

## 已恢复副本模式：留待批准

所有者批准后，由审核者按备份恢复手册先在隔离实例完成解密与恢复；服务器配置、数据目录和密钥不复用生产。副本保持停写，没有 API、Worker、邮件或外部集成进程连接。起点必须是上述旧 head；如果实际备份起点不同，先审查迁移路径，不改写 `alembic_version` 或倒退数据库来迎合脚本。

```sh
uv run --group dev python scripts/release/rehearse_v03.py \
  --mode restored-copy --ack-isolated-copy \
  --expected-source <审核通过的前向源码完整-SHA> \
  --output .local/rehearsal-restored-001
```

此模式只迁移、核对行数和旧列摘要，`api_smoke=not_run` 为明确未运行项。API/Worker 不启动，避免恢复副本中的邮件、研究队列或账户清理被执行。输出目录由审核者受控保存，不提交仓库；只在报告引用源码 SHA、head、计数、摘要和结论，不复制正文、连接或凭据。失败后保留副本现场；重跑用另一个经批准的恢复副本，不在已迁移库上自动恢复、清理或降级。
