# 当前状态（主线接手时点）

> 更新时间：2026-08-13（Asia/Shanghai）。

## 1. Git 与发布身份

| 项目                 | 当前值                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| 仓库                 | `greatLiverheat605/Logion`                                                   |
| 正式集成工作树       | `v020-integration`                                                           |
| 交接分支             | `codex/i0-rc7-closeout`                                                      |
| 远端产品主线         | `origin/main=0bc104c1d6458dbdbfc4efccebff3b481f042b84`                       |
| RC7 产品源码         | `480adc721600243308fa7b5a32200044efd88f07`                                   |
| RC7 manifest SHA-256 | `0dbe60ce2d8044867dc85b8ffb0ca61006bdc96a3654b3842f8cf68c9f7d05b5`           |
| RC7 workflow         | Main `31672956241`、Capacity `31673689291`、Release `31673881951` 均 success |

`origin/main` 的 `0bc104c1…` 是 RC7 验收收口文档提交；RC7 运行产品对应 `480adc721…`。接手时必须重新
运行 `git status --short --branch`、`git rev-parse HEAD`、`git rev-parse origin/main`，不能只信本文。

工作树允许保留两个未跟踪证据目录 `.tmp-v020-rc2/` 与 `.tmp-v020-rc4/`。它们不是待提交源码，
不得删除、格式化、移动或纳入提交。

## 2. 受控 prerelease 状态

- RC7 已完成原子切换；活动源码为 `480adc721600243308fa7b5a32200044efd88f07`，迁移头为
  `0038_local_worker_protocol`，四个运行应用镜像与候选 manifest 一致。旧目录
  `/opt/logion.before-rc7-20260813T130605Z` 保留用于回滚。
- API、Worker、Web、Reverse Proxy、Backup、PostgreSQL、Redis 当前运行；Backup 密钥权限已修正为
  `root:10001 0640` 后稳定运行。切换后累计重启计数包含修复前权限错误的 19 次，修复后未继续增加。
- 公网 `/health` 为 HTTP 200，HSTS、nonce CSP、Frame、MIME sniffing 和 Referrer Policy 头存在。
- 发布后加密备份 `logion-20260813T130618Z-beta-v1.backup` 已通过服务器校验，SHA-256
  `76bd5d7b441fefb0999b08d460042fb3cd6fe37cb3a20c00ac454de86076022f` 已在 BitLocker 异机
  `J:\LogionBackups\encrypted` 复核；迁移头为 `0038_local_worker_protocol`，旧目录与数据卷继续保留用于回滚。
- RC6 回滚源码、旧镜像、部署前后备份和全部数据卷继续保留。RC7 观察期起点为
  `2026-08-13T13:06:05Z`（UTC）。

详细证据见 `docs/development/V020_V15_PRERELEASE_RC7_EVIDENCE.md`。

## 3. 未完成门禁

1. 用户已报告当前浏览器会话登录，但认证 UX 人工回归尚未由协调方在该会话内真实执行；21 个受保护路由、按钮反馈、
   loading/disabled、防重复提交、邀请 409、搜索、知识图谱、主题持久化和控制台错误保持 `not_run`。
2. RC7 至少 24 小时观察尚未收口；到点后需重新检查 health、日志、OOM/restart、磁盘、内存、
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

## 6. 当前 PR 收口断点（2026-08-15）

- PR #212 已解决历史分叉冲突；正式集成分支基于 `origin/main=0bc104c1d6458dbdbfc4efccebff3b481f042b84`，当前待推送的本地修复包含 RC7 文档格式化和 `nanoid` `3.3.17 -> 3.3.18` 安全升级。
- 首个新 head 的 `fast` 门禁因 nanoid 高危公告失败；本地审计与完整 `ci:fast` 已通过。下一步是提交并推送该修复，然后只接受同一最终 head 的 GitHub `fast/integration/browser/mobile` 结果。
- 24 小时 RC7 观察、真实受邀邮件、实体移动设备验收和 Production 授权仍未完成；所有敏感生产开关继续关闭，不能自动合并或部署。
