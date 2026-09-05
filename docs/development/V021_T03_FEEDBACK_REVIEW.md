# T-03 瞬时反馈层实施审查

日期：2026-09-05。关联：ISSUE-005；旧计划中的 ISSUE-002 编号不作为本次关闭依据。

## 交付状态

- 用户已批准步骤 0 与方案 C。本次实施步骤 1-3，不涉及部署。
- 不可变基线：`018e8a229252b702c33840d8f74bdd1d7d7b250b`。
- 工作分支：`dev/T-03-feedback-visibility`。
- 代码与 Web 验证已完成，等待所有者审查。整仓门禁仍失败，因此未 stage、commit、push 或 merge。
- `docs/ai_handoff/` 保持未跟踪，不属于交付文件。

## 修复与语义

| 缺陷                          | 处理                                                                                   | 回归证据                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F1 自学同步错误被本地成功覆盖 | 删除自学、研究、协作三个提交分支末尾无条件成功状态；同步错误同时保留在 inline 与 Toast | 503 后不含“已加密保存”，错误保留；组件测试与三档浏览器通过                          |
| F2 考试 Sheet 遮住错误        | 本地提交后同步失败仍关闭已提交 Sheet；本地提交失败保留输入并在 Sheet 内显示 StatusLine | 同步 503 后 Sheet 关闭且 Toast 可见；本地事务失败保留字段与内部错误                 |
| F3 复习/Run 状态在屏外        | 保留 inline，增加固定位置 Toast                                                        | 浏览器触发后无需滚动可见错误；复习覆盖三档视口，Run 覆盖桌面与移动端                |
| F4 附件诊断屏外               | 完整附件失败诊断进入 Toast，Inspector 补充动态状态语义                                 | 移动端完整显示 `KNOWLEDGE_ATTACHMENT_INGEST_DISABLED` 与请求编号；T-01 成功文案缺席 |

考试创建回调的 boolean 表示“本地数据已提交，可以关闭表单”，不表示服务端同步成功。
没有更改 Outbox、IndexedDB schema、同步协议、权限、认证流程或默认关闭能力。
四个本地解锁回调缓存 form，避免 await 后读取失效的 `event.currentTarget` 产生错误反馈。

同类复核另外覆盖：

- 四个同步入口读取 `SyncCycleResult.control`、剩余 Outbox 与 `has_more`；未抛异常不等于同步完成。
- Provider/Run 刷新函数返回明确结果；刷新失败时不再继续发出操作成功反馈，两处均有专项测试。
- Run 请求挂起时同时禁用发送和取消发送，避免外呼已发起后仍报告“内容未发送”；组件测试使用受控挂起请求验证两个按钮。
- 创建/发送/发现/上传的主要异步按钮增加或保留 pending 禁用和进行中文案。
- 附件只有 `verified` 分支报告验证成功；`failed` 返回值和抛异常均报告失败，队列仍可重试。

## 反馈层与依赖

- `lib/feedback.ts` 统一 success/error/pending，返回文本方便与现有 inline 共用；成功 3 秒，错误无限时并可手动关闭。
- 只显示已知 API/Offline 错误码和请求编号；不展示原始异常 message/details。解包仅限已知 OfflineStorageError 的 LogionApiError cause。
- 根布局挂载 `FeedbackProvider`；Sonner 提供 `aria-live="polite"` 区域，保留已有 inline 语义。
- 顶部居中，移动端避开顶部安全区与底栏，长码允许任意位置换行；移动关闭按钮为 44px。
- Sonner 精确版本 `2.0.8`，MIT，维护者 Emil Kowalski。npm 元数据中该版本发布于 `2026-08-09T08:46:10.174Z`，本次查询时为 latest。
- 实测发布文件：ESM 69,545 bytes / gzip 14,613；CSS 17,681 bytes / gzip 3,297。这不是 tree-shaking 后的最终页面增量，不沿用交接中的“约 5KB”估算。
- 此版本没有 Toaster nonce 参数，默认模块加载会插入无 nonce style。沿用仓库已有 pnpm patchedDependencies 模式，仅禁用 ESM/CJS 的自动 CSS 注入，静态导入官方 `sonner/dist/styles.css`。
- 未修改 CSP/proxy 或放宽 `style-src`。生产构建浏览器场景未观察到 CSP 违规；frozen lockfile 安装通过。
- 维护成本：升级 Sonner 必须重核两个入口 patch、静态 CSS 与真实 CSP 探针。备选为自建 live region/队列或 React Hot Toast；本次遵循用户明确指定的 Sonner，不新增另一套 Toast 实现。

## 七模块浏览器矩阵

隔离 PostgreSQL/Redis/API 加真实生产构建 Chromium；所有内容为合成测试数据。
1440×1000 与 375×812 每格各执行一次，合计 28 场景。成功与失败均检查 Toast、inline、视口、关闭按钮、横向滚动和控制台。

| 模块                | 操作             | 成功场景                                  | 失败场景                               | 移动端                  | 辅助技术边界                        |
| ------------------- | ---------------- | ----------------------------------------- | -------------------------------------- | ----------------------- | ----------------------------------- |
| review-center       | 保存周期审查草稿 | 真实同步成功，可辨                        | 注入同步 503，可辨                     | Toast 可见              | live region / AX 检查，不是实际朗读 |
| exam-center         | 创建考试         | 真实同步成功，可辨                        | 注入同步 503，可辨                     | Sheet 关闭后 Toast 可见 | 同上                                |
| self-study-center   | 快速收集想法     | 真实同步成功，可辨                        | 注入同步 503，可辨且未被覆盖           | Toast 可见              | 同上                                |
| provider-center     | 测试并发现模型   | 模拟 discover 成功响应，可辨              | 真实保留域名解析失败，可辨             | Toast 可见              | 同上                                |
| run-center          | 确认并发送       | 真实 API 入队且 GET 确认持久化，可辨      | 注入提交 503，可辨                     | Toast 可见              | 同上                                |
| persona-settings    | 保存画像         | 真实设置 API 成功，可辨                   | 注入设置失败，可辨                     | Toast 可见              | 同上                                |
| offline-sync-center | 上传附件         | 模拟 init/content/complete verified，可辨 | 真实默认关闭 404，可辨且无验证成功文案 | 具体错误码完整可见      | 同上                                |

Provider 成功仅验证 UI 反馈合同，不是实际上游发现成功。Run 使用仅存在于任务数据库中的健康状态夹具；没有启动推理 Worker，也没有实际模型外呼。
附件成功仅验证浏览器与 transport 合同，不是 scanner/ClamAV 成功验收；真实失败保留默认关闭开关。

## 已执行检查

| 检查                                                      | 观察结果                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Web `pnpm test`                                           | 83 files / 321 tests passed                                                                       |
| Web `pnpm lint`、`pnpm typecheck`                         | passed                                                                                            |
| Web `pnpm build`                                          | passed；最后 Provider/Run 修正包含在此生产构建中                                                  |
| `feedback-visibility.spec.ts`                             | 12 passed；1440、375、320×568 的自学/考试/复习/附件失败场景                                       |
| 七模块浏览器矩阵                                          | 28 passed；已补强 Toast 类型、具体成败文案、inline 一致性断言，使用独立浏览器资料                 |
| 320×568 深色 Run 失败补测                                 | passed；完整错误码可见、发送按钮不被遮挡、无横溢或 CSP 错误                                       |
| T-01 组件回归                                             | 真实 AttachmentQueueRepository/transport 路径；verified、failed、空队列均覆盖                     |
| Sonner 组件回归                                           | 真实 live region、关闭入口、错误无限时、成功 3 秒、pending dismiss、诊断字段边界                  |
| `pnpm install --frozen-lockfile`                          | passed；lockfile 无无关 peer 变更                                                                 |
| `pnpm ci:fast`                                            | failed；context guard、状态模型 118 项、格式、lint/Ruff、TypeScript 已通过，随后 Worker mypy 失败 |
| `uv sync --locked --all-packages --group dev` 后重试 mypy | 仍为同一 4 个错误，未越界修改 Worker 或豁免门禁                                                   |

门禁失败位于未改动的 `apps/worker/src/logion_worker/email_delivery.py:13/16`：
`alibabacloud_credentials.client/models` 的两个 import-not-found 与两个 unused-ignore。
这与基线状态文档记录一致。不能将 `ci:fast` 记为通过；其后续整仓 test/build/contracts 阶段本次没有由该命令执行。
上述 Web 独立验证确实已执行，不替代整仓验收。
最后一行 Run 提交中取消禁用修正后，重新通过 Web 全量测试、lint、typecheck 和 production build，并复跑 Run 的桌面/移动成功失败四场景及 320px 深色失败场景。其余模块的浏览器证据对应未再变化的代码。

浏览器最终回归关闭 trace：环境曾出现 trace stream 写入错误；截图和 DOM 断言完整，不声称 trace 成功。
矩阵第一次复跑只检查浮层可见，漏检 success/error 类型；复用浏览器资料与新认证设备不匹配，导致三个本地模块的成功场景实际为 bootstrap 错误。该运行作废并保留在 `superseded-device-context`，补充具体成败文案断言和每次独立资料目录后重新执行，不将退出码 0 冒充业务成功。
补强断言后还捕获到重复周期和近期认证失效，均保留失败证据：前者改为通过真实 API 查询现有周期后选择下一天，后者通过合成账号正常登录刷新会话。没有修改业务权限或绕过认证；重复周期的 HTTP 200/单操作拒绝也实际验证了新诊断不会谎报同步成功。
Vitest 仍输出部分既有 Radix Select controlled/uncontrolled 警告，测试退出码为 0，未将警告隐藏。

## 证据与未运行项

截图目录按任务指定位置交付，不进入仓库。文件命名为 `模块-宽度-结果.png`，配套 JSON 记录状态变更、API 状态和 AX 观察；持久回归图为 `模块-宽度.png`。
F1/F2/F3/F4 可分别审阅 `self-study-320.png`、`exam-320.png`、`review-320.png`、`attachment-320.png`，以及相应 1440/375 图。

- NVDA/VoiceOver 实际音频播报未执行；最新交接明确留给回归验收。DOM 的 aria-live 不能冒充读屏实测。
- 本轮不是完整 WCAG、真实手机、生产 DNS/部署身份或扫描服务验收。
- 所有者审查与整仓失败处置仍待决定；没有放宽提交门禁。
- 本机仅回环监听的合成测试栈保留供审查，没有推理 Worker；生产系统未改动。浏览器结果已归档，仓库中本轮生成的 `reports/browser/results.json` 已单独恢复，未改动其他所有者文件。

## 回滚与下一步

变更仅为前端反馈、测试、依赖及审查文档，无迁移、协议或生产配置变更。
当前尚未提交，审查以本分支相对基线的 diff 为准；撤回前先保全本次差异，并且只处理已确认属于本任务的具体文件。
若审查后形成提交，可用该提交的独立 revert 撤回反馈层，同时重新安装锁定依赖并运行 Web 门禁，不需要数据库回滚。

建议所有者先审查本报告及差异，再决定单独修复既有 Worker typing 问题或明确调整候选提交门槛。
