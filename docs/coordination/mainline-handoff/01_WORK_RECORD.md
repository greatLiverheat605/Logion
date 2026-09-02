# 工作记录摘要

本文件记录对后续执行有影响的事实，不复制聊天全文、终端转录、凭据或私有主机信息。

## M0 与原型

- 用户批准 M0 架构方向：首版复用 `Resource`；citation 显式指向四类目标；`TopicDependency` 保持唯一先修关系；API 只加法、online-only、默认关闭且不改 sync-v1；共享知识写入继续关闭。
- 原型执行方完成第一版动态知识空间原型和 UX 方向。用户批准按该原型施工，并一次性指定前端执行方完成正式前端首版；该授权不延续到后续版本。
- Codex 审查原型施工，修复正式节点落在 `(0,0)` 的重叠问题，并补齐格式、真实 Review 数据适配、只读动态图谱、移动列表、桌面键盘交互和状态面板。

## 设计、后端与门禁

- V20-01/03/07 设计基线获批；V20-02 完成隔离 PostgreSQL 迁移往返、约束负测、孤儿停止、非空降级停止、备份恢复和合成规模估算。
- V20-04 完成加法 OpenAPI/TypeScript 合同、休眠 Permission、默认关闭路由、严格 Schema、HMAC 游标、ETag 和双桶限流原语；sync-v1 固定哈希未变。
- V20-08 完成 bounded knowledge-space core：ORM、授权、Private owner 隔离、Shared 写入默认关闭、行锁复核、ETag、HMAC cursor、有界图读取和超时错误。
- V20-09 完成 AI candidate/receipt 接受闭环：RFC 8785 幂等 hash、事务内重新授权和确定性锁定；Acceptance 仍 fail-closed。
- V20-10 完成真实栈图谱/搜索/渲染验收；Nightly #40 固定 SHA 全绿，覆盖 audit、Compose、迁移/空环境恢复、真实认证 Playwright、1440/390px、axe、移动节点列表、桌面图谱键盘导航和持久化主题值 XSS 防护。
- V20-11～V20-14 的默认关闭准入、集成门、只读终审和隔离回滚演练均已记录并接受；生产开关仍关闭。

## 运行与交付事件

- GitHub 发生过 Actions 不可用/运行头 SHA 不一致的监控断点；规则是只记录真实状态，条件不满足时不重跑、不伪造通过、不进入下一门。
- 用户曾要求每小时监控 GitHub；该定时监控后来明确不再需要，不能重新创建。
- Mac 端第三方 CLI 的 hooks 曾导致登录异常；用户删除 hooks 后恢复。后续不得擅自新增 hooks 或修改用户 Provider 配置。
- 模型中转曾出现 API 400；用户确认官方入口可用。模型路由问题与仓库实现问题分开记录，不把中转错误写成产品缺陷。

## UX 问题与 PR #202

- 用户真实人工检查发现：按钮缺少反馈、提示框不全、邀请接口返回 409、部分操作不可重复安全提交。
- 前端后续施工先暂停，后由用户指定的执行方完成修复；Codex 验收并创建 PR #202。
- PR 检查 `fast`、`integration`、`browser` 全部成功后，用户批准合并。
- 2026-08-09 PR #202 以 Rebase and merge 合并到 `main`，合并提交为 `2339002cd084950c3b859db561ade66fcfa528f4`；Main candidate 随即自动启动。
- 2026-08-09 Main candidate `31300835608` 已完成并成功，`head_sha` 与合并提交一致；候选构建、provenance、精确候选 smoke、Trivy/CodeQL/SBOM 和清理步骤均真实完成。生产发布和流量切换未触发。
- 2026-08-09 受控公网检查 `/health` 返回 HTTP 200、`version=0.1.0`；确认公网仍为旧版本，v0.2.0 候选尚未部署。登录页可达但无已登录验收会话，认证后 UX 回归保持 `not_run`，未输入凭据或发送邀请。
- 用户要求先继续当前合并任务、暂不切换执行方；主线交接包保持待命，待用户明确同意后再重新规划提示词。

## 不可混淆的历史候选

- 旧 A/B 原型技术通过但产品方向已否决，只保留历史证据。
- 纯内存图内核技术通过但不是正式 API。
- 只读终审已完成，不再派发实现任务。
- 任何 worker 的 `complete` 或“写了测试”都不等于 Codex/用户验收通过；必须有实际运行证据。

## PR #203 与 RC3 门禁（2026-08-10）

- PR #203 已按批准完成 Squash 合并，新 `main` 为 `cb0ada40187088a58f591246ff4de03fc05293e6`；合并树与已审批 PR head 一致。
- Main candidate `31332165349` 与 Full capacity profile `31332633330` 均成功并绑定该 SHA。
- Release candidate `0.2.0-rc3` run `31332751602` 在认证浏览器/WCAG 步骤失败：`/app/exam` 在 reduced-motion 模式仍报告 25 个 transition 元素，重试后相同；其余已完成的镜像、恢复和兼容步骤不能替代失败门禁。
- 修复分支 `codex/v020-rc3-reduced-motion` 仅调整 reduced-motion CSS；本机 `pnpm ci:fast` 通过。进入新候选前必须先取得 PR browser job 的真实成功结果。
- 旧本地协调 Run 仍因 encoded-content safe-scan budget 超限无法校验；不改写历史、不派发外部任务。ECS 保持 RC2，所有敏感生产开关继续关闭。

## PR #204、RC4 与浏览器门禁修复（2026-08-10）

- PR #204 已 Squash 合并，新 `main` 为 `dbea77dc9165497d34a37f051fc5cd1a80932851`；Main candidate `31333796558` 与 Full capacity `31334189035` 均成功并绑定该 SHA。
- Release candidate `0.2.0-rc4` run `31334288158` 在认证浏览器门禁失败：`/app/today` 报告 34 个 transition 元素，原执行与 retry 均失败，候选不得部署。
- RC4 trace 与候选制品证明 CSS 已正确打包且在断言前加载。根因是测试只等待 `domcontentloaded`；断言开始时 SessionBoundary 尚未挂载 `.app-shell-frame`，查询执行期间 React 才插入认证外壳，导致在未稳定首帧上采样。
- 修复分支 `codex/v020-rc4-reduced-motion-today` 让断言先等待应用外壳和页面标题可见，显式验证 reduced-motion 媒体状态，并输出具体残留元素和计算样式。产品 CSS 不再重复修改。
- 本机 Lint、类型检查、402 个 Python 测试、231 个 Web 测试、生产构建和合同检查通过；真实认证浏览器结果仍等待分支 PR。保留 `.tmp-v020-rc2/` 与 `.tmp-v020-rc4/` 证据，不提交、不删除、不格式化。

## PR #205、RC5 与浏览器稳定性修复（2026-08-10）

- PR #205 已 Squash 合并，新 `main` 为 `2317f83557f7be2c79f94a30ef89465bc06d7f0c`；PR 的 `fast`、`integration`、`browser` 三项门禁均成功。
- Main candidate `31336153147` 与 Full capacity profile `31336499869` 均成功并绑定该 SHA。
- Release candidate `0.2.0-rc5` run `31336608321` 通过镜像 smoke、空环境恢复和兼容检查，但真实认证浏览器门禁失败，因此 rollout rehearsal 未取得通过结论且候选不得部署。
- 失败包含两个测试基础设施问题：认证 setup 创建的状态数量少于 Playwright 全局并行槽；reduced-motion 检查通过 locator 采样在 React 路由替换中脱离文档的旧节点，得到空计算样式并误报动效。
- 修复分支 `codex/v020-rc5-browser-stability` 按全局 worker 数生成隔离认证状态，并改为在页面内同步查询、验证和采样当前壳层。SessionBoundary、产品 CSS、认证策略和生产开关不变。
- 本机目标格式、Lint、类型/Mypy、Python 402 项、Web 231 项、离线/合同/移动测试、生产构建及 Playwright 101 项测试发现均通过；下一步必须先取得 PR 的真实 browser job 成功结果，再生成新的 Main/Capacity/RC 候选。

## PR #206 与 RC6 全链路验收（2026-08-10）

- PR #206 已 Squash 合并，新 `main` 为 `c47aa376d95b179200d59986c20289b796740959`；PR checks run `31337462102` 的 `fast`、`integration`、`browser` 全部成功。
- Main candidate `31337611805` 与 Full capacity profile `31338032379` 均成功并绑定该 SHA。
- Release candidate `0.2.0-rc6` run `31338128822` 成功通过 Main/Capacity 证据、候选 manifest、不可变镜像 smoke、空环境恢复、旧客户端/恢复 epoch 兼容、真实认证 Browser/PWA/WCAG、5%/25%/100% rollout rehearsal、证据捕获与清理。
- RC6 制品 `release-candidate-0.2.0-rc6-c47aa376d95b179200d59986c20289b796740959` 已部署到受控 prerelease。当前源码、API ready 和四个运行镜像均与 RC6 manifest 一致；迁移头为 `0038_local_worker_protocol`，旧 RC2 源码、镜像、备份和数据卷继续保留用于回滚。
- RC6 启动后加密备份已通过服务器完整校验、BitLocker Windows 异机 SHA-256 复核和 ECS 隔离空环境恢复；恢复得到 2 个 Workspace、0 个空 `sync_epoch`，临时数据库与附件目录已清理。
- 公网健康、安全头、OOM/重启、资源和切换后严重日志检查通过；所有敏感生产开关继续关闭，启用 AI Provider 数量为 0。
- 认证 UX 是当前唯一直接断点：用户已报告当前浏览器会话登录，但协调方尚未在该会话完成真实走查；此前可控标签仍被 SessionBoundary 判定需要登录。21 路由、交互反馈、邀请 409、图谱和主题回归不得提前记为通过。
- RC6 观察期从 `2026-08-09T22:59:03Z` 起算。至少 24 小时观察、真实受邀邮件、实体移动设备和 Production 授权完成前，不清理回滚点、不启用 Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 或 AI Acceptance。

## 当前主线交接与前端重设计决策（2026-08-10）

- 当前文档主线为 `origin/main=62ddd5251a8ce609dc434b8e6286bd8c7c9d9517`；RC6 运行产品源码仍为
  `c47aa376d95b179200d59986c20289b796740959`，两者不得混淆。
- 用户决定后续只保留一个指定的主线执行方；长期文档使用通用角色名，不从模型品牌推断 Git、秘密、
  敏感能力或 Production 权限。
- 用户不习惯当前系统操作页的样式与操作方式。两名专项设计执行方将分别产出独立完整方案，顺序固定为
  产品诊断、UX 审查、信息架构、交互、视觉、Design System 与高保真原型；审批前不得修改正式前端。
- 双方案使用不同 worktree/分支和不重叠输出目录。用户批准完整原型后，才由主线执行方按冻结方案施工。

## I0 Adaptive Desk 最终收口（2026-08-13）

- I0-A～I0-E 已在正式 `v020-integration` 工作区完成施工、审查和真实浏览器验收；分支为 `codex/logion-redesign-i0`。最新 `origin/main` 已合并到该分支，根 README 已同步产品定位、当前版本边界、五区架构和测试入口。
- 最终浏览器复核发现搜索按钮状态过渡中间帧对比度不足，以及工作区列表缺少合法语义角色。两项均已修复；工作区列表增加具名 list/listitem 结构和单元测试，没有删除可访问名称或放宽 axe。
- 真实隔离栈完整 107 项 Playwright 最终为 101 通过、6 项按规范跳过、0 失败；仅导出消费者在加密导出验证完成后立即停止。8080 无关服务始终未触碰。
- 最终仓库门禁 `corepack pnpm ci:fast` 返回 0；Web 449、Python 402、状态模型 fixture 118、离线 55、合同 12、移动 4，36 路由构建与合同生成一致。pnpm/pip 依赖审计未发现已知漏洞。
- 历史协调 Run 仍因 encoded-content safe-scan budget 超限而未绿；这一限制单独保留，不影响 I0 代码与浏览器验收，也不得改写成通过。
- 下一节点固定为推送最终分支、创建 PR、等待 GitHub `fast/integration/browser/mobile` 四项门禁全绿；全绿后只请求用户批准合并，不自动部署或开启任何默认关闭能力。
- `codex/logion-redesign-i0` 已推送并创建 [PR #208](https://github.com/greatLiverheat605/Logion/pull/208)，base 为 `main`。后续事实源改为 PR 最终 head 与四项远端门禁；未取得全绿和用户合并批准前保持 Open，不部署。
- head `31b0b647a74d81bf05b16abc345d00f768aee28c` 已取得 PR checks run `31669501110` 的 `fast/integration/browser` 成功，以及手动 Mobile builds run `31669799252` 的 `android-debug` 成功；两个 run 均核对相同 `head_sha`。记录该事实的文档提交会产生最终新 head，必须再次验证后才请求合并批准。

## I0 合并、README 与 RC7 证据闭环（2026-08-13）

- PR #208 已经用户批准并 Squash 合入 `main`。保护分支拒绝包含历史 merge commit 的直接快进推送，因此未绕过规则；README 的合并后状态与路线说明分别通过 PR #209、#210 更新，两个文档 PR 的 `fast/integration/browser` 均成功。
- 产品候选固定为 `480adc721600243308fa7b5a32200044efd88f07`：Main candidate run `31672956241`、Full capacity run `31673689291` 与 Release candidate `0.2.0-rc7` run `31673881951` 全部成功并绑定该 SHA。
- RC7 真实执行了不可变镜像 smoke、空环境恢复、旧客户端/恢复 epoch 兼容、107 项 Browser/PWA/WCAG、5%/25%/100% rollout rehearsal、证据上传与隔离卷清理。唯一 warning 是 `docker/login-action@v3` 的 Node.js 20 上游弃用提醒，不改变 success 结论。
- 当时 ECS 受控 prerelease 仍为 RC6；随后已按用户批准完成 RC7 更新。Production 未授权，所有敏感生产开关继续关闭。
- 后续仅文档收口不会改变 RC7 产品候选 SHA；历史协调 Run 的 safe-scan budget 限制继续独立保留。

## RC7 受控 prerelease 部署（2026-08-13）

- 用户批准使用已验收 RC7 更新受控 prerelease；ECS 已完成原子切换，活动源码为 `480adc721600243308fa7b5a32200044efd88f07`，旧目录 `/opt/logion.before-rc7-20260813T130605Z` 保留。
- 切换前最终备份为 `logion-20260813T130618Z-beta-v1.backup`，服务器与 BitLocker `J:\LogionBackups\encrypted` 副本 SHA-256 均为 `76bd5d7b441fefb0999b08d460042fb3cd6fe37cb3a20c00ac454de86076022f`；未删除或替换数据库、附件或数据卷。
- 迁移头为 `0038_local_worker_protocol`；API、Worker、Web、Reverse Proxy、Backup、PostgreSQL、Redis 均运行，公网 `/health` 返回 HTTP 200，四个 RC7 应用 digest 与 manifest 一致，8080 仍仅绑定 `127.0.0.1`。
- 切换后发现 Backup secret 权限错误（`root:root 0600`）导致启动失败；已恢复为 `root:10001 0640`，Backup 当前稳定运行。该修复未更换密钥内容。
- 当前仅为受控 prerelease 更新；Production 发布、流量切换、真实受邀邮件、实体设备验收及 Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 仍未授权。

## PR #212 冲突与依赖审计修复（2026-08-15）

- 正式集成工作区将 RC7 收口分支变基到最新 `origin/main`，跳过已被 squash 吸收的旧提交，并以 `--force-with-lease` 更新 PR 分支。新 head：`7b85116cbcab01624662c50838e08865d30a89f1`。
- GitHub run `31869105696` 的 `fast` 门禁真实失败于 JavaScript dependency audit：锁定的 `nanoid@3.3.17` 已低于公告修复版本 `3.3.18`。已修改 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml`，并保留最小 diff。
- 本地审计与完整门禁均已重新执行并通过：`pnpm audit --audit-level high` 无已知漏洞；`pnpm ci:fast` 返回 0，包含 118 状态测试、402 Python、449 Web、55 offline、12 contracts、4 mobile 测试及构建/合同生成。
- 依赖修复提交 `f2f5eb942db644f2c6b43059330f3ed1a4300905` 已推送；该最终 head 的 `fast`、`integration`、`browser` 与 `android-debug` 均真实成功。不得把旧 head 的运行结果复用于新 head；PR 仍等待用户合并批准，不自动部署或打开默认关闭能力。

## RC7 观察复核（2026-08-15）

- 观察起点 `2026-08-13T13:06:05Z` 已超过 24 小时；公网健康连续 3 次 HTTP 200，安全响应头存在。
- 受控 SSH `120.26.101.76:22` 两次连接及 `Test-NetConnection` 均超时，未读取或输出任何服务器密钥、环境变量或完整日志。ECS 侧 OOM/restart、资源、备份新鲜度和告警检查因此未执行。
- 当前仍是“等待受控 SSH 恢复”的断点；PR 不合并、不部署，不清理回滚目录/镜像/数据卷，不开启默认关闭能力。

## RC7 观察收口（2026-08-16）

- 用户开放受控 SSH 后，于 `2026-08-16T05:23:17Z` 使用既有专用密钥完成只读复核；未读取或输出私钥、密码、环境变量值或完整日志。活动源码仍为 `480adc721600243308fa7b5a32200044efd88f07`，迁移头为 `0038_local_worker_protocol`。
- API readiness 的 application/database/redis 均为 `ok`；API、Web、Worker、Reverse Proxy、PostgreSQL、Redis 健康，Backup 正常运行，Attachment init 退出码为 0。全部容器均为 `OOMKilled=false`、`RestartCount=0`。
- 根磁盘使用 40%，可用内存 933 MiB，Swap 2047 MiB 中使用 395 MiB。最新备份 `logion-20260815T133314Z-beta-v1.backup` 距复核约 15.8 小时，`logion-verify-backup` 返回 OK，备份中的源码与迁移头一致；过去 24 小时系统 error/alert 计数为 0。
- Web 的 7 条 Server Reference ID 格式错误经反向代理日志聚合核对，共 565 个请求、无 5xx，异常请求均以 404 拒绝，因此归类为畸形请求或探测噪声，不构成观察失败。
- 实际生产边界保持不变：Knowledge API、Shared Write、AI Acceptance、Deletion、Attachment ingest、Local Worker、Attachment scanner 均为 `false`，AI Provider 启用数为 0；注册模式为 invite，legacy registration 为 `false`。邮件 Provider 为 `aliyun_directmail`，本轮没有执行真实邀请邮件。
- RC7 至少 24 小时技术观察真实通过。PR #212 可以进入用户合并审批，但记录该结论的新文档 head 必须重新取得 `fast/integration/browser/android-debug` 全绿；不自动合并或部署，不清理回滚点，不启用敏感能力。真实受邀邮件、实体移动设备、Production 授权和历史协调 Run safe-scan 限制仍未完成。

## PR #212 合并与主线候选（2026-08-16）

- 用户明确批准合并后，先重新核对 PR #212 为 Open、clean、无冲突，最终 head `ff2b0bf621a5376b68229caee95ed4aa0ca2e9dc` 的 `fast/integration/browser/android-debug` 四项均成功。
- GitHub 受保护分支流程使用 Squash merge，于 `2026-08-16T14:10:43Z` 将 5 个提交合入 `main`；PR 随后关闭，合并提交为 `11014fb736b1f74085a32a7ad1c00054b0b83d6b`，远端主题分支由 GitHub 删除。
- 合并后主线 Android run `31951949928` 成功；candidate run `31951949948` 真实完成 `ci:fast`、许可/Compose、四镜像构建、不可变镜像 smoke、provenance、精确镜像扫描、SARIF/SBOM 与证据上传，全部成功且绑定 `11014fb...`。
- 本轮没有执行部署。受控 prerelease 仍运行 RC7 产品源码 `480adc721600243308fa7b5a32200044efd88f07`；Production 流量、真实邮件、回滚点清理及默认关闭能力均未触碰。
- 下一批准点为真实受邀邮件、实体移动设备验收和 Production 发布范围。历史协调 Run safe-scan 限制仍单独未绿，不影响合并证据，也未被改写为通过。

## Workbench v1 施工任务包与记忆层核验（2026-08-17）

- 用户批准开始归纳 Workbench v1 施工任务包，并计划在新窗口继续施工。
- 已建立 `08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md`，冻结 I1→I4 顺序、权限/对象不变量、每轮对抗复审和用户审批门。
- 已建立 `TENCENTDB_AGENT_MEMORY_HANDOFF.md`。TencentDB Agent Memory 可保存脱敏的 L0/L1/L2/L3 工作摘要，但不能替代 Git/协调账本，也不能假定 Codex 桌面会话自动接入。
- 当前运行环境没有提供 `MEMORY_ENDPOINT`，因此没有执行健康检查；实际部署仍需完成健康、隔离、持久化和恢复演练，状态只能记为“部署待验收”。
- 一次辅助源码测试在依赖获取阶段超时，未执行测试主体；该结果未记为通过，也不能代替实际端点验收。
- 本次只更新文档，不修改正式前端、API、数据库、OpenAPI、迁移或生产配置；未 commit/push/merge/deploy。

## Workbench v1 I1 批准与文档基线授权（2026-08-18）

- I1 已覆盖 34 个 `page.tsx`、21 条正式路由和 73 个唯一逐操作状态合同；独立对抗终审无剩余 P1/P2。
- 产品 Owner 已批准 I1，并授权完成 Workbench 文档脱敏和基线提交；该授权不包含 push、merge、deploy 或正式前端施工。
- `apps/web/src/**`、API、数据库、迁移、OpenAPI 和生产配置继续保持不变；I2 必须等待新的明确施工范围与写入授权。

## Workbench v1 W1 施工收口（2026-08-19）

- W1（M1-M4 与 S1）已完成并通过独立对抗复审，最终 HEAD 为 `22b9e339d1935e81685dda1c043384f914c58d02`。
- 协调方实际复核：Web 68 个文件/525 个测试、认证 Playwright 32/32、lint、typecheck、Prettier、build 与 `git diff --check` 均通过。
- 独立整批复审第二轮 Verdict 为 PASS，无 P0/P1；新 Workbench Inspector 的页面级 Escape/焦点回归保留为 I4 集成门的可接受 P2。
- 根级 `corepack pnpm ci:fast` 未全绿：在既有 `apps/worker/src/logion_worker/email_delivery.py` 的 `alibabacloud_credentials` 缺少 mypy stub 处失败；未修改该无关 Worker 文件。
- 当前分支尚未 push、merge 或 deploy；TencentDB Agent Memory 仍为“部署待验收”。
- 下一阶段为 I2（研究与考试领域流程），包括 Research Question、Source、Claim/Evidence、Experiment Run、版本/证据关系，以及 Exam、覆盖矩阵、复习缺口、模拟考试和成绩轨迹；开始前需要新的施工范围、写入白名单和 Product Owner 批准。

## Workbench v1 I2 任务包批准（2026-08-19）

- Product Owner 已批准进入 I2 任务包准备；新增 `09_WORKBENCH_V1_I2_CONSTRUCTION_TASK_PACKET.md`，冻结研究线、考试线、I2-Q1 集成线、唯一白名单和独立复审门。
- I2 基线为 `6e448ac01dc78b94f600658f2574a51cce1cca64`。本次只修改交接文档，未开始 I2 正式代码施工，未触碰 API、contracts、数据库、迁移、权限或生产配置。
- 下一动作是协调方复核 I2 包并单独授权 I2-R1 或 I2-E1；GLM 只能承担独立、不重叠的纯模型/测试子任务，结果仍需主线验收。
