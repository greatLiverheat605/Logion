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
