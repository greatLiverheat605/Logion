# 当前状态（主线接手时点）

> 更新时间：2026-08-10（Asia/Shanghai）。

## 1. Git 与发布身份

| 项目                 | 当前值                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| 仓库                 | `greatLiverheat605/Logion`                                                   |
| 正式集成工作树       | `v020-integration`                                                           |
| 交接分支             | `codex/v020-rc6-closeout`                                                    |
| 远端产品主线         | `origin/main=62ddd5251a8ce609dc434b8e6286bd8c7c9d9517`                       |
| RC6 产品源码         | `c47aa376d95b179200d59986c20289b796740959`                                   |
| RC6 manifest SHA-256 | `12280604e31621ef3cad437ec712a1b9e80dfccb64c2d7326509c0354f1624e7`           |
| RC6 workflow         | Main `31337611805`、Capacity `31338032379`、Release `31338128822` 均 success |

`origin/main` 的 `62ddd525…` 是 RC6 验收文档提交；其产品代码仍对应 `c47aa376…`。接手时必须重新
运行 `git status --short --branch`、`git rev-parse HEAD`、`git rev-parse origin/main`，不能只信本文。

工作树允许保留两个未跟踪证据目录 `.tmp-v020-rc2/` 与 `.tmp-v020-rc4/`。它们不是待提交源码，
不得删除、格式化、移动或纳入提交。

## 2. 受控 prerelease 状态

- RC6 已完成原子切换；API ready、迁移头和四个运行应用镜像均与候选 manifest 一致。
- API、Worker、Web、Reverse Proxy、Backup、PostgreSQL、Redis 运行正常；OOMKilled 为 `false`，
  RestartCount 为 0，切换后首轮严重日志关键字计数为 0。
- 公网 `/health` 为 HTTP 200，HSTS、nonce CSP、Frame、MIME sniffing 和 Referrer Policy 头存在。
- 发布后加密备份 `logion-20260809T225859Z-beta-v1.backup` 已通过服务器校验、BitLocker 异机
  SHA-256 复核和 ECS 隔离恢复；恢复头为 `0038_local_worker_protocol`，Workspace 2 个，空
  `sync_epoch` 0 个，临时数据库和附件目录已清理。
- RC2 回滚源码、旧镜像、部署前后备份和全部数据卷继续保留。观察期起点为
  `2026-08-09T22:59:03Z`。

详细证据见 `docs/development/V020_V15_PRERELEASE_RC6_EVIDENCE.md`。

## 3. 未完成门禁

1. 用户已报告当前浏览器会话登录，但认证 UX 人工回归尚未由协调方在该会话内真实执行；21 个受保护路由、按钮反馈、
   loading/disabled、防重复提交、邀请 409、搜索、知识图谱、主题持久化和控制台错误保持 `not_run`。
2. RC6 至少 24 小时观察尚未收口；到点后需重新检查 health、日志、OOM/restart、磁盘、内存、
   Swap、备份新鲜度和告警。
3. 真实受邀邮件和实体移动设备验收需要用户单独批准，当前不得发送或伪造通过。
4. Production 发布、流量切换和敏感能力启用均未授权。
5. 当前协调 Run 验证仍因历史 `graph.json` 与 `tasks.jsonl` encoded-content safe-scan budget 超限失败；
   不改写历史账本、不派发依赖该账本的新并行写任务。

## 4. 产品设计新决策

用户明确反馈：当前系统操作页的样式与操作方式不习惯。现有 RC6 可以继续作为功能与安全基线，
但其系统操作体验不再视为下一轮视觉/交互批准稿。

下一轮必须先完成两份独立的全流程方案：产品诊断 → UX 审查 → 信息架构重构 → 交互重构 →
视觉重构 → Design System → 高保真交互原型。两份方案只允许在独立设计目录/worktree 产出，
不得修改 `apps/web/src/**`。用户选择并批准一份完整原型后，主线执行方才可开始正式前端施工。

## 5. 下一动作

主线执行方先完成只读接管和 V20-15 剩余门禁，不立即改业务代码。并行设计方案由两个专项设计
执行方独立产出；它们没有正式前端所有权、Git 集成权或发布权。具体顺序见 `02_EXECUTION_PLAN.md`。
