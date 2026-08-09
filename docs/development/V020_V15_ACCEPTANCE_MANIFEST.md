# V20-15 最终发布门 Acceptance Manifest

> 日期：2026-08-08（Asia/Shanghai）  
> 结论：**Release candidate `0.2.0-rc1` 与同 SHA 镜像 provenance attestation 已通过；生产发布仍保持阻塞，等待用户另行明确批准。**

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
| 外部 worker     | 本门无新 worker；首版施工与只读终审沿用已接受证据                                      |

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
在线核心、迁移集成、Compose 边界和既有只读终审。V20-10 Nightly #40（GitHub run
`31147645530`，固定 UI 提交 `64298ec597b6e45dfea9a94cc819c77daf0cda8b`）已通过
1440/390px 溢出、axe、移动节点列表、桌面图谱键盘导航和持久化主题值 XSS；该提交到候选没有
任何 Web、Playwright 或浏览器配置差异。

## 5. 未运行项、失败项与原因

以下项目仍不能记为当前候选的重新通过：

1. 本机 Docker smoke：本机仍未启动 Docker；但 Release candidate run `31259843000` 已在隔离
   GitHub runner 实际通过 unchanged candidate 的 Docker smoke、空环境恢复、浏览器/WCAG 与清理。
2. 生产发布：Main candidate 已对同一 SHA 的四个 digest 执行 provenance attestation 和 exact-candidate
   security scan，并且全部成功；Release candidate 已使用 digest-pinned 镜像完成候选 smoke。生产发布授权
   和生产环境执行仍未完成，不把候选通过等同于生产发布。
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
- 合并提交 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a` 已产生成功的 `Main candidate` run
  `31255904782`（`head_sha` 与 `main` 已核对一致），同一提交的 `Mobile builds` run `31255904757`
  也已成功；随后已补齐同一 SHA 的 `Full capacity profile` run `31257249374`，结论为 `success`。
- 容量 job `93102425322` 的专用 PostgreSQL/Redis、迁移、实际容量数据生成和 artifact 上传步骤均为
  `success`；artifact `capacity-profile-448cbdf8bd43c45aa25e3f2068e2246f3299be3a` 未过期。
- artifact 下载端点需要认证，未将无法独立下载的内容伪造为本地文件复核；Release candidate run
  `31259843000` 已成功并生成 artifact `release-candidate-0.2.0-rc1-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。
- Main candidate run `31255904782` 的四项 `actions/attest-build-provenance` 与 `Verify provenance and
scan exact candidate` 均成功；本机 Docker 仍未启动，生产发布和敏感生产能力启用仍需另行批准。

## 9. Release candidate 实际运行证据（2026-08-08）

- Run `31259843000` / job `93108836660`：`head_sha`、分支和候选输入校验成功；`pnpm ci:fast`、
  full-capacity evidence、candidate manifest、digest-pinned image、Docker smoke、empty-environment
  recovery、old-client compatibility、authenticated browser/WCAG、5/25/100% rollout rehearsal、
  evidence capture 与 compose cleanup 均为 `success`。
- Release artifact `9022539674`（`release-candidate-0.2.0-rc1-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`）
  当前未过期；下载端点需要认证，因此不把未下载的 artifact 内容冒充成本地复核结果。
- 该 run 不是生产发布，也没有打开 Attachment、Local Worker、Shared Write、Deletion、Provider、
  sync-v1 或 AI Acceptance。

## 10. 同 SHA 镜像 provenance 证据（2026-08-08）

- Main candidate run `31255904782` / job `93099092811`：web、api、worker、backup 四个
  `actions/attest-build-provenance` 步骤均为 `success`。
- 同 job 的 `Verify provenance and scan exact candidate` 为 `success`，工作流使用
  `gh attestation verify --repo` 对四个 digest 执行 provenance 核验，并完成 exact-candidate 安全扫描。
- 该证据与 Release candidate 的 `source_sha=448cbdf8bd43c45aa25e3f2068e2246f3299be3a` 一致；生产发布
  尚未执行，敏感生产开关继续关闭。

## 11. 生产发布执行前提（2026-08-08）

- 用户已批准进入生产发布执行，但项目没有自动部署 workflow；生产入口是
  `infra/runbooks/aliyun-production-release.md` 的受控 ECS 手册流程。
- 生产执行尚缺目标 ECS/SSH 访问、正式域名/DNS/TLS、DirectMail/RAM、生产密钥环、异机备份副本和
  受控运维接收人。上述信息必须通过安全渠道提供，不能写入仓库或聊天。
- 在这些外部前提满足前，不进行 SSH、DNS、数据库迁移、生产邮件投递、流量切换或敏感能力启用；本
  manifest 结论仍为“候选已通过、生产未发布”。

## 12. 生产目标只读预检（2026-08-08）

- 首版 ECS 配置已复用并通过只读检查：Ubuntu 24.04、Docker/Compose/Nginx/jq、应用目录、`.env`、
  备份密钥与 SSH 密钥登录均正常；没有读取私钥或生产密钥值。
- 线上仍运行旧提交 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`、迁移头 `0034_sync_conflicts`，
  服务健康；最新备份 checksum 为 `OK`。候选 `448cbdf` 尚未部署或迁移。
- `aliyun_directmail`、杭州地域和 `LogionDirectMailSender` 已在现有 `.env` 配置，IMDSv2 角色名核对
  成功；`mail.logion.work` SPF 已存在，但 `_dmarc.logion.work` 尚未解析，DKIM/DMARC 仍需完成公开 DNS
  与控制台确认。
- 只读预检没有改变生产状态；在邮件 DNS 与异机备份门禁补齐前，不进行维护窗口、迁移或流量切换。
- `F:\LogionBackups` 的现有副本最晚为 2026-07-30，且该卷未显示 BitLocker 保护；服务器最新备份
  `2026-08-08` 尚未复制到受保护异机并完成恢复验证，因此不计为本次发布的 off-host 证据。
