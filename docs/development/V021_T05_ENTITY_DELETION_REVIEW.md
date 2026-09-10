# T-05 实施与审查修复报告（2026-09-06，待复审）

> 2026-09-09 M6 复核更正：下文“remote_deleted_at 的显式 null 需要保留”是历史判断。
> 实际旧 main 校验器会拒绝该字段；当前修复只省略缺失的删除时间，保留非空删除时间、
> Pull/bootstrap 的 null 以及 payload 内部空值。普通冲突跨版本校验已通过，真实删除
> 冲突的旧客户端策略尚未通过，见 [M6 发布准备](./V021_M6_RELEASE_PREPARATION.md)。
> 不改写以下历史测试，也不把当前客户端测试当作旧客户端验收。

## 当前交付

Outcome: **review fixes implemented / review pending**。OPUS5 已确认核心逻辑正确；
本轮完成响应兼容性修复、验证口径更正和 ADR 待办。文末保留此前 blocked 快照，
不能将历史快照或历史测试结果当作本轮状态。

- Base: `29a2ca2fe74a4e546269ec599e90f64ea18845c3`
- Branch: `dev/T-05-entity-deletion`
- ADR-0031 已由 owner/OPUS5 定稿为 Accepted；本次完整重读后实现，未更改其决策。
- 无新增模型层阻塞。未 stage、commit、push、merge 或部署，提交仍待 owner 决定。
- T-04 的 `globals.css`、`app-shell.tsx`、`authenticated-accessibility.spec.ts`
  未编辑、未暂存。既有浏览器报告、AI 规划文档和 T-04 文档不属于候选提交。

## 决策与实现

- Goal 软删除其 Task 及这些 Task 的 Note/Resource/StudySession；Task 软删除其
  StudySession，保留 Note/Resource 并解除 `task_id`。活跃会话转 abandoned 并补结束时间。
- `sync/deletion.py` 在同一事务内先授权、锁 Space/根对象/后代、核对完整范围和引用，
  再允许写入。未软删除 EvidenceItem 及未软删除且 active 的 KnowledgeCitation 均阻塞。
  即使 Task 只解除 Note 关联，触及被引用 Note 仍整体拒绝，不能部分写入或跳过 Note。
- 拒绝为 `SYNC_DELETE_BLOCKED_BY_REFERENCE`、`retryable=false`；details 仅有
  `evidence_count`、`citation_count`。无权范围返回拒绝，不向调用者透露引用计数、标识或标题。
- 三个 delete handler 复用同一删除实现。根变更、确定性派生变更、空 payload tombstone、
  幂等记录与影响摘要审计原子提交；重复请求不再级联。在线子对象写入复用 Space 锁。
- Pull 位于 `sync/read.py`：用保留身份及当前权限授权 tombstone，隐藏已删除对象的旧 live
  payload；bootstrap 仍不包含被删除对象。删除结果返回影响摘要，tombstone payload 始终为空。
- Delete/update 使用人工冲突，不采用 LWW。依赖删除使用实际已应用前序版本，不借依赖
  偷换成另一设备的新版本。远端删除带 `remote_deleted_at`，同步中心明确提供接受服务器删除。
- ProtectedOfflineRepository 保持 delete wire 为 `{}`，可恢复正文继续加密保留。
  Pull 保护 pending/conflict 及 Yjs 未发更新，跨页不覆盖本地内容；远端加密使用独立操作键，
  防止加密期间本地编辑覆盖 Vault 内容。拒绝删除恢复本地可见性，ACK 不清掉后续未发工作。
- Planning/Records/Today Inspector 复用共享删除 AppModal，默认焦点为取消，显示服务端计数，
  活跃引用时说明原因且禁用确认。本地提交后清空选区并先报告排队，ACK/Pull 后才报告已同步。
  被动刷新不再覆盖删除错误。新增局部 44px 按钮与移动底部留白，避免固定导航遮挡删除入口。
- Note 独立外链列表仍仅接受 HTTP/HTTPS；保持纯文本 Markdown/HTML 策略，未增加快照、
  `note_links`、依赖、迁移或生产开关。实现复用现有同步、Vault 与 AppModal，未扩展删除模型。

## 本轮审查修复

- `AppliedOperationResult.impact` 和 `FailedOperationResult.details` 使用已安装
  Pydantic 的字段级 `exclude_if`，仅在值为 `None` 时省略。没有给任何路由增加
  `exclude_none`，没有改合同；删除计数、零计数和空字典继续保留。
- 完整核对 Push 响应树：`SyncConflict.remote_deleted_at` 的显式 `null` 需要保留，
  `remote_payload` 也可包含空值；RebootstrapControl 无可空字段。Pull/bootstrap 的
  `deleted_at: null` 不变。相邻 HTTP 集成新增普通 applied/duplicate/rejected/
  blocked_dependency 字段缺席和下行空值断言，删除用例新增三个根对象的精确 impact 断言。
- `test_memory_sync_integration.py` 未修改。先运行原测试复现 `details: null` 导致的
  精确响应断言失败，再修复并原样复跑通过。
- ADR-0031 追加 `vaultRecords` 安全回收待办：保留 `change.operation_id` 槽位隔离，
  将来只回收不再被实体、Outbox、冲突或可恢复文档引用的槽位，并处理并发编辑/拉取。
  至多 10 用户场景增长缓慢，本轮不实现 GC，不改变 Accepted 删除决策。

## 本轮实际验证

以下命令均在当前工作树实际执行，不是此前手工调用 package CLI 的结果。
根级检查包含工作树中原样保留的 T-04 文件，不冒充排除 T-04 的隔离候选验证。

| 实际命令                                                                                                                                                                     | 实际结果                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build`                                                                                                                     | 整条命令退出 0，四步全部执行通过                                                                                                                |
| `pnpm typecheck`（上述链内）                                                                                                                                                 | 全 workspace TypeScript；API + Worker mypy 181 source files passed                                                                              |
| `pnpm lint`（上述链内）                                                                                                                                                      | Web/offline ESLint、根级 Ruff passed                                                                                                            |
| `pnpm test`（上述链内）                                                                                                                                                      | Web 85 files / 347 passed；offline 8 files / 68 passed，branch 85.52%；contracts 13 passed；mobile 4 passed；Python 606 passed / 109 deselected |
| `pnpm build`（上述链内）                                                                                                                                                     | Next production build passed，35 个静态页面生成完成                                                                                             |
| `uv run --group dev pytest apps/api/tests/test_sync_push.py -q`                                                                                                              | 7 passed，含新增 None/空字典/零计数三组序列化断言                                                                                               |
| `uv run --group dev pytest -m integration apps/api/tests/test_memory_sync_integration.py apps/api/tests/test_sync_push_integration.py apps/api/tests/test_sync_delete.py -q` | 34 passed，含全部删除 32 项及未修改的 memory 回归                                                                                               |
| `uv run --group dev pytest -m integration apps/api/tests -q -k "sync"`                                                                                                       | 干净测试库最终 105 passed / 535 deselected，退出 0                                                                                              |
| `pnpm contracts:generate`                                                                                                                                                    | 退出 0，生成前后六个文件 MD5 全部一致，见下表                                                                                                   |
| `node scripts/check-clean-contracts.mjs`                                                                                                                                     | 已运行但失败，退出 1：当前 T-05 合同差异尚未提交                                                                                                |

### 完整集成口径与环境

此前“相关同步集成 39 项”只代表人工收窄的文件选择，不能代表本次完整口径。
本轮先用同参数 `--collect-only` 核对：105/640 tests collected，535 deselected。
pytest 的 `-k` 会匹配 marker 名，`asyncio` 包含 `sync`，因此指定选择也包含
`test_ai_routes_enforce_budget_order_capability_and_tenant_boundaries`；任务书所述
“ai_routing 不在范围内”不符合本次实际收集结果。

环境按 `.github/workflows/pr.yml` 的 integration 块设置，数据库凭据只从本机测试容器
读取到启动器内存并传给子进程，没有输出或写进文件。实际运行分两轮：

- 首轮复用已有测试库：103 passed / 2 failed / 535 deselected。AI routing 在
  `test_ai_routing_integration.py:274` 期望 `fake_generation.calls == 2`，实际为 0；
  Audit 在 `test_audit_integration.py:113` 因固定 AuditEvent 主键已存在而失败。
  这轮失败不能省略，也不能记成预期的“104 + 1”。
- 保留已有数据库和数据，创建独立空测试库，实际运行
  `uv run --package logion-api alembic -c apps/api/alembic.ini upgrade head` 成功；
  Redis 使用经检查为空的独立逻辑库，没有清空旧库。重跑完全相同的 pytest 命令：
  **105 passed / 535 deselected，58.24 秒**。Audit 和 AI routing 本轮均通过。
  未修改上述两个测试或 AI/Audit 实现；不能将旧环境失败推断为本轮代码回归，
  也不声称本次修好了 OPUS5 记录的既有 AI routing 问题。

### 合同可重生成性

重跑 `contracts:generate` 后六个契约文件 MD5 全部不变，无真实生成漂移。
以下为生成前和生成后共同的 MD5，路径相对 `packages/contracts/`：

| 文件                                   | MD5（前后相同）                    |
| -------------------------------------- | ---------------------------------- |
| `openapi/openapi.json`                 | `E4EA7675D7E04A3D1765760A2A56F36E` |
| `src/openapi.d.ts`                     | `8830A5D5B555C6E3A8379B615758FB48` |
| `schemas/sync-v1.schema.json`          | `05CB662E6788576B399602E130B665E9` |
| `src/sync-v1.ts`                       | `2843C820DA618792787FBD0892DA0157` |
| `src/sync-v1-validator.generated.js`   | `4E2994EF503A88147E1D8E44090DB359` |
| `src/sync-v1-validator.generated.d.ts` | `72C23EAD0FD29D9E6602379246577BE2` |

这不等于合同干净树门禁通过。`check-clean-contracts.mjs` 对未暂存及暂存的
`packages/contracts` 差异分别执行 `git diff --exit-code`；本次已有有意的 T-05
合同差异未提交，因此该门禁按设计在当前提交前状态无法通过。未通过 stage/commit
规避门禁；完整 `pnpm contracts:check` 没有另行重复调用。

### 拒绝与同步证据

后端拒绝证据包括：

- Evidence/Citation × Note/Task/Goal 六组拒绝；比较删除前后实体版本、删除时间、关联、
  SyncChange、ProcessedSyncOperation、AuditEvent、WorkspaceSyncState 序号，全部不变。
- 已软删除 Evidence、closed Citation、合法 deleted Citation 不阻塞；无引用删除正常。
- 两类引用事务持有 Space 锁时，删除等待，引用生效后整体拒绝。
- 跨 Workspace、他人 Private Space、Shared viewer 不获计数；Shared editor 正常删除。
- 级联写点故障整体回滚、第二设备 Pull 空 tombstone、重放不重复级联、删除释放配额、
  stale delete/update 双向冲突、Yjs 不复活正文、历史 payload 不泄露。

Offline 证据包括空 payload、Vault 密文、重启、前序依赖、blocked/conflicted Outbox、
多页 Pull、加密期间本地编辑竞态、Yjs 恢复、显式远端删除接受与拒绝后的可见性。

### 历史浏览器证据（本轮未重跑）

前一实施轮浏览器最终 9 passed：新增五个删除测试与一个安全外链测试，
另重跑三个原有工作台流程。该记录经 OPUS5 核实，但不是本轮重新执行的结果。
覆盖三个入口的正确计数、取消焦点、关闭 Inspector、真实 ACK；1440/375/320px、
320px 深色确认框、320x568 引用阻塞与断网预检。预检后通过真实 API 新增 Evidence，
再确认删除，验证服务器拒绝、列表恢复、inline 错误不被刷新覆盖且无“删除已同步”。
未使用删除 API mock。截图保存在 `/tmp/t05-browser-verification/`，不覆盖仓库既有截图。
最后截图已检查移动深色确认框及引用阻塞可读性；自动回归另覆盖工作台 Axe 与四档布局。

前一实施轮执行入口：使用当时已安装的 `vitest.mjs`、`eslint.js`、`typescript/bin/tsc` 和
Playwright CLI，等价于各 package scripts，避免候选目录触发依赖重装。
浏览器在单独候选目录运行，基线归档仅覆盖明确 T-05 文件；T-04 三文件保留 HEAD 版本。

## 限制与未运行项

- 收口实际核对：T-04 三文件、`reports/browser/results.json` 和未修改的 memory 集成
  测试共五个文件的 SHA-256 与开工前全部一致；暂存区为空。`git diff --check`、
  四个 Python 文件 Ruff format check、ADR/报告 Prettier check 和本地 Run validator 均通过。
  本轮没有 stage、commit、push、部署或浏览器报告写入。
- 无缺少凭据或模型层 blocked；合同干净树门禁为上述已运行失败状态，不声称全部门禁通过。
  全仓 `ci:fast`、Worker 数据库集成、浏览器、迁移往返及生产/真机读屏检查本轮未运行，
  不属于此次定向修复验证范围。只运行了新测试库的向前迁移，不冒充迁移往返通过。
  T-05 不包含 T-04 真机门的验收。
- 原报告的 Worker 四错误不是本次现状：完整 API + Worker mypy 已通过。
  单独对 Worker 目录运行会因 API typing 搜索范围报错，不作为完整命令结果。
- 前一实施轮普通 API 测试首次误继承临时集成环境，出现 10 个 readiness/CORS 断言失败，
  使用默认环境重跑为 532 passed。该历史记录不替代本轮根级 Python 606 passed；
  本轮普通测试未继承集成设置，没有改测试期望、认证策略或生产配置。
- 离线且没有可用服务端预检时确认按钮禁用；已经预检后断网的本地删除仍按 Outbox
  保留，不冒称服务器删除成功。重新联网后需重新核对范围。
- Duplicate 响应只确认已处理，不重复计算影响摘要；原始应用结果及审计保存该摘要。
- 临时测试栈仅供本机审查，未连接生产；该结果不证明线上部署版本或生产数据已验证。

## 历史快照：方案决策前的部分实施

以下内容保留原始阻塞与验证记录，已被上述 owner 方案 3 和实施结果替代。

## 状态与基线

Outcome: **partial / deletion semantics blocked**。这不是 T-05 完成报告。

- Base: `29a2ca2fe74a4e546269ec599e90f64ea18845c3`
- Branch: `dev/T-05-entity-deletion`
- ADR: [ADR-0031](../adr/0031-entity-deletion.md)，状态为 Proposed，先于业务代码创建。
- 未 stage、commit、push、merge 或部署；提交决定保留给 OPUS5 审查后的 owner。
- 工作区已有 T-04 实现、状态和浏览器证据，均保留且不归入 T-05 改动。
  `docs/ai_handoff/` 继续未跟踪，不进入提交。

## ADR 与待决项

提案定义软删除、事务级联、空 payload tombstone、人工处理 delete/update 冲突、
Vault 加密保留未同步内容和授权后的 tombstone 下发，禁止 LWW 和静默恢复。

任务书与实际模型有重要差异：Resource 没有 `note_id`；Evidence 只有摘要和历史引用，
没有 Note 正文快照，且 Note 类型 Evidence 的 `note_id` 不允许清空。
因此不能承诺“删除 Note 后 Evidence 正文快照不受影响”。已向 owner 提出：

1. 接受现有模型：Goal 级联其 Task 及关联 Note/Resource/StudySession；单删 Task
   删除 StudySession、保留 Note/Resource 并解除 `task_id`；单删 Note 保留 Evidence
   摘要与历史引用，但不承诺仍能读取 Note 正文。
2. 或先设计、增加 Evidence 正文快照。
3. 或阻止删除被 Evidence 引用的 Note（包括 Goal 级联）。

未收到决策；遵循任务书 §7，未实施删除处理器、offline 删除路径和三个删除 UI。
ADR 不得在确认前标记 Accepted。

## 已实施：Note 安全外链

- 新增 `note-external-links.tsx` 与局部 CSS，在 Records 安全预览后显示独立外链列表。
  不修改 `ProductMarkdownPreview`，不解释 HTML 或 Markdown 链接语法。
- 仅识别文本开头或空白后的独立 HTTP/HTTPS URL，使用 URL parser 二次校验；
  拒绝危险协议、协议相对地址、畸形地址、反斜杠和内嵌凭据。
- 链接具备 `target="_blank"`、`rel="noopener noreferrer"`、外链提示；去重并换行显示。
  未引入依赖；没有请求或验证外部 URL 的可用性。
- 新增 15 项外链组件测试，扩展 Records 集成断言和一个三档视口 Playwright 用例。

## 同步调查结果（尚未修复）

- Pull 位于 `sync/read.py`，不是 `sync/service.py`；当前可见性查询排除已删除实体，
  需要在保留权限过滤的前提下下发 tombstone，不能直接暴露历史 payload。
- ProtectedOfflineRepository 对 delete 也替换为 Vault 引用，与空 payload 约束冲突。
- Pull 只保护 `pending`，未覆盖已冲突实体与关联 Note document 更新，存在覆盖本地工作风险。
- Push wire 没有 `deleted_at` 字段；本地 mutation 和下行 change 才有。不得凭任务示例
  增加未注册 wire 字段。影响摘要和删除冲突元数据若需扩展，应同步更新严格合同与测试。

## 实际验证

| 检查                                                                                                                                                                        | 结果                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm --filter @logion/web test`                                                                                                                                            | 84 files / 336 tests passed，含最后的 Records 集成断言 |
| `pnpm --filter @logion/web lint`                                                                                                                                            | passed                                                 |
| `pnpm --filter @logion/web typecheck`                                                                                                                                       | passed                                                 |
| `pnpm --filter @logion/web build`                                                                                                                                           | passed；首次捕获组可能为空的类型错误已修复并重跑       |
| `pnpm test:browser tests/browser/records-workbench.spec.ts --project authenticated-chromium --workers 1 --reporter line --output /tmp/t05-note-links --grep "Note preview"` | 1 passed，覆盖 1440/375/320px                          |

浏览器使用本机隔离 API 和合成账号，真实创建 Note、解锁 Vault、编辑及预览，
未 mock 外链渲染。只检查链接属性与布局，不访问外部网站。
首次 375px 截图捕获了侧栏断点切换动画中途；测试补充等待侧栏移出视口后，
使用同一命令、改用 `--output /tmp/t05-note-links-final` 重跑，结果仍为 1 passed。
三张最终截图保存在 `/tmp/t05-note-links-final/` 下的测试制品目录，已逐张查看：
外链可见，长链接无横向溢出，危险协议和 HTML 为纯文本。未修改侧栏实现。

`git diff --check` 与 T-05 本地恢复账本 validator 均已通过；旧 T-04 Run 保持原样。

未执行：后端删除测试、offline 删除测试、完整 planning/records/today 浏览器回归、
API 全量测试/Ruff/mypy、合同漂移检查和 `ci:fast`。原因是删除实现尚未获语义确认；
不沿用历史检查结果冒称本轮通过。已有 Records 长流程会覆盖既有审查截图，
本轮仅运行新增定向用例并使用临时输出目录。

## 下一步

Owner 确认级联和 Evidence 保留规则后，先修订 ADR，再完成后端、offline、UI 的
纵向删除路径和全套同步/权限/冲突回归。当前仅外链部分可供代码审查。
