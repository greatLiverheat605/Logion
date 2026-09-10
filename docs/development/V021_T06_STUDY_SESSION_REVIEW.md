# T-06 StudySession 本地复现与修复

日期：2026-09-07。基线：`14fd3eb2b81869ddf967cb32b9e9fe8e2d33f2bf`。
分支：`dev/T-06-status-copy-consistency`。状态：本地复现、根因修复、回归和清理完成，代码待交接审查。

## 复现证据

- 使用隔离 Postgres 数据库、独立 Redis DB、API、完整四队列 Worker 与当前基线 Web。
  现有本地容器复用；生产未访问，邮件投递明确 disabled。合成账号通过本地 legacy register
  建立个人 Workspace/Private Space，设置 onboarding 后实际通过 Web 邮箱密码表单登录。
- UI 新建目标和任务，在线开始并以 completed 结束一次会话，填写 1 分钟及反思。
  Inspector 显示“1 分钟 · 未结束”；页面 reload 并解锁后仍然显示“未结束”。
- Push update 含 `status: completed` 和 `outcome: completed`，HTTP 200；真实 Pull 为
  `server_version: 2`、`status: completed`、`manual_minutes: 1`、非空 `ended_at` 和反思，
  没有 `outcome`。同一 session ID 的 IndexedDB entity 为 clean，outbox 空；其
  `encrypted_payload_ref` 对应的 Vault 解密 payload 与 Pull 一致，没有 `outcome`。
  实际存储是 `entities` 与 `vaultRecords`，不存在独立 `study_session` object store。

## 根因与改动

`execution/service.py` 把结束命令 `outcome` 保存为 StudySession 的 `status`；
`sync/push.py` 的 `session_payload()` 和 bootstrap 都只返回持久状态。
Today 原先直接把解密对象断言为要求 `outcome` 的类型，随后 Inspector 读取不存在的字段。
同步和 refresh 均正常，会话没有变回 active。

`use-today-controller.ts` 在解密后的会话读取投影中，由 `status` 统一派生只读 `outcome`：
active 对应 null，completed/abandoned 对应同名终态。此映射不会写回 Vault，且不修改显示
兜底、服务端模型、迁移、sync-v1 wire 或合同。仍须显式人工验收才能完成任务。

## 验证状态

- 新增 controller 回归覆盖 completed/abandoned 的 finishSession、canonical Pull 和重新
  mount；修复前两项因 outcome 缺失失败，修复后三个 Today 文件共 11 项通过。补充 active
  上残留 outcome、两个终态上相反 outcome 的回归断言，确认投影不修改存储对象。
  测试使用真实 controller，但数据库、Vault、repository 和 SyncClient 为 mock；真实同步
  与加密持久化证据来自下面的浏览器执行。
- `pnpm ci:fast` 实际退出 0，完整八门为 guard:context、agent:state:check、format:check、
  lint、typecheck、test、build、contracts:check。协调校验 118 项；mypy 181 个文件；
  Web 88 个文件 / 399 项、offline 68 项、contracts 13 项、mobile 4 项、Python
  606 passed / 109 deselected。合同生成后的干净树检查通过。
- 保留旧 coverage 于临时证据目录后执行整仓门禁，没有暂存、stash 或移动 T-04 文件来通过门禁。
  门禁使用当前工作树；浏览器候选为固定基线快照加本轮 controller 修复与浏览器断言，
  不包含搁置的 T-04 设计改动。

### 浏览器矩阵

| 场景                              | 实际观测                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| 在线 completed，1440 × 1000       | 保存后显示 completed；Pull/Vault 无 outcome，版本 2、clean、outbox 空              |
| 在线 abandoned，320 × 568         | 保存后显示 abandoned；无横向溢出，Pull/Vault 无 outcome                            |
| 离线 completed，1440 × 1000       | 本地 pending 且 outcome=completed；重连同步后 clean，存储 outcome 缺失，显示仍正确 |
| 离线 abandoned，320 × 568         | 本地 pending 且 outcome=abandoned；重连同步后 clean，显示仍正确                    |
| reload 与同设备空 IndexedDB       | 重新解锁、显式同步后四条会话仍为两个 completed、两个 abandoned                     |
| 独立设备 cold bootstrap，1440/320 | bootstrap HTTP 200 包含四条会话；全部显示正确，无“未结束”                          |

扩展脚本四条结束路径及 reload/cold bootstrap 完整执行退出 0，页面异常数组为空；独立设备
脚本也退出 0。另执行仓库 `today-workbench.spec.ts`，production build 下 **1 passed**，覆盖
320 × 640、390 × 844、1024 × 768、1440 × 900 的布局、axe、reduced motion 与完整人工验收流程。
新增断言检查结束后“开始专注”恢复、Inspector 含 completed 且不含“未结束”。

### 失败记录与边界

- 初次合成账号设置 onboarding 使用 version=0，真实设置已存在，返回 409；改为读取现有
  version 后重试成功，没有修改产品设置接口。
- 初次扩展脚本在重连时把两个“立即同步”按钮都匹配到，Playwright strict mode 失败；
  收窄到首个同步按钮后继续。下一次同设备冷浏览器仅解锁后 Inspector 为空；补上显式同步
  和选择任务后完整重跑成功。两轮失败日志与证据分别保留，没有覆盖为通过。
- 只读复核发现初版测试 mock 缺 `payload_hash` 和 `kind`，TypeScript 实跑失败；已补齐，
  后续整仓 typecheck 通过，没有使用双重类型断言绕过。
- 仓库 Today 浏览器测试在 dev 模式完成全部业务断言后，因两条 Select uncontrolled/controlled
  warning 在日志断言处失败。未屏蔽日志、未改该组件；同一代码 production build 原样重跑
  1 passed。开发模式警告仍是独立待排查事项，本轮不宣称已经修复。
- 未执行生产、邮件投递、真机或完整数据库 integration 标记测试；Python 的 109 deselected
  不计为通过。独立只读子代理复核最终三份代码 diff 未发现新 actionable findings，其报告不
  代替主线实跑结果。

## 文件与证据

修改位置：

- `apps/web/src/features/execution/use-today-controller.ts:819`：会话读取投影。
- `apps/web/src/features/execution/use-today-controller.integration.test.tsx:93`：两个结束结果的回归。
- `tests/browser/today-workbench.spec.ts:224`：结束状态的浏览器断言。
- 本报告与 `docs/development/V020_STATUS.md`：追加当前实证与交接状态。

本机证据根目录为 `/tmp/t06-study-lBUoC0`，全部来自本轮隔离账号：

- `before-evidence.json` 与 `before-completed.png`、`before-reload.png`：修复前实际字段及画面。
- `after-final-evidence.json` 与八张 `after-final-*.png`：四条结束路径、两次重连、reload、cold bootstrap。
- `cold-evidence.json` 与 `after-cold-bootstrap-{1440,320}.png`：独立设备实证。
- `ci-fast.log`、`candidate-production-build.log`、`formal-browser-production.log`：门禁和 production 浏览器执行日志。
- `candidate/reports/ui-refactor/after/app-today-{320x640,390x844,1024x768,1440x900}.png`：仓库浏览器四档截图。
- `formal-browser.log`、`after-evidence.json`、`after-retry-evidence.json`：如实保留的失败尝试。
- `cleanup.json`：清理前后行数。

代表性的修复前、修复后桌面与最窄截图已人工查看。临时脚本位于仓库外，未把认证凭据、
终端日志或运行状态加入 Git；注册临时凭据文件已删除。

## 清理与交接

清理前，本轮独占测试数据库共有 5 个合成用户、5 个 Workspace、5 个 Space、6 个 Task、
14 条 StudySession。确认全部账号均属于本轮后，重建该隔离数据库并迁移到 head；上述五类
行数实查均为 0，对应 Redis DB 也已清空。API、完整 Worker 和 Web 保留为空库测试栈；
既有其他本地数据库、容器与生产均未修改。

T-04 三文件 SHA-256 与开工时一致，全部仍为未暂存。原有 V020_STATUS 字节前缀保持不变，
所有其他既有改动和未跟踪文件保留。新 Run 为 `run-v021-t06-study-session`，旧 Run 与事件未改写。
本轮没有 stage、commit、push、merge 或部署；依交接中的“只在用户明确要求时提交”保留可审查 diff。
