# 可直接交给主线执行方的启动提示词

将下面整段交给用户当前指定的主线执行方。它不包含密码、Token、SSH 材料或私有连接信息。

```text
你现在接手 Logion 项目的唯一主线实施工作。你的第一目标是准确恢复状态并关闭剩余门禁，不是立即写代码。

工作区与基线：
- 只在正式集成工作树 v020-integration 操作。
- 当前交接分支为 codex/v020-rc6-closeout；接手时必须实际运行 git status、git rev-parse HEAD、git rev-parse origin/main。
- 当前已知 origin/main 为 62ddd5251a8ce609dc434b8e6286bd8c7c9d9517。
- RC6 产品源码为 c47aa376d95b179200d59986c20289b796740959；文档提交与产品源码 SHA 必须区分。
- .tmp-v020-rc2/ 与 .tmp-v020-rc4/ 是保留证据：不得删除、移动、格式化或提交。

接手前按顺序完整阅读：
1. AGENTS.md
2. docs/development/AGENT_DELIVERY_WORKFLOW.md
3. docs/development/V020_EXECUTION_PLAN.md
4. docs/development/V020_STATUS.md
5. docs/development/V020_V15_PRERELEASE_RC6_EVIDENCE.md
6. .agents/coordination/current-run.json 及其指向的 Run
7. docs/coordination/mainline-handoff/README.md 与 00～07 全部文件

第一轮只读任务：
- 复核 Git 基线、远端、工作树和保留证据目录；
- 复核 RC6 Main/Capacity/Release run、manifest SHA、部署 source SHA、运行镜像、迁移头、发布后备份和隔离恢复记录；
- 运行协调账本验证。若仍是历史 encoded-content safe-scan budget 超限，只记录 blocker，不重写历史；
- 返回结构化核对报告。第一轮不得修改业务代码、启动本机 Docker、发送邮件或执行 Production 动作。

只读核对通过后，按 02_EXECUTION_PLAN.md 完成 V20-15 剩余门禁：
1. 在用户明确登录的同一可控会话做认证 UX 回归；不得读取 Cookie、localStorage、密码或会话文件。
2. 覆盖 21 个受保护路由，重点验证 Today、Review、Workspace/Space/邀请、搜索、Settings/Profile/Security/Sync/Data/Integrations/AI。
3. 验证成功、失败、空值、loading、disabled、防重复提交、邀请 409 中文反馈、权限、离线、键盘、移动、知识图谱、主题和控制台错误。
4. 不向真实邮箱发送邀请；真实邮件、实体设备和任何外部副作用都必须先向用户申请。
5. 在 2026-08-09T22:59:03Z 起满 24 小时后，重新核对 health、日志、OOM/restart、资源、备份新鲜度、异机同步和告警。

新的产品决策：用户不习惯当前系统操作页的样式和操作方式。两位专项设计执行方会分别提交完整重设计方案与隔离原型。你不得在用户批准某一完整原型前修改 apps/web/src/**。收到方案后先做可实施性、合同、安全、响应式和无障碍审查，输出差异与风险，等待用户选择。

不可变边界：
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 生产开关保持关闭；
- 不绕过 SessionBoundary，不修改用户 Provider/hooks/CCSwitch 配置；
- 不在仓库写入秘密、私有主机数据、真实邮箱、终端转录或用户目录；
- 不静默改变 API、权限、迁移、OpenAPI、同步协议、保留策略或生产配置；
- 未获用户明确授权不 commit、push、merge、release、发送邮件、切流或清理回滚点。

任何实现完成后必须返回：
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:

计划命令、写了测试或模型自报都不算通过。发现基线冲突、未知修改、环境/授权缺失或门禁失败时，保留现场并停止，不伪造完成。
```
