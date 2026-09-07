# Logion UI 优化方案（v0.2.1）

> 规划人：FABLE5-1 · 2026-09-05
> 输入：问题台账 ISSUE-002/009/010/011/012、GPT5.6 报告 §4（BROWSER-001~011）、`prototype/` 四份原型文件
> 基准代码：main @ 37e2e00。本文所有"代码现状"均为 2026-09-05 对该 SHA 的核对结果，行号以该 SHA 为准
> 证据标注：`[实测]` 有审计/黑盒证据；`[代码]` 本轮读源码确认；`[推断]` 未验证

## 0. 优化目标

修复 RC8 审计中发现的 UX 问题，提升可用性。**第一原则是"绝不谎报"，其次才是"反馈好看"。**
本方案只覆盖 v0.2.1（以及建议顺延到 v0.2.2 的 P2/P3 项）；原型中的视觉重构与信息架构调整归入功能演进规划（v0.3+）。

## 1. 当前 UX 问题清单

### 1.1 P0 级问题（数据可靠性，优先于任何视觉优化）

- **反馈内容与事实相反**（ISSUE-008）`[实测][代码]`
  - 表现：附件上传失败，队列行显示 `failed · OFFLINE_ATTACHMENT_UPLOAD_FAILED`，页面同时显示"附件上传队列已处理一项，并完成服务器哈希验证。"
  - 根因：`packages/offline/src/resilience.ts:399-411` 捕获异常后把行标为 `failed` 并正常返回；`apps/web/src/features/sync/offline-sync-center.tsx:472-476` 的成功文案无条件执行。
  - 影响：用户可能据此删除本地原件。这是"反馈正确性"问题，比"有没有 Toast"严重。
  - 附带发现 `[推断]`：线上上传失败最可能的直接原因是 `knowledge_space_attachment_ingest_enabled` 在生产默认关闭（`apps/api/src/logion_api/config.py:176`，`attachment_routes.py:38` 拒绝）。GPT 未捕获到响应体，未证实。

### 1.2 P1 级问题

- **操作反馈弱、无统一浮层**（ISSUE-002，**范围已再次修正**）
  - 台账结论"6 个模块 `setStatus` 调用后从不渲染 `{status}`"是用字面量 `{status}` grep 得出的。本轮逐文件核对**渲染点**，结论如下 `[代码]`：

    | 文件                                        | `setStatus` | 实际渲染位置                                                                                                  | 无障碍属性                                   |
    | ------------------------------------------- | ----------: | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
    | `features/memory/review-center.tsx`         |          33 | 作为 `context.status` 传给 `ReviewWorkbench`，在 `review-workbench.tsx:1600` 用 `<StatusLine>` 渲染于主区顶部 | `role="status" aria-live="polite"`（`:215`） |
    | `features/exam/exam-center.tsx`             |          19 | `exam-workbench.tsx:1182` `<StatusLine>{context.status}`                                                      | 同上                                         |
    | `features/self-study/self-study-center.tsx` |          17 | `self-study-workbench.tsx:1141` 主区顶部 `div.statusLine`                                                     | `aria-live="polite"`                         |
    | `features/ai/provider-center.tsx`           |          18 | 派生为 `visibleStatus`（`:186`），渲染于工具栏 `:454` 与 Inspector `:880`                                     | `aria-live="polite"`                         |
    | `features/ai/run-center.tsx`                |          12 | 工具栏 `:356` 与 Inspector `:723`                                                                             | `aria-live="polite"`                         |
    | `app/app/settings/persona-settings.tsx`     |           6 | 工具栏 `:470`                                                                                                 | `aria-live="polite"`                         |
    | `features/sync/offline-sync-center.tsx`     |          20 | 作为 prop 传给 `SyncWorkbench`，Inspector"运行状态" `:296`、错误态 `:358`                                     | 部分 `role="status"`                         |

  - 因此**"零渲染"不成立**。GPT 黑盒也间接证明了这一点：清单 2.5 "页面明确显示域名解析含非公网地址" 就是 `provider-center` 的 `visibleStatus` 在渲染。
  - **仍然成立的问题** `[实测][代码]`：
    1. 每个模块只有一个状态槽，新消息覆盖旧消息，成功与失败**没有语气区分**（同一段三级灰色小字，`review-workbench.module.css:309-315` 用 `--text-tertiary`）。
    2. 状态槽固定在页面顶部工具栏或右侧 Inspector，**离触发按钮远**；移动端 Inspector 默认收起时，用户可能完全看不到。
    3. 全站没有瞬时浮层，用户报告"提示弹窗也没有"是对这一点的准确描述。
    4. GPT 只对 5 个操作做过反馈测试（AI 预算、创建 Goal、创建 Note、同步、导出），**exam / self-study / persona / run 四个模块的反馈从未被黑盒验证**。
  - 修复方向因此从"补渲染"改为"**先逐模块实测可感知性，再引入统一瞬时反馈层并保留 inline**"。

- **移动侧栏焦点陷阱**（ISSUE-009）`[实测][代码]`
  - 表现：抽屉关闭时 Tab 仍进入屏外侧栏；打开时焦点不移入、无 focus trap。
  - 代码现状：`apps/web/src/components/app-shell/app-shell.tsx` 的 `<aside className="app-sidebar">`（约 `:215-310`）在 ≤45rem 断点仅用 `transform: translateX(-103%)` 移出视口（`globals.css:1836-1844`），没有 `inert`/`aria-hidden`/`visibility`；打开时只渲染一个遮罩按钮（`:312-319`），无焦点管理。
  - 可复用件：项目已引入 `@radix-ui/react-dialog@1.1.23`，`app-modal.tsx` 已实现"初始焦点 + Esc + 焦点归还"，命令面板与通知中心正是用它。
  - 注意：侧栏元素在桌面端常驻可见，**`inert` 只能在移动断点且关闭态施加**，否则会禁用桌面导航。

### 1.3 P2 级问题

- **核心 CRUD 不闭环**（ISSUE-010）`[实测][代码]`
  - Goal/Note/Task 无删除入口；附件队列只能整体清空（连同设备 Vault）；Note 间链接不可点击（`ProductMarkdownPreview` 只按行渲染纯文本，`product-ui.tsx:275-308`，这是有意的 XSS 防护）。
  - **规划复核新增**：服务端同步协议 `apps/api/src/logion_api/sync/push.py:205-224` 的处理器注册表**没有任何 `delete` 处理器**，未注册的操作会被拒为 `SYNC_OPERATION_UNSUPPORTED`（`:381`）。虽然 `sync/models.py:145-148` 与 `service.py:137-138` 已有 tombstone 校验，客户端 `packages/offline/src/validation.ts:152-157` 也接受 `delete`，但**端到端删除路径需要后端新增处理器**。这不是纯 UI 任务。
- **状态与事实不一致**（ISSUE-011）`[实测][代码]`
  - StudySession 已结束仍显示"未结束"：`today-workbench.tsx:961` 渲染 `item.payload.outcome ?? "未结束"`；`use-today-controller.ts:1105-1124` 结束时确实写入 `outcome`。GPT 看到"未结束"说明 Inspector 读到的视图未刷新或来源不一致 `[推断]`。
  - 布尔值显示"最近true"：`review-workbench.tsx:427` 直接 `String(latest.payload.is_correct)`。
  - 导出 4,180 B 显示 `0.0 MB`：`data-workbench.tsx:43-47` 的 `bytesLabel` 只有 B 和 MB 两档。
  - "加密数据包"文案：`data-workbench.tsx:68/176/219/365/368/401/743`；ADR 0019 定义的是服务端 at-rest 加密，下载后为可读 ZIP。
  - 近期认证 `next=/app/data` 未回跳：`login-form.tsx:19-23` 的 `nextRoute` 不读取查询参数。
  - Mastery 百分比：**契约 `MasteryResponse` 只有 6 级枚举**（`packages/contracts/src/openapi.d.ts:5498-5523`），数据库 `mastery_records` 同样只有等级字段。"controller 已算出百分比但未渲染"**未找到对应代码**，本轮判定为清单要求与产品设计的分歧，不是缺陷。
- **触摸目标不足**（ISSUE-012）`[实测][代码]`
  - Review 页按钮 `min-height: 2.25rem`（36px，`review-workbench.module.css:91`）；全局控件 token `--control-height: 1.75rem`、`--control-height-primary: 2.125rem`（`globals.css:71-72`）；移动导航按钮 44×44 达标，说明规范存在但只在部分组件落实。已有先例测试 `components/product/f5-mobile-touch-target.test.ts`。
  - 登录页 `/favicon.ico` 404：`apps/web/src/app/` 只有 `icon.svg`，无 `favicon.ico`。`/manifest.json` 404 **不是缺陷**，manifest 实际路径是 `/manifest.webmanifest`（`layout.tsx:14`）。

## 2. 优化方案

### 2.1 统一瞬时反馈层（Toast / 公告）

- **目标**：所有异步操作在**触发点附近**有可见、可区分成败、对屏幕阅读器可感知的反馈；成功可自动消失，失败必须停留并带请求编号。
- **合同来源**：`prototype/LOGION_VISUAL_SEMANTIC_V1_PLAN.md` §6 已定义反馈合同（字段校验在字段下方、Pending 在触发控件附近、Success 约 3 秒、409/429/离线/5xx 在命令区域停留并带原因与请求编号；**Toast 只作辅助确认**，新对象/收据/历史必须持续存在于对应行）。本方案直接采用，不另起炉灶。
- **技术选型（有前置门）**：
  - 生产 CSP 为 `style-src 'self' 'nonce-…'`，`style-src-attr 'unsafe-inline'`（`apps/web/src/proxy.ts:12-31`，2026-09-05 线上响应头已核实）。**Sonner 是否能在此 CSP 下工作未验证**。原型方案 §8.5 明确要求"每个候选组件先做 CSP 探针，失败则用项目内 CSP-safe 实现，禁止放宽 CSP"。
  - 因此选型为：**先做 Sonner CSP 探针（≤1 小时）；通过则用 Sonner，不通过则用项目内实现**（一个 `aria-live` 区域 + 队列 + 计时器，约 120 行）。两条路径的对外 API 一致：`feedback.success(text)` / `feedback.error(error, { requestId })` / `feedback.pending(text)`。
  - 新依赖须按约束 §12.2 说明许可证、维护状态、包体与替代方案。
- **实现范围**：
  - 新增 `apps/web/src/components/feedback/feedback-provider.tsx` 与 `apps/web/src/lib/feedback.ts`（文件名建议，执行者可按现有目录惯例调整）。
  - 在 §1.2 表中的 7 个模块接入：**保留现有 inline status**（它承担"持久状态"），在每个 `setStatus` 的成功/失败分支**追加**瞬时反馈调用。不做全站 147 处替换。
  - 错误反馈必须显示具体错误码或 `LogionApiError.requestId`，不得退化为笼统"操作失败"。
- **优先级**：P1（前提已修正，见 §1.2；执行前先做真实浏览器逐模块复核，结果可能支持所有者降级为 P2）
- **预估工作量**：8-12 小时（含 CSP 探针与逐模块复核）

### 2.2 移动抽屉焦点管理

- **目标**：关闭态不可聚焦、不可被辅助技术读到；打开态焦点移入并约束；Esc 关闭并归还焦点。
- **方案**：
  1. 用 `matchMedia("(max-width: 45rem)")` 派生 `isMobile`（`useSyncExternalStore`），在 `isMobile && !menuOpen` 时给 `<aside>` 加 `inert`（React 19 原生支持布尔 `inert` 属性）。
  2. 打开时把焦点移到侧栏首个可聚焦元素；`Esc` 关闭并把焦点还给 `aria-label="打开主导航"` 的按钮。
  3. Tab 循环：在 `<aside>` 上监听 `keydown`，Tab/Shift+Tab 到边界时回绕。
  4. 备选：把移动抽屉改为 Radix `Dialog`（复用 `AppModal` 的焦点逻辑）。改动更大，因侧栏在桌面端是常驻布局元素，需要双份渲染；仅当方案 1 在真机屏幕阅读器验证失败时采用。
- **优先级**：P1
- **预估工作量**：4-6 小时（含真机 VoiceOver/TalkBack 验证）

### 2.3 确认对话框统一

- **目标**：破坏性操作（删除、清空 Vault、转移所有权）不再用原生 `window.confirm()`（`provider-center.tsx:250/275/379` 等）。
- **技术选型**：复用现有 `AppModal`（Radix Dialog），不新增依赖。
- **合同**：按约束 §8.2，"危险操作使用明确对象名和后果，不用含糊的'确定吗'"；原型 §5.4 的"输入确认短语后才启用确认按钮"模式可用于清空 Vault。
- **优先级**：P2（随 T-05 删除入口一起做，v0.2.2）
- **预估工作量**：3 小时

### 2.4 核心实体删除入口

- 见开发计划 T-05。UI 侧要点：Inspector 操作区加"删除"入口；确认框列出级联范围（Goal → 阶段/Task 关联；Note → 附件队列条目）；删除后对象行显示 tombstone 状态而非直接消失，直到同步确认。附件队列增加单条"移除"。
- **优先级**：P2，若开放多人试用则建议提前
- **预估工作量**：UI 部分 6-8 小时（后端与同步协议另计，见 T-05）

### 2.5 状态与文案一致性

- 见开发计划 T-06。六个子项相互独立，可并行拆分。
- **优先级**：P2
- **预估工作量**：5-8 小时（去掉 Mastery 百分比后下调）

### 2.6 触摸目标与静态资源

- 建立移动断点下的最小触摸目标 token（如 `--touch-target-min: 2.75rem`），在 `globals.css` 的通用按钮规则里于 ≤45rem 断点强制 `min-height`；全站审计一遍 `min-height` 小于 2.75rem 的可交互控件，而不是只改 Review 页。
- 补 `apps/web/src/app/favicon.ico`（Next.js App Router 约定位置）。
- **优先级**：P3
- **预估工作量**：4-6 小时

### 2.7 已核实无需再做的项

- 安全响应头：`next.config.ts:4-16` 已设 `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`、COOP/CORP；`proxy.ts` 设 nonce CSP；线上响应含 `strict-transport-security: max-age=31536000`（2026-09-05 对 `/` 与 `/api/v1/health` 实测）。审计报告 §2.4 的"缺失"结论不成立，**不要重复添加**。

## 3. 与原型的关系

四份原型文件的定位不同，先说清它们各自是什么：

| 文件                                          | 日期       | 性质                                                                                                 | 与现状的关系                                                             |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `prototype/logion-v2-prototype.html`          | 2026-07    | "代码对齐版"交互原型：8 个视图（today/planning/records/review/ai/sync/data/templates），暗色霓虹风格 | 视图结构已被现有 21 条路由实现覆盖；视觉方向已被 visual-semantic-v1 取代 |
| `prototype/logion-v3-prototype.html`          | 2026-07    | 场景化工作区 + 模板库（备考/研究/自学）演示                                                          | 模板库已建成（`features/growth/templates-workbench.tsx`）；仅作历史参考  |
| `prototype/logion-visual-semantic-v1.html`    | 2026-08-17 | 高保真单文件原型：五区 IA、21 路由、Graphite 主题、论证边注、19 种状态、1440/1100/390 三视口         | **当前有效的视觉与交互合同**，状态为"等待用户审批（G1），正式施工冻结"   |
| `prototype/LOGION_VISUAL_SEMANTIC_V1_PLAN.md` | 2026-08-17 | 上述原型的方案文档：Token、断点、反馈合同、审批门                                                    | 同上                                                                     |

### 3.1 可用于 v0.2.1 的部分（不需要 G1 审批也能用的"合同"）

- **§6 后端反馈合同**：Pending 在触发控件附近、Success 约 3 秒、错误停留并带请求编号、Toast 只作辅助。→ 直接作为 §2.1 的验收口径。
- **§3.4 尺寸**："移动端触控区域至少 44px"。→ §2.6。
- **§8.5 CSP 探针要求**：第三方浮层进生产前必须先探针。→ §2.1 选型前置门。
- **§5.4 危险操作确认**：影响范围 + 最近认证 + 确认短语。→ §2.3。
- **§11.2 复验记录**中"弹层背景 inert、焦点环回、Escape 关闭并返回触发器"是原型已验证的交互模式。→ §2.2 的行为定义。

### 3.2 延后到 v0.3+ 的部分（需要 G1 审批与独立施工批次）

- 五区信息架构（今天/工作台/知识库/协作空间/系统中心）与 232px/72px/抽屉三态侧栏。
- Graphite Evidence Desk 视觉 Token、IBM Plex 字体自托管、Light/Dark 双主题重做。
- "论证边注"（S/E/D/H）签名组件与 Inspector 联动。
- Workspace 邀请页的 ready/validating/pending/409/429 状态网格（§5.2）——其中"服务器已接受"与"邮件已送达"分离的语义，与功能演进规划里的"邀请邮件"一起做。
- 知识图谱 1/2 跳与移动节点列表。
- 原型 §9 的 U0-U6 施工批次与对抗复审门。

**不采用**：v2 原型的暗色霓虹风格；v3 原型的繁体界面与静态模板卡片。

## 4. 实施优先级

| 序  | 项                                      | 对应任务    | 版本                     | 前置                                   |
| --- | --------------------------------------- | ----------- | ------------------------ | -------------------------------------- |
| 1   | 附件上传按真实结果分支呈现              | T-01        | v0.2.1                   | 无                                     |
| 2   | Provider 错误文案按新错误码区分         | T-02 步骤 2 | v0.2.1                   | T-02 步骤 1                            |
| 3   | 7 模块反馈可感知性实测 → 统一瞬时反馈层 | T-03        | v0.2.1                   | CSP 探针；T-01/T-02 先合并（文件交集） |
| 4   | 移动抽屉焦点管理                        | T-04        | v0.2.1                   | 真机                                   |
| 5   | 删除入口 + 确认框统一                   | T-05        | v0.2.2（多人试用则提前） | 后端 delete 处理器                     |
| 6   | 状态与文案一致性                        | T-06        | v0.2.2                   | 无                                     |
| 7   | 触摸目标 token + favicon                | T-07        | v0.2.2                   | 无                                     |
| —   | 安全响应头                              | 已存在      | —                        | 仅复核记录                             |
