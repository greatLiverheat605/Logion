# 当前状态（主线接手时点）

> 更新时间：2026-08-16（Asia/Shanghai）。

## 1. Git 与发布身份

| 项目                 | 当前值                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| 仓库                 | `greatLiverheat605/Logion`                                                   |
| 正式集成工作树       | `v020-integration`                                                           |
| 当前修复分支         | `codex/v020-workspace-invitation-email`                                      |
| 远端产品主线         | `origin/main=0f20fd4f5c301094ce7e88803e24b7d0e86b469c`                       |
| RC7 产品源码         | `480adc721600243308fa7b5a32200044efd88f07`                                   |
| RC7 manifest SHA-256 | `0dbe60ce2d8044867dc85b8ffb0ca61006bdc96a3654b3842f8cf68c9f7d05b5`           |
| RC7 workflow         | Main `31672956241`、Capacity `31673689291`、Release `31673881951` 均 success |

`origin/main` 的 `11014fb…` 是 PR #212 的 Squash 合并提交；RC7 运行产品仍对应 `480adc721…`。接手时必须重新
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
2. RC7 实际没有 Workspace 邀请邮件实现。修复分支已增加加密入队和 Worker 投递，但尚未合并、
   构建候选或部署；不得重发或伪造真实送达通过。实体移动设备验收仍需单独批准。
3. Production 发布、流量切换和敏感能力启用均未授权。
4. 当前协调 Run 验证仍因历史 `graph.json` 与 `tasks.jsonl` encoded-content safe-scan budget 超限失败；
   不改写历史账本、不派发依赖该账本的新并行写任务。

## 4. 产品设计新决策

用户明确反馈：当前系统操作页的样式与操作方式不习惯。现有 RC6 可以继续作为功能与安全基线，
但其系统操作体验不再视为下一轮视觉/交互批准稿。

下一轮必须先完成两份独立的全流程方案：产品诊断 → UX 审查 → 信息架构重构 → 交互重构 →
视觉重构 → Design System → 高保真交互原型。两份方案只允许在独立设计目录/worktree 产出，
不得修改 `apps/web/src/**`。用户选择并批准一份完整原型后，主线执行方才可开始正式前端施工。

## 5. 下一动作

先完成 Workspace 邀请邮件修复的本地/远端门禁和代码审查，再申请合并与受控候选部署。部署获批后
才能对用户指定邮箱补发并完成真实到件、注册、登录和接受闭环；实体移动设备与 Production 发布仍
是后续独立批准点。

## 6. PR #212 收口（2026-08-16）

- PR #212 已解决历史分叉冲突；正式集成分支基于 `origin/main=0bc104c1d6458dbdbfc4efccebff3b481f042b84`，`f2f5eb942db644f2c6b43059330f3ed1a4300905` 已包含 RC7 文档格式化和 `nanoid` `3.3.17 -> 3.3.18` 安全升级并推送。
- 首个新 head 的 `fast` 门禁因 nanoid 高危公告失败；修复后最终 head `ff2b0bf621a5376b68229caee95ed4aa0ca2e9dc` 的 GitHub `fast/integration/browser/android-debug` 已全部成功。
- 用户明确批准后，PR #212 已于 `2026-08-16T14:10:43Z` Squash 合入 `main` 并关闭，合并提交为 `11014fb736b1f74085a32a7ad1c00054b0b83d6b`。该合并不等于部署或 Production 授权。
- RC7 至少 24 小时技术观察已于 2026-08-16 通过；真实受邀邮件、实体移动设备验收和 Production 授权仍未完成。所有敏感生产开关继续关闭。

## 7. RC7 观察收口（2026-08-16）

- 公网 `/health` 已连续 3 次 HTTP 200，安全响应头存在；观察起点 `2026-08-13T13:06:05Z` 已超过 24 小时。
- 用户开放受控 SSH 后，于 `2026-08-16T05:23:17Z` 完成服务器侧只读复核：活动源码与迁移头正确，运行服务健康，全部容器 `OOMKilled=false`、`RestartCount=0`，磁盘/内存/Swap 在可接受范围，最新备份校验通过，过去 24 小时系统 error/alert 为 0。
- Web 的 7 条 Server Reference ID 格式错误对应畸形请求或探测噪声；565 个聚合请求中无 5xx，异常请求全部 404 拒绝，不构成观察失败。
- Knowledge API、Shared Write、AI Acceptance、Deletion、Attachment ingest、Local Worker、Attachment scanner 均为 `false`，AI Provider 启用数为 0。邮件 Provider 为 `aliyun_directmail`，真实邀请邮件仍未验收。
- PR #212 最终 head `ff2b0bf621a5376b68229caee95ed4aa0ca2e9dc` 的 `fast/integration/browser/android-debug` 已全部成功，并已按用户批准 Squash 合入 `main=11014fb736b1f74085a32a7ad1c00054b0b83d6b`。没有部署或打开敏感能力。

## 8. 合并后主线复核（2026-08-16）

- 合并后 Android run `31951949928` 与 candidate run `31951949948` 均绑定 `11014fb...` 并成功；4 个 Dependabot 元数据任务也完成且无阻塞。
- candidate 真实完成 `ci:fast`、依赖许可、Compose、四镜像构建、不可变镜像 smoke、provenance、Trivy/SARIF/SBOM 与证据上传，没有失败步骤。
- 这些镜像只是 `main` 的新候选，未部署到 ECS。受控 prerelease 继续运行 `480adc721...`，RC6/RC7 回滚目录、镜像、备份和数据卷继续保留。
- 当前等待用户决定真实受邀邮件、实体移动设备及 Production 发布范围；未授权前不执行真实邮件、不部署、不切换流量、不启用默认关闭能力。

## 9. Workspace 邀请邮件事故与修复断点（2026-08-16）

- 用户使用未注册 QQ 邮箱执行真实邀请后，页面显示等待/服务端投递语义但未收到邮件。只读生产核对确认邀请于
  `2026-08-16T14:44:56Z` 成功创建为 `pending`，账户不存在，同一时间窗口 `email_outbox` 为 0；未读取或输出
  token、密文、凭据或完整敏感日志，也未重复发送。
- 根因不是 QQ 邮箱或 DirectMail 上游：RC7 的邀请服务只存 invitation/hash 并返回一次性 token，Outbox purpose
  不包含 Workspace invitation；前端“邮件投递状态由服务端处理”与实现不符。
- 修复分支 `codex/v020-workspace-invitation-email` 基于 `origin/main=0f20fd4…`：增加迁移
  `0039_workspace_invitation_email`、原子加密入队、历史无 Outbox 的 pending 邀请 token 轮换补发、Worker 状态复核、
  接受/撤销/过期/邀请者账号删除时终止并清空密文，以及只声明“已排队”的前端反馈。
- 同批修正邮箱验证与密码找回链接缺失 `token=` 的 Fragment 格式错误。隔离迁移往返、专项集成与整仓
  `corepack pnpm ci:fast` 均通过；后者包含状态模型 118、Web 450、Python 402、离线 55、合同 12、移动 4 项测试，
  生产构建和合同一致性检查也成功。pnpm/pip 审计未发现已知漏洞。
- 当前尚未 commit、push、PR、merge、deploy 或真实重发；RC7 线上状态保持不变。下一步只提交并推送修复分支、创建
  PR，等待最终 head 的 `fast/integration/browser/mobile` 远端门禁，不自动合并或部署。
