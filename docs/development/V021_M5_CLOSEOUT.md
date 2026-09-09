# v0.2.1 M5 后续收口记录

> 更新：2026-09-09。M5 按 D-03/D-06/D-15/D-16/D-17 批准范围完成主线技术验收，最终候选为 R-14。LIVE-18 单次真实上游 401、应用 422/AI_PROVIDER_AUTH_FAILED 与失败 UI 通过，2.4 更新 passed；正常 Provider、注册及密码恢复/安全通知已闭环。58 项为 50 passed、0 failed、2 partial、0 blocked、6 out_of_scope；两个 partial 均为批准延后项，真实读屏为 owner waiver。累计 Provider 六次、邮件十封均达批准上限，不再追加。收尾脚本异常、历史失败与数据恢复限制保留；M6 未授权，计划保留 current，未作 Git 交付或部署。
> 基线：`bac2a4371ce6a12d6c3e9a6124104d121b0f8807`。
> 前轮结果：[M5 本地回归](./V021_M5_LOCAL_REGRESSION.md)、[R-01–R-03 修复](./V021_M5_FIXES_REVIEW.md)。

所有者回复“按照建议推进”，继续测试稳定性诊断、剩余验收和候选交付准备。原交接要求
T-04 三文件保持原样、不暂存提交；本轮仍保留该边界。两位工具子代理只读审查，主线为
唯一 writer，不将其包装为旧角色配置下的正式派发或 accepted 事件。

## 已确认缺陷与修复

| ID   | 证据与根因                                                                                                                             | 处理                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R-05 | 保存 Promise 未完成时关闭答题弹层、同题重开并填写新草稿，旧成功回调仍会执行父级关闭；新增单测旧实现 1 failed / 12 passed               | AnswerSheet 实例挂载标记在卸载时清除，延迟关闭实际执行时检查；修复后 13 passed。真实保存继续完成，失败输入保留                                |
| R-06 | 组合测试的深色附件移除弹窗 eyebrow 使用固定 `--cyan`，axe 实测 3.19:1                                                                  | AppModal 自身使用已有主题文字 token `--accent-text`；不修改受保护 globals.css；附件弹窗明确覆盖浅/深、1440/320 四组                           |
| R-07 | 真实 Mastery 第二次确认的墙钟回拨 1.711 秒，使 `updated_at` 早于 `created_at`；诊断明确在 `validateMutation` 入队前拒绝，无第二次 Push | 五个普通更新/删除构造入口使用实体时间下界；保留创建字段、版本、revision 与真实 `client_occurred_at`，不改变校验、CAS 或 sync-v1 合同          |
| R-04 | 原画像入口 `aria-label` 覆盖可见说明；DOM 实验能复现 `label-content-name-mismatch`                                                     | 仓库外准备仅删除该属性 5 行的补丁，`git apply --check` 通过；DOM 调整后规则与键盘跳转通过。源文件未改，不提升 13.3 状态，单点例外待所有者确认 |

R-05 是既有竞态的补修，不冒称由上轮条件挂载引入。新单测等待旧 Promise 完成，并实际
排空关闭定时器，再从当前 screen 查询新弹层及草稿，避免 detached DOM 假通过。

## 候选与检查

旧修复候选保留为 `+m5-9117a37769f0`。本轮第一份独立候选为同一基线加四份产品覆盖：
AppModal、ReviewWorkbench、IntegrationHub、feedback.css，完整产品覆盖摘要为
`8c5abe64082913a53472c382da5653b4ffaa59acdb82f4c25df6eb6232c999ec`。
Web 实际版本为完整基线加 `+m5-8c5abe640829`，API/Worker 仍使用裸基线后端。
Web 3004 与 API readiness 均实测 200，版本符合预期。API 重启首个 readiness 请求曾拒绝
连接，随后 200 后才启动业务测试；该首个失败不记为通过。

最终产品候选增加时间 helper 和五个 caller，共十份产品覆盖，摘要为
`87a78a593c19677e820a3ec1b64c1d7355f4a0f2d5aacd257367072dd86c1b1d`。
Web 3006 实际版本为完整基线加 `+m5-87a78a593c19`；API/Worker 仍为裸基线。
最终浏览器测试覆盖摘要为 `147b3840d61229e3d7cbf87340b80c4f05ba1874c9386210c876aea0fd2f2eb8`。
测试专用副本不包含 T-04 未提交修改或诊断版 repository 插桩，产品与测试分别归因。

| ID  | 证据组 / 文件                                                           | 实际结果                                                                                                                                                 |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01 | `m5-fixes-GSr4mV/stability-baseline-1788770823554/results.json`         | 原九份 spec 在旧修复候选上 37 passed / 3 failed；Mastery 两例与 Sync 非空 Outbox 断言通过，失败为 Goal 解锁、Resource 重命名弹层未关闭和 R-06 深色对比度 |
| G02 | `m5-closeout-KUuKOm/ci-fast-limited-1788771318215.log`                  | 完整 CI 首轮 typecheck 失败：新增单测误用 Testing Library 不支持的 `exact` 参数；已移除                                                                  |
| G03 | `m5-closeout-KUuKOm/ci-fast-limited-1788771468462.log`                  | 完整八门退出 0：Web 406、offline 74、contracts 13、mobile 4、Python 606 passed / 109 deselected、mypy 181 文件、coordination 118                         |
| G04 | `m5-fixes-GSr4mV/r04-proposal-1788771662028/results.json`               | 1 passed，原标签规则失败、DOM 删除属性后通过、Enter 进入设置页；仅验证补丁方向，不是源代码修复后的构建验收                                               |
| G05 | `m5-closeout-KUuKOm/stability-final-1788771782695/results.json`         | 38 passed / 2 failed；Note 删除前解锁、Today 关闭失败；同期 Mastery、Sync 两主题通过                                                                     |
| G06 | `m5-closeout-KUuKOm/stability-targets-1788772118491/results.json`       | 8 passed / 1 failed；Today 人工验收失败；目标 hash 断言的 Mastery、Sync 通过                                                                             |
| G07 | `m5-diagnostic-R73wMZ/transition-diagnostic-1788772504037/results.json` | 8 passed / 1 failed；Mastery 320px 记录到 R-07 入队前时间拒绝。插桩候选只作诊断，不能交付                                                                |
| G08 | `m5-closeout-KUuKOm/clock-before-wire-1788773418911/results.json`       | 1 failed；修正测试 wire 读取后，旧产品在固定回拨两秒时无第二次 Push，确定性复现 R-07                                                                     |
| G09 | `m5-timestamp-h5fyW2/ci-fast-limited-1788773319437.log`                 | 最终产品完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed / 109 deselected、mypy 181、coordination 118                  |
| G10 | `m5-timestamp-h5fyW2/stability-combined-1788773786355/results.json`     | 原九份 spec 加两条回拨回归，42 passed / 0 failed；Goal/Task/Note 删除、Records 编辑、Review、Mastery、Sync、Today 实际组合通过                           |
| G11 | `m5-timestamp-h5fyW2/mastery-final-1788774015763/results.json`          | 最后补齐 tombstone 类型分支、IDB 名称窄化和目标 Topic 后，4 passed；两条真实时钟回拨与两条理由渲染；两份浏览器 spec 的独立严格 tsc 通过                  |
| G12 | `m5-timestamp-h5fyW2/cleanup-1788774058763.json`                        | 本轮累计 11 个合成账号及关联数据清理；91 张业务表总行数 0、独占 Redis 键 0，所有候选临时认证目录已不存在，注册额度恢复 5                                 |

G03 限制 CPU 并行度到 0–3，不设置测试版本覆盖；使用锁定依赖。测试专用候选拥有独立
依赖，不触碰主树或其他候选 node_modules。G09 独立覆盖 R-07 后的完整产品源码，不沿用
G03 的旧通过。浏览器测试晚于 G09 做过 wire 类型、目标定位与窄屏切换调整，G10/G11
分别绑定实际执行的测试版本，不声称 G09 已执行这些浏览器用例。

新增浏览器测试的首次两次运行误读 Pull 字段（DataError、Invalid time value）；第一次
修复候选回拨组为 1 passed / 1 failed，失败因为 320px 默认 master pane 尚未切到复习
工作面，补正常切换后 G10/G11 通过。独立 tsc 首轮未指定已有 Node 类型根且有 tombstone
分支、异步闭包名称窄化问题；修正测试及命令后退出 0。上述测试错误与旧产品失败均保留。

## 稳定性边界

Mastery 已在独立诊断候选复现并定位。诊断记录 `created_at` 为
`2026-09-07T09:15:41.731Z`，同实体第二次确认的 `updated_at` 为
`2026-09-07T09:15:40.020Z`，阶段为 `input-rejected`，base version 1、local revision 2。
固定浏览器时钟回拨两秒后，旧候选也稳定出现第二次确认无 Push。之前两次新增回归测试
误读 wire 字段导致的 DataError/Invalid time value 已单列为测试错误，不当作产品复现证据。

R-07 的 helper 使用 `Date.parse` 与现有校验相同的毫秒比较，返回选中的原始字符串，
保留既有小数精度；不声称任意亚毫秒精确排序或全局单调时钟。只读盘点的 13 个普通
mutation 入口中，五处更新/删除需要下界，其余八处纯 create 共用同一 `now`。Yjs 与冲突
处理属于独立路径；StudySession 的业务起止时间仍按墙钟记录。

Vault 解锁、Today 验收/关闭以及旧 Sync Outbox 失败不能仅凭相同错误文案归因于 R-07。
Provider 先发布 unlocked、controller 后完成 bootstrap/refresh，存在可观察的等待窗口，
但现有失败证据不足以把它认定为根因；不因静态猜测修改共享认证或 Vault 生命周期。

Mastery 渲染夹具现在只修改本次 Topic 的 Mastery，等待 Push 成功、目标 Pull 的实体 ID、
版本、payload hash 及本地 clean 状态。非空建议依旧为渲染 mock，不能作为真实建议生成
或后续写入证据。Sync 明确检查新 Note 标题、两个附件关联同一 Note、未保存/保存状态及
该 Note 的非空 Outbox；上传失败定位到指定文件行。加固不等于已查明旧故障原因。

新组合失败时的本地诊断只采集状态、表单有效性和实体/队列元数据，位于仓库外测试候选；
不采集学习正文、密码、Cookie 或完整 payload。旧失败日志保留，孤立重跑与整组结果分开。

G10 中旧解锁、Today、Sync 失败均未再次出现；这证明当前组合实测通过，不证明这些
旧失败已全部归因。保留其独立诊断缺口。R-05/R-06/R-07 只读审查未发现确定性新增
产品回归或本轮新增 P0/P1；一处 Push operation 未限定 Topic 的低风险测试发现已修正。
最终附件确认框浅/深、1440/320 axe 全部通过，截图已检查；没有把自动化当成真实读屏。

58 项仍为 43 passed、1 failed、5 partial、3 blocked、6 out_of_scope；原范围内 26 项
当前映射通过。新增问题修复没有新增原清单 ID，也未豁免 13.3/R-04 或外部验收，M5 门未通过。

## 主线收口检查

主线独立脚本已验证 27 份交付文件格式、84 个本地链接、58 个唯一 ID/状态合计及原范围
内 26 项映射；Gitleaks 和 `git diff --check` 通过。19 份产品/测试覆盖与当前测试候选字节
一致，产品覆盖摘要一致；T-04 三文件原始摘要不变，其工作树修改未进入候选，暂存区为空。
当前 Run validator 通过，正式 review task 仍 pending，不补造旧角色模型证明或 accepted 事件。
独立只读文档复核确认 G01–G12 路径存在、42/4 项结果与清理/清单计数一致，未发现需修正的
文档错误；该复核没有重复运行 CI 或浏览器，不替代主线已观察的检查。

清理后 Web/API readiness 再次返回 200 与预期版本；本轮旧预览 3004 和诊断预览 3005
已按进程目录核验后停止，保留最终空预览 3006、既有本地栈与脱敏证据。临时认证目录已由
测试 teardown 删除，清理脚本再次确认不存在；生产数据、主树依赖和其他所有者材料未清理。

## 生产与读屏前置

| 项目      | 当前可确认范围                                                                           | 仍需证据                                                                   |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| OPS-01    | 本地候选完整基线与覆盖摘要，公开开发分支仍指向该基线                                     | 生产目标上下文、Web/API 运行版本、四个运行镜像 digest 与同一 manifest 一致 |
| OPS-02    | 本地 ingest 关闭，未改变生产配置                                                         | 生产当前生效布尔值；启用权限另行确认                                       |
| OPS-03/04 | 已有 mock 错误边界；未请求真实 Provider                                                  | 生产 resolver/出站条件、受控 Provider 配置及经确认的真实请求结果           |
| OPS-05    | 本地邮件 disabled，未新增真实发信                                                        | 专用受控收件箱、发信域和投递/链接实测；DNS 记录不能替代邮件到达            |
| OPS-07    | 续验已启动 NVDA 2026.2 便携版及 Speech Viewer；桌面工具因无法确认浏览器 URL 停止，见 H07 | 真实成功/失败播报未完成；不能由 DOM/axe 或已启动读屏软件代替               |
| OPS-06/08 | D-06 延后边界保留                                                                        | 真机/PWA/软键盘/移动读屏未运行，不自动豁免生产手册的发布门                 |

已请求生产公开 HTTPS 地址及既有 SSH 主机别名；没有接收或索取密码、密钥、Token。
确认目标前不猜测生产主机或把本地数据当生产。未部署、未开启 ingest、未修改生产或
真实账号数据、未发送邮件或 Provider 请求。

## 发布与回滚材料

本表是待填写的发布准备记录，不是可部署 candidate manifest。正式 manifest 继续使用
现有 `scripts/release/candidate_manifest.py`，只接受真实提交及四个不可变镜像摘要。

| 字段                               | 当前状态 / 后续要求                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 范围与门                           | D-02/D-03/D-06 有效，M5 未通过，M6 未批准                                                                          |
| 源码身份                           | 本地基线加上述覆盖摘要；最终提交尚未创建                                                                           |
| Main / capacity / Release run      | 新提交同 SHA 的通过证据待 Git 交付后产生，不能沿用旧候选 run                                                       |
| API / Worker / Web / Backup digest | 本轮未构建或发布镜像，不填写占位摘要                                                                               |
| 目标兼容性                         | 由现有 manifest 代码实测：migration head `0040_merge_gate2_heads`、`sync-v1`、offline schema `4`；生产当前值未读取 |
| 上一候选与回滚镜像                 | 保存并验证旧 manifest、实际四个运行镜像的不可变引用、Image ID、RepoDigests；发布手册已补强此前缺失的前置记录       |
| 备份与恢复                         | 部署前加密备份及摘要、异机校验时间、独立空环境恢复结果待实测；不操作生产卷                                         |
| 运行验收                           | TLS、邮件、真实同步、告警、资源及至少 24 小时观察待候选发布阶段执行                                                |
| 停止条件                           | 身份/镜像不一致、必要验收未过、备份或恢复未验证，不进入替换；不兼容 schema 不直接启动旧镜像                        |

对应操作依据：[生产发布手册](../../infra/runbooks/aliyun-production-release.md)、
[备份恢复手册](../../infra/runbooks/backup-restore.md)。实际主机信息、私有连接配置和凭据
保存在运维受控记录中，不进入仓库或本地协调账本。

## M5 继续验收（2026-09-07）

所有者回复“继续 M5”后，补齐可独立运行的本地验收。上述 G01–G12 保留为前轮历史，
本节为最新进度。主树十份产品覆盖仍为 `87a78a593c19677e820a3ec1b64c1d7355f4a0f2d5aacd257367072dd86c1b1d`。
R-04 只在独立候选的基线 AppShell 中删除五行 `aria-label`，未混入主树其他 T-04 改动；
该十一份产品覆盖摘要为 `005b067ecb218e747c2956f65e67be41fe4863c08d4dab90fbe74c4b2282ad82`。
Web 3007 实测版本为完整基线加 `+r04-005b067ecb21`；API/Worker 产品源码仍是裸基线。
本节产品和浏览器证据归属于这个隔离提案，不能冒充主树已应用 R-04。

下表文件均保留在仓库外证据组 `m5-a11y-ZzWN1n`，不是待提交制品。

| ID  | 文件 / 检查                                               | 实际结果                                                                                                                                                      |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01 | `ci-fast-limited-1788787521399.log`                       | R-04 隔离候选完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed / 109 deselected、mypy 181、coordination 118                  |
| H02 | `r04-name-ready-1788788098976/results.json`               | 4 passed；浅/深 × 1440/320，名称来自可见文本、显式 label-content-name-mismatch、局部 axe、真实 Tab 到入口、Enter 到设置页；截图已检查                         |
| H03 | `integration-1788788290872/result.json` 与两个 pytest XML | 独占 PostgreSQL/Redis、迁移 head；删除冲突 8 passed / 24 deselected，导入 12 passed；整个专用库和 Redis 实例均已删除                                          |
| H04 | `deletion-browser-content-1788789117386/results.json`     | 1 passed；在线预检后离线确认、pending 删除标记、独立设备真实更新、delete_update、人工采用服务器版本、Outbox 清空、B 冷初始化正文及 A 重载后同步前解密内容一致 |
| H05 | `auth-unit-observation.json`                              | 20 passed；13 个恶意/空 next 拒绝、合法路径/优先级、模板 recent-auth 提示；3 个不匹配筛选的模板测试 skipped，未把它们计通过                                   |
| H06 | `auth-next-identity-1788788983427/results.json`           | 3 passed；两视口真实登录回到 data、真实导出轮询及同 ID 下载；互操作 recent-auth 仍为 mock 403 后解除 mock 重试，未完成过期会话重新登录链路                    |
| H07 | `nvda-runtime-observation.json`                           | NVDA 2026.2 官方便携版签名有效，独立配置启动并发现 Speech Viewer；桌面输入因工具无法可靠确认浏览器 URL 被停止，未取得成功/失败播报证据                        |
| H08 | `cleanup-1788789193619.json`                              | 本轮 9 个合成账号及相关业务数据清理，91 表总行数 0、独占 Redis 键 0，临时认证目录已不存在，注册额度恢复 5                                                     |

H03 显式使用 `pytest -o addopts= -m integration`；默认 CI 排除 integration，H01 不能
替代 H03。导入测试新增合法但错误的 `expected_version`，断言 `409 / VERSION_CONFLICT`，
预览、密文和 Note 数不变；正确版本仅新增一条 Note，重复提交为 `IMPORT_PREVIEW_EXPIRED`，
提交后密文清除。11 个 HTTP 边界覆盖 content 的 0/1/1,048,576/1,048,577 字符、正文的
0/100,000/100,001 字符、记录的 0/1/1,000/1,001；成功预览不写 Note，拒绝不增加预览或 Note。
这些是字符限制，不能表述为任意 UTF-8 字节限制。

H04 的浏览器闭环使用 Note，Goal/Task/Note 双向 delete_update 和 Yjs 禁止复活由 H03
覆盖，原 E01 的三类删除及引用拒删保留。独立审查指出初稿仅验标题/元数据，已补正文、
pending 状态和本地删除标记后重跑；B 为全新 BrowserContext 的冷初始化，A 为页面重载，
不是浏览器进程重启。三份涉及的浏览器测试严格 tsc 通过，API 测试 Ruff 检查及格式通过。

保留首轮失败：H02 之前首次配置未收录新 spec，未执行测试；第二次为 2 passed / 2 failed，
测试在页面就绪前查询主题按钮，补等待后 H02 通过。H04 首轮使用当前画像未展示的导航链接，
超时 1 failed；改为打开已有 Sync 路由并修正测试字段 `conflict_kind` 后通过，随后再补正文。
H06 首轮为 2 passed / 1 failed，320px 在真实导出继续推进后等待 `queued` 超时；测试改为
发起前监听同一任务、按列表选择新任务并断言最终下载 URL 的任务 ID，保留真实 202/终态/
ZIP 字节证据。短暂 queued 的渲染与条件轮询仍有既有组件测试，不要求真实 Worker 为截图停留。
独立 tsc 首次 Node 类型根设置错误，改用候选 Web 现有类型根后通过；未修改产品代码适配测试。

Windows 独立 Chrome 已关闭、便携 NVDA 已停止。首次组合清理命令被自动检查拒绝；
确认唯一普通目录后，缩小为显式路径删除已成功，浏览器 profile 与 NVDA 日志均已删除。
签名有效的便携工具保留供后续读屏验收，未安装系统版或修改用户既有配置。API 重启后的首个
readiness 曾拒绝连接，后续 Web/API 均为 200 且版本一致；保留空 3006/3007 预览与本地栈。

最新 58 项为 **44 passed、1 failed、4 partial、3 blocked、6 out_of_scope**：8.4 提升为
本地 passed；A-06 单列本地 passed；A-07 保持 partial。13.3/R-04 的主树五行例外仍待所有者
确认，13.1 侧栏、真实读屏、真实邮件与生产前置保留，M5 未通过。两份新增/扩充测试及一份
既有浏览器测试加固已在主树保留待交付；本轮无 commit、push、merge、部署或真实外呼。

主线最终复核：29 份交付文件（28 份 Prettier、1 份 Python Ruff）、86 个本地链接、58 个
唯一 ID/计数和原范围内 26 项映射通过；Gitleaks、diff 空白、候选字节一致与 T-04 原摘要
不变均通过，暂存区为空。主树待交付测试覆盖摘要（不含隔离 R-04 spec/config）为
`8d2654423919bc6996301a5d5a15b29a2bff25d4ed7ec687cfdeabb174986265`，不与旧浏览器摘要混用。
最终校验脚本首轮把新增 Python 测试误归入产品覆盖，修正分类后确认十份产品摘要不变。
Run validator 通过，正式 review task 与 actor 仍 pending，不补造旧模型证明或任务验收事件。
独立只读续验文档复核未发现确定性问题：58 项计数、H02–H08 结果与清理、21 项源码/测试
文件摘要相符；H01 仅复核日志存在与候选归属，不替代主线收取 CI 退出 0 的实际观察。

## M5 反馈与认证补齐（2026-09-08）

所有者回复“继续完善”，主线补真实 recent-auth 链路与七模块成败反馈，期间确认 R-08：
浅色错误 Toast 继承 Sonner 的 `#e60000`，背景 `#fff0f0`，浏览器 axe 实测仅 4.34:1。
在已有浅色反馈 selector 中新增 `--error-text: #b42318`，深色规则保持生效；这是本轮
唯一新增产品修改，不改受保护 globals.css。Provider、Run、Persona 均复现该共享缺陷。

主树十份产品覆盖最新摘要为
`b5ddaaf5eaa6fabaec7b47d6ffe905f6bf9a63e08e74df894d562b0fb74e23b8`。
新隔离候选继续仅额外包含 R-04 五行提案，十一份产品摘要为
`5818528d6f825a500382d54d2e1a9a8fd45c92c906510eaffedcabf775a52258`。
Web 3008 为完整基线加 `+r08-5818528d6f82`，API/Worker 仍为裸基线。
R-04 未进入主树，不将隔离候选的通过描述为主树已应用该例外。

下表证据在仓库外保留，前轮失败与 G/H 记录仍有效。

| ID  | 证据组 / 文件                                                  | 实际结果                                                                                                                                  |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| I01 | `m5-a11y-ZzWN1n/real-reauth-1788834485151/results.json`        | 1 passed；真实等待、refresh 200、导出 403/精确码、拒绝无误写、UI 重新登录 200、next 回跳；重试 202，新增任务 ID 与响应一致                |
| I02 | `m5-feedback-tTNN3Y/ci-fast-1788835228399.log`                 | 新隔离候选完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed / 120 deselected、mypy 181、coordination 118 |
| I03 | `m5-feedback-tTNN3Y/feedback-final-1788835479745/results.json` | 50 passed；七模块成败矩阵、真实与 mock 边界见下表，截图已抽查，24 项 Provider/Run/Persona 场景的 Toast axe 全部通过                       |
| I04 | `m5-feedback-tTNN3Y/cleanup-1788835711599.json`                | 6 个合成账号及关联数据清理；91 表总行数 0、Redis 键 0、临时认证不存在、注册额度恢复 5                                                     |

I01 使用隔离 API 已有配置允许的 60 秒 recent-auth 窗口，按 HTTP Date 等待超过窗口，
没有伪造 403、修改数据库会话时间或使用浏览器假时钟。refresh 成功后仍被拒绝，创建列表
与初始 ID 集合完全一致；从主区“重新登录”链接进入登录页，正常提交并回到 `/app/data`，
重试返回 202，真实列表仅增加响应中的 job ID。启动器 finally 恢复 600 秒并等待 readiness。
13 个恶意/空 next 拒绝及优先级沿用 H05，相关组件也在 I02 全量 Web 测试中通过。
I01 归属于前轮 `+r04-005b067ecb21` 构建；后续唯一产品变更为反馈颜色，不伪称认证链路
已在 3008 再次实跑，也不把 60 秒测试表述为实际等待了默认的 600 秒。

| 模块             | 成功                                                                          | 失败                                      | 本轮视口 / 主题                 |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| 自学、考试、复习 | 真实本地提交与同步，精确成功 Toast 和 inline                                  | 同步 503 注入，错误可见、无假成功         | 各 1440/375/320，浅色，共 18 项 |
| 附件             | mock init/content/complete；校方法、同一 ID、字节、hash、版本及 verified 反馈 | mock 关闭态 404/精确码，无验证成功文案    | 1440/375/320，浅色，共 6 项     |
| Provider         | mock 发现 2 模型；取消确认零请求，确认后一次请求                              | mock DNS_UNRESOLVABLE，精确码与请求编号   | 1440/320 × 浅/深，共 8 项       |
| Run              | mock 预检与入队，校发送内容和确认；清除预检 Toast 后核入队反馈                | mock 提交 503，保留精确错误反馈           | 1440/320 × 浅/深，共 8 项       |
| Persona          | 真实 PUT/GET，exam 值、版本增加及选中状态一致                                 | mock PUT 503，原 value/version 与画像不变 | 1440/320 × 浅/深，共 8 项       |
| 通用成功反馈     | 真实同步 Toast                                                                | 不适用                                    | 两主题各覆盖 1440/320，共 2 项  |

I03 的 50 项均在同一次最终运行通过。A-03 本地反馈合同已补齐；AI 请求全部在浏览器终止，
没有向真实 Provider 发起请求，附件 verified 不等于真实 scanner 验收，Run 不等于实际推理。
前三本地模块与附件固定浅色，不能宣称七模块全双主题或真实读屏通过。I02 默认排除 integration，
其中新增 11 项排除来自上轮导入边界用例，显式 integration 证据仍引用 H03。

失败历史保留在 `m5-a11y-ZzWN1n`：`real-reauth-1788834196645` 因两个重新登录链接
触发 strict mode；`real-reauth-1788834308144` 使用单调计时等待后仍为 202，不能算过期通过。
改用实际 HTTP Date 判断窗口并保留会话年龄观察后 I01 通过，不把第二轮失败归为产品漏洞。
`feedback-matrix-1788834681421` 为 34 passed / 4 failed：两项非合同 Provider 错误码
预期不符、两项窄屏 Run 未切目录。`feedback-contracts-final-1788834998926` 为 8 passed /
7 failed：5 项浅色错误 Toast 对比度失败、2 项 Run 区域标签错误。修正定位器、补强附件和
Persona 断言并修复 R-08 后，按显式主题执行 I03；失败记录没有删除或改写。

A-03 与 A-07 是补充项，原 58 项计数仍为 **44 passed、1 failed、4 partial、3 blocked、
6 out_of_scope**。R-04 主树例外、13.1 侧栏、真实读屏/邮件和生产前置继续保留，M5 未通过。
本轮没有 commit、push、merge、部署或真实外呼；空本地预览保留，最终范围检查另见下文。

最终范围检查见 `m5-feedback-tTNN3Y/final-manifest-1788835915993.json`：29 份文件格式、
88 个本地链接、58 个唯一 ID/状态计数与原范围内 26 项映射通过；两份新增浏览器测试
严格 tsc、Gitleaks、diff 空白、候选字节及三个保护摘要校验通过，暂存区为空。
待交付测试摘要为 `ef0f8535533f6671da8d4038cc56936064faa8153e13fea72aca25e16de856bc`。
清理后 Web/API readiness 为 200 且版本一致。工具只读审查已核对一行 CSS 与 50 项测试
范围，无新增可操作代码问题；正式 actor/review task 仍 pending，不补造旧角色证明或
任务 accepted 事件，M5 状态不因工具辅助审查而升级。

本轮 Run validator 通过，图索引为 8 节点。独立文档复核核对 I01/I03/I04 结果与边界后，
主线已明确前轮 G10 42 项组合的归属，并将认证结论限定为“重试后新增任务 ID 与响应一致”，
不声称重试复用了旧任务 ID；其他数字、主题范围和 mock 边界一致。

## M5 安全与本地回滚补齐（2026-09-08）

所有者回复“继续 M5 完善”，本轮扩充 `test_knowledge_space_acceptance.py` 并复用现有
Workspace、Knowledge 和迁移集成测试；没有新增产品修改。后端及迁移仍归属于完整基线
`bac2a4371ce6a12d6c3e9a6124104d121b0f8807`，主树十份产品覆盖摘要仍为
`b5ddaaf5eaa6fabaec7b47d6ffe905f6bf9a63e08e74df894d562b0fb74e23b8`。
新测试文件 SHA-256 为 `80e396e6ca3c695b0c85fc8ea737b02d43f54c6b453f8cc4e0ae446f1a778004`。

本轮证据保存在仓库外 `m5-security-0PwgiI`，执行器为 `m5-security-rollback.mjs`。
使用已有本地镜像启动独占 PostgreSQL 17.10、Redis 8.6.1 与临时 API；数据目录使用 tmpfs。
测试显式执行 `pytest -o addopts= -m integration`，不以默认排除 integration 的 I02 替代。

| ID  | 证据文件 / 检查                                                                         | 实际结果                                                                                                           |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| J01 | `security-integration.xml`、`security-integration.log`                                  | 9 passed / 1 deselected；Workspace 3、Knowledge core 2、AI acceptance 1、迁移约束 3                                |
| J02 | `performance.json`                                                                      | 真实 HTTP 认证列表 200 请求、并发 10；P50 52.80 ms、P95 161.03 ms、P99 241.72 ms，满足现有 P95 < 500 ms smoke 门槛 |
| J03 | `empty-head.json`、`empty-downgraded.json`、`empty-reupgraded.json`、`schema-drift.log` | 空库 head → 0035 → head 成功；迁移头恢复 `0040_merge_gate2_heads`，表行数恢复一致，alembic check 无新增操作        |
| J04 | `backup.json`、`restore.log`、`populated-before.json`、`restored.json`                  | custom 备份恢复到独立空库；92 张表（含 alembic_version）、229 行的逐表行数和内容摘要一致，三组 scope 孤儿均为 0    |
| J05 | `populated-downgrade.log`、`populated-after-rejection.json`、`default-off.log`          | 有 acceptance receipt 时降级按预期退出 1，命中 V20-09 停止线；全部数据摘要及迁移头不变，7 项敏感能力默认关闭       |
| J06 | `result.json`                                                                           | 全流程退出 0；14 个合成账号及关联数据随两独占容器/tmpfs 删除，容器已不存在；临时 API 停止，原始备份仅在内存中使用  |

J01 的权限范围包括跨 Workspace 404、Owner/成员互不可读 Private Space、Viewer/Editor 权限
变化、成员层级与实时撤权、知识读取与搜索 scope。新增 AI 断言确认另一账号访问已有/随机 Draft
均返回 `404 / RESOURCE_NOT_FOUND`，且没有接受写入；这是所列资源的受控多账号验证，不能
表述为所有资源 IDOR 全覆盖。哈希规范化单测因 integration 筛选被排除，保留其 I02 旧证据。

AI 夹具直接落库 succeeded Run、pending Draft 与 Candidate，没有启动 AI Worker 或调用
Provider。接受前与每次拒绝/故障后，通过新数据库 session 回读 Draft 的 pending/version 1/
未决定状态，并确认 citation、receipt、接受 audit 为零。SQLAlchemy `after_cursor_execute`
分别在 citation INSERT、receipt INSERT、Draft UPDATE、audit INSERT 实际执行后抛错，四次
HTTP 500 后均无部分写入。同一幂等 key 随后并发重试，得到相同响应，数据库恰好一个 citation、
receipt 和接受 audit，三者 operation/target ID 一致，Draft 仅变为 version 2。旧有异 payload
409 和 stale excerpt 409 检查同次通过。此证据验证接受事务，不代表真实模型生成质量或外呼。

J02 在独占本地 API、回环网络和一用户/一 Workspace 夹具下执行现有 `api_smoke.py`。
它只度量认证 Workspace 列表，不包含完整容量场景、生产网络、所有核心 API 或相对基线的
P95 回归 < 20% 比较；ISSUE-007 的线上复现仍未完成。

J04 三组引用检查为 Citation → Excerpt、Excerpt → Resource、Receipt → Draft，均含
workspace scope。J05 的非零是预期保护行为，精确错误为
`V20-09 downgrade stopped: knowledge_acceptance_receipts is not empty`。本轮没有复测
所有其他迁移的非空停止点，也没有切换生产镜像、访问生产备份或证明生产恢复时长。
7 项默认关闭分别为 Knowledge API、Shared Write、AI Acceptance、Deletion、Attachment ingest、
Local Worker、scanner；测试 fixture 临时开启的能力不修改任何运行中的原栈配置。

首轮 `m5-security-L2Xat9` 在空库成功降级后，快照脚本仍查询已删除的知识表而退出 1；
两个独占容器已在 finally 清理。按当前表集合执行孤儿检查后完整重跑 J01–J06 通过。
新增测试首轮 Ruff 提示循环回调变量需绑定，已显式绑定并通过 lint/format；没有产品失败。

A-10、A-11 继续 partial：已补本地安全、性能 smoke、迁移和恢复证据，完整 IDOR/容量、
生产镜像兼容与备份前置仍缺。原 58 项仍为 **44 passed、1 failed、4 partial、3 blocked、
6 out_of_scope**。R-04 主树例外、侧栏、真实读屏/邮件与生产前置保留，M5 未通过、M6 未授权。
本轮无 commit、push、merge、部署或真实外呼；既有产品 CI 与 50 项反馈未重复运行。

最终复核见同目录 `final-manifest.json`：30 份交付文件格式（28 份 Prettier、2 份 Python
Ruff）、90 个本地链接、58 个唯一 ID/计数、原范围内 26 项映射、Gitleaks、diff 空白及
产品/测试候选字节一致均通过；三个 T-04 保护摘要不变，暂存区为空。最新待交付测试摘要为
`7eac51137a0b2ddbcea4c7781dc66eb432a76b8f4aebf2af3227374b51d3565c`。
Run validator 通过，图索引 9 节点；正式 actor/review task 仍 pending。本轮未派发子代理，
未新增正式任务 acceptance；以上为主线实际观察结果。

## M5 完整验收续推（2026-09-08）

所有者要求“继续工作，保证 M5 完整通过”。本轮继续账号生命周期、内容隔离和容量检查，
再次尝试真实读屏；产品和测试源码未改，原完整基线、产品覆盖及测试摘要不变。以下证据
保存在仓库外 `m5-final-backend-lAg6J7`，执行器为同目录 `runner.mjs`。

| ID  | 证据文件 / 范围                                                     | 实际结果                                                                                                                   |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| K01 | 八份 `test_*_integration.py.xml`、同名 `.log`、`test-manifest.json` | 10 passed；账号删除 3、所有权转移 1、Phase 4 猜 ID 隔离 1、内容 1、Planning 1、Execution 1、内容同步 1、Portability 1      |
| K02 | `capacity.json`、`capacity.log`                                     | 原容量脚本全数据集计数一致，6 组查询各 30 样本均满足 P95 < 500 ms，最慢 P95 12.30 ms；10,000 个附件样本生成成功            |
| K03 | `result.json`、`speech-cleanup.json`                                | 全流程退出 0，两独占容器、匿名数据库卷和附件样本删除；另一个读屏测试账号清理，91 业务表总行数/Redis 键均 0，注册额度仍为 5 |

K01 显式执行 integration，文件之间只清空本轮独占 Redis。账号删除覆盖立即撤权、宽限取消、
撤销待接受邀请、唯一 Owner 阻止删除，以及到期后去标识化、附件/凭据/session 清理。
到期由本地夹具调整 delete_after，附件使用 CleanAttachmentScanner 替身，不代表实际等待
宽限期或真实恶意软件扫描。所有权覆盖原子转移和最后一个 Owner 保护。Phase 4 验证个人
Exam/Track/Paper 不进入其他成员列表/bootstrap，猜 ID Push 拒绝且不泄露受害内容；另含
Note、Goal、Task 与导出 scope。所列资源通过不等于所有 API 的 IDOR 全覆盖。

K02 使用未修改的 `scripts/performance/capacity_profile.py`：100,000 Task、1,000,000
Audit Event、25,000 Note、25,000 Resource、10,000 Attachment、5,000 Paper、100,000
AI Run，全部计数一致。附件样本合计 380,000 字节；六组查询 P95 为 Task 2.980、Audit
1.774、Note 12.300、Attachment 0.702、Paper 5.220、AI Run 2.568 ms。生成耗时 58.477 秒，
数据库 622,092,815 字节，查询阶段观察到 1 个连接。AI 和附件均为夹具，无 Provider/scanner
请求。报告明确 `production_equivalent_approved=false`；不能替代生产等价硬件、流量/
饱和度及核心 HTTP API 相对回归门。

真实读屏再次启动签名有效的 NVDA 2026.2 便携版，并建立本地 Chrome 测试标签和一个
合成账号。浏览器工具识别到本地 URL，已提交登录但未取得最终登录/播报成功证据。
原生 Windows 工具读取 Chrome 窗口时报告无法可靠确认当前浏览器 URL，停止本轮 Computer
Use；未绕过限制或把 DOM 当语音证据。NVDA 按 PID/路径核验后停止，合成账号及服务端
认证已清理；未声称清除了用户浏览器全部存储。清理脚本首轮退出 1，移除无用异步生成器
求和行后完成，未修改产品。侧栏键盘和清空本地数据 UI 尚未执行，A-12 仅后端 partial。

本轮已具体询问 R-04 五行主树例外、生产/Provider 目标与受控请求、收件箱及验收邮件
授权，记录时均未收到答案。保护约束与外部操作边界继续有效；A-10/A-11/A-12 为 partial，
原 58 项仍 44 passed、1 failed、4 partial、3 blocked、6 out_of_scope。M5 未通过，M6
未授权；无 commit、push、merge、部署或真实邮件/Provider 请求。

## 本地 UI 与权限缺口续验（2026-09-08）

本轮按所有者四项要求继续本地验收、处理两个待决点、准备外部验收与固定候选。
后端仍为完整基线 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`，仅扩充 Evidence
集成测试；新增账号生命周期浏览器测试并登记到 Playwright 配置。真实外部环境条件
和授权尚未收到，不请求 Provider、不发送邮件，不把浏览器 DOM 当读屏播报。

| ID  | 仓库外证据                                                                           | 实际结果                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L01 | `m5-permissions-IIFPAe/result.json`、17 份 JUnit XML                                 | 22 passed；邀请、记忆、考试、自学、研究、协作、Engagement、Evidence、相关同步、Yjs、AI Provider/routing、附件和 Local Worker                                                        |
| L02 | `m5-permissions-Iqqkrl/result.json`、9 份 JUnit XML                                  | 16 passed；Audit、用户设置、学习循环、Assessment、sync Push/ledger 和 Workbench                                                                                                     |
| L03 | `m5-permissions-hBgJbI/result.json`、Evidence XML                                    | 扩充后的 Evidence 1 passed；六次跨租户 Evidence/Verification/Task 写入均 404，任务和 Verification 版本不变                                                                          |
| L04 | `m5-final-local-Xe5sM6/ci-fast.log`、`browser-1788842236413/results.json`            | 不含 R-04 的旧候选完整 CI 八门退出 0；浏览器组合 4 passed / 1 failed，失败为清空后的 Bootstrap 恢复未显示笔记                                                                       |
| L05 | `m5-final-local-Xe5sM6/diagnostic-1788842713712/results.json`                        | 1 failed；受控延迟真实 Bootstrap 响应，切换到 Records 后释放，IDB 已有 clean Note，页面 20 秒仍无笔记                                                                               |
| L06 | `m5-bootstrap-final-FdYjdE/ci-fast.log`                                              | R-09 新候选完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed / 120 deselected、mypy 181、coordination 118；三份本轮浏览器测试独立严格 tsc 另行通过 |
| L07 | `m5-bootstrap-final-FdYjdE/browser-1788843310486/results.json`                       | 5 passed；全局键盘、确认词、双主题桌面侧栏、受控 Bootstrap 恢复及所有权/账号生命周期                                                                                                |
| L08 | `m5-bootstrap-final-FdYjdE/browser-1788843357597/results.json`                       | 9 passed；捕获、全局 Vault、Exam、Planning、Note 安全外链、Records、Review、Self-study、Today；真实本地数据与既有断点检查                                                           |
| L09 | `m5-bootstrap-final-FdYjdE/cleanup-1788843265103.json`、`cleanup-1788843508588.json` | 两轮分别清理 5 与 3 个合成账号及数据；各次 91 张业务表总行数为 0、独占 Redis 键为 0，注册额度为 5；候选认证目录及主树诊断认证均不存在                                               |

L01/L02 是 26 文件、38 个不同测试；L03 是其中 Evidence 扩充后的重跑，不累加为 39 个
不同测试。三组运行的独占 PostgreSQL/Redis 容器与卷均已清理。AI Provider 是 fake adapter，
scanner 是 loopback 协议夹具；这些测试只验证权限、传输和状态约束，不代表真实外呼或扫描。
已有 J/K 证据继续保留，不宣称所有 API 的 IDOR 全覆盖或生产等价容量通过。

L04 的桌面侧栏、全局快捷键、清空确认词和账号生命周期通过。生命周期包含真实 token
接受页面、URL fragment 清除、唯一 Owner 阻止删除、取消转移无写入、Owner 转为 Admin、
旧 Owner 再次转移 403、删除后会话 401、重新登录受限 403，以及取消删除后恢复 200。
测试只允许 loopback 和 `m5-*@example.com` 合成账号执行，不等待真实宽限期。

### R-09：Bootstrap 完成后共享页面未刷新

Vault 先发布 unlocked，AppShell 依据 phase 更换页面实例。旧 controller 继续 Bootstrap，
落库后只刷新自身 state；新 Records 已读到空库，因此既没有数据丢失，也不会自动重读。
L05 使用真实响应，只控制其交付时机，没有伪造 Note；这证明当前竞态，不能倒推 G01–G07
所有历史失败都来自同一原因。此前独立清空测试通过和 L04 组合失败均保留。

修复在 Today、Records、Planning、Review、Exam、Self-study（含研究/协作）及 Sync 的
全部 Bootstrap chunk 成功后调用现有 `markChanged()`；全局操作工具补齐 Bootstrap/同步
完成通知。复用 Vault revision 刷新机制，没有改变解锁权限、加密、bootstrap wire 或迁移。
新增测试保留“清空前非空、清空后全空、服务器不变、恢复 clean、页面重新可见”的断言。

诊断首轮 `diagnostic-1788842531654` 因候选 CLI 与主树配置混用两份 Playwright 依赖而
退出，未执行产品验收；统一 CLI/cwd 后得到 L05。该工具错误不作为产品失败依据。

### 两个待决点

| 决策          | 可确认的具体方案                                                                                        | 当前约束与影响                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-04 保护例外 | 建议批准仅删除 AppShell 画像入口五行 `aria-label`，让可见文案形成 accessible name；不纳入 T-04 侧栏施工 | H01/H02 已验证隔离补丁；主树单点例外尚未批准，13.3 保持 failed。批准后还需针对包含 R-09 的同一候选复验                                       |
| 10.2 邀请范围 | 建议本版保留现有 token 邀请，完整 URL 展示/复制按 O1 延后；明确 10.2 保持 partial                       | 接受页面已实测，但测试自行拼接 URL 不能证明产品生成了完整链接。若选择本版纳入 O1，需实施并验生成/复制、fragment 消费及登录回跳，再固定新候选 |

处理状态为“方案与影响已明确，等待所有者决定”。未把尚未回复的问题视为同意或把
partial 改成 passed。原 58 个 ID 和分母保留；D-06 不因桌面侧栏通过而扩张到移动开闭焦点。

### 外部验收批次

| 项目     | 启动所需具体输入                                                                | 本批验收范围                                                            |
| -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Provider | 已配置的受控环境引用、可用模型、请求次数/费用上限及外呼授权；凭据只在环境中提供 | 真实连接、一次成功和受控失败、结果归属/脱敏/预算；不自动重放计费请求    |
| 邮件     | 发信环境、受控收件箱引用、允许的邮件类型/数量与发信授权                         | 实际到达、链接目标、接受/过期/重放及账号边界；不以 DNS 或 mock 代替投递 |
| 读屏     | 可可靠定位的测试浏览器窗口、可用读屏设备和受控测试账号                          | 键盘焦点、成功与失败播报、Toast/Inline/通知去重；保留实际播报证据       |

本轮浏览器工具能读取 Logion 标签，但原生窗口枚举未返回可可靠定位的对应窗口；没有
启动 NVDA 或取得播报。临时浏览器页已关闭。以上三项须在条件齐备后集中执行，当前均未通过。

### 最终本地候选与复核

固定候选为完整基线加十四份产品覆盖，产品 SHA-256 为
`2a06c52e4b93f551668625093bc4b4b08b6dcfd6b01793a856fd1e0959c07095`；三十份源码/测试
覆盖摘要为 `f0cbbeb3479d15aa05f65ea1c4cab788c81b274a9b32e227a70569066e73accf`。
逐文件清单位于 `m5-bootstrap-final-FdYjdE/manifest.json`。Web 运行版本为完整基线加
`+m5-final-2a06c52e4b93`，API/Worker 为裸基线。它是未提交的本地候选，不是发布 SHA。
R-04 未纳入；三个 T-04 保护文件的既有改动也未纳入，源文件保持原摘要。

L06/L07/L08 绑定同一候选。L06 的默认 Python 命令排除 120 项 integration，不能替代
L01–L03 的显式执行。L08 中 Exam 的“mock-exam”是产品模拟考试流程；没有真实 Provider
外呼。双主题桌面侧栏和窄屏 Note 截图已查看；自动化焦点、axe 与截图均不替代真实读屏。

新候选首轮 `browser-1788843180975` 为 4 passed / 1 failed：R-09 已通过，生命周期
尚未进入业务动作，因累计注册达到上限而收到 429。L09 第一轮清理后，启动器立即注册
又遇到 API 重启期间代理 500；增加 readiness/版本检查后才执行 L07，两次环境失败保留。
没有放宽产品限流，未把失败运行覆盖成通过。L04/L05 的产品失败也继续保留。

主线复核八份本轮产品改动、浏览器断言及 Evidence 负测，未发现新增 P0/P1；未派发
新子代理，正式只读 review task 与 actor 仍 pending，不将本次复核写成旧模型证明或
正式 accepted。完整范围、文件摘要、保护文件、清单映射和秘密检查见同目录
`final-check.json`；本地 Run 校验另行执行。

最终范围实收：38 份文件格式、94 个本地链接、58 个唯一 ID/计数和原范围内 26 项映射
通过；Gitleaks、diff 空白、源码/候选字节、三个保护摘要及空暂存区检查通过。Run validator
通过（10 节点，正式 review task 仍 pending）；清理后 Web/API readiness 均 200 且身份正确。

### M5 结论与 M6 条件

**M5 未通过。** 当前可执行的本地 UI/权限补验已完成，R-09 已修复并复验，A-12 本地
passed；原 58 项仍为 44 passed、1 failed、4 partial、3 blocked、6 out_of_scope。
剩余事项包括 D-15/R-04、D-16/邀请范围、真实 Provider/邮件/读屏和清单中明确保留的
生产环境/容量证据。13.1 的桌面部分已验，移动开闭焦点仍按 D-06 延后；不得改变分母
或把完整链接、外呼、播报缺失当作通过。两个决定生效后，任何源码变化都需重新固定候选。

**M6 未授权，尚不可发布。** 除 M5 达到生效标准，还须具备获授权的最终提交、同 SHA
CI 与 API/Worker/Web/Backup 四个不可变镜像及有效 manifest；核验生产身份和开关；
保存上一 manifest/回滚镜像，完成部署前备份、独立恢复及兼容性/回滚验证；完成真实邮件、
跨设备同步、告警和资源检查及至少 24 小时观察，并获得当前发布批准。已有 J/K 本地恢复
和容量证据不能替代上述生产门。没有 commit、push、merge、部署或敏感能力启用。

## R-04 例外落地与邀请范围收口（2026-09-08，最新）

所有者在两个具体建议后回复“采取建议”：D-15 仅批准删除 AppShell 画像入口五行
`aria-label`，D-16 批准完整邀请 URL 展示/复制延后至 O1，本版保留 token 接受及
10.2 partial。原问题已记录 resolution，前文未批准/待决定和失败结果为历史，不再代表
当前决策状态。该批准没有扩张到 T-04 其他改动、真实外呼、邮件、生产或 Git 交付。

主树只删除这五行，前后字节与已批准补丁比对通过。可见的画像名称和说明直接形成
accessible name，装饰图标仍 aria-hidden；不改变焦点、导航和权限。原
`authenticated-accessibility.spec.ts` 和 globals.css 未改；四项 R-04 回归纳入现有
`authenticated-shell.spec.ts`，覆盖浅/深主题及 1440/320 宽度。

最终候选基线仍为 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`，远端当前开发分支实读
同 SHA。十五份产品覆盖摘要为
`3330b538bcc67b48fca74973ef78176cea6ad0bbd1725ca2d59de8704ca7503e`，三十一份源码/
测试候选摘要为 `21317e403e21b89195f350dcbe989588e8940f214cf1816ccee1dc2b6cda7168`。
Web 实际版本为完整基线加 `+m5-r04-3330b538bcc6`，API/Worker 仍为裸基线；没有最终提交。

**AppShell 的归因例外必须保留：** 主树包含受保护的 T-04 既有改动，测试候选只包含
Git 基线加获批五行删除。其余三十份源码/测试与主树字节一致；不声称整份 AppShell 与
主树一致，也不得用整文件暂存把 T-04 既有改动带入后续 Git 交付。完整清单及主树前后
摘要见仓库外 `m5-r04-approved-ypDzxy/manifest.json`。

| ID     | 仓库外证据（均位于上述目录）         | 实际结果                                                                                                                                                                                                |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R04-01 | `ci-fast.log`                        | 完整 CI 八门退出 0：Web 411、offline 74、contracts 13、mobile 4、Python 606 passed / 120 deselected、mypy 181、coordination 118，production build 与合同生成检查通过；新增浏览器 spec 严格 tsc 另行通过 |
| R04-02 | `browser-1788850813519/results.json` | 同候选 9 passed：4 项 R-04 名称/axe/Tab/Enter，及全局快捷键、清空确认词、双主题桌面侧栏、R-09 受控恢复、所有权/账号删除恢复；四组画像入口截图已查看                                                     |
| R04-03 | `cleanup-1788850899643.json`         | 2 个合成账号及关联数据清理，91 张业务表行数和独占 Redis 键均零，注册额度为 5；临时认证不存在，清理后 Web/API 健康及版本正确                                                                             |

本轮没有产品检查失败；文档补丁首次因表格空格不匹配未应用，修正后应用成功。
Run 首次校验指出 resolved 问题缺 resolution，补充所有者批准说明后通过；没有把这两次
工具/记录错误计为产品失败或通过。正式 actor/review task 仍 pending，不补造模型证明
或正式 accepted。L06/L08 等旧候选证据继续按原身份保留，本轮未重复后端 integration。

最终范围复核由 `m5-r04-approved-check.mjs` 输出 `final-check.json`，验证候选摘要、
五行授权差异、T-04 其余保护、清单计数与原范围内 26 项映射、格式、链接、秘密和暂存区。
主线审查获批五行改动与新增断言，未发现新增 P0/P1。没有 commit、push、merge 或部署。

当前 13.3 改为 passed，原 58 项为 **45 passed、0 failed、4 partial、3 blocked、
6 out_of_scope、0 not_run**。D-16 的 10.2 partial 是已批准延后，不再列为未决。
M5 仍未通过：真实 Provider/邮件/读屏与清单明确的生产环境和容量前置未完成；D-06
移动开闭焦点仍保留。M6 仍需同 SHA CI/镜像 manifest、生产身份、备份恢复/回滚、真实
运行和观察期及当前发布批准，具体条件沿用前节，不因本次两项决定自动通过。

## 计划续跑与剩余本地安全验收（2026-09-08）

所有者要求按计划连续推进，仅在必要决策时询问。本轮恢复 Run validator 通过，HEAD
仍为原完整基线；D-15/D-16 不重复请求批准。总表顶部、M5/REL-01 与 FOLLOWUP-M5
残留的旧当前摘要已修正，前文各轮历史结果保留。`do-plan` 本地入口已补齐；当前没有
可调用的 MCP 任务工具，未虚报 MCP 同步、旧模型证明或正式 review task accepted。

### SEC-01–SEC-04：本地验收与时间诊断

| ID     | 仓库外证据                                                              | 实际结果                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | `m5-remaining-security-FFOWLG/result.json`、六份 JUnit                  | 首轮 13 passed / 2 failed；Passkey 来源配置缺失收到 403，密码恢复过期用例收到 200；未掩盖失败。                                                                  |
| SEC-02 | `m5-remaining-security-VbtWgi/result.json`、`expiry-clock.json`         | 补 CI WebAuthn RP/来源配置后两文件 7 passed；此时未从重跑通过倒推原过期失败原因。                                                                                |
| SEC-03 | `m5-remaining-security-cyKfPt/result.json`、`expiry-clock-0.json`       | 过期用例五次独立数据库诊断为 4 passed / 1 failed；失败采样中，单调时钟前进 11.59 ms，墙钟回拨 7.839217 秒。                                                      |
| SEC-04 | `m5-remaining-security-q6GVy6/result.json`、六份 JUnit、`manifest.json` | 最终同批 15 passed：Growth 3、Identity 1、TOTP 1、Passkey 1、注册验证 3、密码恢复 6；1 个非 integration Passkey 夹具被筛选排除。四轮各两独占容器及其卷均已清理。 |

Growth 验证模板与分享的租户/角色隔离、最小分享字段、撤销和审计脱敏；Identity/TOTP/
Passkey 验证会话、设备与凭据撤销、来源和重放边界。注册验证和恢复验证真实数据库中
加密 Outbox、用途/账号边界、过期/重放与并发单赢家。邮件 provider 全程 disabled，
Passkey 使用软件凭据；不计为真实邮件到达、硬件认证器或完整 API IDOR 覆盖。

`test_expired_password_recovery_is_terminal_and_clears_payload` 原先按主机当前时刻减一秒
写入过期时间，随后服务重新取墙钟。SEC-03 证明测试期间时间回拨，检查时 token 重新
落在有效区间。本轮只在该测试用标准库 `patch` 固定服务时刻，保留 400、精确错误码、
token 撤销与 Outbox 密文/nonce 清空断言；生产时间与认证代码未改。测试修正不代表
解决主机时钟回拨，也不能反向认定首轮所有失败或旧浏览器失败都有相同根因。

最终产品摘要仍为 `3330b538bcc67b48fca74973ef78176cea6ad0bbd1725ca2d59de8704ca7503e`。
R04 的原三十一文件候选没有覆盖改写；新增密码恢复测试作为单独补充文件运行在同一
固定产品上，摘要与来源记录在 SEC-04 manifest。原完整 CI/浏览器按 R04 身份保留，
本轮没有重复宣称运行完整 CI；补充文件 Ruff lint/format 已通过。

### 下一批的具体输入与停止线

| 项目     | 进入条件                                             | 执行动作与边界                                                                                                                                              |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider | 受控环境引用、模型、外呼次数/费用上限与授权          | 真实发现成功、受控失败及一次合成内容生成，核对归属/脱敏/预算；建议最多 3 次外呼、生成 1 次、费用不超过人民币 1 元或等值，不自动重试。                       |
| 邮件     | 发信环境、受控收件箱引用、发信授权                   | 建议最多 5 封：注册有效/过期 2 封、恢复有效/过期 2 封、成功恢复自动安全通知 1 封；重放不另发。验证实际到达、发件人、链接和最终状态；O2 邀请邮件仍不在范围。 |
| 读屏     | 可用 NVDA/VoiceOver 操作设备和可可靠定位的浏览器窗口 | 验证真实成功/失败播报、焦点与通知去重。当前工具不提供原生应用控制，不启动 NVDA 后宣称完成，不用 DOM/axe 替代。                                              |
| 生产只读 | 明确目标环境引用和受控连接上下文                     | 核对 SHA/镜像/公开版本、ingest 实值、CSP、容量与时钟同步状态；启用开关和发布保持后续批准门。                                                                |

上述额度为具体建议，尚未获得外呼/发信授权。凭据仅在受控环境中提供，不写入仓库、
计划或 Run。新发现的主机时钟异常须在真实时间边界和生产验收前核对同步/漂移情况；
本轮没有调整主机时钟、NTP 或生产配置。

**M5 仍未通过；M6 仍未授权。** 原清单继续为 45 passed / 0 failed / 4 partial /
3 blocked / 6 out_of_scope，补充测试不增加原 58 项分母或通过数。真实 Provider、邮件、
读屏及生产身份/容量证据仍缺；D-06/D-16 的延后范围不再作为重复审批项。M6 继续要求
获授权的最终提交、同 SHA CI 与四镜像 manifest、生产身份、备份恢复/回滚、真实邮件/
跨设备同步、告警资源和至少 24 小时观察及当前发布批准。无 commit、push、merge 或部署。

最终复核实际通过：原 39 文件格式/秘密/范围检查，加补充测试 Ruff 与秘密扫描、计划
格式；98 个报告本地链接与 3 个计划链接、58 唯一 ID/计数、原范围内 26 项映射、保护
文件和空暂存区均通过。远端当前分支仍为完整 base，Web/API 健康及身份正确；Run
validator 为 13 节点、1 event，正式 review task 保持 pending。

包含补充测试的 32 文件交付选择摘要为
`a0d58ef7aa162a3b84887dfaca85f86c1feaee359359cf01642e9a494fd46e9c`；补充文件 SHA-256
为 `ffd7d50882f17f20926644494b1d3be58267285e97e66eae87476624e1252d55`。逐文件清单
和最终复核位于 SEC-04 目录的 `delivery-manifest.json`、`review-check.json`。原 R04
快照及复核文件摘要保留，AppShell 仍只选择获批五行删除，未纳入 T-04 其他既有修改。

## 真实 Provider 与邮件环境核验（2026-09-08，最新）

所有者提供官方兼容入口及凭据，允许浏览器查看发信配置，并在最多五封邮件的具体问题后
提供受控收件箱。本轮按既定三次外呼、其中生成一次、人民币一元上限推进；邮件额度
保留为五封，实际发送零封。入口、密钥、发件人和收件人不进入仓库或 Run。D-15/D-16
继续有效；Git、部署、生产开关及网络权限变更没有获批。

### R-10：真实 TLS 路径中的 SNI 类型错误

两份 AI adapter 将 `sni_hostname` 设置为 bytes，当前 AnyIO 在 TLS 握手中对主机名
执行字符串编码，因而抛出 `AttributeError`。旧 MockTransport 测试不进入真实 TLS，
且错误地断言 bytes，掩盖了兼容性缺口。本轮只将发现和生成两处 SNI 改为字符串，
同步两条断言；没有改 DNS 公网限制、固定 IP、Host、证书验证、重定向或重试策略。

新增 `test_ai_provider_tls.py` 使用临时证书和本地 HTTPS 服务，仅在测试中重定向
底层 socket，保留 HTTPX/AnyIO/TLS 与证书验证。旧实现四项全部复现同一异常；修复后
发现/生成正常握手和错误域名证书拒绝四项通过，错误证书时 HTTP 请求未发送。

| ID     | 仓库外证据                                                              | 实际结果                                                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRV-01 | `m5-provider-live-Nf4Dgw`、`m5-provider-live-LDtZFX`                    | 初次启动缺 WebAuthn 来源配置，迁移失败且无外呼；修正启动配置后七项本地断言通过，真实发现进入 TLS 后异常。两轮独占数据库及 Redis 均已清理，失败保留。                                                                                                        |
| PRV-02 | `m5-provider-candidate-R3Ps8H/target.xml`                               | Provider、generation、DNS、真实本地 TLS 共 86 项通过；Ruff 通过。新增 TLS 旧实现四项失败已实际观察，不将其计为 Provider HTTP 响应。                                                                                                                         |
| PRV-03 | `m5-provider-live-Xm6ltc/provider.json`、`result.json`                  | 27 项通过；真实发现 200、三个模型、选定低成本模型回读；一次生成 200，输入 177 / 输出 332 tokens，应用按保守 CNY 价格向上取整记账 1 分。两个独占容器及卷清理通过。                                                                                           |
| PRV-04 | `m5-provider-candidate-R3Ps8H/ci-fast.log`、`ci-fast-1788855864966.log` | 首轮 Web 409 passed / 2 failed，失败在既有 Provider 加载等待；同文件 19 项独立通过。未改前端或超时，原样完整复跑八门通过：Web 411、offline 74、contracts 13、mobile 4、Python 610 passed / 120 deselected、mypy 181、coordination 118。首次超时根因未确定。 |

PRV-03 使用固定新候选、真实 API/默认适配器和合成输入，单模型、零重试、输出上限
2048 tokens。预算不足在外呼前返回 409；CSRF、viewer、跨 Workspace 分别 403/403/404
且不外呼。重复入队幂等，终态后 Worker 无重复执行；输出为 pending Draft，输入密文
清除，预算预留归零，usage 结算与 Run 一致。凭据加密、响应及十条审计脱敏、Provider
删除清除密文均已断言。记账值不是 Provider 账单对账结果。

首轮 TLS 建连也保守计入三次额度，故未再发真实无效凭据请求。错误码、DNS 拒绝与
证书失败的本地负测已通过，但不能替代真实上游失败及其 UI 流程。2.4 保持 partial，
58 项分母和计数不变；不以一次正常发现将所有 Provider 分支一并标为 passed。

### 邮件、读屏与线上只读结果

- 发信域及 DKIM/SPF/DMARC/MX 均显示验证通过；触发发信地址显示正常。
- 实例已绑定现有发信 RAM 角色。RAM 控制台主体重复加载失败，角色策略详情未核实。
- Workbench 请求新增 SSH 安全组白名单，已选择暂不开通。随后使用现有健康云助手
  执行一次未保存为可复用命令的只读诊断，退出 0；未修改安全组、角色、服务或配置。
- API/Worker 均已配置 DirectMail、发件人、RAM 角色和匹配的公开链接 Origin；主机
  `NTPSynchronized` 为 true。没有输出完整环境或临时云凭据，没有真实发信。
- 线上 API/Worker/backup 自报版本为 `91a02697e193c712c4e0aac7f9f4024daed93fe3`，
  Web 未设置运行版本且公开 `/health` 返回 `0.1.0`；无法绑定当前候选。
- 公开页面实收 CSP，含 nonce、strict-dynamic、connect-src self、object-src none、
  frame-ancestors none，以及 HSTS；这只是当前旧部署的响应头观察，不是新候选 CSP 验收。
- 浏览器接口可用，但原生应用列表为空，无法取得 NVDA/VoiceOver 实际播报证据。
  浏览器 AX/DOM、键盘及旧 axe 结果不替代读屏；A-04 继续 blocked。

邮件必要决定是选择同候选的隔离运行环境。建议使用独立数据库、Redis 和加密密钥，
复用受控发信身份，仅向已指定收件箱执行五封上限的既定流程；不接触生产业务数据，
不将凭据带回本地，不扩大网络权限。具体资源、访问入口和回收方式须在该环境明确后
核定。当前旧线上只能提供投递冒烟证据，不能替代最终候选邮件验收；不为测试而发布
候选或添加生产邀请/账号。

代码复核确认 `AliyunDirectMailTransport` 默认通过 `ecs_ram_role` 获取凭据，并关闭
IMDSv1。因此建议指定已授权的非生产 ECS 承载固定候选，使用独立数据和既有发信身份。
当前唯一已定位的实例运行生产业务；在其上启动临时验收栈仍属于服务器变更，需要明确
对应授权。受控收件箱和五封数量批准继续有效，不重复索取，也不增加长期访问密钥。

### 新候选与当前结论

新候选保持完整基线 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`，包含原 R04
快照、密码恢复补充测试及本轮五文件，共 37 份源码/测试，其中产品覆盖 17 份。
产品摘要 `9274e567144c8d5cdf6651cf39e1ddf525d2a88bccc7353f44d82a06c9f4f3f3`；
源码/测试摘要 `8ec16533d34d2e41bbe80bb4746c68f4be12c1f91bee3f88cff7da6c7ab81a36`。
逐文件清单在 PRV-04 目录 `manifest.json`。原 R04 候选与全部旧证据保留；AppShell
仍只取获批五行删除，主树其他 T-04 改动不纳入。新候选没有新提交。

预览已切换至该新候选。切换前核对旧栈 91 业务表总行数零、Redis 键零，按目录确认
旧进程归属后停止；Web/API 现均报告 base 加 `m5-provider-9274e567144c` 标识，健康
为 200，Web 代理未登录请求为 401。`preview-check.json` 位于 PRV-04 目录；随后
浏览器刷新本地登录页并查看截图，内容正常、无旧错误反馈及明显重叠。前端源码与
R04 候选一致，未重复原九项浏览器组合。后续进程归属以新候选运行状态为准，不能
使用旧预览的 PID 清理；预览保留供本地检查。

**M5 未通过，M6 未授权。** 真实 Provider 正常路径及本地 TLS 缺陷已闭环；真实上游
失败、同候选邮件与实际读屏、生产身份和容量/回滚前置仍有缺口。M6 仍要求获授权的
最终提交、同 SHA CI/四镜像 manifest、生产身份与 Web 版本标识、备份恢复/回滚、
真实邮件/跨设备同步、告警资源、至少 24 小时观察及当前发布批准。

最终范围复核实收：47 份交付文件格式、Python Ruff、秘密扫描和 diff 空白通过；
105 个本地链接、58 唯一 ID/状态合计和原范围内 26 项 passed 映射正确。37 份源码/
测试与当前候选逐字节一致，AppShell 按获批例外单独核对；17 份产品摘要正确，前端
与 R04 快照一致，另外两份 T-04 保护摘要不变。旧证据摘要保持，暂存区为空，临时
认证不存在，Web/API 再次健康且身份一致。复核结果位于仓库外
`m5-provider-final-review-PwCDYg/review-check.json`；Run 校验有效，正式 actor/review
task 仍 pending。本轮 adapter 修复复核未发现新增确定性产品问题，不将主线自检补写
为旧席位的独立正式终审。计划步骤 4 本轮完成，步骤 3 保留明确缺口，未归档。

## 本机邮件验收路径纠正（2026-09-08）

所有者指出本机候选和 ECS 旧版应分开验证。复核当前候选后确认，
`AliyunDirectMailTransport.__init__` 已支持 `CredentialClientProtocol` 注入，
`EmailDeliveryService` 也支持传入 transport。默认 ECS RAM 角色取凭据是生产装配
方式，不是邮件业务只能运行在 ECS 的限制。此前将非生产 ECS 作为唯一前置的说法
过窄，由本节纠正；旧检查结果和未发信事实保留，候选及产品源码没有变化。

本机可继续运行当前 API、独立数据库、加密 Outbox 与 Worker，使用短期 STS 凭据
执行当前签名及 HTTP 发送代码，邮件链接指向本机候选。这样可以验证本机业务链路
和真实 DirectMail 投递；通过测试注入的凭据不代表生产默认 IMDS 获取链路通过。
不需要先升级现有 ECS 或新增部署环境。

当前缺口收窄为受控凭据接入。可由所有者提供本机可用的短期发信凭据，或明确允许
将现有发信角色的短期凭据加密转交本机验收进程、仅内存使用。后者超出先前只读查看
配置的具体范围，尚未执行；不创建长期 AccessKey，不把秘密写入仓库、Run 或日志。
已指定收件箱和五封上限继续有效，实际发送仍为零。M5/M6 状态、清单计数及原预览
保持；本节是代码可行性复核，不增加已通过测试或真实投递计数。

## 本机真实邮件批次（2026-09-08，部分完成）

所有者已明确批准现有发信角色的短期 STS 凭据加密转交本机、仅内存用于最多五封受控
邮件，并允许自行操作浏览器完成必要配置。此前凭据接入待授权问题已解决；生产旧版
无需升级，本轮产品源码和固定候选不变。

| ID      | 仓库外证据                       | 实际结果                                                                                                                                                                 |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MAIL-01 | `m5-local-mail-QztaK3`           | 离线演练 58 项通过，五次 MockTransport 签名/发送、注册和恢复有效/过期、重放、会话撤销、安全通知及队列清理；退出零，独占容器及卷已清理。不计入真实发信额度。              |
| MAIL-02 | `m5-local-mail-9fJnfp/mail.json` | 云端现有角色 IMDSv2 读取退出零，仅输出公钥加密信封；本机解密、短期有效性及当前候选 API/Worker 身份通过。首封真实注册验证接受成功，sent Outbox 密文已清除；整批尚未完成。 |

云端发送详情显示首封验证邮件投递成功，接收服务器返回 `250 Send Mail OK`；它证明
接收邮件服务器接受，不替代收件箱中实际发件人、正文、链接和到达时间的核实。对应
token 在独占本地库设置为两天前过期后，当前 API 返回 400、错误码正确，token 未使用、
账号未验证；这是显式过期状态检查，不声称自然等待到期。

累计已用一次真实发信请求，剩余四次；实际收件确认零，等待受控邮箱登录。后续仅验
首封实收、注册有效、恢复过期/有效及安全通知，不重发首封、不重置累计额度。云凭据、
私钥、邮箱、原始链接和云端输出未写入仓库或 Run。云端读取与本机凭据注入分别归因，
不把本机发送通过解释为候选默认 ECS SDK 凭据装配已通过。

本批 13 项已执行断言通过后因邮箱未登录而停止；未运行五封完成的 finish 检查。
`mail.json` 的 passed 仅表示已执行断言通过，不能解释为整批完成；
`batch-status.json` 明确记录 partial、已用一封和剩余四封。凭据进程、临时 API、
独占数据库、Redis 及卷均已清理，正常候选预览保留。首封临时链接入口已经关闭；
恢复时先从实收邮件核对已保存的 token 摘要和 Origin，再用独占环境完成其余四封，
不重发首封、不重置累计上限。秘密和原始链接没有进入持久证据。

当前 58 项计数仍为 45 passed / 0 failed / 4 partial / 3 blocked / 6 out_of_scope；
11.1/11.2/11.4 在收件核验环节仍 blocked。M5 未通过：实际收件/链接、真实上游失败、
真实读屏及生产身份/容量等前置尚缺。M6 未授权：仍需最终提交、同 SHA CI/四镜像
manifest、生产身份、备份恢复/回滚、真实邮件/跨设备同步、至少 24 小时观察和当前发布批准。

本批最后范围复核通过：48 份文件格式、Python Ruff、秘密扫描和 diff 空白正常；108 个
本地链接、58 唯一 ID/计数和原范围 26 项映射正确。37 源码/测试、17 产品摘要及 T-04
保护与五行例外一致，暂存区为空，Web/API 健康且身份一致。仓库外记录位于
`m5-provider-final-review-5eS79p/review-check.json`；随后仅补本段及计划完成记录并定向
检查。Run 为 14 节点、1 event，actor 与正式 review task 仍 pending，无 Git 交付或部署。

## 首封邮件跳转反馈（2026-09-08）

用户报告点击确认邮箱后，停在邮箱服务包装的跳转地址并显示找不到网页。主线使用
标准 URI 解码和 SHA-256 核对用户提供的地址，原本机 Origin、验证路径及 token 摘要
与 MAIL-02 首封完全一致；用户实收反馈成立。本机浏览器邮箱仍处于登录页，发件人、
精确到达时间和收件箱 UI 尚未观察，不将用户反馈冒充自动浏览器实收观察。

报错地址尚未进入 Logion。旧临时本机入口已在用户点击前清理，即使直接使用原地址
也无法完成页面流程；提前结束环境是本次验收编排的问题。原 API 过期拒绝仍只作 API
证据，不能替代失效链接 UI 或正常注册成功。邮箱包装跳转的服务端失败原因尚未复现，
不能据此判断正式域名链接也失败；当前邮件模板原样使用本机 base URL 和 fragment token，
未包含第三方包装地址，产品代码未修改。

恢复安排调整为先确认本机收件箱可读，再启动环境、发信并保持到收件及页面核验结束。
本机链接仅从运行项目的电脑访问；核对后直接打开原链接可诊断本机业务，但不能将其
作为原邮件按钮跳转成功的证据。仓库外执行器锁定剩余四封，记前批一封与累计数，要求
实收后才能完成 action，拒绝重复计收和跳过前一 action；整批 passed 仅在 finish 后成立。

MAIL-03：`m5-local-mail-9fJnfp/owner-reported-receipt.json` 保存本次匹配事实，不含原始
链接或 token；`m5-local-mail-ycU16L` 为四封离线演练，53 项通过、退出零、独占资源已
清理。没有新增真实邮件、Provider 请求、产品变更或云端配置；清单门禁、候选摘要和
M5 未通过/M6 未授权状态保持。原“实收确认零”记录保留为用户反馈前的历史。

## 本机实收、R-11 与邮件续验（2026-09-08）

本机 QQ 邮箱已经登录。主线实际核实首封与第二封的来源、正文和到达时间；在第二封
临时服务仍运行时，原按钮跳转依然返回 QQ 包装地址的 404。因此它与首封入口提前
清理是两个独立问题，不能继续归因为未登录或换电脑打开。

直接打开第二封原链接又复现产品缺陷 R-11：Worker 输出 `#<token>`，共享
`consumeFragmentToken()` 只读取 `#token=...`，使注册与恢复链接被误判无效。
最小修复兼容两种格式，保留原正则、地址栏清除及 StrictMode 单次消费；没有改为
query 参数，也没有变更 Worker、认证 API、邀请范围或生产配置。

| ID      | 仓库外证据                                                             | 实际结果                                                                                                                                                |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R11-01  | `m5-r11-candidate-CJebu5/before.xml`、`after.xml`                      | 新增回归在旧实现 5 passed / 3 failed；修复后解析器 8 项和公开表单 4 项共 12 passed。覆盖裸 token、既有 named token、无效输入和 StrictMode；原失败保留。 |
| R11-02  | `m5-r11-candidate-CJebu5/manifest.json`、`preview-check.json`          | 新候选 18 产品 / 39 源码测试，定向构建及正常预览身份通过，91 业务表行数与 Redis 键均零。AppShell 仍只含 base 加五行例外，其他 T-04 改动保留。           |
| MAIL-04 | `m5-local-mail-zRvCiv/mail.json`、`ui-observation.json`、`result.json` | 本批续发四封且逐封核实，56 项检查通过、finish 完成并退出零；加首封累计 5/5，独占容器和卷、API 及仅内存凭据进程清理。                                    |

实收时间按邮箱显示记录，精度为分钟、时区为本机北京时间：两封注册分别为 17:29、
18:05，两封恢复为 18:22、18:23，安全通知为 18:25。五封的显示发件人均匹配已批准
地址，注册/恢复正文原链接与当前 action 的 Origin、路径、token 匹配；地址与原始
token 不进入仓库或 Run。未把邮箱显示时间当作精确端到端投递延迟。

第二封在新前端实际显示新密码和确认表单，两个恢复原链接也显示恢复表单，fragment
已清除。浏览器中未填写新密码或提交，成功/过期/重放和状态改变由受控 API 执行器
验收：注册 200、重放 400、随后登录 200；恢复显式过期 400、有效 200、重放 400、
所有旧会话已撤销，安全通知正文确认密码已更新和会话退出。首封的过期证据沿用
MAIL-02；没有声称自然等待 token 到期或真实最终 UI 提交通过。

本批 API/Worker 在 R-11 发现前从 PRV-04 候选启动，修复后 Web 来自 R11-02；R-11
只改前端共享解析器，后端字节一致性另作最终复核。该组合身份如实记录，不能把旧
候选标识改写为新候选全栈启动证据。正常预览已使用新候选，完整 CI 复跑后再次复核。

11.1、11.4 更新为 passed；11.2 更新为 partial，保留 QQ 原按钮 404 和提交后最终
界面缺口。58 项为 47 passed / 0 failed / 5 partial / 0 blocked / 6 out_of_scope。
邮件和 Provider 的本批额度均已用完，不追加请求。临时邮件入口在本批观察结束后
关闭，邮件中的测试 token 已使用或设为过期，不作为后续可复用登录入口。

M5 未通过；剩余邮件点击/最终 UI、真实读屏、真实上游失败与生产容量等条件仍明确
列出。M6 未授权，仍需获授权的最终提交、同 SHA CI/四镜像 manifest、生产身份、
备份恢复/回滚、真实邮件/跨设备同步、至少 24 小时观察和当前发布批准。

### R-11 最终候选门禁

候选 base 为本报告顶部完整 SHA，18 份产品覆盖摘要
`c92d51c279db6c8434f399f628b2c0f41cb1ab567c0d0fe06ca04d9a7706fd6a`，39 份源码/测试摘要
`ecdce872f700cb7b22da18ecaffcb6ac0d51ceb278808e2831bf4777fd13bb59`；未创建最终提交。

R11-03：`m5-r11-candidate-CJebu5/ci-fast.log` 首轮为 Web 414 passed / 2 failed，两项
Provider DNS 反馈测试在等待“测试并发现模型”按钮时失败；该文件独立 19 项通过，
见 `ai-recheck.xml`。未改变断言或扩大等待窗口，原样完整复跑 `ci-fast-retry.log` 和
`ci-result-retry.json` 退出零，八门全部通过：Web 416、offline 74、contracts 13、
mobile 4、Python 610 passed / 120 deselected、mypy 181 文件、coordination 118。
该等待不稳定性与前轮同类记录继续保留，根因未确定，不因复跑通过而抹除。

R11-04：`final-preview-check.json` 记录门禁后按预览配置重新构建、统一重启本地
Web/API/Worker；健康版本一致，91 张业务表总行数及 Redis 键均零，未登录 API 401。
邮件临时批次已经结束，常驻预览保留。真实表单读取观察属于 MAIL-04；此处不冒称
重复执行了旧浏览器组合或全部 58 项。

R11-05：`m5-r11-final-review-58h3DG/review-check.json` 最终范围复核通过：50 份文件
格式、Ruff、秘密扫描、diff 空白，111 个本地链接、58 唯一 ID/计数及原 26 项映射
正确；39 源码测试和 18 产品摘要一致，T-04 保护与五行例外准确，暂存区为空。
本批实际运行的 319 份 API/Worker 文件与 R-11 候选逐字节一致，后端摘要为
`136a32698cba61dda094af468f5618d7b96bb82cbe5654133863625ef9674a54`。
旧证据未覆盖，Web/API 健康且版本一致。随后只补完成记录并复核文档/Run；正式
actor/review task 仍 pending，没有补造模型证明或正式任务 accepted，也未执行 Git
提交、推送、合并或生产部署。计划保留 current，不归档为用户已验收。

## 本地表单与权限续验（2026-09-08）

所有者询问真实读屏的意义并要求继续未通过项。本轮沿用 R-11 的十八份产品覆盖，
不改产品代码；新增一份 Web 测试和扩充一份 API 集成测试，作为原三十九文件候选的
补充测试独立归因。Provider 三次、邮件五封额度均已用完，本批零外呼、零发信。

| ID     | 仓库外证据                                                                     | 实际结果                                                                                                       |
| ------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| LOC-01 | `m5-local-evidence-Mgdi6E/auth.xml`、`auth2.xml`                               | 初轮八项通过、九项新测试失败：测试未等 microtask 渲染。修正等待后十七项通过，其中新增邮件表单九项。            |
| LOC-02 | `m5-local-evidence-Mgdi6E/web.xml`、`web-result.json`、`typecheck-result.json` | 整包 Web 425 passed、typecheck 退出零；AI workbench 十九项通过，原两项等待超时本轮未复现，根因仍未确定。       |
| LOC-03 | `m5-provider-permission-local-ZaOn3L/manifest.json`、`result.json`、JUnit      | 两项 Provider 集成通过；新增九次权限拒绝、数据不变及 adapter 零调用断言。邮件 disabled，独占容器与卷清理通过。 |

邮件测试使用真实 `useFragmentToken`、公开认证适配层和表单，只替换 API 传输。覆盖 Worker
裸 fragment 在 StrictMode 下消费、提交体正确、pending 禁止再次点击、成功后清除输入与
返回登录入口、服务端拒绝保留输入并聚焦带请求编号的错误、无效成功响应、密码不一致和
两种第二因素。它们属于本地 jsdom 组件回归；不证明真实 token 到期或重放，也不替代
QQ 邮件按钮和浏览器最终提交。实际有效/过期/重放 API 证据继续引用 MAIL-04。

Provider 代码核对确认 workspace 与 Provider 数据分两阶段异步加载；本轮原样整包
运行通过，未测得足以解释旧超时的调度证据。没有改变产品、扩大等待时间或把旧失败
改成通过，稳定性风险继续保留。

### 权限覆盖归因

结构化读取 OpenAPI 得到 153 个 path、186 个 operation。其中 Provider/Model 共
八个 operation；这些数量是接口清点，不是权限用例覆盖率。

| Operation                     | 本轮及已有证据                                                            | 尚不代表什么                                    |
| ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| `ai_provider_list`            | 既有低权限 403、跨工作区 404，本轮随两项集成复跑通过                      | 不代表所有角色和撤权时序                        |
| `ai_provider_create`          | 新增低权限 403、跨工作区 404，Provider 总数保持一条                       | 不代表所有角色、并发或撤权时序                  |
| `ai_provider_update`          | 新增低权限、非成员路径、本人工作区替换他人 Provider ID 三种拒绝           | 不代表全 API 写入隔离                           |
| `ai_provider_delete`          | 同三种拒绝；合法 owner 后续修改、轮换、删除仍成功                         | 不代表所有删除闭包与撤权时序                    |
| `ai_provider_discover_models` | 新增本人工作区替换他人 Provider ID 404；所有拒绝后假 adapter 调用数零     | 不代表真实上游失败、真实 UI 外呼或账单验收      |
| 三个 `ai_model_*`             | 原路由/预算测试证据保留，本轮未补 Model 创建、修改的完整角色/对象替换矩阵 | 不由 Provider 拒绝自动认定 Model 三操作已全覆盖 |

修改/删除拒绝后回读 Provider，确认 version 为一、仍 enabled、未删除、原凭据可解密且
总数不变。未发现产品授权缺陷。A-10 保持 partial；下一批可从 Model 的创建/修改拒绝、
成员撤权后访问及各操作的归属矩阵继续，不把模块通过扩大为全部 186 个 operation 通过。

### 读屏与剩余门禁

真实读屏检验的是播报与连续操作：例如错误弹出后是否读出请求编号，成功状态是否
及时播报，弹窗关闭后焦点能否返回触发按钮。DOM、axe、键盘或 `role=status` 的断言
只能证明其中一层，不能代替 NVDA/VoiceOver 实际输出。

本轮 Computer Use 可列出 Chrome 窗口，但读取窗口时因无法可靠确认浏览器 URL
自动停止；没有启动 NVDA 或执行桌面输入，没有改用另一入口规避停止。实际播报
仍未验，需要恢复可靠设备控制或所有者在固定候选上协作操作。

清单 2.3 更正旧“真实外呼未验”为“真实 API 发现已验、同次真实 UI 网络观察未闭环”；
A-11 改引 R-11 三十九文件完整 CI，另列本批两份补充测试，不继续称旧三十七文件为
当前候选。状态仍 47 passed、0 failed、5 partial、0 blocked、6 out_of_scope。

M5 未通过：真实 Provider UI 正常/失败链路、QQ 点击与最终表单 UI、真实读屏及适用
生产/容量前置仍未闭环。邀请完整 URL 与移动项按 D-16/D-06 延后，不重启施工。
追加一次 Provider 失败请求的待决范围仍是无效合成凭据发现、零生成、无自动重试；
未收到追加批准。邮件下一批须先准备可用链接环境与浏览器操作，再申请明确额度。
M6 未授权：最终提交、同 SHA CI 与四镜像 manifest、生产身份、备份恢复/回滚、
真实邮件与跨设备同步、至少二十四小时观察及当前发布批准继续独立列为发布条件。

LOC-04：最终复核位于仓库外 `m5-local-evidence-review-GK6rtY/review-check.json`。
五十三份文件格式、Ruff/ESLint、秘密扫描、空暂存区、一百一十五个本地链接、五十八
唯一 ID/计数、原二十六映射、保护文件及 Run 均通过，Web/API 健康身份一致。两份
补充测试与隔离执行副本逐字节相同；其他候选非文档文件均与 R-11 一致，旧证据保留。
`supplement-manifest.json` 记录原三十九文件加两份测试的四十一文件交付选择摘要
`2946c256e4ed705ee7c8412688333e160f07e8eff4187bfaa0cca39599d21f41`，产品仍为 R-11
十八文件摘要，未将补充检查冒称新四十一文件完整 CI。完成记录随后定向复核；正式
actor 与 review task pending，未新增 Git 交付或部署。

## D-17 与 R-12 最终候选本地验收（2026-09-08）

所有者明确要求“不要真实读屏，完善其余的”。D-17 据此免除本次 M5 的 NVDA/VoiceOver
实际播报，记录为 owner waiver，不记 passed；自动化无障碍、键盘、焦点与 CSP 继续验收。
本节更新当前结论，上述阶段结果保留为历史。

R-12 在注册和恢复 HTML 邮件中增加可复制的完整原链接，并允许长链接换行，便于邮件
客户端包装跳转失败时使用。链接仍使用 fragment，转义、有效期和一次性语义保持；
不声称修复 QQ 自身跳转。Worker 文件其余差异为 Ruff 格式化，不改变签名或传输行为。

基线仍为 `bac2a4371ce6a12d6c3e9a6124104d121b0f8807`；十九产品摘要为
`b9511a8e874867a1e71bb6494818fa91c1683a97c3ed1d227243fb13220a2987`，四十四源码测试摘要为
`38a1c31aec0c0869e8cfa4a2a77e2c1c9f43ea2c2605307b3adc858c72043892`。
Web/API/Worker 已统一此候选，常驻空预览健康；AppShell 仅含基线加获批五行删除。

| ID     | 仓库外证据组 / 文件                                                               | 观察结果                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIN-01 | `m5-r12-candidate-0Av1vD` / `mail-fallback-before.xml`、`mail-fallback-after.xml` | 旧模板十三通过两失败；修复后 Worker 十五项通过，两类 HTML 可见文本均包含完整原链接                                                                                                                       |
| FIN-02 | `m5-r12-candidate-0Av1vD/ci-BywanU` / `result.json`、`ci-fast.log`                | 新候选完整 CI 八门一次退出零，Web 425、Python 612 passed / 120 deselected；既有 Provider 等待超时本轮未复现，不宣称已定位根因                                                                            |
| FIN-03 | `m5-r12-permissions-fSeH9h` / `result.json`、两份 JUnit                           | Provider 两项与 Model 路由一项集成通过；新增 Model 六次角色/跨空间写拒绝及三次撤权读写拒绝，前后数据不变；两容器及卷清理                                                                                 |
| FIN-04 | `m5-r12-mail-GvQ3fj` / `mail.json`、两份浏览器日志、四份 PNG                      | 四十八项本地演练通过；真实页面与本地 API 完成注册/恢复提交、成功、重放四百、错误焦点、请求编号、fragment 清除及 CSP，四状态 axe 零违规；1440 成功页与 320 错误页截图已检查；三次发送均为模拟，真实实收零 |
| FIN-05 | `m5-r12-provider-Q4GvKV` / `provider.json`、两份浏览器日志和 PNG                  | 十三项演练通过；真实本地页面发起发现，经 API、adapter 和模拟上游返回二百及四零一；失败归一为 422 / AI_PROVIDER_AUTH_FAILED、不可重试，错误 UI 与持久健康状态正确；零真实外呼                             |
| FIN-06 | `m5-r12-candidate-0Av1vD` / `preview-check.json`                                  | Web/API 身份与新候选一致，旧预览进程已停止，九十一业务表行数零、Redis 键零；新登录页已在桌面浏览器重新打开并目视检查                                                                                     |

FIN-04 保留三次失败：首轮重放使用同页 fragment 导航，未重新加载文档；第二轮定位
同时匹配表单 alert 和 Next announcer；修正为新页面重放及表单内定位后，注册和恢复
已通过，但通知首次 Worker 轮询未领取。执行器增加有限空轮询，只有未领取时等待，
不改队列时间或自动重试发送；最终批次通过且本轮各任务首次即领取，旧轮询未领取的
原因未定位，不把历史墙钟回拨直接当作本轮根因。FIN-05 首轮误把 create-only 字段
传入更新合同被拒绝，删除该字段后通过；这是验收脚本错误，产品合同未修改。
各次独占 API、数据库、Redis 和卷均已清理；模拟凭据进程已结束。上述日志与截图
均在仓库外，没有把实际邮箱、Provider 地址或凭据写入文档或 Run。

### M5 判定与范围

按 D-03/D-06，仍逐条检查原范围内二十六项零回归、直接修复项按生效语义通过、无新增
P0/P1；不采用通过率替代。新增 diff 主线复核未发现 P0/P1。完整 API 的 IDOR 普查与
生产等价容量仍是未完成的补充/后续工作；S3 §1.4 将广泛 IDOR 与性能列为 P3 范围外，
不能因接口清点到一百八十六个 operation 就把全部普查悄然扩大成本次 M5 必需施工。
生产身份、镜像、CSP、容量与运行观察另归 M0/运维及 M6；本地证据不代表旧 ECS 已升级。

当前 M5 **尚未通过**。五十八项仍为 47 passed、0 failed、5 partial、0 blocked、
6 out_of_scope；10.2、13.1 的邀请和移动部分按 D-16/D-06 延后，真实读屏按 D-17 豁免。
仍需真实补验的是 2.3/2.4 的同次页面与真实上游正常/失败，以及 11.2 新邮件备用链接
实收、有效原链接和真实收件流程的最终 UI。FIN-04/05 是本地演练，不把模拟传输写成实收。

已提出具体追加批次：最多两次模型发现（正常、无效合成凭据各一次），零生成、零重试；
向原受控邮箱最多三封（注册、恢复、安全通知）。旧额度三次请求与五封邮件已尽，
追加批准尚未收到；本批没有新增真实请求或发信。短期发信凭据加密转交、仅内存使用的
既有授权继续有效。新密码的实际浏览器录入、确认和提交需由所有者接管，先准备有效页面。

### M6 发布条件

M6 未授权。需要最终提交及同 SHA CI、四个不可变镜像与 manifest、生产身份和配置
一致、备份与独立恢复/回滚验证、生产 TLS/CSP 与邮件/同步 smoke、容量及至少二十四
小时观察，并取得当前发布批准。本轮未 commit、push、merge、部署或启用敏感能力。

FIN-07：仓库外 `m5-r12-review-awcr8R/review-check.json` 完成五十七文件格式/Ruff、
秘密、空暂存区、一百一十七本地链接、五十八唯一 ID 和原二十六项映射、候选摘要及
保护范围复核。AST 比较确认 Worker 除 action 模板外语义不变；旧产品覆盖字节保持。
十四份本批证据摘要已保存，Web/API 版本与健康正确，正式 review task 保留 pending。
完成记录随后定向复核；没有因文档更新重复完整 CI，也未把待授权真实批次记成通过。

## 追加批次执行检查点（2026-09-08）

所有者要求继续追加并确认原凭据可用，已批准最多两次发现、零生成、零重试及原受控
收件箱最多三封邮件。旧三次请求和五封邮件保留，累计上限分别为五次和八封。

- LIVE-01：仓库外 `m5-r12-provider-JrLFTp/provider.json` 绑定 R-12，浏览器已登录
  合成账号并进入 Provider 页。点击发现后出现原生确认框；控制工具的点击、确认和
  恢复调用超时，尚未记录上游请求。已请所有者解除该弹窗，不将工具异常记成产品失败。
- LIVE-02：现有云助手执行既有 IMDSv2 加密转交脚本，只更换本机公钥，退出零；
  本机成功解密并验证短期有效性。Workbench 曾要求新增安全组白名单，已选择暂不开通；
  未改 IAM、网络、部署或生产配置，未新建长期凭据。
- LIVE-03：仓库外 `m5-r12-mail-YlzTAY/mail.json` 记录首封追加注册邮件发送成功、
  十三项检查通过；QQ 中观察到批准发件人、当日 20:32 到达时间和完整可复制原链接，
  Origin、路径、token 与当前独占数据匹配。原链接打开确认表单，fragment 已清除；
  所有者尚未完成新密码录入、确认、提交及随后登录，11.2 继续 partial。

当前追加发信一封、实收一封，累计六封；追加 Provider 请求零次，累计仍三次。
注册表单和独占环境保持运行至接管完成，恢复邮件与安全通知尚未发送，整批未 finish。
正常空预览保留。此处只记录已观察事实，不作为整批 passed、M5 完成或 M6 发布授权。

LIVE-04：仓库外 `m5-r12-review-eTnR9s/review-check.json` 通过五十七文件格式/Ruff、
秘密扫描、空暂存区、一百一十八本地链接、五十八 ID/计数、原二十六通过项映射、
四十四候选字节与保护范围、Worker 模板之外 AST、Run 和 Web/API 身份健康复核。
保存十六份证据摘要，其中真实批次使用当时的脱敏快照，明确标为仍在执行；不将
旧演练清理结果套用于正在等待所有者操作的两个真实环境。

## 导航反馈修复与 R-14 候选（2026-09-08）

所有者报告进入项目后找不到 Provider、多处 Tab 点击无效。真实浏览器复现：个人页与
帮助页仅改变选中样式，全部内容持续显示；设置只有互操作入口，没有明显 Provider 入口。
自学的收件箱和路线页在未选中对象时共用相同内容，切换结果难以辨识。

- R-13：个人三分组、帮助四分组实际控制内容显示；帮助筛选后的 FAQ 不再空白。
  设置复用命令的画像可见性规则，直达已有 AI 路由的 Provider 视图，未增加一级导航。
- R-14：自学路线与项目使用对应空状态及新建路线操作，保留收件箱捕获入口。
- NAV-02：个人、帮助、设置四文件九项及自学三项定向测试通过。首次缺少 hook 解构、
  测试 mock 缺少函数，以及 forceMount 面板使用 CSS 隐藏的断言误判均已修正并保留记录。
- NAV-03：R-13 完整 CI 两次分别为 Web 428 passed/1 timeout 和 427 passed/2 timeout；
  AI 独立十九项通过。第二次超时位于旧 Security 与 Sync 测试，未确认统一根因。
  R-14 完整 CI 首次八门通过，Web 430、Python 612 passed/120 deselected。
- NAV-04：在所有者真实本机会话中复核设置直达 Provider、个人四次和帮助四次往返、
  筛选后 FAQ、自学三个 Tab 与新建路线表单打开/取消。个人与帮助截图已在工具中观察。
  同类 Provider、Draft、工作区成员/邀请/信息/危险操作分栏实际切换正常；仅查看，不作业务提交。

当前候选为同一基线加二十三份产品覆盖，摘要
`84e7adfa5f2c0b33ae1bf9b34d31082d381e53c2fca4558f197511cbe35b11fc`；
五十三份源码测试摘要
`062f080c5d4ea894cac0c95a934545fc133a58f77fff260d0b1230b3e74d5c60`。
证据为仓库外 `m5-r14-candidate-qg9yv7/manifest.json`、`ci-mR5wJN/result.json`、
`ci-mR5wJN/ci-fast.log` 及 `preview-check.json`。常驻 Web/API/Worker 已统一 R-14；
正常预览九十一业务表行数与 Redis 键零。既有 T-04 保护及五行例外保持。

### 真实批次续验

- 注册已由所有者在真实页面完成并登录；action consumed 和邮箱验证确认，本批十六项检查通过。
- 两个验收站使用相同主机名、不同端口，登录 Cookie 会互相覆盖；Provider 改用独立浏览器
  主机名的本地转发，保留原合成数据库及请求硬上限。实际 Provider 页面已恢复。
- 原生确认框接受操作仍报 `Emulation.setFocusEmulationEnabled` 超时；已请所有者手动确认。
  截至本检查点新增外呼零，累计三次；未将工具异常归为产品请求失败。
- 追加恢复邮件已发送并在受控邮箱核对批准发件人、时间、完整原链接；页面显示设置新密码，
  fragment 已清除。新密码录入与提交需所有者接管，随后核验会话撤销及最后一封安全通知。
  本批发信与实收各二封，累计七封，剩余一封；未重置旧额度，未 finish。
- 所有者已创建目标与里程碑，邮件环境不可再按旧清理脚本直接删除。已保留原环境并建立
  仓库外权限为 0600 的数据库归档，归档可读检查通过，未执行恢复演练；本地 Vault 密钥仍
  由用户口令管理。归档不作为 M6 独立恢复验收。

M5 继续等待上述真实页面闭环与最终判定，不因本地 UI 修复通过改为完成。D-17 是 owner
waiver；D-16 邀请和 D-06 移动延后不变。M6 仍需最终提交、同 SHA CI/四镜像 manifest、
生产身份配置、备份与独立恢复/回滚、TLS/CSP/邮件/同步、容量、至少二十四小时观察及当前
发布批准。未提交、推送、合并、部署或修改生产权限。

NAV-05：仓库外 `m5-r14-review-O3w5J8/review-check.json` 通过六十七文件格式、Ruff、
秘密与空白、空暂存区、一百二十一本地链接、五十八 ID/状态及原二十六项映射、
五十三候选字节、二十三产品摘要、T-04 保护与 Run 校验。确认一百八十一后端源码文件
与 R-12 逐字节一致，真实邮件/Provider 后端仍可归因，前端使用 R-14。二十份证据摘要
保存，真实邮件二十六项检查通过；两真实环境继续运行，未把待接管项目记成通过。

## 接管重试与测试环境恢复（2026-09-08）

本节替代此前“邮件原环境继续运行”的当前状态，历史证据保留。

- LIVE-05：恢复标签页已导航至登录后的空间页，但这不能证明密码恢复成功。主线误将其
  当作可执行完成核验的前提，调用旧执行器 `browser-complete`；服务端实际断言
  `browser_action_consumed` 失败。旧执行器异常退出后自动停止 API 并删除独占数据库、
  Redis 与卷。此为验收执行错误，不计产品恢复成功，也不隐藏清理事故。
- LIVE-06：校验此前归档摘要后，已用 PostgreSQL `pg_restore --exit-on-error` 恢复至
  独立持久化数据库。账号一、密码凭据一、目标一、学习计划一、阶段一及工作区一均存在；
  恢复后 R-14 API 健康，原访问入口恢复。归档和本机服务配置在仓库外受限权限保存，
  没有云端凭据；服务退出不删除数据库。证据为 `restore-RrtizI/restore-result.json`，
  归档摘要与 NAV-04 检查点相同。恢复点为当日 21:39，之后是否存在新增业务数据无法
  核实，不声称完整恢复至事故前瞬间；原恢复邮件对应动作不在该备份中，不能继续使用。
- LIVE-07：Provider 合成会话重新登录并打开真实发现按钮；点击再次出现 CDP 超时。
  按 Computer Use 技能初始化原生窗口工具后，工具因无法可靠确定 Chrome 当前 URL
  停止本轮操作。未绕过停止线；服务端确认新增请求仍零，正常与失败两次真实发现未完成。
- 本批实际发信和实收各二封，累计七封；原短期发信凭据进程已退出，安全通知尚未发。
  原累计上限八封不重置，若补发恢复并保留安全通知，还需增加一封额度；当前未新增发信。
  重新发信前须准备仅内存短期凭据及有效页面；真实密码最终提交仍由所有者操作。

候选源码不变，沿用 R-14 已观察的完整 CI；五十八项仍为 47 passed、5 partial、
6 out_of_scope，M5 未完成。必要未验仍为 2.3、2.4、11.2。D-17 实际读屏豁免及
D-16/D-06 延后保持；M6 未授权，生产身份、镜像、恢复、容量与观察等发布条件不变。
旧执行器失败记录与数据库恢复结果分别保存，不能把本次恢复事故写为 M6 恢复演练通过。

LIVE-08：仓库外 `m5-r14-review-HF34v2/review-check.json` 通过六十九文件格式/Ruff、
秘密与空白、一百二十三链接、原五十八 ID 与二十六基线映射、候选及保护摘要、空暂存区
和 Run 复核。恢复数据库的六类关键对象数量、归档摘要及新 API 健康身份通过；明确保留
二十八项邮件检查中的一项完成断言失败，实际两发两收和新增 Provider 零。二十二份证据
摘要保存，未重复完整 CI，M5 未完成、M6 未授权。

## 跨日续验检查点（2026-09-09）

- LIVE-09：此前已批准累计九封。第八封恢复邮件于前一日 22:44 实收，批准发件人及完整
  原链接已在邮箱核对；中断前尚未写入执行器收件计数，原证据保持零，不覆写历史。
  续跑只读查询确认恢复令牌未消费且已过期，没有安全通知入队。原邮件执行器已退出，
  持久化数据库与服务保留，正常预览及恢复环境页面返回成功；账号、目标和阶段仍存在。
  补发恢复并完成通知需要两封，当前剩余额度一封，须另批准累计上限十封后才发新批次。
- Provider 原执行器已退出，历史新增请求零；仍可用两次发现，累计三次、上限五次。
  新隔离环境绑定 R-14，首次启动因独立主机名与 WebAuthn 配置不一致失败，未产生外呼；
  修正测试配置后迁移成功，合成账号与 Provider 本地准备完成。产品源码未变。
- M5 仍待 2.3/2.4/11.2，D-17 豁免及 D-16/D-06 延后保持；M6 未授权。

LIVE-10：主线重新登录受控邮箱并复核第八封发件人、时间和完整原链接；仓库外
`m5-r14-resume-observation.json` 记录当前账号、目标、学习计划、阶段各一、恢复未消费
且过期及 R-14 API 健康。新邮件执行器创建当前备份，采用持久化环境且退出不清理；
凭据加密转交脚本仅替换本机临时公钥，逐字核对后单次执行成功，短期凭据已在本机
内存解密并验证有效期，没有部署或权限变更。`m5-r14-mail-resume-mv30qjoc/mail.json`
记录 prior 八封、新增零、批准九封；要求同时预留恢复和通知额度，十封上限问题待答。
新 Provider 页面经设置入口打开，点击及接受原生确认继续工具超时；执行器确认外呼
零，已请求所有者手动确定。`m5-r14-provider-resume-LqhzBr/provider.json` 保留进度，
首次迁移失败记录独立保留，不作产品失败归因。两执行器及持久化服务等待续验。

LIVE-11：仓库外 `m5-r14-resume-review-siVsXs/review-check.json` 通过六十九文件格式、
Ruff、秘密与空白、一百二十三链接、五十三候选字节、T-04 保护、五十八 ID/计数及
原二十六项映射、空暂存区、Run 和两常驻服务版本健康复核。二十七份证据摘要保存，
新增恢复邮件的未落盘收件计数与独立重新实收观察分别记录；累计八封、三次 Provider，
本次新增发送和请求均零。沿用 R-14 已通过 CI，未重复整仓测试，M5 仍待接管闭环。

## 自主处理两点与正常发现闭环（2026-09-09）

- LIVE-12：所有者要求主线处理 Provider 确认与邮件额度两点，批准累计邮件十封。
  第九封恢复邮件真实发送成功，12:58 实收，发件人、完整原链接及令牌匹配通过。
  Chrome 及应用内表单显示设置新密码并清除 fragment；未由主线录入或提交用户密码。
  执行器记录二十一项检查通过、一次发信一次实收、恢复未消费且未过期，保留最后通知
  一封额度。新表单约 13:28 到期，已交接所有者；持久化数据及当前备份保留。
- LIVE-13：Chrome 与内置浏览器的原生确认操作仍发生工具超时。使用项目已有隔离
  Playwright Chromium 验收脚本，不修改 R-14 产品代码。脚本实际登录合成账号、打开
  Provider、观察并接受原生确认，POST 返回成功，脱敏请求编号、响应三个模型和同次
  成功文案通过，截图已人工观察。证据 `m5-r14-provider-resume-LqhzBr/ui-normal.json`
  与 `provider-normal.png`；2.3 更新 passed，当前合计 48 passed、4 partial、6 out_of_scope。
- LIVE-14：新增两次请求均实际返回正常成功，累计五次已达上限。一次正常请求在浏览器
  切换期间已完成；主线取得计数后未先停止并调整分支，又执行正常验收脚本，导致原定
  失败请求额度被占用。这是执行错误，不把两次正常成功当作正常/失败整批通过；首笔
  页面归属未完全核实，`provider.json` 原记录保留。脚本首次把原生文案误断言为包含
  Provider 的本地失败同样保留，修正为实际完整文案后通过，不声称工具超时已修复。
  已准备 `m5-r14-provider-failure-Y46H3u`：只用合成无效凭据，硬上限一次，默认拒绝
  外呼，需明确授权命令才能开启。已询问累计六次上限，尚未收到答复，没有新增请求。

M5 尚待 2.4 真实失败及 11.2 恢复提交/通知，旧事故、额度和失败不重置。M6 条件及
未授权状态保持，未 commit、push、merge、部署或修改生产权限。

LIVE-15：`m5-r14-live-progress-review-y9kAQc/review-check.json` 复核通过六十九文件、
一百二十三链接、候选及保护字节、秘密与空白、原二十六项映射、当前 48/0/4/0/6、
空暂存区、Run 和服务健康；三十份证据摘要保存。真实正常 UI 与两个成功请求分别
验证，失败准备环境授权标志关闭且请求零；恢复一发一收、累计九封、批准十封。
没有重复整仓 CI，没有把待本人提交或待新增请求授权的验收记为通过。

## 密码恢复与邮件闭环（2026-09-09）

- LIVE-16：所有者报告已重置密码，实际应用页面显示“密码已更新，请重新登录。”；
  执行器确认最新恢复令牌已消费，原两条会话全部撤销，完成状态已记录。随后仅发送
  最后一封安全通知，13:26 在受控邮箱核实发件人、收件人及正文一致。本批恢复与通知
  各一封、各实收一封，累计十封恰达批准上限，零自动重试；二十八项检查全部通过，
  `m5-r14-mail-resume-mv30qjoc/mail.json` 为 passed。没有观察新密码重新登录，不把它
  写成已验证；此前真实注册及登录、过期/重放证据继续分别归因。
- 邮件执行器 stop 后退出零并释放仅内存短期凭据，没有触碰持久化服务。独立只读
  `m5-r14-mail-completion-observation.json` 确认 API 为健康 R-14，账号、目标、学习计划、
  阶段各一；最新令牌已消费、两条旧会话撤销、安全通知仅投递一次且密文载荷已清空。
  当前数据及既有备份保留；原环境清理事故、恢复点之后变化未核实的限制继续保留。
- 11.2 更新 passed，五十八项现为 49 passed、0 failed、3 partial、0 blocked、
  6 out_of_scope、0 not_run。三个 partial 为 2.4、10.2、13.1；后两项分别按 D-16、
  D-06 延后，唯一范围内必需未验项是 2.4 真实上游失败及对应 UI。
- Provider 仍累计五次，单次失败环境默认禁止外呼，额外一次授权问题保持 open。
  本次“已重新设置密码”只确认密码操作，不作为 Provider 追加授权。候选代码及 CI
  保持，M5 尚未完成；M6 发布条件和未授权状态不变，没有 Git 交付或生产变更。

LIVE-17：`m5-r14-mail-completion-review-ydnuCb/review-check.json` 通过六十九文件格式、
Ruff、秘密与空白、一百二十三链接、五十三候选字节、二十三产品摘要、T-04 保护、
五十八 ID/当前 49/0/3/0/6、原二十六基线映射、空暂存区、Run 与服务健康复核，
三十一份证据摘要保存。首检两份文档表格格式未通过，对齐后复验通过；旧失败证据保留。
邮件问题已 resolved，额外一次 Provider 问题仍 open，不补造正式 actor/review accepted。
随后通过 EOF 正常结束已耗尽额度的旧 Provider 执行器，释放凭据并清理其独占合成数据库、
容器和卷；`m5-r14-provider-resume-LqhzBr/result.json` 确认清理通过。其退出一和批次
passed false 保留，因为两次均正常成功且缺失败路径，不把退出清理误报为整批通过。
单次失败环境仍默认禁止外呼，持久化用户环境不受该清理影响。

## 最终 M5 结论与 M6 发布条件（2026-09-09）

### LIVE-18：真实失败验收

所有者确认累计 Provider 上限从五次调整为六次，仅追加一次合成无效凭据发现，
零生成零重试。批准前请求零；授权后真实 Chromium 重新登录合成账号，点击发现、
接受完整原生确认。上游单次返回 401，应用返回 422 / `AI_PROVIDER_AUTH_FAILED`，
`retryable: false`。页面持续显示“Provider 拒绝了密钥，请更新凭据后重试。”，
Provider 卡片为 `unhealthy` 及对应错误码，模型零。实际浏览器脚本退出零，截图由
主线观察。累计六次，未新增生成或邮件，没有自动重试。

证据为 `m5-r14-provider-failure-Y46H3u/ui-invalid.json`、`provider-invalid.png`、
`provider.json` 与 `m5-r14-final-live-observation.json`；后者绑定七份证据摘要及
实际执行的 UI 脚本。启动编排首次因合成登录字段名不匹配在调用前停止，请求零；
按实际字段修正后仅运行一次浏览器验收，不计额外上游请求。

收尾脚本另有缺陷：沿用一小时多前的原会话，未检查响应状态、刷新或重新登录便
直接取 `providers`，发生 `KeyError`。环境 access TTL 为十五分钟，但原列表响应
未保存，不能确认具体拒绝码。已完成八项检查全通过；后续“列表无凭据”和“健康
状态持久化”两个收尾断言未运行。整批 `passed: false`、退出一及错误栈保留；
容器和卷实际清理通过。2.4 根据同次真实请求、应用响应、浏览器断言与独立截图
判定通过，UI 健康状态另行观察，不把未运行收尾断言计为通过或再次外呼。后续复用
该仓库外执行器须先修复会话续期和响应检查，不将它的异常作为产品回归。

### 固定候选与范围判定

- 基线：`bac2a4371ce6a12d6c3e9a6124104d121b0f8807`。
- 二十三产品摘要：`84e7adfa5f2c0b33ae1bf9b34d31082d381e53c2fca4558f197511cbe35b11fc`。
- 五十三源码测试摘要：`062f080c5d4ea894cac0c95a934545fc133a58f77fff260d0b1230b3e74d5c60`。
- R-14 完整 CI 八门通过，Web 430、Python 612 passed / 120 deselected；导航十二项
  定向及真实页面复验通过。产品本轮未改，不因文档收口重复整仓 CI。
- 原 58 个 ID 不变：50 passed、0 failed、2 partial、0 blocked、6 out_of_scope、
  0 not_run。原范围内二十六项零回归，直接修复项按生效语义通过，主线审查未发现
  新增 P0/P1。10.2 完整邀请 URL/复制按 D-16 延后，13.1 移动开闭焦点按 D-06
  延后；D-17 免除真实读屏，不写成实测 passed。

**M5 结论：按批准范围完成主线技术验收。** 不表示原五十八项全部通过、广泛 API
IDOR 普查、生产等价容量、真机或后续 O/N/U 演进完成。恢复后的新密码重新登录未
观察，既有注册登录证据单列；R-12 邮件备用原链接已验，QQ 原包装跳转历史 404
仍存在。旧 R-13 等待失败未统一定因；两次正常请求占用失败额度、旧邮件环境清理
事故及恢复点之后数据变化未核实的限制保留。

临时 Provider 环境已清理，邮件执行器与短期凭据已释放；用户持久化服务、当前数据
及备份继续保留。Run 的旧角色正式 review task 保持 pending；本次主线实际复核
通过候选和证据归因，不补造正式模型证明或任务 accepted。计划留 current，不声称
用户已完成最终整体验收或批准归档。

### M6：未发布、未授权

| 条件       | 发布所需证据                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| Git 与制品 | 获准创建最终提交、同 SHA CI、四个不可变镜像 digest 和 manifest，实际 Web/API/Worker 身份一致 |
| 生产配置   | 认证、Provider、邮件、DNS/出站、TLS/CSP 与默认关闭能力核验；敏感启用另获当前批准             |
| 数据与回退 | 生产恢复点、独立恢复演练及回滚验证；本次事故恢复不替代该门禁                                 |
| 部署后验证 | 当前候选邮件/同步及必要功能 smoke、容量/饱和度验证、至少 24 小时观察                         |
| 发布批准   | 对具体制品、环境和回滚方案取得当前发布批准，M5 通过不授予部署权限                            |

当前线上仍是旧项目版本。本轮未 commit、push、merge、部署或变更生产权限。

LIVE-19 最终复核：`m5-r14-final-review-l9dMV8/review-check.json` 确认六十九份交付
文件格式/Ruff/秘密/空白、一百二十四本地链接、五十三候选文件与二十三产品摘要、
T-04 保护、五十八唯一 ID/50–2–6 状态、原二十六基线映射、空暂存区、Run 和服务
健康全部通过；三十七份证据摘要保存，一百八十一后端文件与 R-12 字节一致。
真实正常/失败 UI、邮件完成与合成资源清理已分别核实；失败收尾脚本与两条未运行
断言显式保留。所有必要外部问题已 resolved，M5 为 `passed-approved-scope`，
M6 为 `not-authorized`。未重复整仓 CI，未归档计划或变更用户持久化数据。
