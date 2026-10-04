# v0.3 schema 上的旧应用候选

本分支基于 `fdadebcfe76a341e3915b3c8cb000f280fbe4fb0`，只准备方案 A，不合入 main、不部署。
ADR-0063 定义兼容边界。所有者于 2026-10-01 已选定 A，B 为后备；终审通过且单独批准上线后，才可用于实际切换。

## 制品与验证

`config/rollback-schema.json` 固定被验证的新 schema 来源 SHA 与 head。
本分支的 Main 工作流运行名为 `Rollback candidate`：先由固定的新源码迁移空的隔离数据库，
随后运行本分支全部 API/Worker 集成测试和旧客户端合同，再构建四镜像、签发来源证明、执行安全扫描。
镜像冒烟也由新源码迁移，之后才启动旧 API/Worker。禁止把普通旧迁移 smoke 当作此处的兼容证据。

候选包必须同时保留：

- `candidate-manifest.json`：旧补丁 SHA、四个镜像 digest 和其自身附带的 migration head；
- `rollback-compatibility.json`：旧补丁 SHA、实际新 schema 来源 SHA 与 head；
- `rollback-schema-check.json`：只读前置检查；
- `rollback-compatibility-*`：真实 PostgreSQL 集成和旧合同结果；
- 候选安全摘要与完整 workflow 结果。

前置检查命令（数据库连接只经运行环境注入）：

```sh
python -m logion_api.rollback --expected-head <证据中的新-schema-head>
```

命令只读检查数据库的单一 head、私人数据字段和已验证的资源类型约束；它不会迁移。
必须先核对证据绑定的两份 SHA、head、四镜像摘要。目标为 `0058_form_drafts`，只读检查也要求 Agent、草稿表和会话持久性字段存在。
原 `0056_agent_inbox` 的成功证据保留，不能替代新 schema 的验证。
不使用本分支的 Alembic upgrade/downgrade，不改写 `alembic_version`，不使用旧 Release/Nightly 迁移入口。

## 回滚期间的明确限制

会话刷新保留本人“保持登录”选择，密码、Passkey 和 MFA 同样支持该选择。退出清除本人全部
服务端表单草稿；Worker 每轮最多清理 100 份到期草稿，七天保留策略继续有效。旧页面不提供
草稿读写入口，旧 REST、搜索、同步及导出均不包含草稿正文。

私人资源、精读笔记、已接受的 Agent 报告/摘要、概念、测验及其派生记录、阅读任务都不会进入旧共享入口、同步、搜索或导出。
Agent 令牌、待审和已接受收件箱记录保留；旧应用不提供其接口。兼容测试对精读、报告、摘要分别覆盖旧读写、同步冲突/墓碑、搜索、导出和 AI 隔离。
旧论文创建和导入仍原子生成资源映射，恢复前向版本后可继续使用。
研究 AI 任务、研究上下文及其草稿留待前向版本处理；旧应用正常生成的结构化 AI 草稿继续可用。
研究格式导出不执行、不下载，旧导出在生成和下载时重新检查当前权限。

账户删除申请和取消仍可用，但物理清理暂停；所有待处理请求、数据库记录及附件文件保留。
恢复经验证的前向版本后按原政策恢复清理，不扩大恢复期限、不提前删除。
关闭新研究与 Agent 能力，保留服务器 keyring、原文加密缓存和备份；不能用删除新表来恢复旧页面。
这是一项有边界的应急候选，不是长期停留在旧版本的方案。
