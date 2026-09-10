# Logion v0.2.1 开发计划（GPT5.6 执行）

> 规划人：FABLE5-1 · 2026-09-05
> 基准：main @ 37e2e00。文中所有 `file:line` 均为本轮对该 SHA 的核对结果，标注 `[已核实]`；标注 `[推断]` 的内容执行者必须先验证再动手。
> 上位文档：`LOGION_V021_MAINLINE_PLAN_2026-09-04.md`（范围与验收）、`LOGION_UI_OPTIMIZATION_PLAN_2026-09-04.md`（反馈层设计）

## 0. 使用说明

1. GPT5.6 按任务 ID 顺序执行，每个任务一个分支 `dev/T-<nn>-<slug>`，每个任务一个 PR 指向 `main`。
2. 开工前先 `git fetch` 并确认 `origin/main == 37e2e00`（本规划分支未能连接远端，见版本计划头部）。
3. 每个任务的"已核实事实"是规划者读代码的结论，**不替代执行者自己的阅读**；发现不一致时以代码为准并在 PR 中说明。
4. 硬约束：不违反 `docs/gpt_work/LOGION_AI_DEVELOPMENT_CONSTRAINTS.md` §1 的 10 条不变量；不得为让功能"看起来能用"而隐藏失败或放宽安全校验；不得删失败测试；受限项不以仿真冒充真机。
5. 交付格式按约束 §12.3 / §24.5：需求 ID、修改文件、测试命令与结果、迁移/回滚、未验证项。**未运行的检查不得写成通过**。

## 1. 任务分解

### T-00：暴露部署 build SHA（非代码前置 + 1 h 代码）

**优先级**：等同 P0（发布判断前提）
**目标**：公网可读到与部署源码一致的版本标识。

**已核实事实**：

- 后端 `apps/api/src/logion_api/health.py:16-20,26,52` 的 `HealthResponse.version` 来自 `settings.version`；`config.py:17` `env_prefix="LOGION_"`，`:22` 默认 `"0.1.0"`。
- 生产手册 `infra/runbooks/aliyun-production-release.md:536` 写入 `LOGION_VERSION=${SOURCE_SHA}`；`compose.yaml:66/134/262` 传给 api/worker/backup，**web 服务未传**。
- `infra/nginx/nginx.conf:38-48` 仅 `/api/` 到后端；`:49` 其余到前端。后端健康路由无 `/api` 前缀，公网不可达。
- 前端 `apps/web/src/app/health/route.ts:7` 写死 `version: "0.1.0"`。2026-09-05 实测 `https://logion.work/health` 返回该值。

**步骤**：

1. **运维（无代码，先做）**：在生产主机执行 `logion-compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"`（手册 `:645`），记录 `version`；`docker inspect` 四容器镜像 digest 与 RC 候选 manifest 对照。把结果写入 `docs/development/V020_STATUS.md`。
2. **代码**：`route.ts` 改为 `version: process.env.LOGION_VERSION ?? "unknown"`；`compose.yaml` web 服务 `environment` 加 `LOGION_VERSION: ${LOGION_VERSION:-0.1.0}`。web 为 standalone 运行时，环境变量运行时读取。
3. 可选：nginx 加 `location = /api/health/ready { proxy_pass http://logion_api/health/ready; }`，让后端版本也公网可读。

**验收**：

- [ ] 步骤 1 结果已记录，明确"线上当前是 RC7 还是 RC8 或其他"。
- [ ] 部署后 `curl https://logion.work/health` 的 `version` 等于 `.env` 中 `LOGION_VERSION`。
- [ ] `apps/web` 单测覆盖 `route.ts` 读取环境变量（可选）。

**预估**：运维 0.5 h + 代码 1 h。

---

### T-01：修复附件上传谎报成功（ISSUE-008）

**优先级**：P0（违反 Invariant 10）
**目标**：附件上传失败时不得显示成功文案；按实际结果分支呈现，并保留具体错误码。

**已核实事实**：

- 根因 `packages/offline/src/resilience.ts:399-411`：`uploadPending` 的 `catch` 把行更新为 `state: "failed"` 后不 rethrow，`:409-411` 正常返回 entry。这是"用返回值报告结果"的设计，不是 bug 本身。
- 谎报点 `apps/web/src/features/sync/offline-sync-center.tsx:464-482`：`upload()` 在 `await repository.uploadPending(...)` 后无条件 `setStatus("附件上传队列已处理一项，并完成服务器哈希验证。")`（`:476`）；`catch` 永不触发。
- `uploadPending` 全仓仅此一个调用方（grep `uploadPending`，排除测试）。
- 已有单测 `packages/offline/tests/resilience.test.ts:554-568` 断言 transport 抛错 → `state: "failed", last_error_code: "OFFLINE_ATTACHMENT_UPLOAD_FAILED"`；`:590-598` 断言 `complete` 返回非 verified → `OFFLINE_ATTACHMENT_VERIFICATION_FAILED`。**任务书验收第 1 条已被现有测试满足**，缺的是组件级测试。
- `apps/web/src/features/sync/sync-workbench.test.tsx` 中**没有**任何上传相关断言（grep "上传|哈希|upload" 为空）。
- 错误码丢失 `[已核实]`：`resilience.ts:400-403` 只在 `error instanceof OfflineStorageError` 时保留 code，否则统一写 `OFFLINE_ATTACHMENT_UPLOAD_FAILED`。而 `ApiAttachmentUploadTransport`（`apps/web/src/features/sync/attachment-upload-transport.ts`）抛的是 `LogionApiError`，其 `code`（如服务端 `KNOWLEDGE_ATTACHMENT_INGEST_DISABLED`，`knowledge_space/errors.py:72`）**被丢弃**。这直接导致用户看不到"功能未开放"这一真实原因。
- 顺序细节 `[已核实]`：`upload()` 先 `retry(attachment.attachment_id)`（`:469-471`）再 `uploadPending(workspaceId, …)`；后者按 `[workspace_id+state+queued_at]` 取**第一条** `pending_upload`（`:361-367`），不一定是用户点的那条。文案"已处理一项"没有指明是哪项。
- 同类模式排查 `[已核实，供执行者复核]`：`packages/offline/src` 共 15 处 `catch (`。14 处均 rethrow（`normalizeStorageError` 或原样 throw，或包装为 `OfflineStorageError`）：`database.ts:108`、`bootstrap.ts:196/218/258`、`protected-repository.ts:39`、`vault.ts:114`、`hashing.ts:65/81`、`validation.ts:43`、`yjs-notes.ts:291`、`sync-client.ts:78`、`resilience.ts:241`、`repository.ts:184/244`。**唯一"吞异常 + 靠返回值报状态"的是 `resilience.ts:399`**。另 `resilience.ts:370-380` 的元数据缺失分支也走"标 failed 后返回"，但没有 try/catch。

**实施步骤**：

1. **调用方按返回值判定**（不改 `uploadPending` 签名）：
   ```typescript
   const result = await repository.uploadPending(workspaceId, transport);
   if (result === null) setStatus("附件队列中没有待上传项。");
   else if (result.state === "verified")
     setStatus(`附件「${result.filename}」上传成功，并完成服务器哈希验证。`);
   else setStatus(attachmentFailureMessage(result)); // 见步骤 2/3
   ```
2. **保留服务端错误码**：在 `apps/web` 侧给 `ApiAttachmentUploadTransport` 包一层（或在 `upload()` 内用闭包）记录最后一次 `LogionApiError`；失败分支优先显示该 `code` + `requestId`，其次显示 `result.last_error_code`。**不改 IndexedDB schema**（`attachmentQueue` 表不加字段），避免触发 offline schema 升级门禁。
   - 备选（改 offline 包）：`resilience.ts:400-403` 增加 `error instanceof LogionApiError` 分支保留 code。但 `packages/offline` 不应依赖 `apps/web` 的 `LogionApiError`，需改为 duck-typing（`typeof error.code === "string"`）。执行者二选一并在 PR 说明。
3. **区分文案与处置建议**：`OFFLINE_ATTACHMENT_METADATA_REQUIRED` → "需补全目标对象信息"；`OFFLINE_ATTACHMENT_VERIFICATION_FAILED` → "服务器未确认哈希，可重试"；`OFFLINE_ATTACHMENT_UPLOAD_FAILED` / `LogionApiError` → 显示 code 与请求编号；`KNOWLEDGE_ATTACHMENT_INGEST_DISABLED` → "服务端附件功能当前未开放，本地文件保留在队列中"。
4. **文案指明对象**：成功/失败均带 `result.filename`。
5. **同类模式排查交付**：把上面"已核实"的 15 处清单复核一遍，写入 PR 描述（含"已确认无问题"的 14 处）。若 `apps/web` 中有其他"依赖异常判断成功"的 offline 调用点，一并列出（不要求本任务修）。

**涉及文件**：

- `apps/web/src/features/sync/offline-sync-center.tsx:464-482`
- `apps/web/src/features/sync/attachment-upload-transport.ts`（若选步骤 2 主方案）
- `apps/web/src/features/sync/sync-workbench.test.tsx`（新增用例）
- `packages/offline/src/resilience.ts`（仅备选方案会改）

**约束**：Invariant 10；不得为"让上传看起来成功"而隐藏 failed 行或自动清队列。

**验收**：

- [ ] `packages/offline` 现有单测 `:554-598` 继续通过（已覆盖 transport 抛错 → failed）。
- [ ] 新增组件测试：mock transport 抛 `LogionApiError{code:"KNOWLEDGE_ATTACHMENT_INGEST_DISABLED"}`，断言页面**不出现**"完成服务器哈希验证"，**出现**该 code 或其映射文案。
- [ ] 新增组件测试：mock transport 成功 → 出现成功文案且含文件名。
- [ ] `pnpm ci:fast` 全绿。
- [ ] 真实浏览器复测清单 5.4：失败时显示具体错误码；成功时才显示验证成功。
- [ ] PR 描述含 15 处 catch 的排查清单。

**预估**：5-8 h（任务书 7-11 h；下调原因：单测已存在、同类模式仅 1 处）。

**T-01b（需线上访问，可与 T-00 运维步骤一起做）**：确认线上 `LOGION_KNOWLEDGE_SPACE_ATTACHMENT_INGEST_ENABLED` 取值。`config.py:176` 默认 `False`；`V020_STATUS.md` 记录 RC6/RC7 均关闭 `[推断：线上很可能仍关闭，这就是上传失败的原因]`。即使确认为预期行为，T-01 仍必须修。

**提交规范**：

```
fix(web): stop reporting attachment upload success on failure (ISSUE-008)

uploadPending reports results via the returned entry state and never
throws on transport failure, so the caller's catch never ran and the
success copy fired unconditionally. The caller now branches on the
returned state, keeps the server error code (e.g.
KNOWLEDGE_ATTACHMENT_INGEST_DISABLED) instead of collapsing it to
OFFLINE_ATTACHMENT_UPLOAD_FAILED, and names the file it processed.

Tested:
- packages/offline: existing failed/unverified cases still pass
- apps/web component: failure path asserts absence of verification copy
  and presence of the server error code; success path asserts filename
- Browser: checklist 5.4 re-run

Swept packages/offline for swallow-and-return: 15 catch sites, 14 rethrow,
1 (uploadPending) reports via state by design and is now handled.

Closes: ISSUE-008
Co-Authored-By: GPT 5.6 <noreply@openai.com>
```

---

### T-02：拆分 DNS 错误码并修复 Provider 发现（ISSUE-001）

**优先级**：P0
**目标**：让 `AI_PROVIDER_DNS_BLOCKED` 可辨因；再据此修线上 Provider 发现。

> 不按"SSRF 拦截"方向排查。"域名解析包含非公网地址"是 `provider-center.tsx:53-54` 的静态查表文案；服务端 `details` 为空。OPUS5 报告实测目标域名 A/AAAA 均为公网地址 `[此为 OPUS5 结论，规划者未复现]`。

**已核实事实**：

- `apps/api/src/logion_api/ai_gateway/network.py:27-33`：`except (OSError, UnicodeError, ValueError)` → `ValueError("provider DNS resolution failed")`；`if not addresses or any(not address.is_global …)` → `ValueError("… not exclusively public")`。两种语义同一异常类型。
- `adapter.py:41-47`：`hostname is None` → `DNS_BLOCKED`；`except ValueError` → `DNS_BLOCKED`。`generation_adapter.py:49-55` 完全相同的两处。
- `_error(code, status, retryable)` 是现有构造方式。
- 前端 `provider-center.tsx:53-54` 静态文案；`:51-52` 已有 `AI_PROVIDER_URL_BLOCKED` 文案可作 hostname-None 的归宿。
- 测试 `apps/api/tests/test_ai_provider.py:146-159` 参数化 `["127.0.0.1"]` 与混合地址 → 断言 `DNS_BLOCKED`。这两个用例语义上仍属"含非公网地址"，**断言不需要改**；需要**新增**"resolver 抛 `OSError`（或返回空列表）→ `UNRESOLVABLE`"用例。
- 错误码没有集中注册表：`grep AI_PROVIDER_URL_BLOCKED packages/contracts` 无命中，只在 `ai_gateway/service.py`。新错误码**不会**产生 OpenAPI diff，但仍要跑 `pnpm contracts:check` 确认零漂移。

**实施步骤（顺序不可颠倒）**：

1. `network.py`：定义 `class ProviderDnsUnresolvable(ValueError)` 与 `class ProviderDnsNotPublic(ValueError)`，分别在两处抛出；空列表归 `Unresolvable`。
2. `adapter.py` 与 `generation_adapter.py`：
   - `hostname is None` → 改映射 `AI_PROVIDER_URL_BLOCKED`（422，不可重试）——这是 URL 问题不是 DNS 问题 `[规划建议，执行者可保留原码但需说明]`。
   - `ProviderDnsUnresolvable` → `AI_PROVIDER_DNS_UNRESOLVABLE`，HTTP 503，`retryable=True`，`details={"hostname": hostname, "resolved_count": 0}`。
   - `ProviderDnsNotPublic` → `AI_PROVIDER_DNS_BLOCKED`，422，`retryable=False`，`details={"hostname": hostname, "resolved_count": len(addresses)}`。
   - **安全约束**：`details` 中**不得**出现任何解析到的 IP，否则 SSRF 拦截变成内网探测信道。单测必须断言 `details` 序列化后不匹配 IPv4/IPv6 正则。
3. 前端 `provider-center.tsx:53-54`：`DNS_UNRESOLVABLE` → "无法解析 Provider 域名（{hostname}），请检查服务端网络或 Provider 配置；可重试。"；`DNS_BLOCKED` → 保留现文案；`details` 缺失时用中性文案。若 `last_health_status`（`:666`）展示错误码，同步适配。
4. **运维**：容器内 `getent hosts <provider_host>`、`cat /etc/resolv.conf`、出站策略、是否需 egress 代理。若确为无出网 → 部署配置问题，按基础设施修复并记录到 `V020_STATUS.md`。
5. **配置核对**：读取该 provider `base_url`（凭据字段密文，不解密）。

**明确禁止**：放宽 `resolve_public_addresses` 的公网校验（Invariant 6 / 约束 §7.2）。

**涉及文件**：

- `apps/api/src/logion_api/ai_gateway/network.py:22-34`
- `apps/api/src/logion_api/ai_gateway/adapter.py:32-56`
- `apps/api/src/logion_api/ai_gateway/generation_adapter.py:46-56`
- `apps/api/tests/test_ai_provider.py`（新增用例）
- `apps/web/src/features/ai/provider-center.tsx:46-64`

**验收**：

- [ ] 单测：resolver 抛 `OSError` → `AI_PROVIDER_DNS_UNRESOLVABLE`，status 503，retryable True；含非公网地址 → `DNS_BLOCKED` 422 False（现有用例）；两者 `details` 均含 `hostname` 与 `resolved_count`，**不含 IP**。
- [ ] `generation_adapter` 同样两条路径有测试。
- [ ] `pnpm ci:fast` 全绿；`pnpm contracts:check` 零漂移。
- [ ] 真实浏览器复测清单 2.4/2.5：错误信息能区分"网络问题"与"配置问题"。
- [ ] 若步骤 4 完成且 DNS 修复：discover-models 200。

**预估**：8-10 h（步骤 4/5 需运维，可能阻塞；步骤 1-3 约 5 h）。

**提交规范**：

```
fix(ai): distinguish DNS resolution failure from SSRF block (ISSUE-001)

resolve_public_addresses raised one ValueError for "cannot resolve" and
"resolved to non-public address"; both adapters mapped it to
AI_PROVIDER_DNS_BLOCKED with empty details, so operators could not tell
an outage from a security block.

Split into AI_PROVIDER_DNS_UNRESOLVABLE (503, retryable) and
AI_PROVIDER_DNS_BLOCKED (422, not retryable). details carries hostname
and resolved_count only; never the addresses. Hostname-less URLs now map
to AI_PROVIDER_URL_BLOCKED. Frontend copy no longer asserts a cause the
server did not report.

Tested:
- Unit: both adapters, both paths; details asserted free of IP literals
- Contract: pnpm contracts:check clean

Refs: ISSUE-001
Co-Authored-By: GPT 5.6 <noreply@openai.com>
```

---

### T-03：操作反馈可感知性复核 + 统一瞬时反馈层（ISSUE-002）

**优先级**：P1（**前提已修正**，步骤 0 结果可能支持所有者降级）
**目标**：7 个模块的异步操作在触发点附近有可见、可区分成败、屏幕阅读器可感知的反馈；引入全站瞬时反馈层；**保留** inline status。

**已核实事实（推翻台账"0 渲染"）**：

| 文件                                        | `setStatus` | 渲染点                                                                                                                     | a11y |
| ------------------------------------------- | ----------: | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| `features/memory/review-center.tsx`         |          33 | `review-workbench.tsx:1600` `<StatusLine>{context.status}</StatusLine>`（`:215` 定义，`role="status" aria-live="polite"`） | ✅   |
| `features/exam/exam-center.tsx`             |          19 | `exam-workbench.tsx:1182` 同上                                                                                             | ✅   |
| `features/self-study/self-study-center.tsx` |          17 | `self-study-workbench.tsx:1141` `div.statusLine aria-live="polite"`                                                        | ✅   |
| `features/ai/provider-center.tsx`           |          18 | `:186` 派生 `visibleStatus` → `:454` 工具栏、`:880` Inspector，均 `aria-live`                                              | ✅   |
| `features/ai/run-center.tsx`                |          12 | `:356` 工具栏、`:723` Inspector，均 `aria-live`                                                                            | ✅   |
| `app/app/settings/persona-settings.tsx`     |           6 | `:470` 工具栏 `aria-live`                                                                                                  | ✅   |
| `features/sync/offline-sync-center.tsx`     |          20 | prop → `sync-workbench.tsx:296`（Inspector）、`:358`（错误态）                                                             | 部分 |

台账用字面量 `{status}` 统计，漏掉了 `context.status`、`visibleStatus`、条件表达式。**GPT 黑盒 2.5 项"页面明确显示域名解析…"就是 provider-center 的渲染在工作。**

**仍成立的缺陷**：单状态槽互相覆盖；成功/失败无语气区分（`review-workbench.module.css:309-315` 三级灰）；状态槽在顶部工具栏或 Inspector，离触发点远，移动端 Inspector 收起时可能不可见；全站无瞬时浮层；exam/self-study/persona/run 四模块反馈**从未被黑盒验证**。

**实施步骤**：0. **真实浏览器逐模块复核（必做，2-3 h，先于任何改动）**：对 7 个模块各选 1 个成功操作 + 1 个失败操作（如断网、非法输入），在 1440 与 375 视口记录：状态文字是否可见、距触发点距离、是否被后续消息覆盖、屏幕阅读器是否朗读。产出一张表放进 PR。**若 7 模块均"可见且可朗读"，停下来把结果交所有者决定是否降级。**

1. **CSP 探针（≤1 h）**：在开发构建以生产 CSP（`proxy.ts:12-31`，`style-src 'self' 'nonce-…'`）挂载 Sonner `<Toaster>`，观察控制台是否有 CSP 违规。通过 → 用 Sonner；不通过 → 项目内实现（`aria-live` 区域 + 队列 + 计时器）。**禁止放宽 CSP。** 新依赖需说明许可证、维护状态、包体、替代方案（约束 §12.2）。
2. **反馈 API**：`apps/web/src/lib/feedback.ts` 导出 `feedback.success(text)`、`feedback.error(error | text, { requestId? })`、`feedback.pending(text) → dismiss()`；Provider 挂在 `app/layout.tsx`（或 `app/app/layout.tsx`，与 `SessionBoundary` 顺序核对）。成功 3 s 自动消失；错误需手动关闭；不阻塞操作。
3. **接入 7 模块**：在各 `setStatus` 的成功/失败分支**追加**调用，不删除 inline（inline 承担持久状态，浮层承担瞬时确认，见原型方案 §6）。错误必须带具体 code 或 `requestId`。优先顺序按步骤 0 表中"最不可见"排。
4. **加载态**：异步按钮 `disabled` + 文案变化，已有 `pending` 模式（如 `planning-workbench.tsx:563`）可复用，不引入 spinner 组件。
5. `offline-sync-center` 的 `:358` 错误态补 `aria-live`。

**涉及文件**：新增 `lib/feedback.ts`、`components/feedback/feedback-provider.tsx`；修改上表 7 个 center/settings 文件（追加调用，不重写）；`app/layout.tsx`。**与 T-01（offline-sync-center）、T-02（provider-center）有交集，T-01/T-02 先合。**

**约束**：中文文案；成功 3 s 自动关闭、错误手动关闭；非 modal；对屏幕阅读器可感知（实测，不假设）；不移除 inline status；不放宽 CSP。

**验收**：

- [ ] 步骤 0 表格已交付。
- [ ] `pnpm ci:fast` 全绿。
- [ ] 7 模块每个至少 1 个成功 + 1 个失败操作在真实浏览器可见且在触发点附近；失败显示具体错误码。
- [ ] 320×568 下浮层不遮挡主操作、不引发横向滚动。
- [ ] 屏幕阅读器朗读浮层内容（NVDA/VoiceOver 任一，记录版本）。
- [ ] 生产 CSP 下控制台无 CSP 违规。

**预估**：8-12 h（任务书 14-17 h；下调原因：不需要补渲染，只追加瞬时层）。

**提交规范**：

```
feat(web): add transient feedback layer alongside inline status (ISSUE-002)

All seven modules already rendered their status text (context.status /
visibleStatus / toolbar), but in a single overwriting slot far from the
trigger and without a global transient layer. This adds a CSP-safe
feedback layer and wires success/failure calls next to existing
setStatus branches. Inline status is kept for persistent state.

Scope note: this is not a rewrite of 147 call sites and does not touch
security-center / audit-log / account-deletion-recovery.

Tested:
- Per-module real-browser table (success + failure, 1440 and 375)
- 320x568: no occlusion, no horizontal scroll
- Screen reader announces feedback
- No CSP violations under production policy

Closes: ISSUE-002
Co-Authored-By: GPT 5.6 <noreply@openai.com>
```

---

### T-04：修复移动侧栏焦点陷阱（ISSUE-009）

**优先级**：P1
**目标**：关闭态侧栏不可聚焦、不可被辅助技术访问；打开态焦点移入并约束；Esc 关闭并归还焦点。

**已核实事实**：

- `apps/web/src/components/app-shell/app-shell.tsx`：`<aside className="app-sidebar{ open}">`（约 `:215`），`menuOpen` state；遮罩 `<button aria-label="关闭主导航" className="app-navigation-scrim">`（`:312-319`）；触发按钮 `aria-label="打开主导航" aria-expanded={menuOpen}`（`:324-331`）。无 `inert`/`aria-hidden`/焦点管理。
- `globals.css:1836-1848`：`@media (max-width: 45rem)` 下 `.app-sidebar { transform: translateX(-103%) }`，`.open { transform: none }`。桌面端侧栏常驻可见。
- 项目已有 `@radix-ui/react-dialog@1.1.23`；`app-modal.tsx` 实现了 `onOpenAutoFocus` / `onCloseAutoFocus` 归还焦点；命令面板与通知中心用它。
- React 19.2.7 支持布尔 `inert` 属性。

**实施步骤**：

1. 用 `useSyncExternalStore` + `matchMedia("(max-width: 45rem)")` 得到 `isMobile`。
2. `<aside inert={isMobile && !menuOpen}>`。**不能**在桌面端加 `inert`。旧 WebView 回退：同条件下加 `aria-hidden="true"` 与 CSS `visibility: hidden`（配合 transform 过渡结束后切换，避免动画闪断）。
3. 打开时（`menuOpen` 变 true 且 `isMobile`）把焦点移到侧栏首个可聚焦元素；记录 `document.activeElement` 以便归还。
4. Tab 循环：在 `<aside>` 上 `onKeyDown`，Tab/Shift+Tab 到首尾时回绕；`Escape` → `setMenuOpen(false)` 并把焦点还给"打开主导航"按钮（`ref`）。
5. 备选：把移动态侧栏改用 Radix `Dialog` 渲染（复用 `AppModal` 焦点逻辑）。改动更大（侧栏在桌面是布局元素，需双份渲染），仅在方案 1 真机验证失败时采用。
6. 浏览器测试：在 `tests/browser/authenticated-accessibility.spec.ts` 增加移动视口用例：关闭态连续 Tab 40 次，`document.activeElement` 从不在 `.app-sidebar` 内；打开态 Tab 不离开；Esc 后焦点在触发按钮。

**验收**：

- [ ] 关闭态连续 Tab 遍历整页，焦点从不进入侧栏（Playwright 用例 + 手动）。
- [ ] 打开态 Tab 不离开抽屉。
- [ ] Esc 关闭后焦点回到"打开主导航"。
- [ ] 桌面端（≥45rem）侧栏导航行为不变（回归 `authenticated-shell.spec.ts`）。
- [ ] **真机屏幕阅读器**（VoiceOver 或 TalkBack）验证并记录设备/系统版本；仿真结果不算通过。

**预估**：4-6 h（含真机）。

---

### T-05：核心实体删除入口（ISSUE-010）—— 默认 v0.2.2

**优先级**：P2；若开放多人试用则建议提前
**目标**：Goal / Note / Task 可删除（软删除 + tombstone 同步），删除前二次确认并说明级联范围；附件队列支持单条移除。

**已核实事实（改变任务性质）**：

- 服务端 `apps/api/src/logion_api/sync/push.py:205-224` 处理器注册表只有 `create`/`update`（learning_goal create；task create/update；study_session create/update；note create/update；resource create/update；evidence create；verification update；topic/topic_dependency/mastery create）。**没有任何 `delete` 处理器**；未注册操作 → `SYNC_OPERATION_UNSUPPORTED`（`:381`）。
- 但基础设施已备：`sync/models.py:145-148` tombstone 检查约束；`service.py:137-138` 校验 delete 必须 tombstone 且无 payload；`packages/offline/src/validation.ts:152-157` 接受 `operation_type: "delete"` 且要求 `deleted_at`；`repository.ts:71-74` 处理 restore/delete 状态。
- 现有删除先例（可参考"影响签名 + 收据"模式）：`workbenches/routes.py:1178-1260`（受 `workbench_delete_api_enabled` 开关，`config.py:141`）；`knowledge_space/routes.py:140-152`（受 `knowledge_space_deletion_enabled`，`:170-173`）。
- UI：planning/content/execution 三个 feature 目录 grep "删除" 为空。
- ADR 0003 / 0026：删除冲突必须人工确认，不得 LWW。约束 §12.1：同步/数据寿命语义变更先 ADR。

**因此 T-05 是纵向切片**：ADR → 后端 `delete` 处理器（learning_goal/note/task，含级联规则与 tombstone 下发）→ offline `commitMutation` delete 路径核对 → pull 端 tombstone 应用核对 `[推断：需验证客户端 pull 是否已处理 tombstone]` → UI 入口 + 确认框（复用 `AppModal`，列出级联范围）→ 测试（含"删除 vs 离线更新竞争"场景，约束 §10.2）。

**T-05a（可独立、可提前，2-4 h）**：附件队列单条移除。仅本地：`AttachmentQueueRepository` 增加 `remove(attachmentId)`（`resilience.test.ts` 已直接调用 `db.attachmentQueue.delete`），UI 在 failed 行加"移除"。不触及同步协议。

**产品决策（须所有者定，不留给执行者猜）**：

- Note 链接：a) 渲染可点击链接（URL 白名单 http/https + `rel="noopener noreferrer"` + 外链提示，约束 §9）；b) Note-link 选择器（需 `note_links` 表，当前 `content/models.py` 无此表 `[已核实]`）。规划建议 a) 先做（小），b) 归演进。**不得**为此放宽 `ProductMarkdownPreview` 的纯文本策略。
- 术语：线上为 Goal/阶段，清单为 Topic/Milestone。规划建议**以代码为准（Goal/阶段）**，修改清单而非产品。

**预估**：20-30 h（任务书 14-22 h；上调原因：后端 delete 处理器与 ADR）。T-05a 另计 2-4 h。

---

### T-06：状态与文案一致性（ISSUE-011）—— v0.2.2

**优先级**：P2，子项独立可并行。

| 子项                          | 已核实位置                                                                                                                         | 处理                                                                                                                                                  | 预估      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| StudySession 结束后仍"未结束" | `today-workbench.tsx:961` 渲染 `item.payload.outcome ?? "未结束"`；`use-today-controller.ts:1105-1124` 结束时写 `outcome`+`status` | `[推断]` Inspector 读的 `sessions` 视图未在 commit 后刷新，或 pull 回来的 payload 无 `outcome`。先复现再修；修法是 mutation 后 `refresh()` 或统一来源 | 1-2 h     |
| "最近true"                    | `review-workbench.tsx:427` `formatStatus(String(latest.payload.is_correct))`                                                       | 布尔 → "正确"/"错误"                                                                                                                                  | 0.5 h     |
| `0.0 MB`                      | `data-workbench.tsx:43-47` `bytesLabel` 缺 KB 档                                                                                   | 加 `< 1 MiB` → KB                                                                                                                                     | 0.5 h     |
| "加密数据包"                  | `data-workbench.tsx:68/176/219/365/368/401/743`                                                                                    | 按 ADR 0019 改为"服务端加密存储；下载后为可读 ZIP（含 manifest.json/data.json/Markdown/CSV/BibTeX）"                                                  | 1 h       |
| 导出不自动刷新                | `data-workbench.tsx` 无轮询代码 `[已核实]`                                                                                         | 任务处于 queued/running 时 5 s 轮询，终态停止；或明确"点击刷新"                                                                                       | 1-2 h     |
| `next=/app/data` 未回跳       | `login-form.tsx:19-23` `nextRoute` 不读查询参数                                                                                    | 读 `next`，**仅接受以 `/` 开头、不含 `//` 的同源相对路径**（防开放重定向）                                                                            | 1 h       |
| Mastery 百分比                | `MasteryResponse` 仅 6 级枚举（`openapi.d.ts:5498-5523`）；`mastery_records` 无百分比字段                                          | **非缺陷**。所有者决策：是否新增派生指标。规划建议改清单 6.3 为"显示等级 + 建议理由"，不做百分比                                                      | 0（决策） |

**预估**：5-8 h。

---

### T-07：触摸目标 44px + favicon（ISSUE-012）—— v0.2.2

**优先级**：P3

**已核实**：`review-workbench.module.css:91` `min-height: 2.25rem`（36px）；`globals.css:71-72` `--control-height: 1.75rem`、`--control-height-primary: 2.125rem`；先例 `components/product/f5-mobile-touch-target.test.ts` 已为 sync 页做过 44px 提升。`apps/web/src/app/` 只有 `icon.svg`，无 `favicon.ico`。`/manifest.json` 404 **非缺陷**（实际 `/manifest.webmanifest`）。

**步骤**：新增 `--touch-target-min: 2.75rem`；在 `≤45rem` 断点对通用按钮/链接类强制 `min-height`；全站 grep `min-height` < 2.75rem 的可交互控件列表并逐一处理；补 `apps/web/src/app/favicon.ico`；扩展先例测试覆盖 review 页。

**预估**：4-6 h。

---

### 已核实无需执行：安全响应头

`next.config.ts:4-16` 已含 `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`、COOP/CORP；`proxy.ts:35-44` 设 nonce CSP 与 `Referrer-Policy: no-referrer`（与 `next.config` 的 `strict-origin-when-cross-origin` 不同，后者被覆盖，可顺手统一但非必要）；2026-09-05 实测 `https://logion.work/` 与 `/api/v1/health` 均含 `strict-transport-security: max-age=31536000`（由反向代理设）。**任务书 T-XX 取消。**

## 2. 任务依赖关系

```
T-00 步骤1（运维读版本）──────────────────────────┐
T-00 步骤2（web 透传 LOGION_VERSION）              │
                                                    │
T-01（附件谎报，P0）无依赖，最先做 ───────┐          │
                                          ├─ T-03 ──┼─→ M5 回归（GPT5.6 重跑 58 项，
T-02 步骤1/2（错误码，P0）无依赖 ─────────┘          │      以 T-00 得到的 SHA 归因）
T-02 步骤3/4（运维 DNS）⚠️ 可能阻塞，独立跟踪        │
                                                    │
T-04（侧栏焦点，P1）独立，需真机 ───────────────────┘

T-05（含 ADR）/ T-05a / T-06 / T-07 → v0.2.2（所有者可提前）
```

文件交集：`offline-sync-center.tsx`（T-01 → T-03）、`provider-center.tsx`（T-02 → T-03）。

## 3. 总预估工作量

| 类别              | 任务               | 规划估算    | 任务书原估算 | 变化原因                    |
| ----------------- | ------------------ | ----------- | ------------ | --------------------------- |
| 前置              | T-00               | 1.5 h       | —            | 新增；运维 0.5 + 代码 1     |
| P0                | T-01               | 5-8 h       | 7-11 h       | 单测已存在；同类模式仅 1 处 |
| P0                | T-02               | 8-10 h      | 8-10 h       | 不变                        |
| P1                | T-03               | 8-12 h      | 14-17 h      | 不需补渲染                  |
| P1                | T-04               | 4-6 h       | 4-6 h        | 不变                        |
| **阻断项小计**    |                    | **27-39 h** | 33-44 h      |                             |
| 回归              | 58 项重跑 + 自动化 | 3-4 h       | 3-4 h        |                             |
| **v0.2.1 合计**   |                    | **30-43 h** |              |                             |
| P2                | T-05               | 20-30 h     | 14-22 h      | 后端 delete 处理器 + ADR    |
| P2                | T-05a              | 2-4 h       | —            | 拆出                        |
| P2                | T-06               | 5-8 h       | 6-10 h       | 去掉 Mastery 百分比         |
| P3                | T-07               | 4-6 h       | 4-6 h        |                             |
| **含 P2/P3 总计** |                    | **61-91 h** | 60-86 h      |                             |

所有工时均为估算，以执行为准。

## 4. 交接给 GPT5.6 的说明

1. 每任务独立分支 `dev/T-<nn>-<slug>`，独立 PR 指向 `main`。
2. PR 描述含：任务 ID、修改文件、测试命令与原始结果摘要、回滚方式、未验证项。
3. 提交前：`pnpm ci:fast` 全绿；`pnpm test:browser` 相关 spec 通过；真实浏览器手动验证（T-01/T-02/T-03 必须；T-04 需真机屏幕阅读器）。
4. 禁止：为让功能"看起来能用"而隐藏失败或放宽安全校验；违反 10 条不变量；以仿真冒充真机；删失败测试；改 IndexedDB schema 以外的方式绕开 offline 升级门禁；未经 ADR 改同步语义（T-05）。
5. 本计划中所有 `[推断]` 项，执行者先验证再实施，结论写进 PR。

## 5. 非代码前置事项

见 T-00。**在 T-00 步骤 1 完成前，任何"验收通过"都不能归因到具体源码版本。** 若步骤 1 发现线上是 RC7，需所有者决定：先部署 RC8 再回归，还是以线上版本为回归基线。

## 6. 建议 OPUS5 重点审查

- T-03 的前提修正是否成立（7 处渲染点行号可直接核对）。
- T-05 "服务端无 delete 处理器" 的结论（`push.py:205-224`）及由此带来的工时与 ADR 要求。
- T-00 对 `/health` 路由归属的分析（nginx `location` 与 web route）。
- T-01 步骤 2 两个方案的取舍（是否允许 offline 包 duck-typing 识别 API 错误）。
- T-02 把 hostname-None 改映射到 `URL_BLOCKED` 是否可接受。
- 版本计划 §3 对"90% 通过率"的替代标准。
