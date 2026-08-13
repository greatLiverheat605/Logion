# v0.2.0 当前进度快照

> 更新时间：2026-08-10（Asia/Shanghai）。
> 当前阶段：**V20-01～V20-14 已通过验收；V20-15 RC6 已完成同 SHA 全链路验收并部署到受控 prerelease。部署、加密备份、异机校验、隔离恢复和首轮运行时检查通过；用户已报告当前浏览器会话登录，认证 UX 实际走查仍为 `not_run`。Production 发布、邮件投递验收和流量切换仍未完成，敏感生产能力继续关闭**。
> 正式实现状态：**V20-08/V20-09 与 V20-10 服务端、前端首版均已进入 `codex/v020-integration`；知识空间 API、Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 生产开关继续默认关闭**。
> 当前文档主线：`origin/main=62ddd5251a8ce609dc434b8e6286bd8c7c9d9517`。RC6 实际产品源码仍为
> `c47aa376d95b179200d59986c20289b796740959`；Main candidate run `31337611805`、Full capacity run
> `31338032379` 与 Release candidate `0.2.0-rc6` run `31338128822` 均成功并绑定该产品 SHA。文档主线 SHA
> 与运行产品 SHA 不得混淆。受控 prerelease 当前运行 RC6；该状态不等于 Production 发布。

## V20-15 RC6 受控 prerelease 部署断点（2026-08-10）

- RC6 已在受控维护窗口完成原子切换。当前源码与 API ready 版本均为
  `c47aa376d95b179200d59986c20289b796740959`，迁移头为 `0038_local_worker_protocol`；候选 manifest
  SHA-256 为 `12280604e31621ef3cad437ec712a1b9e80dfccb64c2d7326509c0354f1624e7`。
- API、Worker、Web、Reverse Proxy、Backup、PostgreSQL 与 Redis 均运行；有健康检查的服务全部 healthy，
  OOMKilled 均为 `false`、RestartCount 均为 0。四个应用容器的运行镜像与 RC6 manifest 固定 digest 逐项一致。
- 公网 `/health` 返回 HTTP 200；HSTS、nonce CSP、`X-Frame-Options: DENY`、
  `X-Content-Type-Options: nosniff` 和 `Referrer-Policy: no-referrer` 均存在。切换后 20 分钟内五个应用服务的
  serious log 匹配数均为 0；磁盘使用 37%，可用内存 758 MiB，Swap 使用 125 MiB。
- RC6 启动后加密备份 `logion-20260809T225859Z-beta-v1.backup` 已通过服务器完整校验并同步到
  BitLocker XTS-AES-256、100% 加密且 Protection On 的受控 Windows 异机卷；Windows 独立计算的
  SHA-256 为 `cd423291ebf372a35484e839e4788125027959379f2d07ae90fea605654dcf99`，与 sidecar 一致。
- 使用同一备份完成 ECS 隔离空环境恢复：迁移头 `0038_local_worker_protocol`、`workspace_count=2`、
  `null_sync_epoch_count=0`。精确命名的临时数据库和临时附件目录均已清理，未覆盖线上数据库或数据卷。
- 运行配置复核显示 Knowledge Space API、Shared Write、Deletion、Attachment Ingest、Local Worker、
  AI Acceptance 与 Legacy Registration 均为 `false`，启用的 AI Provider 数量为 0；sync-v1 未变。
- 认证浏览器仍是当前断点：用户已经报告当前浏览器会话登录，但协调方尚未在该会话真实完成走查；此前
  可控标签访问 `/app/review` 得到“需要登录”。21 个受保护路由、交互反馈、邀请 409、重复提交、
  搜索、知识图谱、主题持久化和控制台错误回归保持 `not_run`，不得写成通过。
- RC2 回滚源码、旧镜像、部署前/后备份和数据卷继续保留。RC6 观察期从
  `2026-08-09T22:59:03Z` 起算；认证 UX、真实受邀邮件、实体移动设备和至少 24 小时观察未完成前，
  不宣称 Production，不清理回滚点，不开启任何敏感生产能力。

完整部署证据见 [`V020_V15_PRERELEASE_RC6_EVIDENCE.md`](./V020_V15_PRERELEASE_RC6_EVIDENCE.md)。

## 主线交接与系统操作体验重设计断点（2026-08-10）

- 用户决定把后续主线交给一个指定执行方接手。仓库长期规则只记录“主线执行方”等通用角色名；模型品牌
  不自动授予 Git、秘密、生产开关或发布权限。
- 主线下一步先完成只读接管、认证 UX 人工回归和 RC6 至少 24 小时观察收口。真实邀请邮件、实体移动设备、
  Production、流量切换、回滚点清理和任何敏感能力启用仍需用户逐项批准。
- 用户明确不习惯当前系统操作页的样式与操作方式。现有 RC6 继续作为功能、安全和合同基线，但不视为下一轮
  视觉与交互批准稿。
- 两个专项设计执行方将基于同一 approved base 独立完成“产品诊断 → UX 审查 → 信息架构重构 → 交互重构 →
  视觉重构 → Design System → 高保真交互原型”。它们使用独立 worktree/目录，只能写设计与隔离原型，
  不得修改 `apps/web/src/**`，也不得提交、推送、合并或部署。
- 设计方可以在隔离原型中采用成熟开源组件或图谱/布局库，但必须记录精确版本、许可证、可访问性、维护状态、
  包体和供应链评估；不得修改根 manifest/lockfile。正式前端接入任何新依赖前，主线执行方必须另行完成依赖审查。
- 用户审批一份完整原型或明确要求组合修订后，主线执行方才可开始正式前端施工。双方案任务包见
  [`mainline-handoff/07_FRONTEND_REDESIGN_BRIEFS.md`](../coordination/mainline-handoff/07_FRONTEND_REDESIGN_BRIEFS.md)。

## V20-15 RC6 全链路验收通过（2026-08-10）

- PR #206 已 Squash 合并到 `main`，合并提交为 `c47aa376d95b179200d59986c20289b796740959`；PR checks run `31337462102` 的 `fast`、`integration`、`browser` 三项门禁均成功，真实 browser job 覆盖 101 项浏览器用例。
- 新提交的 Main candidate `31337611805` 与 Full capacity profile `31338032379` 均成功，并确认 `head_sha` 与上述完整 SHA 一致。
- Release candidate `0.2.0-rc6` run `31338128822` 成功验证指定 Main/Capacity 证据与候选 manifest，并依次通过不可变镜像 smoke、空环境恢复、旧客户端/恢复 epoch 兼容、真实认证 Browser/PWA/WCAG、5%/25%/100% rollout rehearsal、证据捕获与隔离环境清理。
- RC6 制品 `release-candidate-0.2.0-rc6-c47aa376d95b179200d59986c20289b796740959` 已生成且未过期。该结论只授权进入受控 prerelease 部署流程，不等于 Production 发布或流量切换。
- RC5 暴露的两个测试基础设施缺陷已由 PR #206 修复并在 PR browser 与 RC6 中复核：每个 Playwright 全局 worker 槽均有独立认证状态；reduced-motion 只原子采样当前文档中的已解析壳层节点，不再把脱离文档的旧节点误报为动效。
- RC6 已在后续受控维护窗口部署；实际部署、备份、恢复和浏览器断点以上一节为准。Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## V20-15 RC5 浏览器并行与路由采样修复断点（2026-08-10）

- PR #205 已 Squash 合并到 `main`，PR 的 `fast`、`integration`、`browser` 三项门禁均成功；合并提交为
  `2317f83557f7be2c79f94a30ef89465bc06d7f0c`。
- 新提交的 Main candidate `31336153147` 与 Full capacity profile `31336499869` 均成功，并确认绑定同一完整 SHA。
- Release candidate `0.2.0-rc5` run `31336608321` 通过指定 Main/Capacity 证据、快速检查、不可变镜像 smoke、空环境恢复与旧客户端/恢复 epoch 兼容，但在真实认证浏览器门禁失败；rollout rehearsal 未获得通过结论，候选不得部署。
- 同一浏览器门禁暴露两个独立测试基础设施缺陷：全局 setup 只按认证项目 worker 数创建一份状态，而认证项目可被调度到 Playwright 全局并行槽 1；reduced-motion 断言通过 locator 跨边界传递元素，React 路由替换时旧节点脱离文档，计算样式变为空字符串并被误报为动效。
- 修复分支 `codex/v020-rc5-browser-stability` 基于上述新 `main` 创建。setup 现在按实际全局 worker 数生成隔离认证状态；动效断言等待完整 load，并在页面内同步查询和采样当前壳层，同时显式拒绝壳层缺失和未解析计算样式。SessionBoundary、产品 CSS 与认证策略不变。
- 本机已通过目标文件 Prettier、Lint、TypeScript/Mypy、Playwright 101 项测试发现、Python 402 项、Web 231 项、离线/合同/移动测试、生产构建与 `git diff --check`。真实认证浏览器仍必须由该分支 PR 验证。
- 本地协调 Run 校验仍因历史 `graph.json` 与 `tasks.jsonl` 的 encoded-content safe-scan budget 超限而失败；历史文件保持原样，不派发外部任务。ECS 继续保持 RC2，所有敏感生产开关继续关闭。

## V20-15 RC4 浏览器门禁修复断点（2026-08-10）

- PR #204 已将全局 reduced-motion CSS 修复 Squash 合并到 `main`；候选 CSS 与本机生产构建 CSS 的 SHA-256 一致，不是错误镜像或漏打包。
- Release candidate `0.2.0-rc4` run `31334288158` 的候选镜像 smoke、空环境恢复与兼容验证通过，但认证浏览器门禁在 `/app/today` 报告 34 个 transition 元素，原执行与 retry 均失败，因此不得部署。
- 失败 trace 证明样式表在断言前已加载，`page.emulateMedia({ reducedMotion: "reduce" })` 也成功；但 `goto(..., { waitUntil: "domcontentloaded" })` 返回时页面仍处于 SessionBoundary 验证状态，`.app-shell-frame` 尚未挂载。原 `evaluateAll` 在 React 挂载期间采样，门禁没有等待认证页面稳定。
- 修复分支 `codex/v020-rc4-reduced-motion-today` 基于上述 `main` 创建。浏览器断言现在先等待应用外壳与 `h1` 可见，再显式校验 media query，并在失败时输出最多 50 个元素的标签、类名和计算动效属性；现有产品 CSS 不再重复修改。
- 本机已通过目标文件 Prettier、Playwright 测试发现、Lint、TypeScript、Mypy、402 个 Python 测试、231 个 Web 测试、生产构建与合同检查。整仓聚合 `pnpm ci:fast` 的格式阶段仅因必须保留且不提交的 `.tmp-v020-rc4` 原始 trace/HTML/JSON 被扫描而停止；这些证据未被格式化、删除或纳入提交。
- 真实认证浏览器仍必须由该分支 PR 的 GitHub browser job 执行并通过，之后才可合并并以新 `main` SHA 重跑 Main candidate、Full capacity 与新版本号 RC5。ECS 继续保持 RC2，所有敏感生产开关继续关闭。

## V20-15 RC3 reduced-motion 修复断点（2026-08-10）

- PR #203 已按用户批准完成 Squash 合并，合并提交为
  `cb0ada40187088a58f591246ff4de03fc05293e6`；其文件树与已审批的 PR head 一致。
- 同一提交的 Main candidate run `31332165349` 与 Full capacity run `31332633330` 均成功。Main job 的构建、
  digest 固定镜像 smoke、provenance、漏洞扫描和 SBOM 均实际执行；容量 job 的专用数据库迁移、数据生成和测量也实际执行。
- Release candidate `0.2.0-rc3` run `31332751602` 正确校验了上述同 SHA 证据，并通过候选镜像 smoke、空环境恢复和旧客户端/恢复 epoch 兼容；
  但在 `Browser, PWA and automated WCAG gate` 失败，因此 rollout rehearsal 被跳过，候选不得部署。
- 失败可重复发生在认证路由 `/app/exam`：系统启用 `prefers-reduced-motion: reduce` 时仍有 25 个元素保留 transition；
  原断言和 CI retry 均得到 `Expected: 0, Received: 25`。这不是 GitHub 基础设施事故。
- 修复分支 `codex/v020-rc3-reduced-motion` 从该 `main` 创建，只在 reduced-motion 媒体查询中统一关闭应用外壳动画、过渡和滚动动画；
  普通动效不变。本机 `pnpm ci:fast` 已通过（协调 118、Python 402、Web 231，以及格式、Lint、类型、Mypy、构建和合同检查）。
- 本地协调 Run 校验仍因历史 `graph.json` 与 `tasks.jsonl` 的 encoded-content safe-scan budget 超限而失败；历史文件保持原样，
  当前不派发外部任务。修复必须先进入 PR 并让认证 browser job 真实通过，再生成新的不可变候选；不得重跑失败 RC3 后伪造通过。
- ECS 当前继续运行前一 RC2；未执行候选部署、数据库迁移、真实邮件或流量切换。Shared Write、Deletion、Attachment、
  Local Worker、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## 主线交接更新（2026-08-09）

- PR #202（`b850725` + `7fc1d84`）已由用户批准并以 Rebase and merge 合并到 `main`；合并提交为
  `2339002cd084950c3b859db561ade66fcfa528f4`。
- 合并后的 Main candidate 为 run `31300835608`，已完成且 `conclusion=success`；运行 `head_sha` 为
  `2339002cd084950c3b859db561ade66fcfa528f4`，与合并提交一致。
- 该候选 job 实际完成 `pnpm ci:fast`、生产依赖许可策略、Compose 校验、候选镜像构建、provenance、精确候选 smoke、
  Trivy/CodeQL/SBOM、artifact 上传和环境清理；未触发生产发布或流量切换。
- RC2 已部署到受控公网 prerelease；`https://logion.work/health` 连续返回 HTTP 200，但 Web 展示版本仍为 `0.1.0`，API ready 与精确运行镜像已绑定 `2339002…`。
  当前仍不能标记为 v0.2.0 正式上线。原验收会话在候选重建后失效，认证人工回归暂记 `not_run`；未读取凭据、未发送真实邀请。
- 执行方切换按用户当前指令暂缓；主线交接包已准备但不视为已启动新任务。用户同意后再重新规划并发出新的提示词。
- 当前仅保留用户指定的主线执行方；其他模型和工具暂停派发，特殊专业场景需用户另行配置。主线交接包位于
  [`docs/coordination/mainline-handoff/`](../coordination/mainline-handoff/)。
- 本次记录只完成状态交接，不开启 Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance，
  不执行生产发布、真实邮件或流量切换。

## V20-15 RC2 部署断点（2026-08-10）

- RC2 候选仍固定为 `2339002cd084950c3b859db561ade66fcfa528f4`；Main、full-capacity 与 Release candidate `0.2.0-rc2` 三个 GitHub 流程均已成功。
- 首次补拉连接在 API 42.06 MB 处被 GHCR 对端重置；单进程重试随后完成 API，四个候选 digest 已全部存在并与 manifest 一致。
- 迁移前备份 `logion-20260809T180418Z-beta-v1.backup` 已通过服务端校验、同步到 BitLocker `J:` 并在 Windows 复核 SHA-256；隔离空环境恢复头为 `0038_local_worker_protocol`，Workspace 2、空 sync epoch 0。
- 旧失败演练残留库经核对 `public` 表和活动连接均为 0 后已按精确名称清理；主库与数据卷未触碰。
- `attachment-init`、Alembic 幂等升级、候选服务健康等待全部通过；运行中的 API/Web/Worker/Backup 精确 digest 与 RC2 manifest 一致，OOM/重启计数为 0，API ready 明确返回 source SHA `2339002…`。
- 公网 `/health` 连续三次 HTTP 200，安全响应头完整，近 15 分钟无严重服务日志；部署后备份 `logion-20260809T182125Z-beta-v1.backup` 也已校验并复制到加密卷。
- Web health 仍展示 `0.1.0`，并且原受控 Owner 浏览器会话在候选重建后失效；登录页已打开，完整认证 UX 回归保持 `not_run`，不伪造通过。
- 详细证据见 [`V020_V15_PRERELEASE_RC2_EVIDENCE.md`](./V020_V15_PRERELEASE_RC2_EVIDENCE.md)。Production 发布、流量切换和所有敏感生产开关继续阻塞。

## PR #198 integration follow-up（2026-08-08）

- 修复提交 `93eae8d` 后，GitHub Actions run `31254465425` 仅剩知识空间核心集成测试的 `POST /knowledge/search` 返回 404；图谱读取已通过。
- 根因是测试夹具只打开知识空间 API，却没有配置 HMAC 分页游标密钥；首次搜索需要生成 `next_cursor` 时，服务按 fail-closed 规则返回资源不存在。生产默认配置未改变。
- 提交 `dab9fcb` 为该夹具提供仅测试用的 32 字节游标密钥。其后的 run `31255160930` 在同一 head SHA `dab9fcbf0e4cac132a82ac0034e69addd64ab0ab` 上，integration、browser、fast 三个 job 全部成功；迁移往返、全量集成、真实认证浏览器、无障碍/响应式检查、`pnpm audit`、`pip-audit` 与 `pnpm ci:fast` 均由 CI 实际执行并通过。
- 本机窄集成测试仍因未运行且凭据不匹配的 PostgreSQL 无法执行；该限制不影响 CI 的真实 PostgreSQL 验收，也未启动 Docker。所有敏感生产开关继续关闭。

> 恢复记录：用户于 2026-08-06 明确要求从 V20-02 断点继续。Codex 已重新复核现有差异、PostgreSQL
> 往返/失败关闭和整仓遗留门禁，完成 V20-08/V20-09 实现、独立验收、提交与推送。

> 后续记录：用户于 2026-08-06 授权按计划继续并在必要时提交 GitHub。Codex 完成 V20-04，建立
> 默认关闭合同、休眠权限、严格 Schema、权限策略、HMAC 游标、ETag 与双桶限流原语；聚焦门禁、
> 生成门和 sync-v1 隔离门均通过。设计、迁移和合同拆为 3 个提交并已推送
> `origin/codex/v020-integration`，当前合同提交为 `5437135`。

## 总体判断

多 Agent 协调基础设施已经建立。原型执行方完成第一版整体动态知识空间原型，用户批准按该原型
方向推进，并随后明确指定前端执行方完成本次正式前端首版施工。Windows Codex
已接管结果，将受控原型入口、真实 Review 数据适配、只读动态图谱、移动列表、键盘交互和状态面板集成到
`codex/v020-integration`；审查发现并修复了正式节点全部落在 `(0,0)` 的重叠问题，同时补齐仓库格式门。
M0 已按推荐方案通过：
首版复用 `Resource`，citation 显式指向四类目标，`TopicDependency` 保持唯一先修关系，API
只加法、online-only、默认关闭且 sync-v1 不变，共享知识写入继续保持关闭。V20-01、V20-03 和
V20-07 已完成协调复核并获用户批准；用户随后单独授权 V20-02，Windows Codex 已完成隔离
PostgreSQL 往返、约束负测、孤儿停止、非空降级停止、备份恢复和合成规模估算。V20-04 又完成了
加法 OpenAPI/TypeScript 快照、休眠 Permission、默认关闭 Route、严格输入输出 Schema 和可独立测试的
安全原语。ORM/核心服务及本次前端首版已经集成；生产策略、V20-11 准入评审和发布仍须按后续门禁推进。主线执行方
纯图内核仍只是无授权、无数据库、无游标和无服务端资源治理的候选，不计 V20-08/V20-10 完成。

不要使用虚构百分比衡量当前进度。按门禁判断：**架构 M0、第一版 UX 方向以及 V20-01/03/07
设计基线、V20-02 迁移证明、V20-04 合同门、V20-08 核心数据路径、V20-09 接受闭环与 V20-10
真实栈浏览器/移动安全门、V20-11 默认关闭准入、V20-12 集成门、V20-13 只读终审与 V20-14
隔离回滚演练已冻结；V20-15 发布门尚未完成。**

## 阶段状态

| 范围                              | 状态                                                                      | 已有证据                                                                                                                                                                                                         | 下一门禁                                                          |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 多 Agent 协调闭环                 | 已完成基础能力                                                            | `AGENTS.md`、协调 Skill/contract、状态 Schema/校验器、可验证 Runs；`codex/v011-coordination` 已推送                                                                                                              | 持续按本 SOP 更新账本和快照                                       |
| V20-00 / M0 架构基础              | 已批准                                                                    | ADR-0029 Accepted；Orca `task_5f8745a5770e` complete；五项推荐边界已冻结                                                                                                                                         | 执行 V20-01/03/07 设计门，不扩大为实现授权                        |
| 旧 A/B 原型                       | 技术验收通过、产品方向已否决                                              | 9 个限定原型文件；23/23 Vitest、lint、typecheck、build 通过；A/B 评审包完整                                                                                                                                      | 仅保留历史证据，不进入施工                                        |
| 整体动态知识空间原型              | 已作为受控演示入口集成                                                    | 原型代码、既有浏览器 QA、正式施工提交 `5d737b7`；生产视图不默认使用 mock                                                                                                                                         | 保留演示边界；未来迭代 owner 仍由用户另行指定                     |
| V20-06 UI 冻结                    | 第一版方向与首版实现已集成                                                | 用户批准第一版方向，并一次性指定前端执行方施工；Codex 审查修正 `7a93ac9`，Nightly #40 真实浏览器门禁已通过                                                                                                       | 进入 V20-11，前端后续 owner 仍由用户指定                          |
| bounded graph kernel              | 纯图内核模块候选验收通过                                                  | 42 个 pytest、Ruff lint/format、mypy、空白/范围/秘密检查及四组关键运行时复现均由 Codex 独立通过                                                                                                                  | 保持未提交候选；正式接入须等待设计门及授权、scope、游标和资源治理 |
| V20-01/02 schema 与迁移           | V20-02 隔离证明已完成                                                     | [`V020_MIGRATION_PROOF.md`](./V020_MIGRATION_PROOF.md)；往返/负测/恢复/规模证据已通过；migration commit `91451bd`                                                                                                | ORM 登记和 `alembic check` 收口留给 V20-08                        |
| V20-03/04 permission/API/OpenAPI  | V20-04 已完成并验收                                                       | 9 Path/11 Operation/26 Schema 纯加法；133 个聚焦测试、264 个 API 测试、合同生成/检查、sync-v1 固定哈希一致；commit `5437135`                                                                                     | 进入 V20-08 前复核硬失败关闭边界；不得直接启用主 Flag             |
| V20-07 保留/隐私签核              | 设计与推荐矩阵已批准                                                      | [`V020_RETENTION_THREAT_SIGNOFF.md`](./V020_RETENTION_THREAT_SIGNOFF.md)；用户于 2026-08-05 批准，敏感能力保持关闭                                                                                               | 生产启用前完成独立合规证据与 Owner 门禁                           |
| V20-08 bounded core               | 已完成并推送                                                              | Codex 独立验收；核心 ORM、授权、bounded read、图内核与整仓门禁均有证据                                                                                                                                           | 保持默认关闭；进入 V20-09/V20-10 后续门禁                         |
| V20-09 AI acceptance              | 已完成并推送                                                              | 候选/收据迁移、RFC 8785 幂等 hash、事务锁定、并发/重放/stale 测试、整仓门禁均有证据                                                                                                                              | 进入 V20-10；Acceptance 生产开关继续关闭                          |
| V20-10 graph/search/rendering     | 已完成并通过 Nightly 真实栈验收                                           | Nightly #40：`31147645530`，目标 SHA `64298ec597b6e45dfea9a94cc819c77daf0cda8b`；审计、Compose、迁移/空环境恢复、认证 Playwright、1440/390px、axe、移动节点、桌面图谱键盘导航、持久化主题值 XSS 防护全部通过     | 进入 V20-11 默认关闭准入评审，生产开关继续关闭                    |
| V20-11 默认关闭准入               | 已通过，生产能力继续关闭                                                  | 常驻 loopback clamd、加密卷/ACL、附件 clean/malware/fail-closed、Local Worker crash/upload 恢复、worker-offline 核心流、迁移、整仓门禁和依赖审计均有真实证据；协调 Run 已完成接受                                | 保持全部生产开关关闭；进入 V20-12 集成门                          |
| V20-12～15 集成、终审、回滚、发布 | V20-12～V20-14 已通过；V20-15 候选已部署为 prerelease，生产正式发布仍阻塞 | [`V020_V15_ACCEPTANCE_MANIFEST.md`](./V020_V15_ACCEPTANCE_MANIFEST.md)；同 SHA provenance、Docker smoke、恢复、认证浏览器/WCAG 与候选 ECS 迁移/健康证据均已记录；真实邮件投递、24 小时观察与最终流量切换仍未完成 | 完成受邀真实邮件/设备验收、观察期和发布授权后再决定是否切换       |
| 只读终审                          | 已完成并由 Codex 接受                                                     | `task_66a2bdb9ab08` / `ctx_ce22e673e7fd`；审查目标 `7d50e675be19b2779613ed61ba31dc821afa73dc`；详见只读终审报告                                                                                                  | 不再派发；保留只读报告与清洁工作树证据                            |

## 当前等待点

当前执行顺序：

1. 在 `codex/v020-integration` 继续由 Windows Codex 单一 writer 集成；当前前端检查点为 `64298ec597b6e45dfea9a94cc819c77daf0cda8b`。
2. V20-01 与 V20-03 已通过异常交付恢复结算；正常 `worker_done` 未送达，不伪造该消息。
3. Windows Codex 已协调两份结果的冲突并完成 V20-07 retention/security 决策包。
4. 用户于 2026-08-05 单独授权 V20-02；迁移证明已完成，能力仍关闭。
5. V20-04、V20-08 与 V20-09 已完成并推送 `codex/v020-integration`；提交前后均通过整仓门禁。
6. V20-10 服务端、前端与真实 `127.0.0.1:8080` 栈验收均已完成；Nightly #40 对固定提交
   `64298ec597b6e45dfea9a94cc819c77daf0cda8b` 全绿。Shared Write、Deletion、Attachment 与 Local Worker 仍关闭。
7. V20-11 硬停止证据已补齐并由 Windows Codex 独立复核；当前 Run 为
   `.agents/coordination/runs/run-v020-v11-remediation`。生产开关继续关闭，V20-12 默认关闭任务节点已建立。
8. V20-13 只读终审已完成：无 High/Medium，5 个 Low/Info 已由 Windows Codex 修复并通过目标测试、整仓门禁、依赖审计、迁移检查及真实附件栈复核；审查工作树已恢复 clean。
9. V20-14 隔离回滚演练已完成并接受；V20-15 Release candidate、同 SHA 镜像 provenance attestation 与 exact-candidate security scan 已通过，生产发布仍等待用户批准。本次正式首版前端由用户一次性指定前端执行方完成；未来迭代 owner 仍待用户另行指定。

## 模型所有权决定

- 用户后续明确覆盖原限制，一次性指定前端执行方完成本次正式前端首版；该任务已经结束。
- 这次授权不延续为未来版本所有权；后续前端模型仍由用户另行指定。
- 主线执行方继续采用用户指定的桌面或 CLI 流程：用户粘贴任务提示词并启动，Windows Codex 负责任务包与验收；默认不由 Codex 操控外部图形界面。

## 已知阻塞与风险

- ADR-0029 与 V20-01/03/07 设计基线、V20-02 隔离迁移证明及 V20-04 合同门均已通过；ORM/服务、
  生产迁移、生产合规证据和敏感能力启用仍分别受独立门禁约束。
- V20-09 已登记 `0037_knowledge_acceptance` ORM；当前 `alembic check` 已通过。生产锁竞争、真实行数、
  生产恢复点与容量预算仍未验证，Acceptance 生产开关保持关闭。
- V20-04 的 11 个 Operation 只发布合同并硬失败关闭；V20-08 已实现 scoped query、对象两端授权、
  锁内复核、响应字节/时间和并发限制。V20-09 Acceptance 仍独立 fail-closed，未进入生产启用讨论。
- 整仓 `pnpm ci:fast` 已通过：协调状态、格式、lint、类型、377 个 Python 测试、前端测试/构建与合同检查
  均为绿色；默认门禁仍隔离 62 个 integration tests，V20-09 目标集成测试另行通过。
- V20-01/V20-03 worker 的终端交接完整，但 Windows `Path`/`PATH` 与 Orca 本地连接问题阻止了
  正常 `worker_done`；协调员已停止精确 Dispatch 并以显式恢复结果结算，未伪装正常交付通道。
- 第一版 UX 方向和正式首版代码已集成；两条认证 Playwright 用例可发现，但因本机没有
  `127.0.0.1:8080` API/Web 栈且本轮不启动 Docker，真实浏览器执行记为 unrun，不计通过。
- 纯内存图算法候选已通过模块验收，但尚无授权、Space scope、数据库查询、游标、响应
  字节、超时、速率和配额边界；不得直接作为正式 API 或 V20-08/V20-10 完成证据。
- 旧 A/B 的技术 accepted 不能误写为产品 approved。
- 外部执行方均无 commit 或 push 权限；只产出工作树差异，提交与推送均由 Windows Codex 完成；
  本次一次性前端授权不会延续为后续版本所有权；只读终审必须保持只读。

## 长期记忆位置

- 人类可读 SOP：[`AGENT_DELIVERY_WORKFLOW.md`](./AGENT_DELIVERY_WORKFLOW.md)
- 版本 DAG：[`V020_EXECUTION_PLAN.md`](./V020_EXECUTION_PLAN.md)
- 状态模型：[`AGENT_STATE_MODEL.md`](./AGENT_STATE_MODEL.md)
- 当前本地 Run：`.agents/coordination/runs/run-v020-v11-remediation`（活动指针已建立并通过校验；旧审查 Run 已关闭）

状态变化后必须更新本文件并向当前 Run 追加事件；不得只在聊天中记录。

## V20-15 最终发布门记录（2026-08-08）

候选提交 `0b66e033c822bdcd759af8cd19e9ec9ead4eba94` 的 acceptance manifest 已建立，且在非生产
隔离 PostgreSQL/Redis/API/Web/普通后台 Worker 上完成实时复核，记录完整
基线、差异/路径/秘密复核、整仓门禁、依赖审计、历史真实栈证据、未运行项、残余风险和清理边界，
详见 [`V020_V15_ACCEPTANCE_MANIFEST.md`](./V020_V15_ACCEPTANCE_MANIFEST.md)。本门不自动发布、不
merge、不启动 Docker，也不启用敏感生产能力；实时 PostgreSQL/认证浏览器、镜像签名/attestation
和发布授权必须在用户明确批准后另行执行。

## V20-15 发布准备复核（2026-08-08）

- 非 C 盘临时工具目录中的 Gitleaks `8.30.1` 已对当前仓库完整 Git 历史执行秘密扫描：406 个提交、
  约 15.74 MB，0 条泄漏；报告未写入仓库。
- GitHub 官方状态为 `All Systems Operational`。公开只读核对确认当前默认分支为 `main`，但当前
  `codex/v020-integration` 候选尚无同一 source SHA 的成功 Main candidate 与 full-capacity 运行；
  现有成功 Release/Capacity 运行属于 `main` 旧提交 `ebf93ee192598430393f93e9313665c36446f84e`，
  不可复用。
- GitHub CLI 未登录，本轮未触发 workflow_dispatch；没有创建镜像、签名/attestation、Docker release
  smoke，也没有 merge、发布或开启 Attachment、Local Worker、Shared Write、Deletion、Provider、
  sync-v1、AI Acceptance。V20-15 仍是候选可接受、生产发布阻塞。

## V20-08 最新断点（2026-08-06，覆盖前述旧快照）

V20-08 bounded knowledge-space core 已由 Windows Codex 在 `codex/v020-integration` 完成并通过本地验收；V20-08 的三个 Codex 任务（核心服务、父级 scope ORM/兼容性登记、图内核回归测试）均已写入 `run-v020-core` 并接受。实现包括 SourceExcerpt/Citation ORM、Workspace/Space 授权、Private owner 隔离、Shared 写入默认关闭、ResearchClaim 当前用户约束、行锁复核、ETag、HMAC cursor、列表/图查询限额、TopicDependency 有界图读取和查询超时错误。

本轮实际证据：知识空间契约 23 passed、图内核 42 passed、迁移集成 3 passed、核心 API 集成 2 passed、候选清单 7 passed；整仓 Python 376 passed（61 integration tests 按默认门禁隔离），Ruff、Mypy、前端 lint/typecheck/test/build、contracts 与 `pnpm ci:fast` 全部通过。隔离 PostgreSQL 已完成 `upgrade head` 与 `alembic check`；临时容器仅用于验证，不代表生产迁移/备份恢复批准。

安全和发布状态保持不变：`LOGION_KNOWLEDGE_SPACE_API_ENABLED`、cursor keys 与
`LOGION_KNOWLEDGE_SPACE_AI_ACCEPTANCE_ENABLED` 均默认关闭/未启用；Shared Write、Deletion、Attachment、
Local Worker、Provider 和 sync-v1 均未启用或修改。图正式关系当前仅为 `TopicDependency`，Citation 图节点
延后 V20-10。生产容量、备份恢复演练、只读终审、浏览器 UX 验收仍是后续门禁，不能把本轮验收表述为整个 v0.2.0 完成。

长期记录：当前 Run 指针为 `.agents/coordination/current-run.json -> run-v020-v11-remediation`；本轮修复事件、handoff、observation 和 SHA-256 证据位于 `.agents/coordination/runs/run-v020-v11-remediation/`，第一轮只读审查保留在已关闭的 `run-v020-v11-review/`。提交/推送前继续执行最终 diff、路径越界和秘密扫描。

## V20-08 提交结果

## V20-09 完成记录（2026-08-06）

V20-09 已完成第一版后端闭环实现并通过 Codex 验收，能力仍保持默认关闭：

- `AIOutputDraftCandidate` 保存 AI 生成的最小证据候选、目标类型/版本和 Excerpt hash/source-version 快照；候选必须先落在 Draft scope 内，不能由 Provider 直接写正式 Citation。
- `KnowledgeAcceptanceReceipt` 以 `(workspace, accepted_by, idempotency_key)` 唯一约束保存只含 ID 与摘要 hash 的收据；相同 key+相同规范 payload 返回原收据，不同 payload 返回 `KNOWLEDGE_IDEMPOTENCY_CONFLICT`。
- Acceptance 在单一事务内重新授权并按确定顺序锁定 Space、Draft、Candidate、Excerpt 和 typed Target，所有版本/hash/status 检查完成后才创建正式 `KnowledgeCitation`、Receipt 和最小 Audit；任何 stale/冲突均保持正式写入为 0。
- 规范 payload hash 使用 RFC 8785，候选/期望集合按 ID 排序后计算；可选 `If-Match` 与 `expected_draft_version` 同时校验。接受逻辑不导入 Provider，也不自动重试未知外呼状态。
- 新增 `LOGION_KNOWLEDGE_SPACE_AI_ACCEPTANCE_ENABLED`，默认 `false`；即便主知识空间 flag 打开，Acceptance 路由仍 fail-closed，Shared Write、Deletion、Attachment、Local Worker、Provider 和 sync-v1 继续关闭。

本轮新增证据：Acceptance 集成 1 passed（并发同 key、同 key 重放、不同 payload 冲突、stale 全回滚），规范 hash 单测 1 passed；候选清单 7 passed；Ruff check/format、Mypy、`git diff --check`、`alembic check` 与整仓 `pnpm ci:fast` 全部通过。此前隔离 PostgreSQL 已完成 `0036 -> 0037` upgrade 往返验证。V20-09 已通过 Codex 验收，但不能把本轮表述为整个 v0.2.0 完成。

V20-08 提交并推送：`bacc747f2e16a22c1d53e38c05878583b6a1a11f`；V20-09 提交并推送：`e4dc335b922ea15ce976299c000b9bc061588306`（`feat: close AI knowledge acceptance loop`）。V20-10 已完成并推送；生产启用、V20-11 与后续只读终审门禁仍未完成。

## V20-10 后端增量与真实栈验收记录（2026-08-07）

本轮 V20-10 已完成代码与真实栈验收，但不代表整个 v0.2.0 发布完成：

- 已补齐知识空间词法搜索合同与实现：`POST /knowledge/search`，按 Space/当前用户授权，支持 Topic、QuizItem、当前用户 ResearchClaim、Note 四类目标；每类候选行、结果数、字节数、查询时间和 HMAC Cursor 均有界。
- 已修复图 route 对 `cursor` 的丢弃：请求现在会校验签名、范围、过滤器和 BFS keyset 位置，并使用签名快照时间边界读取候选图。当前不发放无法证明安全的图续页 Cursor，`next_cursor` 保持可为空，避免伪造“还有全局数量”的语义。
- OpenAPI/TypeScript 合同已按加法方式生成，未新增 sync-v1、Vault 或 Outbox。用户后续一次性指定
  用户指定的前端执行方完成本次正式前端首版，Windows Codex 已将结果接入同一集成分支。
- 已观察：知识空间契约 27 passed、图内核 42 passed；开启测试专用知识空间 flag、Origin、独立测试 Redis 与 Cursor key 后，核心集成 2 passed，并覆盖跨 Space Topic 与共享 Space 内 ResearchClaim 当前用户隔离。全量 `pnpm test` 通过（381 passed, 62 deselected），前端 lint/typecheck/test/build、Python Ruff/Mypy 亦通过；提交后 `pnpm contracts:check` 与 `pnpm ci:fast` 均通过。
- 另修复了 Cursor Base64URL 非规范编码可绕过篡改负测的问题；解码现在要求规范编码，统一 fail-closed。

设计细节见 [`V020_GRAPH_SEARCH_RENDERING_DESIGN.md`](./V020_GRAPH_SEARCH_RENDERING_DESIGN.md)。当前已补充跨 Space/用户 ResearchClaim 隔离、控制字符/通配符、搜索与图 Cursor 非法位置/过滤器复用负测，并通过全量 Python 与前端门禁；服务端增量已提交并推送，提交为 `bfb4d35`（代码）与 `dfaaf5a`（状态文档）。

前端首版施工由用户指定的外部执行方在独立工作树完成，原始提交由 Windows Codex
接管为 `5d737b7`。正式实现保留 `/app/knowledge-prototype` 受控演示入口，并在 ReviewCenter 中用
真实 Topic/TopicDependency/Mastery 数据驱动只读动态图谱，不把 mock 数据作为生产默认值，也不暴露
原型审批操作。Codex 审查发现真实节点被 `(0,0)` 占位坐标误判为已有布局，已改为可选坐标并增加
位置分散断言；同时把复习安排查找从逐节点扫描改为索引，审查修正提交为 `7a93ac9`。

已观察的前端与真实栈证据：Prettier、ESLint、TypeScript、44 个测试文件/224 个 Vitest 用例、生产构建和
`git diff --check` 通过；Nightly #40 在 GitHub Actions 官方状态恢复后针对固定提交
`64298ec597b6e45dfea9a94cc819c77daf0cda8b` 执行并通过。作业 `92770353461` 的 `pnpm audit`、
`pip-audit`、许可证策略、Compose smoke、migration/empty-environment restore、真实认证
Playwright、1440/390px 横向溢出、axe 无障碍、移动节点列表、桌面图谱键盘导航与持久化主题值
XSS 防护均为实际通过；运行记录：
<https://github.com/greatLiverheat605/Logion/actions/runs/31147645530>。

V20-10 收口后，下一步转入 V20-11 默认关闭准入评审。Shared Write、Deletion、Attachment、Local
Worker、Provider、sync-v1 与 AI Acceptance 的生产开关继续关闭；未取得 V20-11 证据前不得进入
V20-12 或启用任何本地执行/附件生产路径。

## V20-11 默认关闭准入评审记录（2026-08-07）

第一轮只读审查已执行，结论为硬停止，未进入 V20-12：

- `uv run --group dev pytest tests/test_compose_attachment_boundary.py tests/test_backup_bundle.py -q`：7 passed，覆盖附件初始化最小权限、只读消费者、备份挂载与 staging 排除。
- `pnpm --filter @logion/offline test`：7 个文件、55 tests passed；该结果证明 offline library 的加密/校验/同步边界，不等同于 Local Worker 准入。
- 当前设计与配置继续保持 `knowledge_space_attachment_ingest_enabled=false`、`knowledge_space_local_worker_enabled=false` 及其他敏感能力关闭；本轮未启动本机 Docker。
- 未运行且不可记为通过：Attachment migration 与 Malware/Polyglot corpus；准确 Volume 的 BitLocker 或等价静态加密、Recovery/ACL 证明；Lease 绑定、Crash/Reboot/上传中断残留清理；worker offline 时认证知识核心流程。

硬停止原因是上述任一项缺失都违反 V20-07/V20-11 的明确停止条件。协调记录位于
`.agents/coordination/runs/run-v020-v11-review/`，任务 handoff 标记为 `blocked`；在补齐证据并重新验收前，
不得启用 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 生产路径。

## V20-11 默认关闭边界修复记录（2026-08-07）

本轮只修复与验证默认关闭边界，不宣称 V20-11 已通过：

- `Settings` 新增 `knowledge_space_attachment_ingest_enabled` 与
  `knowledge_space_local_worker_enabled`，默认均为 `false`；两者在主知识空间 flag 关闭时拒绝启用。
- 附件初始化、上传、完成和下载路由现在统一先经过附件准入 flag；关闭时返回
  `KNOWLEDGE_ATTACHMENT_INGEST_DISABLED`、`404` 和 `Cache-Control: private, no-store`，不会触发认证、限流或文件访问。
- 附件验证失败后立即 best-effort 删除 staging 对象；若文件系统暂时不可用，数据库仍保持 `failed`，后续残留清扫仍是待完成门禁。
- 实际通过：`uv run --package logion-api pytest apps/api/tests/test_knowledge_space_contract.py apps/api/tests/test_attachments.py -q`
  （40 passed）；Ruff check/format 与 Mypy（4 个源文件）均通过；Compose 附件边界/备份测试 7 passed；offline 包 55 tests passed。
- 已在完整测试环境变量下重跑真实附件集成；注册阶段返回 `503 AUTH_RATE_LIMIT_UNAVAILABLE`，原因是本机 Redis
  服务不可用，附件断言没有执行；该结果不计为通过。迁移集成同样因本机 PostgreSQL 连接被拒绝而未执行断言。
- 本轮修复已由 Codex 提交并推送：`69a7c58`（`fix(api): enforce V20-11 default-closed boundaries`）。

以下硬停止仍未改变：准确 Volume 的 BitLocker/等价加密、Recovery/ACL 证据，Attachment migration 与
Malware/Polyglot corpus，Lease 绑定及 Crash/Reboot/上传中断残留清理，以及 worker offline 时认证知识核心流程。
在这些证据齐备前，不进入 V20-12，也不打开任何生产敏感开关。

## V20-11 环境复核记录（2026-08-07）

本轮环境复核的完整证据见 [`V020_V11_ENVIRONMENT_EVIDENCE.md`](./V020_V11_ENVIRONMENT_EVIDENCE.md)。结论仍为硬停止：

- 本地单元、默认关闭边界和 offline 包检查保持通过；完整测试环境变量已正确注入。
- Redis 不可用导致真实附件协议在注册阶段返回 `AUTH_RATE_LIMIT_UNAVAILABLE`；PostgreSQL 不可用导致迁移集成的 3 个断言连接被拒绝。两者均记录为未执行，不计为通过。
- 本机 `C:` 卷为未加密状态，不能作为生产附件卷加密证明；恢复密钥、准确命名卷 ACL、恶意/Polyglot 语料、Local Worker 租约/残留与 offline 核心流程仍缺证据。
- 继续保持 `knowledge_space_attachment_ingest_enabled=false`、`knowledge_space_local_worker_enabled=false` 及其余敏感生产开关关闭；不启动本机 Docker，不进入 V20-12。

## V20-11 方案 1 本机环境复核与真实集成补证（2026-08-07）

用户已批准方案 1：在非 C 盘建立隔离验收环境，恢复密钥保存到桌面。该环境仅用于验收，不改变生产开关：

- G: 上创建 `LogionV20.vhdx`，挂载为 J:；J: 使用 BitLocker XTS-AES 256，100% 已加密且 Protection On。恢复密钥仅保存于桌面，未进入仓库、Git 历史或协调账本。
- PostgreSQL 与 Redis 均由 G: 安装并使用 J: 数据目录；完整测试环境变量从加密卷读取。未启动 Docker。
- `test_attachment_integration.py`：1 passed；`test_knowledge_space_migration_integration.py`：3 passed；知识空间核心 + AI acceptance 组合：3 passed。此前因服务未启动导致的失败 observation 保留，新的成功 observation 已追加到 `run-v020-v11-remediation`。
- `pnpm audit --prod --audit-level high`、`pip-audit`、`pnpm ci:fast`、Compose/备份边界与 offline 包检查均通过。`J:\Attachments`/`staging`/`verified` ACL 已收紧，当前无 `.part` 残留；ClamAV 对干净 Polyglot/HTML/PNG/文本语料扫描退出码为 0。

本轮仍不能宣称 V20-11 或整个 v0.2.0 发布通过：尚缺经批准的恶意样本检测命中证据，以及 Local Worker 的 lease 绑定、撤销/过期拒绝、Crash/Reboot/上传中断残留清理和 worker-offline 时真实认证核心流程。`knowledge_space_attachment_ingest_enabled`、`knowledge_space_local_worker_enabled`、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭；在上述门禁补齐前不进入 V20-12。

## V20-11 隔离安全内核与在线脱离验证（2026-08-07）

- 新增 `apps/worker/src/logion_worker/local_worker_security.py` 作为未来 Local Worker 的隔离候选内核；它只处理短期租约、scope/input hash 绑定、单调 checkpoint、终态清理和残留清扫，不接 API、数据库、Provider 或生产开关。
- 新增 6 项安全内核测试：`uv run --package logion-worker pytest apps/worker/tests/test_local_worker_security.py -q` 通过；Worker 测试集合 30 passed（4 deselected）。新增模块 Ruff、format、mypy 均通过。整个 Worker 包的严格 mypy 仍受既有 workspace `logion-api` 未提供 `py.typed` 标记影响，未将该既有问题写成新增模块失败。
- ClamAV 临时 loopback daemon 从内存流式扫描标准 EICAR，实际命中 `Eicar-Test-Signature FOUND`；J: 上干净 PDF/HTML、PNG/PDF、纯文本语料均 `OK`。临时配置、日志、PID 和进程已清理，未关闭 Windows Defender，未将样本写入仓库。
- 在 Local Worker 进程不运行时，PostgreSQL/Redis 仍可用，知识空间核心 + AI acceptance 真实集成 3 passed，证明在线核心不依赖本地 Worker。

本轮仍不进入 V20-12：缺少真实远端 Local Worker lease/revoke API、job/Space/输入摘要协议、生产 Crash/Reboot/上传中断恢复和正式扫描器接入/处置演练。新增内核仅作为下一阶段设计候选；`knowledge_space_local_worker_enabled`、Attachment、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## V20-11 隔离内核加固与接入合同（2026-08-07）

- `apps/worker/src/logion_worker/local_worker_security.py` 继续保持隔离候选定位；新增检查点大小上限、允许文件名、未知工件拒绝、符号链接拒绝和 `fsync` 后原子替换。新增回归后，Local Worker 安全内核 8 passed，Worker 包 32 passed、4 deselected；Ruff lint/format 与新增模块 strict mypy 通过。
- 新增 [`V020_V11_LOCAL_WORKER_CONTRACT.md`](./V020_V11_LOCAL_WORKER_CONTRACT.md)，冻结待实现的远端 lease/revoke/checkpoint/result 合同、scope/input hash 绑定、fail-closed 语义、Crash/Reboot/上传中断恢复、扫描器隔离/告警/处置和进入 V20-12 的必要条件。该文档不授权 API、迁移、Provider 或任何生产开关。
- 本轮只完成隔离安全内核加固与设计合同，未宣称 V20-11 通过。真实远端 Local Worker 协议、生产扫描器接入/处置演练和认证恢复流程仍是硬停止；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭，不进入 V20-12。

## V20-11 服务端协议候选内核（2026-08-07）

- 新增 `apps/api/src/logion_api/knowledge_space/local_worker_protocol.py` 作为隔离的服务端协议候选内核：服务端生成短租约、绑定 job/workspace/space/input 摘要，支持幂等撤销、单调 checkpoint、uploaded 结果校验、单次 result receipt 和恢复元数据；没有 FastAPI 路由、数据库、认证依赖、Provider 或生产开关接入。
- 新增 `apps/api/tests/test_knowledge_space_local_worker_protocol.py`，实际通过 scope/过期、撤销、上传前结果拒绝、结果幂等、冲突 key 和非法 key 场景；目标协议与既有知识合同共 `31 passed`。核心知识空间回归 `1 passed, 3 deselected`；新模块 Ruff lint/format 与 strict mypy 通过。
- 本轮仍不能宣称远端 Local Worker API 已完成。需要后续独立设计/迁移/认证授权批准后，才能把候选内核接入真实 lease/revoke/checkpoint/result 路由；Crash/Reboot/上传中断演练、扫描器接入/处置和 worker-offline 认证流程仍为硬停止。所有敏感生产开关继续关闭，不进入 V20-12。

## V20-11 持久化 Local Worker API 候选（2026-08-07）

本轮由 Windows Codex 接管并完成 `task-api` 的独立验收；该结果是候选实现通过，不是生产启用批准：

- 新增 Job、Lease、Checkpoint、Result Receipt 持久化模型与 `0038_local_worker_protocol` 迁移；迁移包含 scope 外键、hash/状态约束、幂等键唯一性和非空降级保护。
- 新增严格请求/响应 Schema 与四组 API：`leases`、`revoke`、`checkpoints`、`result`、`recovery`。路由统一经过默认关闭 Feature Boundary；启用候选时要求 CSRF、可信 Origin、近期重新认证和 Private Space owner/admin 授权。
- 租约 token 只返回一次，数据库只保存 SHA-256 摘要；checkpoint 阶段单调、job/workspace/space/input hash 绑定；result receipt 单次提交，重复请求仅允许同 payload replay，不同 payload 返回稳定冲突；recovery 仅返回受限阶段摘要。
- 实际验收：目标合同/核心/Acceptance/图内核/协议测试 `74 passed, 3 deselected`；真实认证 Local Worker 集成 `3 passed`；迁移集成 `3 passed`；`alembic check` 报告无新升级操作；Ruff lint/format 与知识空间 strict mypy 通过；OpenAPI/TypeScript 合同已重新生成。
- 协调 Run 已追加 `handoff-api`、`obs-api-contract`、`obs-api-migration`、`obs-api-auth`，并记录 `task-api completed` 与 `task-api accepted`。候选实现仍受 `knowledge_space_local_worker_enabled=false` 约束，未启动 Docker、未绕过 SessionBoundary。
- 集成提交 `2ba0554`（`feat(api): add default-closed local worker protocol`）已由 Codex 推送到 `codex/v020-integration`；推送后的 `pnpm ci:fast` 与 `pnpm contracts:check` 均通过。

V20-11 仍保持硬停止：Crash/Reboot/上传中断真实恢复演练、正式扫描器接入/隔离/告警/人工处置及完整 worker-offline 认证证据尚未齐备；在这些门禁完成前不进入 V20-12，也不打开 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 生产开关。

## V20-11 扫描器与恢复收口（2026-08-08）

- 新增 `attachment_scanner.py`：loopback-only clamd `INSTREAM`、固定超时/分块/大小上限、恶意命中和不可用 fail-closed；新增 scanner 配置和 `.env.example` 默认关闭项。
- Attachment finalize 只有在 MIME、大小、声明 SHA-256、扫描 SHA-256 全部一致时才执行；最终原子复制再次校验摘要；恶意命中尝试移动到 J: 加密隔离目录并写入最小审计告警，隔离失败返回固定错误码。
- 本机常驻 ClamAV 1.5.2 已在 G: 安装、J: 病毒库/日志/临时/隔离，Automatic/Running 且仅 `127.0.0.1:3310`；J: BitLocker XTS-AES-256、Protection On，相关 ACL 已收紧。
- 扫描器与附件单元/合同门禁 `45 passed`；真实附件认证集成 `1 passed`；真实 clamd clean + 内存 EICAR 命中 + 隔离/残留清理均已观察。Windows Defender 拦截落盘 EICAR 移动被记录为真实隔离失败并保持 fail-closed。
- 真实 clamd API 路径 `test_attachment_integration.py -k real_loopback` 为 `1 passed, 1 deselected`；J: staging/verified/quarantine 路径均实际经过扫描器，干净 PDF finalize 为 `verified`。
- Local Worker 新增 `recover_after_restart()` 及真实子进程 crash/上传中断演练；安全内核与恢复测试 `11 passed`。无 Worker 进程时知识空间核心 + AI acceptance 真实认证集成 `3 passed, 1 deselected`。

本节完成后进入 V20-11 admission 复核；在整仓门禁、协调 observation、生产开关核对和用户 release 批准完成前，仍不进入 V20-12、不启用 Attachment/Local Worker/Shared Write/Deletion/Provider/sync-v1/AI Acceptance。

## V20-11 最终准入决定与 V20-12 断点（2026-08-08）

Windows Codex 已完成最终 admission 复核，V20-11 以“候选实现和恢复前提通过、生产能力继续默认关闭”的边界通过：

- 扫描器/附件/知识合同 `45 passed`；真实附件、Local Worker API 与迁移集成合计 `9 passed`；Local Worker crash/upload 恢复 `11 passed`；无 Worker 进程时在线核心与 AI acceptance `3 passed, 1 deselected`。
- 发现并修复搜索游标把快照时间截断到整秒的问题；游标 schema 升至 v2 并保留微秒级快照边界，新增回归后目标游标测试 `5 passed`，此前偶发的第二页空结果已不再复现。
- `pnpm ci:fast` 全绿：402 Python tests、118 协调状态测试、224 Web Vitest、lint/typecheck/build/contracts 全部通过；`pnpm audit --prod --audit-level high` 与 `pip-audit` 均无已知漏洞，`alembic check` 无新升级操作。
- 本机证据复核为 J: XTS-AES-256、100% 加密、Protection On、Automatic Unlock Disabled；常驻 clamd Automatic/Running 且仅监听 `127.0.0.1:3310`；相关 ACL 收紧且 `.part` 残留为 0。真实内存 `INSTREAM` 恶意样本命中与干净 API finalize 均已重新观察。
- 默认设置实测：知识空间 API、Shared Write、Deletion、Attachment、Local Worker、AI Acceptance 与附件 scanner 均为 `false`，邮件 Provider 为 `disabled`；未启动 Docker，未绕过 SessionBoundary。

下一断点为 V20-12 负测/安全/集成门。该节点的建立不授权开启 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance，也不代表 v0.2.0 已具备发布条件；V20-12 全部通过后才进入只读终审。

## V20-11 协调账本收口与 V20-12 当前节点（2026-08-08）

- `task-v11-closeout` 已追加 `task.completed` 与 `task.accepted`；五项 Codex observation 已绑定最终 handoff 原始字节摘要：`obs-v11-scanner-contract`、`obs-v11-scanner-live`、`obs-v11-recovery-live`、`obs-v11-offline-auth`、`obs-v11-gates`。
- 恢复证据另由只读 `task-v11-recovery` 复核并接受，绑定 `obs-v11-recovery-rehearsal`；该任务不拥有或修改既有 Local Worker 安全源文件。
- 当前 Run 校验结果：`eventCount=38`、`nodeCount=46`、`handoffCount=8`、`observationCount=24`；`task-v11-closeout=accepted`、`task-v11-recovery=accepted`、`task-v20-12-integration=accepted`；graph/context/tasks/handoff/observation 一致，所有摘要均按原始 UTF-8 字节计算。
- V20-12 四组门禁真实通过：bounded negative `73 passed`；安全与隔离集成（Local Worker `11 passed`，API/迁移/附件/知识核心/Acceptance `12 passed, 1 deselected`）；默认关闭 `45 passed`；整仓 gates `pnpm ci:fast`（Python `402`、Web `224`、协调 `118`）、`pnpm audit` 无漏洞、`pip-audit` 无漏洞、`alembic check` 无新迁移、Compose 边界静态检查通过。此前发现的 `nanoid < 3.3.17` 高危依赖已通过 workspace override 与 lockfile 修复。
- V20-12 收口不授权生产启用：Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 均保持关闭；未启动本机 Docker、未绕过 SessionBoundary。下一步可建立 V20-13 只读终审任务包，终审不得修改、提交或推送。

## V20-13 只读终审与修复收口（2026-08-08）

只读审查方通过固定只读工作树审查了候选提交
`7d50e675be19b2779613ed61ba31dc821afa73dc`（基线
`08babebcd5a09861106c9b05accf32bd8f2ea01c`）。Orca 任务
`task_66a2bdb9ab08`、Dispatch `ctx_ce22e673e7fd` 均返回 succeeded；审查没有 High/Medium
问题，发现的 5 项 Low/Info 均已由 Windows Codex 处置：

- `.env.example` 补齐附件 ingest 与知识游标配置示例，并保持默认关闭；
- deletion flag 在尚未接线时 fail-closed，避免“开启但恒定 404”的误导语义；
- 附件集成测试改用 `LOGION_TEST_ATTACHMENT_TMP_ROOT` 或系统临时目录，不再硬编码盘符；
- 图谱 excerpt preview 使用统一总时间预算，超时安全返回无 preview 并标记 `TIME_LIMIT`；
- 搜索响应显式返回 `truncated` 与 `truncation_reasons`，候选窗口/字节上限不再伪造可恢复的深分页游标。

本轮复核证据：针对性知识空间/图内核/合同测试 `69 passed`；整仓快速门禁在合同生成前的
上下游阶段全部通过（协调 118、Python 402、Web 224、lint/typecheck/build）；`pnpm audit`
无已知漏洞；`pip-audit` 无已知漏洞（工作区包按规范标记为非 PyPI 项）；临时非 C 盘 PostgreSQL
隔离集群完成全量 `upgrade head` 与 `alembic check`，真实 Redis/ClamAV 环境下附件集成
`3 passed`。临时集群已停止并清理，未启动 Docker，未绕过 SessionBoundary。

只读审查工作树曾出现会话元数据残留；协调员已通过 Orca 清理，并再次核对
工作树 clean、HEAD 仍为目标 SHA。V20-13 现已接受，但不代表生产发布批准；Attachment、Local
Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

下一断点为 V20-14：在 staging/隔离恢复环境执行 upgrade/downgrade/upgrade、空环境恢复、
feature-off、孤儿扫描与引用闭包演练；首个正式写入后只允许禁用能力与前向修复，不允许破坏性降级。

## PR #198 integration remediation（2026-08-08）

- GitHub Actions run `31253445278` for commit `6d0cc65068fc395f1fbfcc8a821935b58164809f` failed in the integration job: 60 passed and 7 failed。
- 失败属于集成测试环境不一致，不是生产边界变更：知识空间与 AI acceptance 集成测试未显式启用候选 API flag；附件测试使用 `http://localhost:3000`，而 PR 环境仅允许 `http://test`；PostgreSQL 外键拒绝码实际为 SQLSTATE `23503`。
- 修复范围限定为集成测试夹具、loopback-only INSTREAM 协议测试服务（仍使用生产 `ClamdInstreamScanner` 客户端）、PR 集成允许来源和迁移断言；生产默认值及所有敏感生产开关保持关闭。
- 修复后已观察：目标 Ruff/lint/format 与 `git diff --check` 通过；附件扫描器与知识空间合同单测通过；`pnpm ci:fast` 通过（Python 402、Web 224、协调 118、lint/typecheck/build/contracts）；`pnpm audit --prod --audit-level high` 与 `pip-audit` 无已知漏洞。
- 本机数据库集成重跑已尝试，但隔离凭据无法建立连接，记录为环境限制而非通过；推送后必须等待 GitHub integration 在新提交上重新执行，PR 才能接受。

## PR #198 合并收口（2026-08-08）

- PR `#198` 已按用户授权使用 GitHub `Rebase and merge` 合并，页面状态为 `Merged`。
- 合并提交：`448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；正式集成目录已执行 `git fetch origin main`，`origin/main` 已指向该提交。
- 合并后的依赖复核真实执行：`pnpm audit --prod --audit-level high` 无已知漏洞；`uv run --group dev pip-audit` 无已知漏洞（`logion-api`/`logion-worker` 为工作区包，按工具规范跳过 PyPI 审计）。
- 合并不等于生产发布批准。Docker release smoke、镜像签名/attestation、发布授权仍是后续独立门禁；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。
- 下一断点保持为 V20-14：staging/隔离环境执行 upgrade → downgrade → upgrade、空环境恢复、feature-off、孤儿扫描与引用闭包检查；完成并复核后再进入 V20-15 发布准备。

## V20-15 合并后候选复核（2026-08-08）

- 合并提交 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a` 已触发 GitHub `Main candidate` run
  `31255904782`，结论为 `success`；该 run 的 `head_sha`、分支和主分支均已核对一致。
- 同一提交的 `Mobile builds` run `31255904757` 结论为 `success`。当前正式集成目录的 `pnpm ci:fast`、
  `pnpm audit --prod --audit-level high`、`uv run --group dev pip-audit` 及 34 项默认关闭/备份/Compose
  边界聚焦测试均真实通过，工作树保持 clean。
- Full-capacity profile 仍需 workflow_dispatch，Release candidate 还必须校验同一 source SHA 的
  Main candidate、capacity 与候选证据；本轮不启动 Docker、镜像发布或敏感生产能力，等待发布流程明确授权。

## V20-15 Full-capacity 证据（2026-08-08）

- 已按用户批准手动触发 `Full capacity profile` run `31257249374`，分支 `main`，
  `head_sha=448cbdf8bd43c45aa25e3f2068e2246f3299be3a`，结论为 `success`。
- GitHub job `93102425322` 的专用 PostgreSQL/Redis 容器初始化、迁移、实际容量数据生成和 artifact
  上传步骤均为 `success`；容量 artifact 为
  `capacity-profile-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`（未过期）。
- GitHub Actions 的 artifact 下载接口需要认证，协调员未将无法独立下载的内容伪造为本地复核；本次
  通过依据是该 job 的实际成功结论与工作流内置验证。Release candidate 仍需用户另行批准，不自动发布。

## V20-15 Release candidate 收口（2026-08-08）

- 已按用户批准触发 Release candidate `0.2.0-rc1` run `31259843000`，分支 `main`，
  `head_sha=448cbdf8bd43c45aa25e3f2068e2246f3299be3a`，结论为 `success`；job `93108836660` 全部步骤
  均为成功，Release artifact `release-candidate-0.2.0-rc1-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`
  未过期。
- 实际通过的隔离门禁包括：同 SHA Main/capacity 证据校验、`pnpm ci:fast`、候选 manifest、digest
  镜像加载、Docker smoke、空环境恢复、旧客户端/恢复 epoch 兼容、认证浏览器/WCAG、5/25/100% rollout
  rehearsal、证据归档和 compose 清理。
- 本轮未执行生产发布；独立镜像签名/attestation 核验和生产授权仍是剩余门禁。所有 Attachment、Local
  Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## V20-15 同 SHA provenance 核验收口（2026-08-08）

- Main candidate run `31255904782` 的四个 `actions/attest-build-provenance` 步骤均为 `success`，并且
  `Verify provenance and scan exact candidate` 步骤（job `93099092811`，step 26）为 `success`。
- 该验证针对构建出的 web/api/worker/backup digest 使用 `gh attestation verify --repo`，并完成 exact
  candidate 的 Trivy/文件系统/IaC/镜像安全扫描；source SHA 与 Release candidate 均为
  `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。
- V20-15 候选验收与镜像 provenance 证据现已收口；生产发布、生产环境变更和敏感能力启用仍未执行，
  需用户另行明确批准。

## 生产发布执行断点（2026-08-08）

- 用户已批准开始生产发布执行；但仓库没有自动部署到生产环境的 workflow，正式入口是
  `infra/runbooks/aliyun-production-release.md` 所定义的受控阿里云 ECS 手册流程。
- 当前缺少可执行所需的目标 ECS/SSH 访问、正式域名与 DNS/TLS 状态、阿里云 DirectMail/RAM 配置、
  生产密钥环与异机加密备份位置。未获得这些外部前提前，不执行 SSH、DNS、数据库迁移、域名证书、邮件
  投递或生产流量切换。
- 已通过的候选仍固定为 `0.2.0-rc1` / source SHA `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；生产
  开关继续默认关闭，当前停在“生产目标与凭据准备”而非“已发布”。

## 生产目标只读预检（2026-08-08）

- 已复用首版现有 ECS 配置完成只读预检：Ubuntu 24.04、Docker 29.6.2、Compose 5.3.1、Nginx、jq、
  `/opt/logion`、生产 `.env` 与备份密钥文件均存在；SSH 密钥登录成功，未读取私钥或密钥值。
- 当前线上代码仍为旧提交 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`，迁移头为
  `0034_sync_conflicts`；候选 `448cbdf` 的迁移头更高，尚未进行线上替换或迁移。
- 现有服务全部运行且健康，当前线上 `logion.work/health` 返回 HTTP 200；最新备份文件
  `logion-20260808T054944Z-beta-v1.backup` 校验为 `OK`。
- `.env` 已配置 `aliyun_directmail`、`cn-hangzhou` 和 `LogionDirectMailSender`；ECS IMDSv2 只读角色名
  核对成功，未读取临时凭据正文。公网 DNS 已有 `mail.logion.work` SPF，但 `_dmarc.logion.work`
  当前未解析；DirectMail DKIM/DMARC 需在 DNS/控制台确认后，才能满足生产邮件门禁。
- 本轮仅执行只读检查，未停止服务、未修改 `.env`、未迁移数据库、未切换流量。下一断点是补齐
  DMARC/DKIM 与异机备份确认，再按 runbook 进入 prerelease 维护窗口。
- Windows `F:\LogionBackups` 现有异机副本最晚为 2026-07-30，且该卷当前未显示 BitLocker 保护；它不能
  作为本次候选的最新异机恢复证据。服务器 2026-08-08 备份 checksum 虽为 `OK`，仍需在受保护目标上
  完成复制、校验和空环境恢复。

## 生产发布前置修复（2026-08-09）

- 按已批准的方案 1，本机 `F:` 异机备份目标已完成 BitLocker XTS-AES-256 加密，状态为
  `FullyEncrypted`、`Protection On`、100%；恢复密钥仅保存到 Windows 桌面，不进入仓库、Git 历史或协调记录。
- `J:` 安全卷继续保持 XTS-AES-256、100% 加密和 `Protection On`。本轮尚未把 ECS 最新加密备份复制到
  `F:\LogionBackups`，也未执行空环境恢复，因此异机恢复门禁仍未通过。
- `_dmarc.logion.work` 仍未解析；DirectMail DKIM 仍需在阿里云控制台确认。生产数据库迁移、镜像替换、邮件
  投递和流量切换继续未执行，所有敏感生产开关继续关闭。

## 异机备份链路复核（2026-08-09）

- ECS 现有最新备份 `logion-20260808T054944Z-beta-v1.backup` 及 `.sha256` 已复制到加密的
  `F:\LogionBackups\encrypted`；Windows 重新计算的 SHA-256 与 sidecar 一致：
  `aa7b3f9421504d51601b67e4ccf0b197ba1ef7b6dd33d029f38a9aac2cbea20f`。
- 服务器 Backup 容器 `logion-verify-backup` 返回 `OK`；在 ECS 上使用临时数据库完成隔离恢复，恢复头为
  `0034_sync_conflicts`，`restore_requires_sync_epoch_bump=true`，临时数据库和附件目录已清理。
- 该产物绑定线上旧提交 `5f44833…`，不替代候选 `448cbdf…` 的发布前备份；候选维护窗口仍必须重新备份、
  校验、复制并恢复演练。线上当前仍为旧提交，未迁移、未替换镜像、未切流。

## DNS 与 SSH 入口复核（2026-08-09）

- 阿里云 DNS 已存在 DirectMail DKIM：`aliyun-cn-hangzhou._domainkey.mail.logion.work`；通过公共解析器复核
  记录可见。已新增 `_dmarc.logion.work` TXT，策略为 `v=DMARC1; p=none; adkim=s; aspf=s`，并通过公共解析器复核。
- 受控 SSH 会话的实际来源由服务器 `SSH_CONNECTION` 证明为 `183.159.53.63`；安全组中对应 `/32` 规则保留。
  删除多余 `100.104.0.0/16` 规则时触发阿里云短信二次验证，尚未提交删除，不把它记为完成。
- 生产候选 `0.2.0-rc1` 尚未部署；数据库迁移、镜像替换、真实邮件投递和流量切换继续保持停止状态。

## 候选镜像拉取失败与线上回滚（2026-08-09）

- 生产候选仍固定为 `0.2.0-rc1` / source SHA `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。在 ECS 维护窗口中，Public ECR 基础镜像和 Web 镜像拉取成功；API、Worker、Backup 的 GHCR 平台 manifest/API token 路径持续超时，未使用未验证代理、临时镜像或本地构建物。
- 候选未执行数据库迁移、Compose 候选启动、真实邮件、浏览器验收或流量切换；线上数据库没有被候选迁移触碰。
- 已执行回滚任务 `2714`：失败候选目录隔离为 `/opt/logion.failed-20260808T173400Z`，旧目录 `/opt/logion.before-20260808T170123Z` 恢复为 `/opt/logion`，并重新启动旧 API/Web/Worker/Reverse Proxy/Backup。
- 回滚后只读复核通过：线上提交仍为 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`，迁移头仍为 `0034_sync_conflicts`；API、Web、Worker、Reverse Proxy、Backup、PostgreSQL、Redis 均处于运行/健康状态，`http://127.0.0.1:8080/health` 返回 `{"status":"ok","service":"web","version":"0.1.0"}`。
- 本次发布门禁结论为 `blocked`，不是候选通过。下一次重试前必须先解决 ECS 到 GHCR blob/platform manifest 的网络问题（优先临时提升 ECS 公网带宽，或提供四个 digest 已完整校验的离线镜像包）；四个候选 digest 全部拉取并核验成功前，不执行迁移或切流。
- 线上仍保持旧版本与默认关闭边界；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1、AI Acceptance 等生产开关继续关闭，不启动本机 Docker，不绕过 SessionBoundary。

## 候选镜像重试拉取完成（2026-08-09）

- 按用户要求在隔离候选目录 `/opt/logion.failed-20260808T173400Z` 重新执行完整 Compose pull；任务持续约 21 分钟，未中断，最终退出码为 0。
- 四个候选应用镜像均已成功拉取并与 `/root/logion-upgrade/candidate-manifest.json` 的固定 digest 一致：API `53528d1a…2607a`、Backup `a9b85709…0876`、Web `0639461f…e0b7`、Worker `bef54d48…8878c`。候选目录 source SHA 与 manifest 均为 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。
- 本次只执行镜像拉取和 digest 核验，没有创建候选 Compose 容器，没有执行数据库迁移、候选启动、真实邮件、浏览器验收或流量切换。
- 线上复核仍为旧提交 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`、迁移头 `0034_sync_conflicts`，`/health` 返回 `{"status":"ok","service":"web","version":"0.1.0"}`。
- 下一步仍需单独进入受控 prerelease 维护窗口：重新生成候选维护备份并完成异地校验，随后才允许启动候选依赖、执行 `0038_local_worker_protocol` 迁移、健康检查和真实验收；本次拉取成功不等于生产发布批准。

## 候选受控 prerelease 部署与首轮验收（2026-08-09）

- 候选维护窗口已按用户批准的发布流程执行。候选 source SHA 为
  `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；四个应用镜像仍严格绑定 manifest digest：API
  `53528d1a…2607a`、Backup `a9b85709…0876`、Web `0639461f…e0b7`、Worker `bef54d48…8878c`。
- 迁移实际从 `0034_sync_conflicts` 执行到 `0038_local_worker_protocol`；候选 API ready、Web health、
  PostgreSQL、Redis、Worker、Reverse Proxy 均健康。正式 `/opt/logion` 已晋级为候选目录，旧源码保留在
  `/opt/logion.before-20260809T023701Z`，未删除任何数据卷；随后通过正式 `logion-compose` 强制重建并再次等待健康。
- 候选运行时复核：反向代理端口仍只绑定 `127.0.0.1:8080`；公网 `https://logion.work/health` 返回 HTTP 200；
  HSTS、CSP、X-Frame-Options、Referrer-Policy 和 X-Content-Type-Options 均存在；证书有效期至
  `2026-10-27`，`certbot renew --dry-run` 全部模拟成功。候选服务 OOM 与重启计数均为 0，近 15 分钟严重日志计数均为 0。
- 认证浏览器首轮 smoke 已真实执行：既有受控 Owner 会话在候选重建后仍保持登录，16 个应用路由均渲染 `main`、
  未出现登录表单；连续 3 次刷新保持会话，浏览器控制台错误为空。邀请注册页显示“仅受邀邮箱开放”，未执行实际发送。
- 迁移后的部署后加密备份已生成并通过 `logion-verify-backup`：
  `logion-20260809T023930Z-beta-v1.backup`，SHA-256
  `329f705215ae07fc5b1c5276e5bcbfbb55c83981fba61181eae8b0d5a913bbd9`；已复制至
  `F:\LogionBackups\encrypted`，Windows SHA 与 sidecar 一致。使用同一备份完成 ECS 隔离空环境恢复，恢复头为
  `0038_local_worker_protocol`、`workspace_count=1`、`null_sync_epoch_count=0`，临时数据库与附件目录已清理。
- 预发布观察起点记录为 `2026-08-09T03:22:21Z`。本轮没有开启 Shared Write、Deletion、Attachment、Local Worker、
  Provider、sync-v1 或 AI Acceptance，也没有执行真实邮件投递、移动实体设备验收或生产流量切换。
- 一次使用未审核 `alpine:3.20` 的临时备份导出尝试因镜像不可用而停止，未拉取或引入该镜像；随后改用现有 Backup 容器直接导出并完成校验，生产状态不受影响。
- 协调账本新增的 prerelease handoff/observation 已按实际结果写入；`pnpm agent:state:validate` 复核时仅剩历史
  `graph.json` 与 `tasks.jsonl` 的 encoded-content safe-scan budget 超限（没有新的私有 IP、Schema 或证据哈希错误），
  该本地账本校验问题保留为后续修复项，不影响已完成的 ECS 运行时、备份和恢复证据。

当前结论是 **prerelease 已启动且首轮技术验收通过，生产发布仍未完成**。继续观察至少 24 小时，并在受邀收件人
和实体设备验收完成、备份告警确认后，再请求下一次发布切换批准。

## V20-15 UX 反馈修复（2026-08-09）

- 对受控 prerelease 的真实 Owner 会话复现了四类问题：空空间名称和非法邮箱只出现浏览器原生提示，单字符搜索没有
  就地反馈，错误本地口令只显示笼统失败信息；本轮未发送真实邀请或开启任何敏感能力。
- 前端修复已提交并推送到 `codex/v020-integration`：`84e06d5a76c9f46683e420a9a8ff3953ed31fcb5`。范围仅限工作区/空间/邀请、
  搜索、画像、本地解锁的 loading、禁用、防重复提交、中文错误映射、就地反馈和无障碍关联；未修改 API 合同、权限、迁移、
  生产配置或默认关闭开关。
- 本机实际门禁：Web `230` 测试、Python `402` 测试、Lint、TypeScript、Mypy、生产构建和 `pnpm contracts:check` 均通过。
- 当前修复尚未进入同 SHA release candidate，也尚未部署到 ECS；线上仍运行前一候选 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。因此
  不能把 UX 问题标记为已解决，下一步必须完成主分支集成/候选构建、受控 prerelease 部署和同一组浏览器回归。

## 产品重构 G0 审批与 D0 断点（2026-08-10）

- 产品 Owner 已明确批准 `docs/product/PRODUCT_REDESIGN_EXECUTION_PLAN.md`；D1～D8、产品定位“认知作业空间”、
  目标信息架构、对象边界、设计语言、执行 DAG 和两级原型验收自此作为产品重构基线。
- 当前 Gate 为 **G0 已通过，D0 可启动**。D0 只允许写入 `docs/design/logion-redesign-v1/**` 与
  `prototype/logion-redesign-v1/**`，用于代码感知诊断、21 路由映射、三套方向准备和隔离原型；不得修改
  `apps/web/src/**`、API、Worker、Contracts、Offline、迁移、根 Manifest、锁文件或生产配置。
- G1 方向选择、G2 完整原型、G3 正式前端一级验收和 G4 真实用户测试仍是独立审批门。G2 通过前不开始正式
  Web 施工；本次批准不授权 commit、push、merge、deploy、生产流量切换或任何敏感能力启用。
- 2026-08-10 复核 `.agents/coordination/current-run.json` 指向的历史 Run 时，校验仍因 `graph.json` 与
  `tasks.jsonl` 的 encoded-content safe-scan budget 超限而失败。按长期工作流暂不派发新 Worker、不改写历史
  事件；Git、源码、合同和真实检查继续作为事实源。
- 模型无关的 D0 自包含合同已写入 `docs/design/logion-redesign-v1/D0_TASK_PACKET.md`。它冻结了基线、21 路由、
  唯一允许路径、禁止范围、交付物、验收命令、交接格式和停止条件；旧 A/B 隔离产物只允许作为历史对照。
- 三份产品文档、D0 任务包和本状态断点已在用户明确授权后以提交
  `65c6cb323f544b9b20cf8f995ec5f1aabe3a2521` 首次推送到 `origin/codex/v020-rc6-closeout`。D0 仍未派发；
  派发时必须另行冻结包含后续基线校正的远端可达完整 SHA，并建立可验证协调断点。

## 产品重构 D2 完成与 I0 主线交接准备（2026-08-11）

- 根据产品 Owner 的继续施工指令，方向冻结为 `C Adaptive Desk + B 的 Knowledge/Research 证据三栏 + A 的 Today 极简行动线`。
  该组合只冻结前端信息架构、交互和视觉输入，不改变现有权限、API、迁移、sync-v1 或默认关闭边界。
- D2 隔离交互原型已完成：`prototype/logion-redesign-v1/d2-approved.html`。它覆盖 Today、五种受控工作台、Knowledge Base 五种视图、Research、Collaboration、System Center、21 条旧路由命令映射、桌面/390px、双主题、密度和五类状态。
- D2 原型实际验收：四组主矩阵各 50 个场景，共 200 个；主标题、设备横向溢出和 Today 并列面板等高均通过。15 个桌面子视图和 15 个移动子视图通过；命令面板 21 条路由映射、`/app/review` 搜索、邀请 409、图谱方向键、移动列表和危险确认门均真实操作通过；本地原型控制台 error/warn 为 0。
- D2 原型验收不等于正式 Web/API 验收：axe、真实认证、生产构建、真实数据和正式 Playwright 必须由 I0 施工后重新执行。原型不发送真实邮件、不执行真实删除，所有数据均为合成数据。
- 新增设计输入与施工包：`docs/design/logion-redesign-v1/07_D2_DIRECTION_DECISION.md`、`08_D2_PROTOTYPE_SPEC.md`、`09_DESIGN_SYSTEM.md`、`10_ROUTE_MIGRATION_MAP.md`、`D2_ACCEPTANCE_REPORT.md`、`I0_CONSTRUCTION_TASK_PACKET.md`、`I0_MAINLINE_EXECUTION_PROMPT.md`。尚未 commit/push。
- I0 现在可以由用户手工交给单一主线执行方；施工方只写 `apps/web/src/**` 和必要的 `apps/web/tests/**`，依赖、合同、状态、Git 与生产权限仍按任务包逐项审查。未获得新的 Git 授权前不 commit/push/merge/deploy。

## I0-B Shell 与路由适配验收（2026-08-12）

- I0-A、I0-B 及 I0-B-R1 已完成协调方独立验收。当前工作树仍固定在
  `codex/logion-redesign-i0` / `e2b85987d816baf53a089007e674cd440e9ce64f`，未执行 commit、push 或 merge。
- I0-B 建立五个固定区域、21 条正式 URL 的统一 route manifest、44px Context Bar、Persona 感知的桌面/移动区域入口和 Inspector 插槽；保留 `/app` 与历史 `/app/knowledge-prototype`。
- I0-B-R1 修复了 `/app/search` 重复上下文标题、历史原型错误标题，以及桌面侧栏与移动端 Persona 默认入口不一致的问题。
- 协调方实际观察：Web lint、TypeScript、55 个测试文件/388 个测试、Prettier、生产构建、`guard:context` 和 `git diff --check` 全部通过。
- 真实认证 Playwright、320/390/1024/1440 响应式、axe、视觉比较、主题 XSS、图谱键盘和移动图谱门禁统一留到 I0-E；协调账本验证仍受历史 `graph.json`/`tasks.jsonl` safe-scan budget 限制，未伪造通过。
- I0-C1 可启动：只迁移 Today 与 Knowledge Base 的 Review/Graph 高频只读路径；先接入现有真实 API/Space/SessionBoundary 和有界图谱合同，再处理后续 Records/Research，不改变 API、权限、迁移或 default-off 能力。

## I0-C1 主线接管施工（2026-08-12）

- 外部执行方中断后，主线在 `codex/logion-redesign-i0` / 固定基础
  `e2b85987d816baf53a089007e674cd440e9ce64f` 上由协调方直接接管；本轮未重新派发模型，未执行
  commit、push、merge、deploy。
- 图谱请求已接入真实 `GET /api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge/graph`：客户端只允许
  1/2 跳，路径段编码，切换根节点/范围会取消旧请求并丢弃陈旧响应；响应失败关闭，校验节点/边 150/400 上限、重复
  ID、悬空边、端点类型、UUID、截断元数据和服务端 limits。
- Review 图谱已使用服务端授权数据；API error/locked/empty/loading 状态就地显示，不再把本地 sync-v1 Topic 图谱静默
  伪装成授权成功。根节点与 1/2 跳范围可操作；桌面详情统一进入 AppShell Inspector，移动端使用同一节点集合列表/详情层。
- Today 首屏保留真实 Task/Session/Evidence/Verification/Vault 行为，行动线补齐 WHY/EVIDENCE/NEXT，执行队列最多 3 项并按
  进行中、截止时间、优先级排序；未改变 API、权限、迁移、Worker、sync-v1 或任何 default-off 生产能力。
- 实际验证：Web 57 个测试文件/433 个测试、lint、TypeScript、Prettier、生产构建（36 路由）和 `guard:context` 通过；
  `git diff --check` 通过。协调账本验证仍因历史 `graph.json`/`tasks.jsonl` encoded-content safe-scan budget 超限失败，
  未记为通过。
- 未运行真实认证 Playwright、1440/1024/390/320 浏览器矩阵、axe、主题持久化/XSS、桌面真实图谱键盘和移动真实设备门禁；
  这些仍属于 I0-E，当前 I0-C1 结论为“施工完成，待真实浏览器验收”，不是版本完成。

## I0-D Collaboration / System Center 施工（2026-08-12）

- 外部执行方中断后，主线继续由协调方在 `codex/logion-redesign-i0` 工作区施工；本轮仍未 commit、push、merge 或 deploy。
- 协作空间已拆为两个明确子视图：`/app/collaboration` 继续承载共享审阅与反馈，`/app/workspaces` 承载 Workspace、Space、成员、邀请和角色治理；`/app/spaces` 保留为知识库管理入口，不改变 Space 权限边界。
- `WorkspaceCenter` 已改为左侧 Workspace/Space 上下文、右侧成员与邀请的双栏控制台；移动端堆叠。成员角色更新保留 `expected_version` 与行级 pending。
- 邀请 409 已接入 `DeskConflictResolver`：根据现有服务端稳定原因安全区分“已是成员 / 已有待处理邀请”，未知原因按远端状态变化处理；提供“刷新并比较 / 调整角色 / 关闭”，不自动重发、不泄露服务端原文。
- 新增 `SystemCenterFrame`，以“账户与偏好 / 安全与数据 / 服务与治理”分组列表承载 `/app/profile`、`/app/settings`、`/app/help`、`/app/security`、`/app/sync`、`/app/data`、`/app/audit`、`/app/integrations`、`/app/ai`；右侧继续渲染各页面真实组件，未复制数据逻辑。
- 实际检查：Web 60 个测试文件/441 个测试、lint、TypeScript、Prettier、生产构建（36 路由）和 `git diff --check` 通过。
- 真实认证 Playwright、21 条认证路由、邀请邮件、真实图谱键盘/移动节点、认证 axe、1440/1024/390/320 矩阵、主题 XSS 与 reduced-motion 尚未运行：本机 8080 被无关 `sub2api` 占用，隔离 API/网关已停止；E2E 保护已允许显式回环端口，下一次使用 8180，不能用 mock 或静态构建替代。
- 协调 Run 校验仍受历史 `graph.json` / `tasks.jsonl` safe-scan/目录结构预算阻塞，未伪造通过。I0-D 结论为“施工完成，待真实浏览器验收”，不等于 v0.2.0 发布完成。
- 详细记录：[`I0_D_COLLABORATION_SYSTEM_2026-08-12.md`](./I0_D_COLLABORATION_SYSTEM_2026-08-12.md)。

## I0-E 浏览器验收与 8180 端口断点（2026-08-12）

- 本机 `8080` 继续由无关 `sub2api` 占用且未被触碰；`127.0.0.1:8180` standalone Web 与 `127.0.0.1:8000` 隔离 API 已启动，Web、API、PostgreSQL 与 Redis 健康检查通过。没有启动 Docker，也没有修改生产配置。
- `tests/browser/e2e-environment.ts` 已改为接受有效回环端口；8180 只有在显式设置 `LOGION_E2E_PROVISION_ACCOUNTS=true` 时才允许账号 provisioning，远程地址始终禁止自动建号。
- 已修复暗色三级文字对比度，并把互操作命令和 Persona 桌面/移动导航测试对齐已批准的固定五区架构。静态门禁通过：Web lint、TypeScript、Prettier、60 个测试文件/441 项测试、36 路由生产构建和 `git diff --check`。
- 真实认证专项回归 `9/9`、互操作真实流程 `5/5`、最终 `authenticated-chromium` 完整矩阵 `31/31` 通过。覆盖 21 条认证路由、axe、1440/1250/900/720/420/390/320、横向溢出、reduced-motion、主题持久化/XSS、移动节点列表、桌面图谱键盘、真实 Review 图谱 API、Vault/设备/导入导出及错误边界。
- 真实数据导出首轮因隔离栈没有队列消费者停在 `queued`；仅启动 `PortabilityService.execute_next()` 的临时导出消费者后，加密归档、下载、内容与 SHA-256 校验通过。该临时消费者已停止，没有启用邮件、AI、账号删除或知识空间 Local Worker 队列。
- 8180 公开 Playwright 五项目矩阵再次真实执行：`69 passed, 6 skipped, 0 failed`，覆盖 axe、键盘、320px 溢出、主题持久化、reduced-motion、manifest 与 offline shell。
- Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1 与 AI Acceptance 的生产能力继续关闭；仅本机隔离 API 临时启用知识空间只读主开关。未 commit、push、merge、deploy。
- 协调 Run 校验再次真实执行，仍因历史 `graph.json` / `tasks.jsonl` encoded content 超出 safe scan budget 失败，未伪造通过。详细证据见 [`I0_E_BROWSER_ACCEPTANCE_2026-08-12.md`](./I0_E_BROWSER_ACCEPTANCE_2026-08-12.md)。当前结论为“I0-E 本机技术验收通过，待 Git/集成/发布授权”，不等于 v0.2.0 已发布。

## I0 最终安全与权限边界审查（2026-08-12）

- 最终审查补齐 WorkspaceCenter 与 Review 的陈旧响应竞态防护：列表、详情、Space 和本地解密请求均具有取消或最新请求守卫；切换 Workspace 时立即清理旧 Space、图谱根节点和 Inspector。新增真实 UI 竞态烟雾 1/1 通过。
- 邀请和成员角色更新在请求前严格限制为 `viewer/reviewer/contributor/editor/admin`，合同外角色不发送请求；动态 Workspace、Space 和 Member 路径段统一编码，CSRF 与成员 `expected_version` 保持不变。
- 知识图谱响应增加实际 UTF-8 JSON 1 MiB 上限、`next_cursor` 1024 字符上限和合同外字段拒绝；原有 150 节点、400 边、UUID、重复 ID、悬空边、端点类型及截断元数据验证继续失败关闭。
- 最终静态与仓库门禁通过：Web 62 个测试文件/448 项测试、lint、TypeScript、Prettier、36 路由生产构建、`guard:context`、Ruff、171 个源文件 Mypy strict、Python 402 项、合同 12 项、离线 55 项/93.01% 行覆盖率、`contracts:check`、依赖审计和 `git diff --check` 均通过。
- 修复后的认证专项 18/18 与 Workspace/Review 真实竞态烟雾 1/1 通过；此前完整认证矩阵 31/31 和公开五浏览器 69 通过/6 规范跳过/0 失败仍有效。
- 8180 standalone 曾因本机静态文件复制层级错误出现 chunk 404；修复目录层级并重启后静态资源、登录页和 health 均恢复 200。该问题不是产品回归，8080 上的无关 `sub2api` 始终未触碰。
- 安全扫描未发现硬编码密钥、令牌、真实密码、连接串、新的 SessionBoundary 绕过或生产敏感能力启用。Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1 与 AI Acceptance 继续关闭。
- 当前 I0 技术审查结论为通过，可以进入 Git 审批节点；仍未 commit、push、merge 或 deploy，也不等于 v0.2.0 已发布。`.tmp-v020-rc2/`、`.tmp-v020-rc4/` 与 `.zcode/` 不得进入提交。
- 唯一独立未绿项仍为历史协调 Run：`graph.json` 与 `tasks.jsonl` encoded content 超出 safe scan budget。工具和 fixture 测试通过，但当前 Run 不得记为全绿，也不得改写历史事件。详细记录见 [`I0_FINAL_SECURITY_REVIEW_2026-08-12.md`](./I0_FINAL_SECURITY_REVIEW_2026-08-12.md)。
