# T-05a 本地失败附件单条移除

日期：2026-09-07。基线：`14fd3eb2b81869ddf967cb32b9e9fe8e2d33f2bf`。
工作分支：`dev/T-06-status-copy-consistency`。状态：实现、验证与技术审查完成，待 Git 交付。

## 授权与范围

用户在 FABLE 计划补齐后的下一步建议上明确“开始”。本轮先复核 T-06 StudySession，
再实施 T-05a。原始需求来自 FABLE 开发计划 T-05a：只移除本地 failed 附件队列单行，
不修改同步协议或生产 ingest 开关。

为保留当前未提交的 StudySession 修复、计划归纳及 T-04 工作区，继续使用当前工作树。
T-05a 独占修改范围为 `packages/offline/src/resilience.ts`、相邻 resilience 测试、
Web sync center/workbench 与相邻测试/样式、`tests/browser/sync-workbench.spec.ts` 及
`playwright.config.ts` 的测试发现项，以及本报告和状态/计划索引。浏览器验证
使用隔离候选与合成数据；不包含搁置的 T-04 候选。尚无新的 stage/commit/push 指令。

T-04 的 globals.css、app-shell.tsx、authenticated-accessibility.spec.ts 保持原字节且不暂存。
不改 API、认证、数据库迁移、IndexedDB schema、Vault 格式、sync-v1 合同或其他实体删除语义。

## 实现

- `removeFailed(workspaceId, attachmentId)` 校验 UUID，在单个 attachmentQueue 读写事务中
  重查工作区与 failed 状态，再单行删除。blob 就在该行，不调用 Vault 或全设备清理。
- `retry()` 的读取/检查/状态更新也进入同表事务，避免另一连接移除后重试仍报告成功。
  retry 先完成则 remove 拒绝 pending；remove 先完成则 retry 拒绝缺失。
- failed 行增加移除确认，显示文件名与本地影响范围。取消不改变数据；离线可执行。
  成功后刷新当前队列投影、反馈文件名，焦点落到附件列表标题；失败保留条目和弹窗错误。
  pending/uploading/verified 条目不可移除；缺元数据的 legacy failed 条目允许清理。
- 复用现有 AppModal、图标和删除确认样式；不新增依赖或通用删除框架。
- 跨标签页先重试/移除时，失败后读取实际队列，关闭失效确认并反馈状态变化；真实存储
  失败仍保留 failed 行和弹窗错误，读取也失败时一并显示，不伪造成功。
- 320px 实际截图发现此前上传错误 toast 遮挡确认框标题，已以此弹窗专属 CSS marker
  暂时隐藏外层 Sonner；关闭后恢复，当前操作错误由弹窗内 alert 保留。未修改全局反馈 API。

## 验证记录

- 先新增仓储回归，初轮 7 失败/8 通过（removeFailed 尚未实现）；实现后 resilience
  15 项通过，Web sync center/workbench 初轮共 8 项通过；补跨标签页回归后 10 项通过。
- 仓储回归使用真实 Dexie + fake-indexeddb，包括双连接相反先后顺序、工作区隔离、
  状态/UUID/缺失拒绝和 legacy 清理；保留其他附件、加密实体、Vault 与 Outbox。
- Web 测试使用真实组件/仓库但手写存储及 API mock，覆盖确认/取消、离线、失败可见性、
  不发起 HTTP 请求、不清空 Vault；不把 mock 当作真实浏览器/磁盘验收。

最终实际运行：

| 检查                                | 观察结果                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 完整 `pnpm ci:fast`                 | 八门退出 0；Web 403、offline 74、contracts 13、mobile 4、Python 606 passed / 109 deselected；mypy 181 文件，协调测试 118                 |
| 隔离候选 `next build --webpack`     | 生产构建通过；HEAD 快照加 12 份允许路径的最终内容，T-04 三文件使用 HEAD 原文                                                             |
| Playwright `sync-workbench.spec.ts` | 最终 Chromium 1 passed；测试图片冻结动画后再跑 1 passed，不累加为不同场景数                                                              |
| 浏览器实际流程                      | 真实 Note 与两个 Blob 入队，离线保存标题形成非空 Outbox，真实断网上传产生 failed；取消/Escape 不变、确认只删目标、在线 reload 后仍不存在 |
| 本地保留断言                        | 非空 entities/vaultMetadata/vaultRecords/outbox 与其余 store 逐行不变；保留附件的 Blob 另计算 SHA-256；不只比较空数组或存储的哈希字段    |
| UI / 网络                           | 1440×900、320×568，确认框 axe 0 violations、初始取消焦点/退出焦点通过，无 pageerror；移除流程未发 API 或写请求                           |
| 独立只读复核                        | 1 个 P2 跨标签页状态失效问题已修复；测试恢复网络时序和窄屏 toast 遮挡已修正，复核无新增 actionable findings                              |
| 候选与保护                          | 12 文件与隔离候选字节相同；T-04 三文件 SHA-256 不变且候选排除；暂存区为空、`git diff --check` 通过                                       |

候选清单摘要（按 12 个路径及 SHA-256 构建的 JSON 清单）：
`c3215c8951b7056ed7d6dff19b536f87f9fed33c9e5e0445e374b7ef8cf52fea`。
这不是 Git commit，也不替代后续绑定正式提交的 acceptance manifest。

失败记录均保留：首次完整 CI 在通用快照的 any 字段访问处失败，修正为类型明确的队列
快照；第二次在 effect 同步 setState lint 失败，改为可取消的 microtask。其后完整门禁通过，
视觉小修后的最终完整门禁再次通过。浏览器初两轮分别缺少 Sync 解锁及解锁后重新选 tab，
第三轮把无关 Next GET 预取算入“移除请求”；改为检查 API/非 GET 请求后通过。真实截图
继续发现 toast 遮挡，已修正后复验，不删除旧失败日志。

本机证据分组：`t05a-verify-DMBKxD` 保存 CI 日志和迁出的 coverage；
`t05a-browser-h0ZAlX` 保存隔离构建、浏览器日志、四张最终截图、候选哈希清单和清理结果。
截图包含桌面/320px 确认框、320px 移除后和桌面 reload；不作为 T-04 或移动实体设备验收。

## 清理和剩余边界

- 本轮累计 6 个合成用户及其 Workspace、Space、Note 已清理；两次清理分别核对 91 张
  业务表，最后总行数均为 0。Redis 为 0 keys，3 个初始化失败的空库已验证无表后删除。
- 初始化曾因新端口未对应 WebAuthn 本地 origin 失败；仅修改临时栈环境。清理最初使用
  同步引擎/未安装驱动失败，改为项目已有 async engine 后执行成功；未修改产品配置或依赖。
- Playwright context 已关闭，认证临时文件已移除；3 份失败 trace（含合成口令输入）已删除，
  保留无口令的失败日志、截图与最终结果。空数据库、API、Worker 和本地预览保留供后续审查。
- 本轮未运行完整 58 项 M5、Firefox/WebKit、真机/真实读屏、生产 scanner、真实邮件或生产
  ingest 验收。没有生产动作、stage、commit、push、merge 或 deploy。
- 本地 Run 追加 T-05a review 入口并验证，技术结果在本报告记录。旧席位模型证明未补造，
  不伪造 assigned/accepted 生命周期；三项交接任务保持 pending。

## T-06 审查收口

本轮只读复核三份 StudySession 代码，blob 与上一轮最终候选一致，未发现阻塞 findings；
三文件 `git diff --check` 通过。此前真实栈和完整门禁证据继续引用
[StudySession 报告](./V021_T06_STUDY_SESSION_REVIEW.md)，不记为本轮重新运行。
技术审查已完成，Git 交付和生产发布仍分别跟踪。
