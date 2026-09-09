# v0.2.0 当前进度快照

> 更新时间：2026-09-03（Asia/Shanghai）。
> 当前阶段：**GLM Gate 2、发布增量复审、Main candidate、Nightly、Full capacity 与 Release candidate `0.2.0-rc8` 已在同一 RC8 产品源码 SHA 上通过。RC7 仍运行于受控 prerelease；RC8 尚未部署，Production 发布、真实受邀邮件、实体移动设备验收、至少 24 小时 RC8 观察和流量切换仍未完成，敏感生产能力继续关闭**。
> 正式实现状态：**V20-08/V20-09 与 V20-10 服务端、前端首版均已进入 `codex/v020-integration`；知识空间 API、Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 生产开关继续默认关闭**。
> RC8 产品源码固定为 `91a02697e193c712c4e0aac7f9f4024daed93fe3`；Main candidate run
> `33732478569`、Nightly run `33732517630`、Full capacity run `33735531223` 与 Release candidate run
> `33740072308` 均成功并绑定该产品 SHA。
> 本次状态归档的文档提交 SHA 与产品源码 SHA 不得混淆。受控 prerelease 当前仍运行 RC7；该状态不等于
> RC8 已部署或已获得 Production 发布批准。

## GLM Gate 2 收口与 RC8 候选就绪（2026-09-03）

- GLM Gate 2 经 PR [#227](https://github.com/greatLiverheat605/Logion/pull/227) 合入 `main`，合并提交为
  `809054f30c908ee92210d538f3a1178e42bbcce9`。Product Owner 于 `2026-08-29T00:41:13+08:00`
  签字通过；签字文件 Git blob OID 为 `f3faa981f2d164c7692045a73246f9d56846e71a`，规范化文件内容
  SHA-256 为 `45152093ed5fa8c60d4ed03f2de73262b22780d82a040235a75b0223aba676f1`。该文件在
  `809054f..91a0269` 间无变化。
- 候选安全修复 PR [#228](https://github.com/greatLiverheat605/Logion/pull/228) 将四个最终镜像的
  `libcrypto3/libssl3` 约束提升到 `>=3.5.8-r0`，并修复 `fast-uri` 高危依赖；Nightly 阻塞修复 PR
  [#229](https://github.com/greatLiverheat605/Logion/pull/229) 对齐 Audit 零 primary 合同、提高 light
  `--text-3` 对比度并修正 Templates 空租户前置。最终 RC8 产品源码为
  `91a02697e193c712c4e0aac7f9f4024daed93fe3`。
- 对 `809054f..91a0269` 的独立只读增量复审结论为 **PASS，P0=0 / P1=0 / P2=0 / P3=0**；
  `packages/contracts`、API/OpenAPI、权限、sync、migration、数据库及 recent-auth 服务端语义均无变化。
- Main candidate [33732478569](https://github.com/greatLiverheat605/Logion/actions/runs/33732478569) 成功完成
  `ci:fast`、四镜像构建、不可变候选 smoke、provenance、Trivy、CodeQL 与 SBOM。candidate manifest
  SHA-256 为 `931e70667728b8f670907ebfe5f29c402939075cde8bdf43165099c8e0cd8fc8`；migration head 为
  `0040_merge_gate2_heads`，offline schema 为 `4`，同步协议保持 `sync-v1`。
- Nightly [33732517630](https://github.com/greatLiverheat605/Logion/actions/runs/33732517630) 全链成功；浏览器
  结果为 `178 passed / 12 skipped / 1 flaky / 0 failed`。唯一 flaky 是范围外的 public Firefox 密码管理器
  用例首次运行 30 秒超时、retry 通过；Templates 在 session age `416s` 时创建响应仍为 `201`。
- Full capacity [33735531223](https://github.com/greatLiverheat605/Logion/actions/runs/33735531223) 成功；
  `100000` tasks、`1000000` events、`50000` notes/resources、`10000` attachments、`5000` papers 与
  `100000` AI runs 全部命中预期，所有查询通过，最慢 `notes_recent p95=5.291ms`。capacity profile
  SHA-256 为 `15db3da761f17a0ef4d5b1cbbc4605d56a6af952a2289bc27d2b5bce2d0431d8`；
  `production_equivalent_approved=false` 保持不变，不把 GitHub runner 结果视为生产容量批准。
- Release candidate [33740072308](https://github.com/greatLiverheat605/Logion/actions/runs/33740072308) 于
  `2026-09-03T09:52:21Z` 成功，工作流实际检出产品 SHA `91a0269`，完成 `ci:fast`、Full capacity
  evidence 复核、不可变镜像 smoke、空环境恢复、旧客户端/restored-epoch 兼容、Browser/PWA/WCAG
  `179 passed / 12 skipped / 0 failed`、5%/25%/100% rollout rehearsal、证据上传与 Compose 卷清理。
  RC artifact `release-candidate-0.2.0-rc8-91a0269...` 的 GitHub digest 为
  `sha256:e6e62a903447489d85524096d62fc7739c7ab6f744b6d24d035fc1ed63299fbc`。
- 下一门固定为：另行批准后把 RC8 部署到受控 prerelease，先生成并校验生产切换前备份，保留 RC7
  回滚目录、旧镜像和数据卷，再完成真实 Session 冒烟、邀请邮件、实体移动设备与至少 24 小时观察。
  Release workflow 的 rollout 仅为合成 rehearsal，`production_approval_granted=false`；Production、流量切换、
  回滚点清理与敏感能力启用继续需要用户另行明确批准。

## 历史：C7 修复候选与 RC8 前置门（2026-08-21）

- GLM 首轮整体审核返回 `FAIL`，原因是 Today 工作区切换竞态、DELETE body 反向代理真实验收证据缺失，以及 RC8 发布证据未归档；P0=0、P1=3。三项均已进入当前修复范围。
- TodayCenter 已增加 context/Spaces/本地数据请求的取消和最新请求身份守卫，并新增快速 workspace 切换回归；定向测试为 `13 passed`。
- 仓库 Nginx 配置已在一次性 localhost 隔离链路中真实验收两条 DELETE 路径：JSON body、`Origin`、`X-CSRF-Token`、`Idempotency-Key` 均完整到达 mock API。临时容器和网络已删除，生产删除 flag 仍关闭。
- C7 修复提交为 `fa8e119e355c8ab733b034e0b58eb21290326c9a`；PR #220 的 checks run [`32479408725`](https://github.com/greatLiverheat605/Logion/actions/runs/32479408725) 中 `fast`、`integration`、`browser` 均成功。RC8 证据索引见 [`V020_V15_PRERELEASE_RC8_EVIDENCE.md`](./V020_V15_PRERELEASE_RC8_EVIDENCE.md)。旧 Main candidate [`32463164818`](https://github.com/greatLiverheat605/Logion/actions/runs/32463164818) 仅作为修复前参考，不能替代合并后同 SHA candidate。
- 下一顺序固定为：GLM 只读整体复审 → `PASS / P0=0 / P1=0` 后申请合并批准 → 合并后生成 Main candidate/Release 证据 → 再申请 Production 发布批准。当前不 merge、deploy、不切流、不启用 flags。

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

完整 RC6 部署证据见 [`V020_V15_PRERELEASE_RC6_EVIDENCE.md`](./V020_V15_PRERELEASE_RC6_EVIDENCE.md)。

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

| 范围                              | 状态                                                                                             | 已有证据                                                                                                                                                                                                          | 下一门禁                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 多 Agent 协调闭环                 | 已完成基础能力                                                                                   | `AGENTS.md`、协调 Skill/contract、状态 Schema/校验器、可验证 Runs；`codex/v011-coordination` 已推送                                                                                                               | 持续按本 SOP 更新账本和快照                                       |
| V20-00 / M0 架构基础              | 已批准                                                                                           | ADR-0029 Accepted；Orca `task_5f8745a5770e` complete；五项推荐边界已冻结                                                                                                                                          | 执行 V20-01/03/07 设计门，不扩大为实现授权                        |
| 旧 A/B 原型                       | 技术验收通过、产品方向已否决                                                                     | 9 个限定原型文件；23/23 Vitest、lint、typecheck、build 通过；A/B 评审包完整                                                                                                                                       | 仅保留历史证据，不进入施工                                        |
| 整体动态知识空间原型              | 已作为受控演示入口集成                                                                           | 原型代码、既有浏览器 QA、正式施工提交 `5d737b7`；生产视图不默认使用 mock                                                                                                                                          | 保留演示边界；未来迭代 owner 仍由用户另行指定                     |
| V20-06 UI 冻结                    | 第一版方向与首版实现已集成                                                                       | 用户批准第一版方向，并一次性指定前端执行方施工；Codex 审查修正 `7a93ac9`，Nightly #40 真实浏览器门禁已通过                                                                                                        | 进入 V20-11，前端后续 owner 仍由用户指定                          |
| bounded graph kernel              | 纯图内核模块候选验收通过                                                                         | 42 个 pytest、Ruff lint/format、mypy、空白/范围/秘密检查及四组关键运行时复现均由 Codex 独立通过                                                                                                                   | 保持未提交候选；正式接入须等待设计门及授权、scope、游标和资源治理 |
| V20-01/02 schema 与迁移           | V20-02 隔离证明已完成                                                                            | [`V020_MIGRATION_PROOF.md`](./V020_MIGRATION_PROOF.md)；往返/负测/恢复/规模证据已通过；migration commit `91451bd`                                                                                                 | ORM 登记和 `alembic check` 收口留给 V20-08                        |
| V20-03/04 permission/API/OpenAPI  | V20-04 已完成并验收                                                                              | 9 Path/11 Operation/26 Schema 纯加法；133 个聚焦测试、264 个 API 测试、合同生成/检查、sync-v1 固定哈希一致；commit `5437135`                                                                                      | 进入 V20-08 前复核硬失败关闭边界；不得直接启用主 Flag             |
| V20-07 保留/隐私签核              | 设计与推荐矩阵已批准                                                                             | [`V020_RETENTION_THREAT_SIGNOFF.md`](./V020_RETENTION_THREAT_SIGNOFF.md)；用户于 2026-08-05 批准，敏感能力保持关闭                                                                                                | 生产启用前完成独立合规证据与 Owner 门禁                           |
| V20-08 bounded core               | 已完成并推送                                                                                     | Codex 独立验收；核心 ORM、授权、bounded read、图内核与整仓门禁均有证据                                                                                                                                            | 保持默认关闭；进入 V20-09/V20-10 后续门禁                         |
| V20-09 AI acceptance              | 已完成并推送                                                                                     | 候选/收据迁移、RFC 8785 幂等 hash、事务锁定、并发/重放/stale 测试、整仓门禁均有证据                                                                                                                               | 进入 V20-10；Acceptance 生产开关继续关闭                          |
| V20-10 graph/search/rendering     | 已完成并通过 Nightly 真实栈验收                                                                  | Nightly #40：`31147645530`，目标 SHA `64298ec597b6e45dfea9a94cc819c77daf0cda8b`；审计、Compose、迁移/空环境恢复、认证 Playwright、1440/390px、axe、移动节点、桌面图谱键盘导航、持久化主题值 XSS 防护全部通过      | 进入 V20-11 默认关闭准入评审，生产开关继续关闭                    |
| V20-11 默认关闭准入               | 已通过，生产能力继续关闭                                                                         | 常驻 loopback clamd、加密卷/ACL、附件 clean/malware/fail-closed、Local Worker crash/upload 恢复、worker-offline 核心流、迁移、整仓门禁和依赖审计均有真实证据；协调 Run 已完成接受                                 | 保持全部生产开关关闭；进入 V20-12 集成门                          |
| V20-12～15 集成、终审、回滚、发布 | V20-12～V20-14 已通过；V20-15 候选已部署为 prerelease，24 小时技术观察已通过，生产正式发布仍阻塞 | [`V020_V15_ACCEPTANCE_MANIFEST.md`](./V020_V15_ACCEPTANCE_MANIFEST.md)；同 SHA provenance、Docker smoke、恢复、认证浏览器/WCAG 与候选 ECS 迁移/健康证据均已记录；真实邮件投递、实体设备验收与最终流量切换仍未完成 | 完成受邀真实邮件/设备验收和发布授权后再决定是否切换               |
| 只读终审                          | 已完成并由 Codex 接受                                                                            | `task_66a2bdb9ab08` / `ctx_ce22e673e7fd`；审查目标 `7d50e675be19b2779613ed61ba31dc821afa73dc`；详见只读终审报告                                                                                                   | 不再派发；保留只读报告与清洁工作树证据                            |

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
10. RC7 至少 24 小时技术观察已于 2026-08-16 真实收口；PR #212 随后按用户批准 Squash 合入 `main=11014fb736b1f74085a32a7ad1c00054b0b83d6b`，合并后 `candidate/android-debug` 均成功。当前等待真实受邀邮件、实体移动设备和 Production 发布范围的逐项授权；不自动部署。

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
- 当前 I0 技术审查结论为通过。用户已于 2026-08-13 批准创建并推送 I0 分支；主实现提交
  `0aeacb405eb61870a05efa7424ef528763a278e1` 已创建，包含 85 个已复核文件；分支
  `codex/logion-redesign-i0` 已成功推送到 `origin` 并建立跟踪关系。当前仍未 merge 或 deploy，也不等于 v0.2.0 已发布。`.tmp-v020-rc2/`、`.tmp-v020-rc4/` 与 `.zcode/` 未进入提交。
- 唯一独立未绿项仍为历史协调 Run：`graph.json` 与 `tasks.jsonl` encoded content 超出 safe scan budget。工具和 fixture 测试通过，但当前 Run 不得记为全绿，也不得改写历史事件。详细记录见 [`I0_FINAL_SECURITY_REVIEW_2026-08-12.md`](./I0_FINAL_SECURITY_REVIEW_2026-08-12.md)。

## I0 主线同步与最终本机收口（2026-08-13）

- `codex/logion-redesign-i0` 已合并最新 `origin/main`，根 `README.md` 已改为“自适应认知作业空间”定位，并明确仓库清单仍为 `0.1.0`、RC6 仅为受控 prerelease、I0 仍需 PR/远端门禁/合并审批；同时补充五区、21 路由、44px Context Bar、Inspector、移动五区和显式回环 E2E 说明。
- 最新真实认证矩阵发现并修复两项可访问性问题：搜索服务器按钮状态切换中间帧对比度不足，以及 WorkspaceCenter 无角色 `div` 使用 `aria-label`。工作区选择现在是具名语义列表，按钮仍保留原生交互语义，并有回归测试。
- 修复后 21 路由 axe/横向溢出定向门禁 1/1 通过；公开五浏览器与认证项目完整 107 项矩阵最终为 `101 passed, 6 skipped, 0 failed`。覆盖真实认证、主题持久化/XSS、reduced-motion、响应式、移动节点、桌面图谱键盘、Workspace 竞态、Calendar、Private Space 导入、近期认证门和加密导出下载校验。
- 最终 `corepack pnpm ci:fast` 从头到尾返回 0：状态模型 fixture 118、Web 449、Python 402、离线 55、合同 12、移动 4，Ruff/Mypy/格式/Lint/类型/36 路由构建和合同一致性均通过。依赖审计未发现已知漏洞。
- 仅导出消费者已在完整矩阵结束后停止；8180 standalone 已在最终构建门禁前停止；8080 无关服务未触碰。Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1 与 AI Acceptance 的生产开关继续关闭。
- 历史协调 Run 校验再次真实失败于 `graph.json` 与 `tasks.jsonl` encoded content 超出 safe scan budget；没有伪造通过或改写历史。该独立限制不改变代码、合同、依赖和真实浏览器结果。
- 当前节点是“本机收口完成，进入分支推送、PR 与 GitHub `fast/integration/browser/mobile` 门禁”；仍未 merge、deploy 或启用敏感生产能力。
- 分支已推送并创建 [PR #208](https://github.com/greatLiverheat605/Logion/pull/208)，目标分支为 `main`。PR 描述明确列出本机门禁、非目标、安全边界和历史协调 Run 未绿项；当前只等待最终 head 的 `fast/integration/browser/mobile` 远端门禁，不自动合并或部署。
- PR head `31b0b647a74d81bf05b16abc345d00f768aee28c` 的 PR checks run [`31669501110`](https://github.com/greatLiverheat605/Logion/actions/runs/31669501110) 已成功：`fast`、`integration`、`browser` 全绿。由于 `mobile.yml` 受路径过滤未自动触发，已对同一分支手动运行 Mobile builds [`31669799252`](https://github.com/greatLiverheat605/Logion/actions/runs/31669799252)，`android-debug` 成功且 `head_sha` 相同。该证据写入后会形成仅文档的新 head；仍需等待新 head 的远端门禁，不自动合并。

## I0 合并与 RC7 候选验收（2026-08-13）

- 用户批准后，PR [#208](https://github.com/greatLiverheat605/Logion/pull/208) 已按仓库禁止 merge commit 的保护规则 Squash 合入 `main`；直接快进推送曾被保护规则拒绝，未绕过规则。随后两次仅 README 状态修正分别经 PR [#209](https://github.com/greatLiverheat605/Logion/pull/209) 与 [#210](https://github.com/greatLiverheat605/Logion/pull/210) 的 `fast/integration/browser` 门禁后 Squash 合并。
- RC7 产品候选源码固定为 `480adc721600243308fa7b5a32200044efd88f07`。Main candidate [`31672956241`](https://github.com/greatLiverheat605/Logion/actions/runs/31672956241) 成功并生成候选清单、digest-pinned 镜像、provenance 与安全证据；Full capacity [`31673689291`](https://github.com/greatLiverheat605/Logion/actions/runs/31673689291) 成功并生成同 SHA 的容量报告。
- Release candidate `0.2.0-rc7` run [`31673881951`](https://github.com/greatLiverheat605/Logion/actions/runs/31673881951) 成功：可信 Main/Capacity 证据、`pnpm ci:fast`、容量报告、候选 manifest、不可变镜像 smoke、空环境恢复、旧客户端与恢复 epoch 兼容、107 项真实 Browser/PWA/WCAG 矩阵、5%/25%/100% rollout rehearsal、证据捕获及 Compose 卷清理均实际完成。
- RC7 唯一注释是 `docker/login-action@v3` 目标 Node.js 20 的上游弃用 warning；GitHub 已强制其在 Node.js 24 运行，job 结论仍为 success。该 warning 不等于产品门禁失败，后续依赖维护应单独升级 Action。
- 部署前受控 prerelease 仍运行 RC6；该历史状态随后在用户批准后由 RC7 原子切换替换。Production 发布、流量切换和 Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1、AI Acceptance 继续未授权且保持关闭。
- 本节后的文档提交只记录既成事实，不重建或替换 RC7 产品候选，也不得把文档提交 SHA 冒充 `480adc721600243308fa7b5a32200044efd88f07` 的候选证据。历史协调 Run 的 encoded-content safe-scan budget 超限仍单独未绿，未改写为通过。

## RC7 受控 prerelease 部署收口（2026-08-13）

- 用户批准使用已验收 RC7 更新受控 prerelease。ECS `120.26.101.76` 已在受控维护窗口完成原子目录切换；活动目录 `/opt/logion` 的源码精确为 `480adc721600243308fa7b5a32200044efd88f07`，旧目录 `/opt/logion.before-rc7-20260813T130605Z` 保留用于回滚。
- 切换前最终备份 `logion-20260813T130618Z-beta-v1.backup` 已由 Backup 服务生成并通过 `logion-verify-backup` 校验；服务器 SHA-256 与 BitLocker `J:\LogionBackups\encrypted` 异机副本一致，值为 `76bd5d7b441fefb0999b08d460042fb3cd6fe37cb3a20c00ac454de86076022f`。数据库、附件、PostgreSQL、Redis 数据卷未删除或替换。
- Alembic 迁移头核对为 `0038_local_worker_protocol`。API、Worker、Web、Reverse Proxy、Backup、PostgreSQL 与 Redis 均运行；RC7 四个应用镜像精确匹配候选 manifest：API `baa67d44…5acaa`、Backup `898dd722…82528`、Web `489e8e6…670d3`、Worker `786bccd…1175e4`。公网 `https://logion.work/health` 返回 HTTP 200。
- 切换后发现 Backup 密钥文件权限在 staging 中为 `root:root 0600`，导致容器启动检查失败并累计 19 次重启；未读取或更换密钥内容。已恢复为 `root:10001 0640`，Backup 当前稳定运行且新启动退出码为 0，问题已收口。
- 反向代理仍只将 Compose `8080` 绑定到 `127.0.0.1`；公网仅通过 80/443 访问。`LOGION_REGISTRATION_MODE=invite`，Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 和 Production 流量切换继续关闭。
- 本次部署只代表受控 prerelease 更新，不代表 Production 发布授权。旧目录、旧镜像、数据卷、部署前后备份继续保留；至少 24 小时观察、真实受邀邮件、实体移动设备验收和 Production 授权仍是后续门禁。
- 详细 RC7 部署证据见 [`V020_V15_PRERELEASE_RC7_EVIDENCE.md`](./V020_V15_PRERELEASE_RC7_EVIDENCE.md)。

## RC7 PR #212 冲突与依赖门禁修复（2026-08-15）

- PR #212 原分支携带已被 `origin/main` squash 吸收的旧提交历史，GitHub 初始状态为 `mergeable=false / dirty`。已在正式 `v020-integration` 工作区基于 `origin/main=0bc104c1d6458dbdbfc4efccebff3b481f042b84` 变基，并以 `--force-with-lease` 安全更新分支。
- 新 PR head 为 `7b85116cbcab01624662c50838e08865d30a89f1`，仅保留 RC7 收口文档变更；随后 GitHub 重新启动 `fast`、`integration`、`browser` 门禁。
- 新 head 的 `fast` 首次真实执行于 run `31869105696`，在 JavaScript dependency audit 阶段因 `nanoid@3.3.17`（公告要求 `>=3.3.18`）失败；不是代码测试或部署失败。已将 workspace override 与锁文件精确升级到 `nanoid@3.3.18`，未引入其它依赖重排。
- 本地 `corepack pnpm audit --audit-level high` 返回 `No known vulnerabilities found`；随后 `corepack pnpm ci:fast` 返回 0：状态模型 118、Web 449、Python 402、离线 55、合同 12、移动 4，构建与合同生成均通过。
- 依赖修复提交 `f2f5eb942db644f2c6b43059330f3ed1a4300905` 已推送；同一 head 的 GitHub `fast`、`integration`、`browser` 与 `android-debug` 均真实完成并成功。该 PR 仍未合并或部署；历史协调 Run 仍因 `graph.json`/`tasks.jsonl` encoded-content safe-scan budget 超限而无法验证，继续单独保留为未通过项。

## RC7 24 小时观察复核（2026-08-15）

- 观察起点为 `2026-08-13T13:06:05Z`；截至本次复核已超过 24 小时。公网 `https://logion.work/health` 连续 3 次返回 HTTP 200，响应体为 Web 健康状态；HSTS、CSP、X-Frame-Options、X-Content-Type-Options 与 Referrer-Policy 均存在。
- SSH 首轮复核曾因端口不可达而中断；用户开放受控入口后，已于 `2026-08-16T05:23:17Z` 使用既有专用密钥完成只读复核。活动源码仍为 `480adc721600243308fa7b5a32200044efd88f07`，Alembic 为 `0038_local_worker_protocol`；API readiness 的 application/database/redis 均为 `ok`，API、Web、Worker、Reverse Proxy、PostgreSQL、Redis 健康，Backup 正常运行，Attachment init 退出码为 0。
- 所有容器均为 `OOMKilled=false`、`RestartCount=0`；根磁盘使用 40%，可用内存 933 MiB，Swap 2047 MiB 中使用 395 MiB。最新备份 `logion-20260815T133314Z-beta-v1.backup` 距复核约 15.8 小时，`logion-verify-backup` 返回 OK，备份中的源码与迁移头正确；过去 24 小时系统 error/alert 计数为 0。
- Web 的 7 条 Server Reference ID 格式错误经反向代理日志聚合核对，共 565 个请求且无 5xx；畸形请求均以 404 拒绝，属于探测噪声，不构成观察失败。
- 实际边界再次核对：Knowledge API、Shared Write、AI Acceptance、Deletion、Attachment ingest、Local Worker、Attachment scanner 均为 `false`，AI Provider 启用数为 0；注册模式为 invite，legacy registration 为 `false`。邮件 Provider 为 `aliyun_directmail`，不得误写为关闭，真实受邀邮件仍未验收。
- 结论更新为“RC7 至少 24 小时技术观察通过”。PR #212 可以进入用户合并审批；仍不自动合并或部署，不清理 RC6/RC7 回滚点，不启用默认关闭能力。真实受邀邮件、实体移动设备和 Production 授权仍未完成；历史协调 Run 仍因 `graph.json`/`tasks.jsonl` encoded-content safe-scan budget 超限而失败，未改写为通过。

## RC7 PR #212 合并与主线候选复核（2026-08-16）

- 用户明确批准后，PR [#212](https://github.com/greatLiverheat605/Logion/pull/212) 已于 `2026-08-16T14:10:43Z` 使用仓库允许的 Squash merge 合入 `main` 并关闭；最终 PR head 为 `ff2b0bf621a5376b68229caee95ed4aa0ca2e9dc`，合并提交为 `11014fb736b1f74085a32a7ad1c00054b0b83d6b`。
- 最终 PR head 的 `fast`、`integration`、`browser` 与 `android-debug` 均成功。合并后 `main` 又真实触发 Android run [`31951949928`](https://github.com/greatLiverheat605/Logion/actions/runs/31951949928) 和 candidate run [`31951949948`](https://github.com/greatLiverheat605/Logion/actions/runs/31951949948)，两者均绑定 `11014fb...` 并成功。
- 合并后 candidate 已完成 `ci:fast`、依赖许可、Compose 校验、四个候选镜像构建、不可变镜像 smoke、provenance、精确镜像扫描、SARIF/SBOM 与证据上传。该结果只是新 `main` 候选证据，不代表已经部署。
- 受控 prerelease 仍运行已观察通过的 RC7 产品源码 `480adc721600243308fa7b5a32200044efd88f07`；没有执行新镜像部署、Production 流量切换、回滚点清理或敏感能力启用。
- 下一批准点为真实受邀邮件、实体移动设备和 Production 发布范围。历史协调 Run 的 `graph.json`/`tasks.jsonl` safe-scan budget 限制继续独立保留，未改写为通过。

## Workbench v1 产品基线批准（2026-08-17）

- 产品 Owner 已批准将现有 Persona 逐步演进为 Workbench：统一 Today，学习/研究/考试/导师四个固定领域工作台，另提供受控自定义工作台。
- 固定工作台各保留一个系统入口；多个课题、考试和目标由工作台内项目承载。自定义工作台可复制固定模板或从空白创建，有限属性只属于工作台上下文，不覆盖正式对象、权限或同步语义。
- 一个工作台可以设置默认 Knowledge Base，并引用其他已授权 Space；切换工作台不得改变 Workspace Role、Space 权限、正式对象数量或服务端鉴权。
- 旧路线图中“Today 允许四画像明显不同布局”的表述已被替代：Today 始终维持同一“行动—原因—证据—验收”闭环，领域深度布局进入 Workbench。
- 已建立 [`WORKBENCH_V1_PRODUCT_SPEC.md`](../product/WORKBENCH_V1_PRODUCT_SPEC.md) 和 [ADR-0030](../adr/0030-workbench-v1.md) 提案。当前只进入合同与隔离原型阶段，未修改正式 Web/API/迁移/OpenAPI、未启用生产开关、未部署。

## Workbench v1 Q21-Q27 冻结与隔离原型验收（2026-08-17）

- 产品 Owner 已冻结 Q21-Q27：严格 CSP 不放宽；“论证边注”只投影已有、已授权的正式来源，AI Draft 不得伪装为正式结果；通知中心只沉淀待处理失败、不确定状态和冲突；区块与 Inspector 动效限定为 180-280ms，控件不得位移并支持 reduced-motion；空状态只说明状态、原因和一个下一步动作；Sources/Audit/History 使用桌面语义表格与移动等价列表；图谱只用于 Knowledge，移动端必须提供同源节点列表。
- Q23 的目标切换方式为非生产环境逐批接入新 Token，整体完成后再切换生产。产品 Owner 另提出旧线上停止服务，但该生产动作尚未执行，也不由原型审批自动授权；维护方式、回滚条件和恢复检查必须形成独立生产变更并再次审批。
- 隔离原型 [`logion-workbench-v1-prototype.html`](../design/workbench-v1/logion-workbench-v1-prototype.html) 已完成。原型覆盖统一 Today、学习/研究/考试/导师/自定义工作台、Knowledge、Collaboration、System Center、Inspector、Light/Dark、reduced-motion、完整状态矩阵和 1440/1024/390/320 响应式模式；所有数据均为合成数据，不请求 API、不发送邮件、不执行正式删除。
- 浏览器实测通过：自定义文本按不可信输入转义；保存真实经过 `saving -> success receipt`；403/Vault locked 不泄露对象、引用、历史或存在性；移动 Inspector 具备模态语义、背景 inert、焦点环和 Escape 焦点返回；桌面研究图谱方向键、Enter、选中路径和焦点返回可用；跨工作台 Source 只增删引用、不复制或删除正式对象；409 只允许比较并生成合并版本；Light/Dark 刷新持久化、reduced-motion、状态矩阵、移动图谱节点列表和正式删除影响预览均通过。
- 320px 最终逐页矩阵已覆盖五个区域和学习/研究/考试/导师/自定义五类工作台；文档、设备和 `.page-scroll` 均无横向溢出。1440px 研究证据实验台、390px Knowledge 移动列表和 320px Today 已完成视觉复核，未发现控件重叠或漂移；浏览器控制台 `error/warn` 为 0。
- 对抗复审发现的三项 P0 已收口：AI Draft 使用独立对象；权限不足时页面与 Inspector 均失败关闭；对象归属 Space 固定在对象数据上。来源列表使用独立对象 ID，能力关闭具有禁用入口和命令二次守卫。
- 仓库内 `axe-core@4.12.1` 已在真实浏览器执行 1440/390 × Light/Dark 四组 WCAG 2 A/AA 与 2.1 A/AA 审计；修复设备容器误带 `aria-pressed` 和深色三级文字对比度后，四组均为 0 violations。临时审计标签与本地静态服务已移除/停止，最终原型仍为自包含文件。
- 最终静态门禁为 Prettier、内联 JavaScript `node --check` 和 `git diff --check`。本轮只修改文档与隔离原型，未触碰正式 Web/API/数据库/OpenAPI/迁移或生产开关。
- 隔离原型和 I1 覆盖合同现已获产品 Owner 批准；本次授权仅包括脱敏的 Workbench 文档基线提交。正式施工批次仍未授权，继续禁止修改 `apps/web/src/**`、API、数据库、OpenAPI、迁移、生产配置或 Feature Flag，也不 push、merge、deploy 或关闭线上服务。

## Workbench v1 施工任务包与 TencentDB Agent Memory 边界（2026-08-17）

- 用户已批准进入 Workbench v1 施工任务包整理；I1 全站覆盖矩阵已完成，未开始修改 `apps/web/src/**`。
- 固定工作台为学习、研究、考试、导师，Today 统一，自定义工作台仅为受控界面组合，不改变 Workspace Role、Space ACL、SessionBoundary、正式对象归属或生产能力。
- 施工包位于 `docs/coordination/mainline-handoff/08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md`；I1 已覆盖 34 个 `page.tsx`、21 条正式路由和 73 个唯一逐操作状态合同，并通过独立对抗终审。
- 已新增 `docs/development/TENCENTDB_AGENT_MEMORY_HANDOFF.md`。TencentDB Agent Memory 只能作为脱敏辅助记忆层，Git/AGENTS/协调账本仍是权威；Codex 桌面新窗口不会自动获得外部记忆注入。
- 当前运行环境没有提供 `MEMORY_ENDPOINT`，没有执行健康检查；实际部署仍需完成健康、隔离、持久化、负向权限和新窗口恢复演练，状态只能记为“部署待验收”。
- 一次辅助源码测试在依赖获取阶段超时，测试主体未执行；该结果未记为通过，也不能替代实际端点验收。
- 产品 Owner 于 2026-08-18 批准 I1，并授权完成 Workbench 文档脱敏和基线提交；不授权 push、merge、deploy、I2 或正式前端施工。
- 共享写入、删除、附件、Local Worker、Provider、sync-v1 与 AI Acceptance 等敏感生产能力继续关闭。

## Workbench v1 W1 施工收口（2026-08-19）

- W1（M1-M4 与 S1）已完成并通过独立对抗复审，最终 HEAD 为 `22b9e339d1935e81685dda1c043384f914c58d02`。
- Web 68 个文件/525 个测试、认证 Playwright 32/32、lint、typecheck、Prettier、build 与 `git diff --check` 均通过。
- 独立整批复审第二轮 Verdict 为 PASS，无 P0/P1；新 Workbench Inspector 的页面级 Escape/焦点回归保留为 I4 集成门的可接受 P2。
- 根级 `corepack pnpm ci:fast` 在既有 `apps/worker/src/logion_worker/email_delivery.py` 的 `alibabacloud_credentials` 缺少 mypy stub 处失败；未修改该无关 Worker 文件。
- 当前分支尚未 push、merge 或 deploy；TencentDB Agent Memory 仍为“部署待验收”。
- 下一阶段为 I2（研究与考试领域流程），必须先取得新的施工范围、写入白名单和 Product Owner 批准；在批准前不开始 I2 正式代码施工。

## Workbench v1 I2 任务包批准（2026-08-19）

- Product Owner 已批准进入 I2 任务包准备；任务包为 `docs/coordination/mainline-handoff/09_WORKBENCH_V1_I2_CONSTRUCTION_TASK_PACKET.md`。
- I2 冻结研究证据实验台、考试覆盖指挥台和领域集成回归三条线；基线为 `6e448ac01dc78b94f600658f2574a51cce1cca64`，正式代码施工尚未开始。
- I2 仍禁止 API、contracts、数据库、迁移、权限、SessionBoundary、生产配置和敏感 Feature Flag 改动；每轮施工必须独立对抗复审。

## v0.2.1 T-00 本地实现断点（2026-09-05）

- T-00 执行分支为 `dev/T-00-expose-build-sha`，本地基准、`main` 与缓存的 `origin/main` 均为 `37e2e005d5594da31daade87d67a4ea183283b06`。`git fetch origin` 因 GitHub SSH 公钥认证失败而未取得远端更新，因此没有把缓存引用冒充最新远端观察。
- Web `/health` 已改为在请求期读取 `LOGION_VERSION`，缺失时返回 `unknown`；Compose 已向 Web 服务传入该变量；相邻 Vitest 覆盖 40 位 SHA、缺失变量和 `no-store`。未修改 Nginx、API、Worker、Dockerfile、release workflow 或生产 runbook。
- 已观察通过定向 Vitest、Web lint/typecheck、root lint、root build、`pnpm contracts:check`、Compose 配置校验、`git diff --check`、Next standalone 运行时 SHA smoke，以及完整 `pnpm test`：Python `550 passed, 77 deselected`，Web `79 files / 292 tests`，offline `55`，contracts `12`，mobile `4`。
- `pnpm ci:fast` 未记为通过：Prettier 会扫描 17 个既有未跟踪 Markdown 文件并失败；root mypy 仍在既有 Worker 邮件模块的第三方包 typing metadata 处失败。T-00 未修改这些无关文件。
- 2026-09-05 再次观察公网 `https://logion.work/health` 为 HTTP 200、`Cache-Control: no-store`，但版本仍是 `0.1.0`。生产 API readiness version、四个已部署镜像 digest 与候选 manifest 对照均为 `not_run`，原因是当前会话没有获授权的生产连接上下文；因此未判定线上是 RC7、RC8 或其他版本。
- 本地 Run `run-v021-t00-expose-build-sha` 保持未验收并阻塞于生产证据。没有 commit、push、PR、deploy、流量切换或生产能力变更。

## v0.2.1 T-01 本地实现收口（2026-09-05）

- T-01 执行分支为 `dev/T-01-attachment-upload-truthful`，不可变基线为 T-00 本地提交
  `8a3ee2e01ea884858a7363ba19571d0db2c1ae30`。T-00 的本地实现提交已存在，但生产 build identity
  仍未验收；本节不把 T-00 写成生产通过。
- 附件上传调用方现按 `uploadPending()` 的实际返回值区分 `null`、`verified` 与 `failed`；只有
  `verified` 会显示“完成服务器哈希验证”。成功和失败反馈均使用实际处理结果的文件名，失败行保留在
  本地队列中。Web transport 仅在当前上传生命周期内保留最后一个真实 `LogionApiError`，从而显示服务端
  `code` 与 `requestId`；未修改 IndexedDB schema、offline wire、附件删除或生产开关。
- 新增组件回归穿过真实 `OfflineSyncCenter`、`AttachmentQueueRepository` 与
  `ApiAttachmentUploadTransport`：失败用例断言文件名、`KNOWLEDGE_ATTACHMENT_INGEST_DISABLED`、
  请求编号、重试入口及“完成服务器哈希验证”缺席；成功用例断言文件名与 verified 文案；另覆盖队列竞态
  返回 `null`。定向 Web 为 `2 files / 4 tests`，offline resilience 为 `1 file / 9 tests`；完整 Web
  `80 files / 297 tests`、完整 offline `7 files / 55 tests`、根级测试（Python `550 passed, 77 deselected`、
  contracts `12`、mobile `4`）、Web lint/typecheck/build、root build、`pnpm contracts:check`、Prettier、
  Ruff、ESLint、`git diff --check` 与状态模型 `118` 项均已实际通过。
- 浏览器清单 5.4 已在隔离本机栈复测：真实 PostgreSQL/Redis/API/Web 路径的附件 init 返回 HTTP `404` /
  `KNOWLEDGE_ATTACHMENT_INGEST_DISABLED`，页面显示文件名、错误码和动态 request ID，失败行仍可重试，
  且整页不含验证成功文案；随后以浏览器级 API route mock 依次返回 init/content/complete verified，只有此时
  出现带文件名的验证成功文案。后半段仅证明真实浏览器 UI 与 transport 合同，不冒充 ClamAV/scanner 的
  服务端成功验收。临时服务、容器和测试数据已清理。
- 已复核 `packages/offline/src` 的 15 个 `catch (`：`bootstrap.ts:196/218/258`、
  `database.ts:108`、`hashing.ts:65/81`、`protected-repository.ts:39`、`repository.ts:184/244`、
  `resilience.ts:241/399`、`sync-client.ts:78`、`validation.ts:43`、`vault.ts:114`、
  `yjs-notes.ts:291`。其中 14 处重新抛出，只有 `resilience.ts:399` 按设计写入 `failed` 后返回 entry；
  另有不计入这 15 处的 `yjs-notes.ts:73 catch {}`，同样立即抛错。该清单必须原样进入后续 PR 描述。
- `uv sync --all-packages --group dev --frozen` 已通过；`pnpm ci:fast` 仍在与 T-01 无关的既有 Worker
  mypy 问题处失败：`email_delivery.py` 无法取得 `alibabacloud_credentials.client/models` 的类型实现，
  并报告两个 `unused-ignore`。该聚合门没有写成通过，也未越界修改邮件模块。
- 当前只有上述 Web 实现、组件测试和本状态文档差异；没有 commit、push、PR、merge、deploy 或生产能力变更。

## v0.2.1 T-02 DNS 错误分类待审查（2026-09-05）

- 用户确认 T-01 已通过 OPUS5 审查并提交为 `6547cf20e1740387f5d66921563c7f028883a40f`。
  T-02 从该不可变基线创建 `dev/T-02-dns-error-split`，当前代码完成并交回用户审查。
- `resolve_public_addresses` 新增两类异常：解析异常、非法解析结果及空列表属于
  `ProviderDnsUnresolvable`；含任一非公网地址仍属于 `ProviderDnsNotPublic`。原有
  `any(not address.is_global ...)` 公网校验、固定目标 IP、Host/SNI、禁止重定向与 `trust_env=False`
  均保持不变，没有将无 DNS 出网或 SSRF 拦截推断成线上根因。
- discovery 与 generation 两个 adapter 均将解析失败映射为 `AI_PROVIDER_DNS_UNRESOLVABLE` /
  HTTP 503 / retryable；非公网结果仍为 `AI_PROVIDER_DNS_BLOCKED` / HTTP 422 / 不可重试；
  无 hostname 的 URL 为 `AI_PROVIDER_URL_BLOCKED` / HTTP 422 / 不可重试。
- DNS details 只包含 `hostname` 与 `resolved_count`，非公网异常仅携带数量。IP 字面量、带尾点 IP
  或嵌入 IPv4 的 hostname 返回 `null`，不回显任何解析到的地址或原始 resolver 异常。
  新增共享参数化测试覆盖两个 adapter、IPv4/IPv6、混合结果、解析异常/空值、取消及 URL 错误；
  断言 details 序列化后不匹配 IPv4/IPv6 正则，并验证实际 HTTP 错误响应及失败前未创建 HTTP transport。
- Provider 即时反馈显示可辨因文案、错误码和请求编号；旧 `DNS_BLOCKED` 缺失 details 时使用中性提示。
  持久化健康状态没有 DNS details，因此同样使用中性提示，刷新后不会再次断言非公网原因。
- 已实际通过：后端定向 `82` 项、完整 Python `603 passed / 77 deselected`、AI Workbench `14` 项、
  完整 Web `80 files / 303 tests`、API mypy `174` 个文件、Web lint/typecheck、root production build、
  `pnpm contracts:check`（零漂移）。
- 浏览器在生产构建的 `1440px` 和 `375px` 下分别通过解析失败、非公网阻断、旧码无 details 共 `6` 个场景；
  核对即时反馈、请求编号、无成功文案和刷新后的健康文案。认证、Provider 配置和 DNS 响应均为明确的
  browser route mock，不作为真实 Provider 或生产 DNS 证据。临时浏览器服务已停止。
- 配置链路核对：现有 Provider API 响应公开 `base_url` 和 `credential_configured`，不公开密钥；
  `AIProviderService.discover_models` 将存储的 `provider.base_url` 传给 adapter。
  步骤 5 的真实配置只读核对已尝试，但线上 Provider 页面显示“需要登录”，当前无有效浏览器会话，
  实际存储的 `base_url` 核对为 **blocked**，未读取或解密凭据。
- 步骤 4 运维为 **blocked**：线上版本仍未知，没有容器执行上下文，未验证 resolver 配置、出站策略、
  DNS 出网、代理需求或真实 discover-models 200；不能据此认定生产无出网。
- `pnpm ci:fast` 已实际执行：context guard、状态模型 `118` 项、格式、lint、Ruff、TypeScript 均通过；
  root mypy 仍在未改动的 Worker `email_delivery.py:13/16` 处报告
  `alibabacloud_credentials.client/models` 的两个 `import-not-found` 和两个 `unused-ignore`。
  聚合门保持失败，未修改无关邮件模块或豁免该门禁。
- AI 规划文档保持未跟踪且不纳入交付；本次没有 stage、commit、push、PR、merge 或部署。
- 当前本地 Run 为 `run-v021-t02-dns-error-split`，待审查任务 `task-t02-review` 为 pending；
  T-01 Run 保留历史完成与门禁记录。两个 Run 均通过 validator，未提前标记 T-02 accepted。

## T-03 方案 C 实施批准（2026-09-05）

- 用户确认步骤 0 浏览器复核已通过审查，并批准方案 C：修复 F1-F4、引入 Sonner 瞬时反馈、
  保留七个模块的 inline 状态。实施基线为 `018e8a229252b702c33840d8f74bdd1d7d7b250b`，
  独占分支 `dev/T-03-feedback-visibility`。本地提交已获交接授权，不推送、不部署。
- 状态：实施与验证中，尚未验收。生产身份、DNS 出网与真实读屏播报不作为本轮通过项；
  原有默认关闭开关、CSP、认证、同步协议与 AI 安全边界保持不变。

## T-03 方案 C 实施待审查（2026-09-05）

- F1-F4 已修复；七模块通过统一 `feedback` API 调用 Sonner，保留 inline StatusLine。
  错误手动关闭、成功 3 秒；移动长错误码换行、44px 关闭按钮、ARIA live 区域均已验证。
- Sonner 固定 `2.0.8`，采用仓库已有 pnpm patch 模式关闭自动 style 注入，静态导入官方 CSS；
  生产 CSP 未放宽。依赖评估、修复语义、测试与真实/模拟边界见
  [`V021_T03_FEEDBACK_REVIEW.md`](./V021_T03_FEEDBACK_REVIEW.md)。
- 最新 Web 全量 `83 files / 321 tests`、lint、typecheck、production build 均通过。
  七模块矩阵补强成败语义与 inline 一致性断言后 `28` 场景通过；此前复用浏览器资料的运行已作废归档。
  持久 Playwright 三档视口 `12` 项通过，
  覆盖 F1-F4、320×568 无横向滚动和主操作不被遮挡。另补 320×568 深色 Run 失败场景通过。
- T-01 未回归：真实默认关闭附件 404 可见具体错误码和请求编号，且不含验证成功文案；
  verified 成功使用明确标注的 browser route mock，不作为 scanner 验收。
- `pnpm ci:fast` 仍在既有 Worker `email_delivery.py:13/16` 的第三方依赖 typing 处失败，
  与 T-02 状态一致；补齐锁定 Python 环境后仍为相同 4 个错误。未改无关 Worker、未豁免聚合门。
- NVDA/VoiceOver 实际播报按照最新交接留给回归验收，生产身份与 DNS 出网继续 blocked。
  代码已供审查；因聚合门失败，本次未 stage、commit、push、merge、PR 或 deploy。
  AI 规划文档保持未跟踪，浏览器生成结果不纳入候选差异。
- 最后一处 Run 提交中取消禁用已通过全量 Web 和生产构建复验，并补跑 Run 四场景及深色 320px。
  本地 Run `run-v021-t03-feedback-visibility` 已验证，owner review 为 pending；旧 T-02 事件保留。
  本机隔离预览暂留供审查，无推理 Worker，不作为生产环境。

## T-05 ADR 草案与外链部分实施（2026-09-06）

- 当前分支 `dev/T-05-entity-deletion`，基线为
  `29a2ca2fe74a4e546269ec599e90f64ea18845c3`。T-04 工作区改动保留，未混入 T-05 交付。
- ADR-0031 已先行撰写，状态 Proposed。Resource 不存在 `note_id`，Evidence 没有 Note
  正文快照；已请求 owner 确认级联及保留语义，删除实现依任务书 §7 保持 **blocked**。
- 已独立实现 Note HTTP/HTTPS 外链列表，保留纯文本预览，不解释 HTML/Markdown 链接，
  拒绝危险协议、畸形 URL、凭据和反斜杠，具备新窗口安全属性、外链提示和长链接换行。
- 已实际通过：Web 全量 `84 files / 336 tests`、lint、typecheck、production build；
  新增真实栈 Playwright `1 passed`，覆盖 1440/375/320px，桌面和最窄截图已查看。
- 后端 delete、tombstone 修复、ProtectedOfflineRepository delete、三个 UI 删除入口
  均未实施，相关删除/冲突/权限及完整浏览器回归未运行，T-05 状态为 partial。
  详情见 [`V021_T05_ENTITY_DELETION_REVIEW.md`](./V021_T05_ENTITY_DELETION_REVIEW.md)。
- 无 stage、commit、push、merge 或部署；AI 规划文档仍未跟踪。当前等待数据寿命决策，
  不将 Proposed ADR 当作批准，不将 Note 外链测试通过当作删除功能验收。

## T-05 方案 3 实施（2026-09-06，已由 OPUS5 审查）

- Owner 已批准拒绝删除被引用的 Note，OPUS5 将 ADR-0031 定稿为 Accepted；前述
  Proposed/blocked 段落仅保留为历史。本轮继续使用 `dev/T-05-entity-deletion` 和
  `29a2ca2fe74a4e546269ec599e90f64ea18845c3`，无新增模型层阻塞。
- Goal/Task/Note 软删除、事务级联、两类活跃引用拒绝、空 tombstone 权限下发、
  Vault 删除同步与人工冲突处理、三个 UI 删除入口已实施。预检显示引用计数并禁用确认，
  服务端同事务再次检查，拒绝时实体/ledger/audit/序号均不变化。
- 后端删除 32 项、相关同步集成 39 项、API 默认非集成 532 项、Web 347 项、offline
  68 项与覆盖率、contracts 13 项通过；Ruff、Web/offline lint/typecheck、contracts typecheck、
  独立候选 production build 和四个合同生成制品字节级零漂移均通过。
- API + Worker 完整 mypy 本次 181 个文件通过，不沿用旧四错误结论。全仓 `ci:fast`
  未执行，不声明聚合门或全部数据库集成通过。
- 最终真实栈浏览器 Planning/Records/Today 为 9 passed；三个删除、引用阻塞、断网
  预检、预检后新增引用的拒绝可见性、安全外链及原有流程均通过；1440/375/320px、
  最窄深色和 320x568 阻塞截图留在临时目录。修正了删除入口被底部导航遮挡及被动刷新覆盖反馈。
- 详情见 `V021_T05_ENTITY_DELETION_REVIEW.md`。T-04 三文件、既有报告与 AI 文档保留，
  不属 T-05 候选；无 stage、commit、push、merge 或部署。待 OPUS5 审查后由 owner 决定提交。

## T-05 审查修复（2026-09-06，已复审并提交）

- OPUS5 已确认核心实现正确，owner 授权仅修复 Push 可选字段兼容性、更正报告和追加
  ADR 待办。基线与分支不变，仍禁止 stage、commit、push、部署；此前 39 项集成和四文件
  生成一致性只是历史收窄检查，不能作为完整口径或合同干净树门禁通过的证据。
- `impact`/`details` 仅在值为 None 时通过字段级 `exclude_if` 省略；删除计数保留。
  未给 Push/Pull/bootstrap 路由启用 `exclude_none`，保留冲突与下行 tombstone 的显式空值。
  原 memory 测试先复现失败、后原样通过；新增/补强相邻单测及 HTTP 断言。
- 实际执行根级 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过：
  mypy 181 文件；Web 347、offline 68（branch 85.52%）、contracts 13、mobile 4；
  Python 606 passed / 109 deselected。定向序列化 7 passed，memory/Push/删除集成 34 passed。
- 完整 `-m integration apps/api/tests -q -k "sync"` 收集到 105 项；`-k` 也匹配 asyncio
  marker，实际包含 AI routing。复用旧库首轮为 103 passed / 2 failed（AI routing 调用数为 0、
  Audit 固定主键重复）；不删除旧数据，另建干净测试库并成功向前迁移后重跑为
  105 passed / 535 deselected。没有修改 AI routing、Audit 或 memory 测试来消除失败。
- 重跑 `contracts:generate` 后六个契约文件 MD5 全部一致；实际运行干净树脚本仍因
  未提交的有意合同差异退出 1，不声称该门通过，也不通过提交规避本轮禁止 Git 写入的约束。
- ADR-0031 保持 Accepted，追加 operation-id Vault 槽位的安全 GC 待办，本轮不实现。
  本轮没有重跑浏览器、Worker 数据库集成、迁移往返、真机或生产检查，也未执行完整
  `ci:fast`；详细实跑/失败/历史与未运行边界见 T-05 实施报告。无缺少凭据或模型层阻塞。

## T-05 已提交（2026-09-06，OPUS5 复核）

- 提交 `dd664fc feat(sync): refuse deletion of referenced Notes (T-05)`，分支
  `dev/T-05-entity-deletion`，46 文件 +4378/-265，**未 push**。上面各段的
  "禁止 commit""干净树门禁退出 1""未执行 ci:fast" 均为当时事实，现仅作历史保留。
- OPUS5 复核发现 GPT 门禁链 `typecheck && lint && test && build` 漏掉 `format:check`：
  `sync-v1.schema.json` 三处 T-05 新增行超 80 字符。已确认该文件是手写输入而非生成物，
  `prettier --write` 后四个生成制品 MD5 不变，修复以 amend 并入同一提交。
- 首次在提交态、且 T-04 三文件 stash 移出的隔离树上实跑完整 `pnpm ci:fast`，八门全过：
  `guard:context`、`agent:state:check`、`format:check`、`lint`、`typecheck`（mypy 181 文件）、
  `test`（mobile 4、contracts 13、offline 68、Web 347、Python 606 passed / 109 deselected）、
  `build`、`contracts:check`。干净树门禁提交后退出 0，印证其为纯 `git diff --exit-code`。
- 遗留未归属缺陷（非 T-05 引入，已逐一验证为既有）：`test_ai_routing_integration.py`
  调用计数、`test_audit_integration.py` 固定主键在复用库上冲突、`guard:context` 与
  `pnpm test` 重新生成 `packages/offline/coverage` 的次序陷阱（连续两次 ci:fast 必失败）。
- 仍未执行：浏览器回归未在序列化修复后重跑、Worker 数据库集成、迁移往返、真机。
  ADR-0031 的 Vault 槽位 GC 按设计延后。T-04 三文件保留在工作区，不属本提交。

## T-06 状态与文案一致性（2026-09-06，待审查）

- Owner 批准五项直接修复、StudySession 先复现后修复、Mastery 只确认不派生百分比。
  基于 `64b6d4bdc4a7890cfb2a2304acb138ba71580ee3` 创建
  `dev/T-06-status-copy-consistency`，HEAD 不变；没有 stage、commit、push、PR 或部署。
- 判题三态、导出 KB 档与真实 ZIP 文案、可见时条件轮询和安全 next 回跳已实施。
  48 项定向测试通过；完整 `pnpm test` 重跑 Web 392、offline 68、contracts 13、mobile 4、
  Python 606 passed / 109 deselected，lint/typecheck（mypy 181 文件）/build/contracts:check 通过。
- 实际运行 `pnpm ci:fast` 在第三门因既有 `sisyphus/PROGRESS.md` 格式报警退出 1，前两门通过；
  后五门逐项另行实跑，不宣称聚合命令或八门全过。未修改其他所有者文件规避门禁。
- 真实本地候选浏览器 1440/320px 的六个场景通过，已人工查看截图；早期测试定位器错误、
  全量测试首轮失败和后续实跑结果均保留在 T-06 报告，旧浏览器 JSON 不用作证据。
- StudySession 因生产未登录且未指定测试对象保持 blocked，没有认证后的复现或代码修复。
  Mastery 不显示百分比，但当前没有渲染 suggested_reason；范围外的重复答题阶段保留问题另行上报。
  T-04 三文件及原报告哈希不变。详情见 `V021_T06_STATUS_COPY_REVIEW.md`。

## T-06 剩余工作（2026-09-06，部分完成）

- 新基线 `821a9acc77f0a13b85b1b7a05b4b4ccf4fe64e8f`，沿用 T-06 分支。
  所有者批准 Mastery 理由显示、StudySession 先复现后修复，以及两项完成后一次提交和 push。
  上一节基线、授权和测试结果均保留为历史，不作为本轮证据。
- Mastery Inspector 增加非空“建议依据”，两个 level 和百分比逻辑不变。
  定向单测 10/10，通过新增 Chromium 1440/320px 两用例，有值/无值四图已检查。
- 本轮完整 `pnpm ci:fast` 首次实跑退出 0：八门通过，Web 397、Python 606 passed /
  109 deselected；最终收口证据见 `V021_T06_REMAINING_REVIEW.md`。
- 线上已实际提交一次注册确认请求，但受控邮箱未收到邮件。未进入认证后流程，开始/结束
  会话均为 0 次；状态是认证前提 blocked，不是“未能复现”，没有 StudySession 代码修改。
- SSH push 仍失败；现有密钥被拒绝，CLI 凭据无效，官方设备登录未成功，等待所有者恢复授权。
  两项完成条件未满足，没有新 commit、stage、merge 或部署。
  T-04 三文件及既有浏览器 JSON 哈希不变；新 Run 保存新基线，旧 Run 和事件未改写。

## T-06 StudySession 本地复现（2026-09-07，验收中）

- 当前基线为已推送的 `14fd3eb2b81869ddf967cb32b9e9fe8e2d33f2bf`，远端分支已实查一致。
  依照新交接搭建隔离完整本地栈，以合成账号登录 Web，普通在线开始/结束已复现
  “1 分钟 · 未结束”，reload 后仍然存在；旧线上认证阻塞结论保留为历史。
- 实际 Pull 与 Vault 解密数据均为 completed、版本 2、1 分钟、outcome 缺失，entity clean、
  outbox 空。根因是 Today 读取模型把命令参数误当持久字段；现于读取投影按 status 派生
  outcome，未修改显示兜底、服务端或同步合同。修复前两个新增回归失败，修复后 Today 11 项通过。
- 完整验收与清理继续执行，详见 `V021_T06_STUDY_SESSION_REVIEW.md`。T-04 三文件不动，
  本轮未 stage、commit、push 或部署；新 Run 记录当前基线，旧 Run 与事件不改写。

## T-06 StudySession 本地验证完成（2026-09-07，待交接审查）

- 本轮完整 `pnpm ci:fast` 退出 0，八门通过：Web 399、offline 68、contracts 13、mobile 4、
  Python 606 passed / 109 deselected，mypy 181 文件。修复前两项回归为红，最终 Today 11 项通过。
- 真实浏览器在线/离线两种终态共四条路径、重连、reload、同设备冷读取及独立设备 bootstrap
  均通过。仓库 Today 测试 dev 模式因 Select 警告失败，原样在 production build 下重跑
  1 passed；四档布局/axe/人工验收通过。失败记录和未运行边界见本轮专项报告。
- 本轮隔离库的 5 个用户、5 个 Workspace、5 个 Space、6 个 Task、14 条会话已清理，相关
  行数均为 0；独占 Redis 清空，临时凭据删除，保留空库本地测试栈。
- T-04 三文件哈希不变且未暂存，原有状态文档字节前缀不变，其他既有改动保留。
  无 stage、commit、push、merge 或部署。最终 diff 经独立只读复核无新增 actionable findings。

## FABLE 计划归纳补齐（2026-09-07）

- 用户授权“开始补齐”后，新增 [FABLE 计划总表](./FABLE_PLAN_REGISTER.md) 和
  [58 项回归映射](./FABLE_REGRESSION_CHECKLIST.md)。归纳覆盖 T-00–T-07（含 T-01b/T-05a）、
  12 条 ISSUE、M0–M6、O1–O11、N1–N10、视觉 U0–U6/G1/G2、12 份旧文档及不做项。
- 本地规划分支的 `c00d500bef56a1114ff9fbc90208244043130f8f` 包含 FABLE 全部 5 份原文；
  从中恢复当前工作树缺失的验收摘要、UI 优化、功能演进三份正文，另从 `6365e47` 恢复 OPUS5
  规划审查。原文内容只规范 Markdown 排版；现有主线/开发两份计划不改。此前“缺原文”的判断
  只适用于当时当前工作树检索，不再视为原始规划丢失。
- 项目备份还找回 RC8 58 项清单及 12 份旧开发文档；回归映射不复制个人测试账号，保留
  全部原 ID，并标明内链/外链、Goal/Topic、ZIP/JSON、邀请邮件与既有邮件等语义差异。
- Git 历史确认 T-00/01/02/03/05 和 T-06 六项在当前 HEAD 祖先链中；StudySession 第七项
  仍为本地验证完成的未提交候选。`64b6d4bd` 已记录 owner 搁置 T-04/长期延后移动工作，
  原三文件继续保护；原 M3/M5 包含 T-04 的验收门没有因此自动通过。
- 独立补列 T-05a、通用危险操作确认框、O9/O11 未排期、真实读屏、生产 SHA/digest、
  ingest 观察/启用决定、DNS/配置、真实邮件与版本/验收标准决定。T-05/T-06 已覆盖的
  O3、O7 外链、O6 部分内容不重复开发；原有记录与后续遗留事项保留。
- 本轮仅补文档和本地协调记录，未执行 58 项全量回归或生产/真机检查，不据此新增产品
  passed 结论。无 stage、commit、push、merge 或部署；新增文档待审查。
- 文档验证已观察通过：11 份定向 Prettier、58 个本地链接、任务/里程碑/演进编号覆盖、
  58 个清单 ID 与 12 个补充项、旧报告 27/12/9/10 逐项归类、4 份恢复正文与 Git 原文的
  格式化一致性、`git diff --check`、当前 Run validator。T-04 三文件哈希和此前状态文档
  字节前缀不变、暂存区为空；独立只读复核的 3 项补充均已纳入。

## T-06 审查收口与 T-05a 开始（2026-09-07）

- 用户明确“开始”后，先只读复核 StudySession 三份代码：与已验证候选一致、无阻塞
  findings，定向 diff 空白检查通过。原真实栈证据保留，不重新声称跑过相同产品门禁。
- T-05a 按 FABLE 原范围开始：失败附件单条本地移除、明确确认与反馈；工作区/状态检查
  与移除位于同一 Dexie 事务，retry 同步收紧事务边界。仓储 15 项、Web 定向 8 项已通过，
  其余验证进行中，见 [T-05a 报告](./V021_T05A_ATTACHMENT_QUEUE_REVIEW.md)。
- 当前基线、分支及既有未提交改动保留；T-04 三文件仍受保护，不恢复移动施工。
  本轮没有生产开关、同步合同、schema 或 Git 提交/推送变更。

## T-05a 本地附件移除完成验证（2026-09-07，待 Git 交付）

- 实现 failed 附件单行确认移除，事务重查工作区和状态；不影响非空 Vault、实体、Outbox
  或其他附件。跨标签页状态变化会刷新并关闭旧确认，存储失败保留行和错误。
- 最终完整 `pnpm ci:fast` 八门通过：Web 403、offline 74、contracts 13、mobile 4、
  Python 606 passed / 109 deselected。初轮 lint 失败及修正记录见
  [T-05a 报告](./V021_T05A_ATTACHMENT_QUEUE_REVIEW.md)。
- 隔离生产构建的 Chromium 回归 1 passed；真实 Note、Blob、非空 Outbox、断网上传失败、
  取消/Escape、单项移除与 reload 持久化通过。1440/320px 确认框 axe 和焦点通过；截图发现
  toast 遮挡后已局部修正并重跑。不是移动真机、生产 ingest 或 M5 全量验收。
- 累计 6 个合成用户与相关测试数据已清理，91 张业务表总行数归零；独占 Redis 清空，
  3 个失败初始化空库删除，临时认证文件和含合成口令的失败 trace 删除。
- StudySession 技术审查已完成，FABLE 总表的 T-05a/T-06、O4、D-02 与 A-08 状态已同步。
  12 文件与隔离候选字节一致；T-04 三文件哈希不变且不入候选，暂存区为空。全部新候选
  仍未提交、未推送、未部署；下一步是按明确 Git 授权交付，并统一最终版本和发布验收口径。

## FABLE 候选进入 Git 交付（2026-09-07）

- 用户在上一轮提出 Git 交付后回复“继续”，本轮整理已经验证的 StudySession、T-05a 与
  FABLE 文档归纳到当前开发分支。交付范围、源码摘要和版本/验收推荐稿见
  [候选范围与后续验收](./V021_DELIVERY_SCOPE.md)；提交及远端 SHA 以实际 Git 比对为准。
- 不纳入 T-04 三文件、其未入库报告、其他本地材料或运行证据；FABLE 中原指向未入库材料
  的两个链接改为来源说明，避免在其他机器形成失效链接。
- D-02/D-03/D-06 的推荐稿尚待确认，原 58 项及 27 项通过基线保留。特别指出 12.2 属于
  原 27 项，不能在延后移动工作后仍声称“原 27 项全部零回归”；13.1 的未验部分如实保留。
- 生产、main 合并、release、真实读屏/真机和运维验收均不从本次 Git 交付自动获得通过状态。

## FABLE M5 本地回归归纳（2026-09-07）

- 上轮 28 文件已提交并推送，候选为 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`。
  所有者在具体推荐稿后回复“开始”，D-02/D-03/D-06 已生效，本轮按 v0.2.1 修复候选执行 M5。
- [M5 本地回归报告](./V021_M5_LOCAL_REGRESSION.md)与 [58 项清单](./FABLE_REGRESSION_CHECKLIST.md)
  已填写：40 passed、3 failed、6 partial、3 blocked、6 out_of_scope，分母仍为 58。
  原 scope 内 26 项为 24 passed、6.2 failed、12.1 partial，M5 门未通过。
- 独立 Git archive 的 production build 使用完整候选 SHA，无产品源码覆盖；本地 API/Web
  health 归因一致。真实核心数据、四条会话终态、离线同步/冲突、角色变更、预算、导入导出和
  关闭态附件已有实证。Provider 发现为明确 mock，生产与真实邮箱/读屏未验。
- 首轮浏览器 29 passed / 5 failed / 4 did not run；定位 strict-mode 与溢出 helper 问题后分别
  补跑，所有初轮失败保留。重复 Quiz 阶段残留、导出加密文案遗漏、Toast 对比度和画像名称
  差异已登记 R-01–R-04；Mastery/Sync 独立重跑通过，整组不稳定性仍未定根因。
- 本轮 34 项定向单测通过，Lighthouse 13.0.1 八个认证静态页面为 98–100；高分不抵消交互态
  axe 失败。完整 `ci:fast` 仍引用上轮相同产品 SHA 的实跑证据，本轮未重复声明新执行。
- 18 个合成账号及关联数据清理完成，91 张业务表总行数与独占 Redis 键均为 0，认证文件与
  Lighthouse profile 删除，注册额度恢复为 5。空本地测试栈及仓库外脱敏证据保留。
- 两份浏览器测试调整与本轮文档未提交；T-04 三文件哈希不变且未暂存，其他既有改动保留。
  下一步按 M5 报告修复和复验，不启动 M6 生产发布。

## FABLE M5 三项缺陷修复复验（2026-09-07）

- 所有者回复“开始”后完成 R-01–R-03：答题弹窗关闭后卸载并重置，互操作导出明确服务端
  加密与下载可读 ZIP 未加密，浅色成功 Toast 文字调整为 #006b2c。R-04 保护边界保持。
- 基于 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807` 独立候选，三份产品覆盖摘要
  `9117a37769f0b44c4b56406811dac5d7fb3df5577f4a1c83edac0968893ff9aa`，运行版本带覆盖前缀。
  完整 `ci:fast` 八门通过：Web 405、offline 74、contracts 13、mobile 4、Python 606 passed /
  109 deselected、mypy 181。并行测试超时与版本环境污染的两轮失败均保留在修复报告。
- 浏览器三组 20、2、1 passed（含重跑）：成功反馈两主题/两宽度、既有失败反馈、真实 ZIP
  摘要/成员、Review 两主题四断点、保存/Escape/取消重开与离线 false/true 两条真实记录通过。
- 当前 58 项为 43 passed、1 failed、5 partial、3 blocked、6 out_of_scope。原范围内
  26 项当前映射均 passed；其他项继续引用首轮证据，不当作新候选 58 项全量重跑。
  13.3/R-04、13.1 侧栏、真实邮件/读屏及整组测试不稳定性仍保留，M5/M6 未通过。
- 详情见 [M5 修复复验](./V021_M5_FIXES_REVIEW.md)。无新 commit、push、merge 或部署；
  T-04 三文件、未跟踪报告与其他所有者材料保持原样，合成数据与认证在复验后清理。

## FABLE M5 后续收口复验（2026-09-07）

- 所有者回复“按照建议推进”后，继续本地验收与交付准备。R-05 慢保存旧回调误关新草稿、
  R-06 深色附件弹窗对比度、R-07 Mastery 时间回拨入队前拒绝均已复现并修复。
- 相同基线加十份产品覆盖摘要为
  `87a78a593c19677e820a3ec1b64c1d7355f4a0f2d5aacd257367072dd86c1b1d`。
  完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed /
  109 deselected、mypy 181、coordination 118。旧 CI 不替代该最终产品的检查。
- 九份浏览器 spec 加两条固定回拨回归，42 passed；最终调整后的四条 Mastery 测试另跑
  4 passed。包含真实 Push/Pull、目标 payload hash、IDB clean/version/revision 和两主题
  附件弹窗 axe。浏览器测试独立严格 tsc 通过，之前测试自身错误和旧产品失败均保留。
- 58 项仍为 43 passed、1 failed、5 partial、3 blocked、6 out_of_scope。旧解锁/Today/Sync
  失败在最终组合未重现，但不能全部归因为时间回拨；R-04、真实读屏、生产/邮件前置仍缺。
- 本轮 11 个合成账号及数据清理，91 张业务表总行数与独占 Redis 键均为 0；所有候选
  临时认证已不存在，注册额度恢复 5。空本地预览与仓库外证据保留。
- [后续收口报告](./V021_M5_CLOSEOUT.md)已补候选身份、测试版本和发布回滚材料。原 T-04
  三文件仍保护；R-04 仅准备仓库外五行补丁。没有新 commit、push、merge、部署、真实邮件
  或 Provider 请求；M5 未通过，M6 未授权。

## FABLE M5 继续验收（2026-09-07）

- 所有者回复“继续 M5”后，R-04 五行删除在独立基线候选通过完整 CI 与浅/深两主题、
  1440/320 两视口四项可访问名称和键盘回归。产品覆盖摘要为
  `005b067ecb218e747c2956f65e67be41fe4863c08d4dab90fbe74c4b2282ad82`；主树例外未批准，
  三份 T-04 保护文件保持原样。
- 显式执行 API integration：删除冲突 8 passed、导入 12 passed，含错误版本、重放精确码、
  11 个字符/记录边界与拒绝无误写。专用数据库和 Redis 实例清理完成；默认 CI 不替代这些结果。
- Note 离线删除、第二设备更新、delete_update、人工采用服务器版本、B 冷初始化正文与 A
  重载后同步前本地解密内容验证最终 1 passed。认证单测 20 passed / 3 筛选跳过，真实合法
  回跳/导出与 mock recent-auth 三项浏览器复验通过；首轮测试失败保留在后续收口报告。
- 最新清单为 44 passed、1 failed、4 partial、3 blocked、6 out_of_scope；8.4 和 A-06 本地通过。
  A-07 完整过期会话重登录链路仍缺；NVDA 2026.2 已启动但桌面控制因 URL 确认失败停止，
  未完成真实播报。R-04 主树例外、侧栏、生产与真实邮件前置仍保留，M5 未通过。
- 本轮 9 个合成账号及数据清理，91 表总行数与 Redis 键均零，注册额度恢复 5；认证、Windows
  独立浏览器 profile 和 NVDA 日志已删除，便携工具停止并保留。主树仅补三份测试及结果文档，
  无 commit、push、merge、部署或真实外呼；M6 未授权。证据见 [H01–H08](./V021_M5_CLOSEOUT.md)。

## FABLE M5 反馈与认证补齐（2026-09-08）

- 所有者回复“继续完善”后，A-07 真实过期、refresh 仍拒绝、重新登录回跳、重试 202 且
  新增任务 ID 与响应一致，最终 1 passed；窗口由临时 60 秒恢复 600 秒，未伪造认证响应。
- A-03 七模块本地反馈合同补齐，最终 50 项浏览器全部通过。Provider/Run/附件 verified
  仍含 mock，真实外呼/scanner/读屏未验；前三学习模块和附件固定浅色，后三模块双主题。
- 新复现 R-08 浅色错误 Toast 对比度 4.34:1，仅在反馈 CSS 加深错误文字。最新主树十份
  产品覆盖摘要 `b5ddaaf5eaa6fabaec7b47d6ffe905f6bf9a63e08e74df894d562b0fb74e23b8`；
  含 R-04 隔离提案摘要 `5818528d6f825a500382d54d2e1a9a8fd45c92c906510eaffedcabf775a52258`。
- 新隔离候选完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python
  606 passed / 120 deselected、mypy 181、coordination 118。原失败保留，见 [I01–I04](./V021_M5_CLOSEOUT.md)。
- 六账号与关联数据清理，91 表总行数零、Redis 键零、认证不存在、注册额度 5。A-03/A-07
  为补充项，原 58 项仍是 44/1/4/3/6；R-04 主树例外及真实读屏/邮件/生产前置保留。
  T-04 三文件保护继续，无 commit、push、merge、部署或真实外呼；M5 未通过，M6 未授权。

## FABLE M5 安全与本地回滚补齐（2026-09-08）

- 所有者回复“继续 M5 完善”，本轮仅新增 AI 接受测试扩充及结果文档，产品覆盖不变。
  显式 integration 9 passed / 1 deselected，覆盖权限/撤权、知识 scope/迁移约束和 AI 接受；
  四个实际 SQL 写点注入失败均完整回滚，同 key 并发重试只产生一组 citation/receipt/audit。
- 独占本地 API 的认证列表 200 请求、并发 10，P95 161.03 ms，通过既有 500 ms smoke
  门槛；不能替代完整容量、生产网络或核心 API 相对基线的回归比较。
- 空库 head → 0035 → head 与 schema check 通过；备份恢复库 92 表（含版本表）共 229 行
  的行数和内容摘要一致，三组 scope 孤儿为零；有 receipt 时降级命中 V20-09 保护，数据与头不变。
- 14 个合成账号及数据随两独占 tmpfs 容器清理，临时 API 已停，原始备份未落盘。
  J01–J06 及首轮快照脚本失败保留于 [M5 收口报告](./V021_M5_CLOSEOUT.md)。
- A-10/A-11 仍 partial，原 58 项仍 44/1/4/3/6；R-04 主树例外、侧栏、真实读屏/邮件与
  完整 IDOR/容量、生产回滚前置继续保留。无 Git 提交/推送/合并或部署，M5 未通过，M6 未授权。

## FABLE M5 完整验收续推（2026-09-08）

- 所有者要求保证 M5 完整通过。本轮新增内容隔离、账号删除/所有权等 10 项 integration
  通过，完整容量数据集和六组查询门槛通过，最慢 P95 12.30 ms；仍非生产等价容量批准。
- 两独占容器、匿名数据库卷和附件样本均清理。真实 NVDA 再次被原生窗口工具因当前
  浏览器 URL 无法可靠确认而停止；已停 NVDA 并清理一合成账号，91 业务表/Redis 均零。
  证据见 [K01–K03](./V021_M5_CLOSEOUT.md)，未取得实际播报通过。
- 侧栏键盘和清空本地数据 UI 未执行；A-12 更新为后端 partial。R-04 五行例外、生产/
  Provider 目标和请求授权、受控收件箱及邮件授权已询问，尚未收到答案。
- 产品与测试源码未改，原 58 项仍 44/1/4/3/6；M5 未通过，M6 未授权，无 Git 交付或部署。

## FABLE M5 本地 UI、权限与候选固定（2026-09-08）

- L01–L03 补 26 文件、38 个不同权限集成测试及增强 Evidence 重跑；六次跨租户写入
  均 404 且版本不变，独占容器和卷已清理。Provider/scanner 为受控替身，不代表真实外呼。
- R-09 清空恢复竞态已复现修复：数据落库后只通知旧组件，跨页仍为空；八份入口/工具
  代码补现有共享刷新通知。三份 T-04 保护文件保持，R-04 未纳入。
- 最终十四份产品覆盖摘要 `2a06c52e4b93f551668625093bc4b4b08b6dcfd6b01793a856fd1e0959c07095`，
  基线仍 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`。L06 完整 CI 八门通过：Web 411、
  offline 74、contracts 13、mobile 4、Python 606/120 deselected、mypy 181、coordination 118。
- L07 本地 UI/生命周期 5 passed，L08 跨模块 9 passed；A-12 本地通过，13.1 桌面侧栏
  已验、移动开闭焦点保留 partial。原产品失败、429 限流与重启代理 500 均保留。
- L09 两轮分别清理 5/3 合成账号及数据，91 业务表/Redis 均零，注册额度 5，认证不存在。
  证据和候选摘要见 [M5 收口报告](./V021_M5_CLOSEOUT.md)，尚未创建最终发布提交。
- D-15/R-04 单点保护例外与 D-16/邀请 URL 范围仍待所有者决定；真实 Provider、邮件、
  读屏缺具体环境/授权或可用设备条件。原 58 项仍 44/1/4/3/6，M5 未通过；M6 还需同 SHA
  CI/镜像 manifest、生产身份/备份恢复/回滚、真实运行观察及当前批准。无 Git 交付或部署。

## FABLE M5 两项决定落地（2026-09-08）

- 所有者“采取建议”，D-15/D-16 生效：R-04 仅删除画像入口五行 aria-label，完整邀请
  URL/复制延后至 O1，10.2 保留 partial；不再作为待决问题。T-04 其他改动继续保护。
- 主树五行补丁已应用；候选 AppShell 只含基线加该补丁，不含主树其他 T-04 改动。
  最终十五份产品覆盖摘要 `3330b538bcc67b48fca74973ef78176cea6ad0bbd1725ca2d59de8704ca7503e`，
  基线仍 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`，尚未创建最终提交。
- 新候选完整 CI 八门与新增浏览器 spec 严格 tsc 通过；9 项浏览器同次通过，包含
  R-04 四组名称/axe/键盘、桌面侧栏、R-09 恢复及账号生命周期。详见
  [R04-01–R04-03](./V021_M5_CLOSEOUT.md)，旧失败历史保留。
- 两个合成账号及数据清理，91 业务表/Redis 均零，注册额度 5，临时认证不存在，
  Web/API 健康和身份通过。13.3 更新为 passed，原 58 项为 45/0/4/3/6。
- M5 仍待真实 Provider、邮件、读屏与生产环境/容量前置；M6 发布条件保持。没有
  commit、push、merge、部署或敏感能力启用，正式 actor/review task 仍 pending。

## FABLE M5 计划续跑与本地安全补验（2026-09-08）

- 按所有者连续推进指令恢复，Run validator 通过；D-15/D-16 继续有效。总表顶部、M5/
  REL-01 与 FOLLOWUP-M5 的旧当前摘要已同步，历史结果保留，`do-plan` 续跑入口已建立。
- SEC-04 六文件 15 项本地安全集成通过，覆盖 Growth、Identity、TOTP、软件 Passkey、
  注册验证和密码恢复。首轮 13 passed / 2 failed 保留；Passkey 缺 CI 来源配置已补齐。
- SEC-03 过期用例诊断抓到单调时钟前进 11.59 ms、墙钟回拨 7.839217 秒。本轮只固定
  密码恢复过期测试的服务时刻，最终六项恢复测试通过；认证/生产时间代码未改，主机时钟
  同步风险另列。四轮各两独占容器及数据卷均清理，真实邮件和 Provider 未请求。
- 产品摘要仍为 `3330b538bcc67b48fca74973ef78176cea6ad0bbd1725ca2d59de8704ca7503e`；
  补充测试独立归因，不覆盖原 R04 候选，未重跑完整 CI 或原浏览器组合。
- 58 项仍 45/0/4/3/6，M5 未通过、M6 未授权。真实 Provider/邮件环境和授权、可用读屏
  操作设备及生产只读上下文仍缺；未作 Git 交付或部署。详情见 [M5 收口报告](./V021_M5_CLOSEOUT.md)。

## FABLE M5 真实 Provider 与邮件环境核验（2026-09-08）

- 所有者已提供 Provider 凭据、授权查看阿里云并指定受控收件箱。三次外呼额度已用完，
  其中生成一次；最多五封邮件的授权保留，当前发送零封。秘密及真实邮箱未进入仓库/Run。
- 真实发现暴露 R-10：两 adapter 的 bytes SNI 在 AnyIO TLS 编码时异常。仅改两处字符串
  类型及对应断言，新增真实本地 TLS 正常握手/错误证书拒绝回归；旧实现四项复现失败，
  修复后 Provider/generation/DNS/TLS 86 项及 Ruff 通过。
- 新候选真实发现与生成均 200，27 项检查通过，输入 177 / 输出 332 tokens，应用保守
  价格记账 1 分；幂等、权限、预算、pending Draft 和脱敏通过。不是账单对账；真实上游
  失败未请求，2.4 保持 partial。三轮独占数据库/Redis 及卷均清理。
- 当前 17 份产品摘要 `9274e567144c8d5cdf6651cf39e1ddf525d2a88bccc7353f44d82a06c9f4f3f3`，
  37 份源码/测试摘要 `8ec16533d34d2e41bbe80bb4746c68f4be12c1f91bee3f88cff7da6c7ab81a36`。
  完整 CI 首轮 Web 两项等待超时保留，独立 19 项及原样完整复跑八门通过，根因未确定；
  最终 Web 411、Python 610/120 deselected，其余门见 [PRV-01–PRV-04](./V021_M5_CLOSEOUT.md)。
- 新候选预览 Web/API 健康且身份一致，91 业务表行数/Redis 键零，登录页已刷新目视检查。
  AppShell 仍只含基线加获批五行删除，主树其他 T-04 改动保留，旧证据未覆盖。
- 发信域/地址正常，现有发信角色已绑定且 API/Worker 配置存在；角色策略未核实。
  线上 API/Worker/backup 为旧 SHA，Web 公开版本为 0.1.0；实收 CSP/HSTS 与 NTP 同步
  只属于旧部署。邮件需同候选隔离环境，实际读屏工具条件仍缺；未修改云端配置。
- 58 项仍 45/0/4/3/6，M5 未通过、M6 未授权；没有 commit、push、merge、部署或敏感
  启用。正式 actor/review task 保持 pending，不补造旧角色证明或验收事件。

## FABLE M5 本机真实邮件批次（2026-09-08）

- 所有者已批准短期发信凭据加密转交本机并仅内存使用。离线演练 58 项通过后，从现有
  角色读取短期凭据并只输出加密信封；本机当前候选 API、加密 Outbox 和 Worker 真实发送
  首封注册验证成功。无需升级生产 ECS，产品和候选源码未改。
- 云端投递详情显示成功，接收服务器返回 250；对应 token 在独占测试库设置过期后，
  API 400、错误码和账号/token 状态正确。本批 13 项断言通过，不等同于五封整批通过。
- QQ 邮箱未登录，实收内容、发件人和链接尚未核实；累计已用一封、剩余四封，不重发
  首封或重置额度。凭据进程、API、独占数据库/Redis 及卷已清理，正常预览保留。
- 详见 [MAIL-01–MAIL-02](./V021_M5_CLOSEOUT.md) 和执行子计划。原 58 项仍 45/0/4/3/6，
  M5 未通过，M6 未授权；真实上游失败、读屏与生产前置仍缺。没有 Git 交付或部署。

## FABLE M5 首封邮件反馈（2026-09-08）

- 用户点击首封后报告邮箱包装跳转地址不存在；其回传链接解码后的 Origin、路径和
  token 摘要与首封完全一致，确认用户已收到该封。本机邮箱 UI、发件人、到达时间仍未观察。
- 原临时入口在点击前已清理，页面验证未完成；这是验收编排时序问题，API 过期拒绝
  不替代页面通过。下一批先确认本机收件箱可读，并保持环境到逐封收件与页面核验结束。
- 剩余四封执行器已硬限额度、先实收再完成、禁止重复计收并修正中途 passed 语义；
  离线 53 项通过且资源清理，真实累计仍一封。详见 [MAIL-03](./V021_M5_CLOSEOUT.md)。
- 产品及固定候选不变，M5 未通过、M6 未授权；无新增外呼、发信或部署。

## FABLE M5 实收与 R-11 修复（2026-09-08）

- 本机邮箱已登录，五封邮件的来源、时间和正文已实际核实，累计额度 5/5。续验四封
  56 项检查通过，注册/恢复有效、显式过期、重放、登录和会话撤销通过，安全通知实收。
- 服务存活时仍复现 QQ 包装跳转 404；直接原链接另暴露 R-11，Worker 裸 fragment
  与前端 named token 不兼容。共享解析器最小修复，旧实现三项复现失败，修后 12 项通过；
  实收注册/恢复原链接显示表单并清除 token，未声称浏览器最终提交成功。
- 新候选 18 产品摘要 `c92d51c279db6c8434f399f628b2c0f41cb1ab567c0d0fe06ca04d9a7706fd6a`，
  39 源码测试摘要 `ecdce872f700cb7b22da18ecaffcb6ac0d51ceb278808e2831bf4777fd13bb59`。
  完整 CI 首轮两项既有 Provider UI 等待失败，独立 19 项通过；原样复跑八门通过，
  Web 416、Python 610 passed / 120 deselected。预览 Web/API/Worker 已统一新候选且健康。
- 独占邮件容器/卷、API 与短期凭据进程已清理，正常预览保留；11.1/11.4 passed，
  11.2 partial，58 项为 47/0/5/0/6。详见 [MAIL-04 与 R11-01–02](./V021_M5_CLOSEOUT.md)。
  M5 未通过、M6 未授权；Provider 额度已尽，真实读屏和生产前置保留，无 Git 交付部署。

## FABLE M5 本地表单与权限补充（2026-09-08）

- R-11 产品候选不变，新增邮件表单九项回归，与 token 八项共十七项通过；整包 Web
  四百二十五项、typecheck 通过。真实 fragment hook 与认证适配层保留，仅 mock 传输，
  不计为 QQ 按钮或浏览器最终提交通过。初轮新测试等待时序错误及旧 Provider 超时保留。
- Provider 两项集成补九次创建、修改、删除和发现拒绝请求，角色与对象归属拒绝、
  凭据/版本/删除状态不变及假 adapter 零调用均通过；独占数据库和 Redis 及卷清理。
  OpenAPI 清点一百五十三 path、一百八十六 operation，不将模块通过当作完整 IDOR。
- Computer Use 因无法可靠识别浏览器 URL 自动停止，没有启动 NVDA 或操作桌面。
  真实读屏仍未验；本批没有新增 Provider 请求或邮件，原额度均耗尽。
- 清单 2.3/A-11 过时归因已纠正，计数仍 47/0/5/0/6。两份测试单独归因，常驻
  R-11 预览保留；M5 未通过，M6 未授权。详见 [LOC-01–03](./V021_M5_CLOSEOUT.md)。

## FABLE M5 读屏豁免与最终收口（2026-09-08）

- 所有者要求免除真实读屏并完善其余验收，D-17 生效；实际播报记为明确豁免，不计 passed。
  自动化无障碍、键盘焦点、本地候选 CSP 继续验证，D-03/D-06/D-15/D-16 范围保持。
- R-12 为 HTML 邮件增加可复制的完整原链接，保留 fragment、转义、有效期与一次性语义。
  旧模板新增两项回归失败，修复后 Worker 十五项通过；不声称修复了 QQ 外部包装跳转。
- 新候选十九产品摘要 `b9511a8e874867a1e71bb6494818fa91c1683a97c3ed1d227243fb13220a2987`，
  四十四源码测试摘要 `38a1c31aec0c0869e8cfa4a2a77e2c1c9f43ea2c2605307b3adc858c72043892`，
  完整 CI 一次通过，Web 425、Python 612；Provider/Model 三项集成及新增九次拒绝通过。
  邮件四十八项与 Provider 十三项本地浏览器演练通过，成功/失败及截图已检查，临时环境清理。
  五十七文件、一百一十七链接、摘要/保护/秘密/Run 最终复核通过；详见 FIN-01–07。
- Provider 三次与邮件五封额度均已用完，新批次先完成准备与本地演练；没有新增外呼发信。
  M5 还需 2.3/2.4/11.2 真实闭环，追加两次发现与三封邮件问题待答。M6 未授权；没有
  Git 交付、生产部署或敏感开关变更。完整 API 普查与生产容量依原后续/发布范围单列。

## FABLE M5 追加真实批次获批（2026-09-08）

- 所有者批准继续追加，并确认原 Provider 凭据可复用；最多两次发现，零生成零重试，
  原受控收件箱最多三封注册、恢复和安全通知。旧额度计数保留，累计上限五次请求、八封邮件。
- 沿用 R-12 固定候选，D-17 真实读屏豁免有效；先完成真实页面闭环，再做最终结论。
  未增加 Git、部署、长期凭据或权限变更授权；秘密和真实连接信息仍不入仓库或 Run。

## FABLE M5 追加实收与页面接管（2026-09-08）

- R-12 候选不变，Run validator 通过。Provider 已在真实页面点击发现，原生确认框
  遇浏览器控制超时，服务端新增外呼零；已请求所有者解除弹窗后续验。
- 现有云助手 IMDSv2 短期凭据加密转交退出零，本机解密与有效性通过；Workbench
  所需新增白名单已选择暂不开通，没有修改云端权限、安全组或生产配置。
- 首封追加注册邮件投递成功并实收，批准发件人、到达时间与完整备用链接核实，
  十三项检查通过。原链接显示确认表单并清除 fragment，密码提交与登录待所有者
  接管，独占环境保持至闭环。累计六封，后两封尚未发送；整批未 finish。
- 原五十八项仍 47/0/5/0/6，D-17 豁免有效，M5 待页面闭环、M6 未授权；没有
  Git 交付部署。证据见 [LIVE-01–03](./V021_M5_CLOSEOUT.md)，旧失败和额度保留。

## FABLE M5 导航反馈修复（2026-09-08）

- 所有者报告 Provider 入口与 Tab 无反馈；真实浏览器复现个人、帮助只改变高亮，
  自学两个空状态相同。R-13/R-14 已修复，并在设置补直达 Provider 的既有画像规则入口。
- 当前固定二十三产品摘要 `84e7adfa5f2c0b33ae1bf9b34d31082d381e53c2fca4558f197511cbe35b11fc`，
  五十三源码测试摘要 `062f080c5d4ea894cac0c95a934545fc133a58f77fff260d0b1230b3e74d5c60`。
  R-14 完整 CI 一次通过，Web 430、Python 612/120 deselected；十二项定向回归及真实
  入口/分组往返/FAQ/新建路线打开取消通过。R-13 两次旧 UI 等待失败及 AI 十九项独立
  通过保留，未宣称已确定超时根因。常驻预览三服务已统一 R-14 且健康。
- 真实注册已完成并登录；恢复邮件已实收并打开原链接表单，待所有者操作密码。
  本批两封发送和实收、累计七封；最后安全通知待恢复成功。Provider 合成认证已按
  不同浏览器主机名隔离，原生确认框工具仍超时，新增请求零，已请求所有者手动确认。
- 所有者已创建目标与里程碑，原邮件环境及数据保留，仓库外受限权限数据库归档可读；
  不按旧临时清理脚本直接删除，不将归档可读当作独立恢复演练。T-04 保护保持。
- 五十八项仍 47/0/5/0/6，D-17 豁免有效；M5 待真实闭环，M6 未授权。详细证据及
  条件见 [M5 收口报告](./V021_M5_CLOSEOUT.md)，没有 Git 交付或生产变更。

## FABLE M5 接管重试与环境恢复（2026-09-08）

- 恢复页已离开表单，但令牌未消费；主线提前执行完成核验，旧执行器断言失败后自动
  清理邮件测试 API、数据库与 Redis。此为执行错误，原环境继续运行的旧状态已失效。
- 已从 21:39 归档恢复独立持久化数据库，账号、目标、学习计划、阶段和工作区存在；
  R-14 API 健康，原本机入口恢复，服务退出不删除数据。之后新增数据无法核实，
  不声称恢复到事故前瞬间；旧恢复链接不能继续使用，没有改用户密码。
- Provider 重登录及点击后，原生窗口工具因无法可靠识别浏览器 URL 停止操作；
  新增请求零。本批邮件两发两收、累计七封，短期凭据进程已退出；补发恢复并保留
  安全通知会需要额外一封额度，目前未发送。详见收口报告 LIVE-05–07。
- R-14 源码和已通过 CI 保持，五十八项仍 47/0/5/0/6；M5 未完成、M6 未授权。
  历史失败保留，未做 Git 交付或生产变更。

## FABLE M5 恢复邮件追加额度（2026-09-08）

- 所有者允许邮件累计上限从八封调整为九封，已发七封保留；剩余两封仅补发恢复及
  完成安全通知，零自动重试。仅内存短期凭据转交授权继续有效，使用持久化本机环境。
- Provider 原有两次发现额度、R-14 候选和范围决定保持；批准时尚未新增外呼或邮件。
  M5 继续验收，M6 未授权，没有新增 Git、部署、权限扩张或长期云端凭据授权。

## FABLE M5 跨日续验（2026-09-09）

- 第八封恢复邮件前一日实收，但令牌未消费且已过期。原收件计数因中断未落盘，保留
  历史并补记独立观察；累计八封、上限九封，下一组恢复及通知需再追加一封额度。
- 正常 R-14 页面及持久化恢复环境健康，账号和目标数据保留。旧 Provider/邮件临时
  执行器已退出，Provider 新环境本地准备完成，累计仍三次，剩余两次已授权发现。
- 当前候选源码与 CI 不变，M5 尚待真实闭环，M6 未授权，详见收口报告 LIVE-09。

## FABLE M5 两点处理授权（2026-09-09）

- 所有者要求主线处理 Provider 确认与邮件追加两点，批准邮件累计上限十封；已发八封，
  剩余恢复及通知两封，零自动重试。Provider 仍剩两次发现，零生成零重试。
- 两执行器仍在，批准时新增请求与邮件零；仅内存短期凭据有效，继续自主验收。
  真实用户新密码按工具要求本人提交；本次不增加 Git、生产部署或权限扩张授权。

## FABLE M5 正常发现闭环（2026-09-09）

- LIVE-13 真实 Chromium Provider 点击、原生确认、POST 成功、三个模型及同次成功
  文案通过，2.3 更新 passed，五十八项为 48/0/4/0/6。R-14 源码与 CI 保持。
- 浏览器切换期间已有一笔正常请求完成；主线未先按最新计数停止，又执行一笔正常
  请求。两次额度都用于成功路径，累计五次已尽，此执行错误及首笔归属未完全核实
  明确保留。失败环境已准备但默认禁止外呼，额外一次批准待答。
- 邮件上限十封已获批准，第九封恢复邮件 12:58 实收，完整原链接表单已显示；恢复
  尚未消费，需本人提交，最后通知一封保留。M5 尚待 2.4/11.2，M6 未授权。

## FABLE M5 密码恢复与邮件闭环（2026-09-09）

- 所有者完成密码提交，实际页面显示密码已更新；LIVE-16 确认恢复令牌已消费、原两条
  会话全部撤销。最后安全通知单次发送成功，13:26 实收核实发件人、收件人和正文。
  本批两发两收、累计十封达批准上限，二十八项检查全通过；未观察新密码重新登录。
- 邮件执行器退出零并释放短期凭据，持久化服务与数据保留。退出后独立只读确认 API
  健康且版本 R-14、账号/目标/计划/阶段各一，安全通知已发送且载荷清空。历史清理
  事故及恢复点后的数据限制继续保留，未把事故恢复当作 M6 独立恢复演练。
- 11.2 更新 passed，五十八项为 49/0/3/0/6。M5 范围内仅剩 2.4 真实失败 UI；10.2
  和 13.1 按既有决定延后，D-17 豁免有效。Provider 累计五次，额外一次请求仍待批准；
  用户本次密码完成反馈不扩张该额度。产品候选和 CI 不变，M6 未授权，无 Git 交付部署。
- LIVE-17 六十九文件、一百二十三链接、候选/保护/秘密/计数/Run 和健康复核通过，
  三十一份证据摘要保存。已结束耗尽额度的旧 Provider 执行器并清理其合成容器和卷；
  缺少失败路径的批次 false 及退出一保留，单次失败环境仍禁止外呼，用户持久化环境保留。

## FABLE M5 单次失败验收授权（2026-09-09）

所有者确认追加一次合成无效凭据的真实模型发现，累计上限从五次调整为六次，
零生成零重试。批准时新请求零，旧计数与执行错误保留；进入 2.4 真实失败 UI 验收，
不增加邮件、Git 交付、生产部署或敏感开关授权。

## FABLE M5 按批准范围完成（2026-09-09）

- LIVE-18 实际执行一次合成无效凭据发现：上游 401、应用 422/AUTH_FAILED 且不可
  自动重试、真实页面持续错误提示及 unhealthy 健康状态通过。浏览器退出零，累计
  Provider 六次、邮件十封达批准上限，不再追加。
- 收尾脚本原会话等待超过默认有效期，未检查响应便取 providers，KeyError 及整批
  false/退出一保留，原列表拒绝码未保存；两个后续断言未运行，不当作通过。2.4
  根据实际请求、应用响应及浏览器/截图独立通过；独占合成容器及卷已清理。
- R-14 产品/源码测试摘要不变，完整 CI Web 430/Python 612 和导航/权限证据保持，
  2.4 更新 passed。58 项为 50/0/2/0/6，原二十六项零回归、直接修复项通过、无
  新增 P0/P1；D-16/D-06 延后与 D-17 豁免保留，M5 完成主线技术验收。
- 计划留 current，未声明用户已最终整体验收/批准归档，旧角色正式 review pending
  不补造 accepted。历史失败、执行事故和恢复点限制保留；用户服务与数据备份保留。
  M6 未发布未授权，具体条件见收口报告末节；没有新增 Git 交付或生产变更。
- LIVE-19 最终复核通过：六十九文件、一百二十四链接、候选/保护/秘密/计数、原
  二十六项映射、Run/空暂存区/服务健康及三十七证据摘要。M5 明确记录为批准范围
  passed，M6 not-authorized；旧失败与未运行收尾断言保留，不重复完整 CI 或归档。

## FABLE M6 发布准备启动（2026-09-09）

所有者要求推进 M6，已启动可逆本地准备与只读核验。远端开发分支仍为 M5 基线，
main 是其祖先且落后九个提交；最新成功 Main、capacity、Release 工作流分别对应
旧 SHA，不能作为当前发布证据。GitHub CLI 未登录，公开 API 已核实运行状态。
新建发布准备文档、M6 计划及直接子计划，整理完整交付范围、制品门禁和生产备份回滚
步骤。具体 Git 交付与生产变更尚未批准；没有新提交、推送、工作流调度、外呼或部署。

## FABLE M6 本地交付准备完成（2026-09-09）

独立副本已准备 72 文件交付包（53 源码测试、19 文档），产品摘要保持 R-14；
主树 T-04 保护与空暂存区不变。包含已有九个提交的 main 完整差异为 160 文件，
两组 patch、精确 Git tree 和文件摘要保存于仓库外，尚无最终候选提交或四镜像 manifest。
发布工具 21 passed，133 本地链接、格式/秘密/范围/空白和 Run 校验通过；原 M5
完整 CI 证据继续绑定不变产品，不冒充新 SHA 的远端 CI、生产备份或恢复结果。
下一道必要决策为该交付包的提交、推送现有开发分支及面向 main 的草稿 PR 授权；
合并、维护切换、M6 外呼/邮件和生产启用仍有独立门禁。本轮新增外呼与生产操作为零。

## FABLE M6 Git 交付开始（2026-09-09）

所有者在具体 Git 交付提案后要求开始 M6，提交、推送开发分支及面向 main 的草稿 PR
已获准。原 72 文件树形成产品提交 `3620176704c27ecdef481aedee7fd62823f0718c`，
tree 与批准输入完全一致；后续文档提交记录该身份及本次授权，新增直接 Git 子计划。
总选择 73 文件，包含既有九个提交的 main 完整差异 161 文件，产品摘要保持 R-14。
独立副本执行 Git，原主树基线、T-04 修改与空暂存区保持；推送和 PR 仍待实际结果。
具体合并及生产发布未批准，真实 Provider 与邮件旧额度不扩张。

## FABLE M6 草稿 PR 与检查修复（2026-09-09）

已推送候选 `3fc558d92b593b8b6895a338e2e4ee1424cb767d` 并创建草稿
[PR #233](https://github.com/greatLiverheat605/Logion/pull/233)。首轮远端数据库
集成、浏览器和移动构建通过，快速检查被依赖审计阻断；本地复现六项漏洞。
独立副本正在更新必要补丁依赖并修复普通冲突多发空删除时间的旧客户端兼容回归。
红测试一失败一通过与初次 CI 失败保留；新候选将重跑门禁，不沿用 R-14 产品摘要。
原主树和 T-04 修改保持，合并及生产尚未批准，新增 Provider 与邮件均零。

本地必要补丁已完成，JavaScript 审计零漏洞、Python 审计无已知漏洞；完整
`pnpm ci:fast` 退出零，Web 430/Python 614 passed、120 deselected，合同零生成
差异。旧 main 校验器确认普通冲突修复有效，但真正删除冲突仍拒绝非空扩展字段；
已形成兼容性子计划与 D-18 待决策，不将协议同名当作兼容通过。准备推送修复并复核
新提交远端检查，PR 保持草稿，尚不可直接合并。

修复已推送为 `c134bf4c4ace77084a1ba7d95dc939fe837ec029`，远端 fast、
browser 和移动构建通过，integration 的唯一失败是旧断言仍索引空删除时间。
断言改为字段明确缺席后，新的独占数据库完整集成 120 passed / 578 deselected，
迁移和合成容器清理通过；首次本地镜像启动失败未执行测试的记录保留。补充现有
upgrade_required 控制的旧校验器验证通过，但真实跨版本删除升级链尚待 D-18。

## FABLE M6 焦点与生产浏览器复验（2026-09-09）

集成修复 `7e6ce8b` 已推送，PR 共 13 提交、164 文件；同 SHA 数据库集成和移动
构建成功，fast 的恢复表单焦点断言失败，browser 有两项 WebKit axe 上下文销毁
失败及两项 flaky。焦点测试改为等待 effect 完成，定向 9 项和 Web 全套 430 项
通过；浏览器工作流正切换至与 Docker 一致的生产 standalone，保留所有测试门槛。
工作流工具 4 项和格式/空白检查通过；首次本机生产浏览器执行因缺少浏览器及系统库
失败，证据保留并补齐环境后复验，不记为产品失败。D-18 仍待所有者决定，PR 保持
草稿；原主树产品和用户数据保持，无合并、部署或新增 Provider/邮件批次。
