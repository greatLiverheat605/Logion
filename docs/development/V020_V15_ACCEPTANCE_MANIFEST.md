# V20-15 最终发布门 Acceptance Manifest

> 日期：2026-08-08（Asia/Shanghai）  
> 结论：**候选验收记录完成；非 Docker 实时栈已补证，生产发布与敏感能力启用仍保持阻塞，等待用户另行明确批准。**

## 1. 不可变身份与范围

| 项目            | 结果                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| 仓库            | `greatLiverheat605/Logion`                                                             |
| 正式集成工作树  | Orca `v020-integration`（不在仓库中持久化主机用户目录）                                |
| 分支            | `codex/v020-integration`                                                               |
| 不可变基线      | `08babebcd5a09861106c9b05accf32bd8f2ea01c`                                             |
| 代码候选提交    | `0b66e033c822bdcd759af8cd19e9ec9ead4eba94`                                             |
| 远端状态        | `origin/codex/v020-integration` 与当前本地 HEAD 同步；本 manifest 已随文档收口提交推送 |
| 协调者/实际模型 | Windows Codex / `gpt-5.6-sol`                                                          |
| 外部 worker     | 本门无新 worker；Kimi 首版施工与 DeepSeek 只读终审沿用已接受证据                       |

本门只复核候选集成，不发布、不 merge 默认分支、不启用生产敏感能力，不接触生产数据、凭据或
Provider endpoint。V20-14 演练文档提交为 `0b66e03`；本 manifest 与状态收口随后提交。代码自
`b4b2888` 后未改变。

## 2. Diff、路径与秘密边界

- 基线到候选共 95 个已跟踪变更路径，均位于仓库内的既定 API、Worker、Web、合同、测试、文档和
  配置范围；没有额外未跟踪文件、暂存文件或生成缓存。
- `git diff --check` 通过，`git status --short --branch` clean；代码候选与文档收口均已推送，未改写历史。
- `pnpm guard:context` 与 `pnpm agent:state:check` 通过；协调 Run 校验为
  `run-v020-v11-remediation`：38 events、46 nodes、8 handoffs、24 observations。
- 增量 diff 的敏感文本复核只发现测试用的 Bearer 假值；没有真实 token、密钥、私有端点、生产
  `.env`、恢复密钥或用户私有目录写入仓库。
- 已在非 C 盘临时工具目录安装 Gitleaks `8.30.1`，对当前仓库完整 Git 历史执行
  `gitleaks git --config .gitleaks.toml --redact --no-banner`：共扫描 406 个提交、约 15.74 MB，
  **0 条泄漏**。扫描报告未写入仓库；仓库内的状态机秘密扫描、候选安全测试与 CI 快速门禁也已实际通过。

## 3. 实际执行的候选门禁

| 门禁                                   | 结果与证据                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm ci:fast`                         | **通过**：协调 118；Python `402 passed, 67 deselected`；Web Vitest `224 passed`；lint、typecheck、build、合同生成均通过                                          |
| `pnpm contracts:check`                 | **通过**；OpenAPI、TypeScript 与 sync-v1 生成后无脏 diff                                                                                                         |
| `pnpm audit --prod --audit-level high` | **通过**：No known vulnerabilities found                                                                                                                         |
| `uv run --group dev pip-audit`         | **通过**：No known vulnerabilities found；工作区包因非 PyPI 项按工具规则跳过                                                                                     |
| 默认关闭合同                           | **通过**：`apps/api/tests/test_knowledge_space_contract.py` 为 `27 passed`；所有敏感开关默认 `false`，邮件 Provider 默认 `disabled`                              |
| 临时 PostgreSQL 迁移门禁               | **通过**：非生产隔离集群完成 `upgrade head` 与 `alembic check`，迁移头为 `0038_local_worker_protocol`                                                            |
| 真实认证浏览器                         | **通过**：`pnpm test:browser` 为 `95 passed, 6 skipped`；知识空间图谱 4 项、集成中心 5 项均通过，覆盖 axe、1440/390px、移动节点、键盘导航与持久化主题 XSS        |
| 回滚与恢复                             | **通过（V20-14 已接受）**：空环境迁移往返、备份恢复、非空降级停止线、引用闭包孤儿 `0`；详见 [`V020_V14_ROLLBACK_REHEARSAL.md`](./V020_V14_ROLLBACK_REHEARSAL.md) |

## 4. 已接受但本轮不重复的真实栈证据

候选代码自 `b4b2888` 后未改变，以下证据可由 V20-11～V20-14 已接受 observation 继承：隔离
PostgreSQL/Redis/ClamAV、附件扫描与残留清理、Local Worker crash/upload 恢复、worker-offline
在线核心、迁移集成、Compose 边界和 DeepSeek 只读终审。V20-10 Nightly #40（GitHub run
`31147645530`，固定 UI 提交 `64298ec597b6e45dfea9a94cc819c77daf0cda8b`）已通过
1440/390px 溢出、axe、移动节点列表、桌面图谱键盘导航和持久化主题值 XSS；该提交到候选没有
任何 Web、Playwright 或浏览器配置差异。

## 5. 未运行项、失败项与原因

以下项目仍不能记为当前候选的重新通过：

1. Compose smoke 与真实 release workflow：本轮不启动 Docker；V20-10/V20-12 的隔离边界证据已
   接受，但本轮不把 Docker 运行记为通过。
2. 发布候选镜像 digest、签名/attestation、容量证据与真实 release workflow：没有获用户发布
   授权，也没有生产镜像和凭据；不执行、不伪造。
3. 独立 `gitleaks`：已完成全历史扫描并通过（Gitleaks `8.30.1`、406 commits、0 findings）。
   该结果只覆盖当前集成分支历史，不替代发布工作流对最终镜像的安全扫描与 attestation 校验。
4. 临时隔离服务、进程和 Redis 测试库均已停止并清空；临时 J: 目录删除受当前文件策略阻止，
   目录不在仓库、无生产数据或凭据，待下一次允许安全清理时删除。

## 6. 生产开关与残余风险

`knowledge_space_api_enabled`、Shared Write、Deletion、Attachment ingest、Local Worker、
Attachment scanner、AI Acceptance 均保持关闭；邮件 Provider 为 `disabled`，sync-v1 未变更。
不启动本机 Docker，不绕过 SessionBoundary，不使用恢复密钥或任何生产凭据。

远端 push 提示默认分支存在 Dependabot 风险（2 high、1 moderate）；本分支 `pnpm audit` 与
`pip-audit` 已通过，但默认分支风险仍应在发布决策中单独处理。

## 7. 决定与下一步

V20-15 **候选验收可接受，但发布门未解除**。下一步只有两种受控动作：

- 用户明确批准后，在非生产隔离环境补跑 PostgreSQL/认证浏览器/发布候选所需门禁；或
- 用户明确批准生产发布流程后，另行创建 release candidate、镜像签名和发布 Run。

在此之前不得 merge、发布或打开 Attachment、Local Worker、Shared Write、Deletion、Provider、
sync-v1、AI Acceptance 任一生产能力。

## 8. 发布准备复核（2026-08-08）

- GitHub 官方状态 API 返回 `All Systems Operational`；公开只读核对显示当前默认分支为 `main`。
- 当前集成分支 `codex/v020-integration` 的候选提交尚未产生对应的成功 Main candidate 与 full-capacity
  workflow 运行。现有成功 Release/Capacity 运行绑定的是 `main` 的旧提交
  `ebf93ee192598430393f93e9313665c36446f84e`，不能复用于当前候选。
- 本机 GitHub CLI 未登录，因此没有触发 workflow_dispatch；本轮不申请凭据、不合并默认分支、不启动
  Docker，也不创建镜像、签名或 attestation。生产发布仍需用户明确批准，并在同一 source SHA 上完成
  Main candidate、capacity、Release candidate 三段链路。
