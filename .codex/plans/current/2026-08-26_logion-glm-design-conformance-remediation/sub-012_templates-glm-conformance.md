# 子计划：Templates 安装与分享 GLM 一致性整改

## 元信息

- 子计划 ID：`sub-012`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 9 - Self-study、Research、Collaboration 与 Templates（本子计划仅 Templates）
- 创建时间：`2026-08-27T18:55:00+08:00`
- 状态：Product Owner 独立验收通过 ✓
- 依赖：`sub-011` Collaboration 已获 Product Owner 独立验收；MCP C6 `8a14becb-a18e-420c-b4bd-7cb0aafeee44`

## 保护边界

- 保留正式 Workspace/Space 上下文、TemplatePackage 版本语义、从目标创建模板、导入结构化 JSON、独立副本安装、短期只读分享、分享撤销、权限/capability/error/request ID 语义。
- 不修改既有 API 行为、数据库、权限模型、分享 token 生成或模板对象图；仅允许为真实来源目标读取补齐向后兼容的只读 Goals GET，并同步 OpenAPI contracts；不伪造连接器、模板数据、分享链接或安装成功状态。
- 只复用现有 Radix adapters、Workbench primitives、State Notice、双主题 token 和正式 `browserApiClient`；不复制 GLM fixture store、hash router、mock 数据或手写 overlay。
- 路由专属 controller/view 分离；Templates 不再直接以旧 `ProductPanel`、`planning-form` 长表单作为主体。

## GLM 目标布局

```text
Templates Workbench
├─ AppShell / Workspace + Space Context Bar
├─ Category Master
│  ├─ 模板分类与可见性筛选
│  ├─ 搜索结果计数
│  └─ 模板版本列表
├─ Template List / Detail Main
│  ├─ 模板元数据与来源
│  ├─ 版本变更与风险链接
│  ├─ 安装差异与目标 Space
│  └─ 已安装副本回显
└─ Install / Import / Create / Share Sheets
   ├─ 安装起始日期与独立副本确认
   ├─ JSON 结构校验与私有导入
   ├─ 从目标创建不可变版本
   └─ 短期只读分享、Token 一次显示、撤销影响范围
```

主任务：从分类/搜索定位一个可信模板，核对版本、来源、许可、风险和安装差异后，在明确目标 Space 中安装独立副本；低频的创建、导入和分享在 Sheet 中完成。

## 步骤分解

### 步骤 1：冻结 Templates 副作用与 GLM 合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T19:10:00+08:00`
- **AI 评分**：94/100
- 登记现有 `GrowthCenter` 的 Workspace/Space/Goal/Template/Share 加载、在线状态、过滤、安装日期、导入 JSON、模板创建、分享 token 和撤销流程。
- 建立 route-specific 区域、稳定 `data-testid`、唯一 primary、11 类状态和允许偏离记录；确认安装、导入、创建、分享和撤销的真实请求 payload 不变。
- 新增 controller/model 合同测试，覆盖版本、独立副本、私有来源限制、相对日期、一次性 token、撤销版本和 capability-disabled。
- **验证**：Templates controller、payload 和状态合同测试通过。

### 步骤 2：Templates Category Master 与 Template Detail Main

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T19:35:00+08:00`
- **AI 评分**：95/100
- 新增 `templates-workbench.tsx`、模块 CSS 和 controller hook；从 `growth-center.tsx` 提取真实副作用。
- 实现 Category Master、搜索/可见性 segmented filter、版本列表、Template Detail Main、来源/许可/风险/安装差异与目标 Space 上下文。
- 保留空、加载、离线、权限、错误、stale 状态，避免过滤时丢失当前选择；不渲染旧 `ProductPanel` 主体。
- **验证**：`templates-category-master`、`templates-detail-main`、`templates-inspector` 区域与唯一 primary 合同通过。

### 步骤 3：Install / Create / Import / Share Sheets

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T19:55:00+08:00`
- **AI 评分**：96/100
- 用现有 Radix Dialog/Sheet/Popover/Select/Checkbox/Confirm primitives 替换纵向表单和原生 `window.confirm`。
- 安装 Sheet 展示目标 Space、相对日期、创建独立副本、不覆盖现有内容和成功后的安装回显。
- 创建/导入 Sheet 保留 JSON 1 MB 限制、结构校验、来源/许可/外链提示、版本与可见性；分享 Sheet 保留字段最小化、有效期、Token 只显示一次、撤销影响和恢复路径。
- 所有失败保留输入，成功后关闭 Sheet；capability-disabled 入口可见并解释所需权限/部署能力。
- **验证**：创建、导入、安装、分享与撤销真实请求和 Radix Sheet 焦点路径通过。

### 步骤 4：Templates 真实任务、四断点与证据

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T20:00:00+08:00`
- **AI 评分**：97/100
- 新增 `templates-workbench.test.tsx`、controller/contract tests 和 `tests/browser/templates-workbench.spec.ts`。
- 使用真实 Session/API/Workspace/Space/权限和实际模板/目标数据完成：定位模板 → 检查详情 → 安装独立副本 → 创建版本 → 导入合法/非法包 → 创建分享 → 一次性 token → 撤销。
- 在 320/390/1024/1440 运行 overflow、Workbench/GLM geometry、唯一 primary、Axe、键盘、焦点、reduced-motion、runtime console 检查，并生成 Before/GLM Target/After 报告与截图 SHA-256。
- **验证**：`tests/browser/templates-workbench.spec.ts` 真实规格 `1 passed (12.9s)`；四断点、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary、runtime console 全部通过。
- **证据报告**：[templates-conformance.md](../../../../reports/ui-refactor/templates-conformance.md)

### 步骤 5：最终镜像与 Product Owner 独立验收

- **状态**：已完成 ✓（Product Owner 独立验收通过）
- **执行时间**：`2026-08-27T20:06:20+08:00`
- **AI 评分**：96/100
- 清理临时诊断，重建无源码挂载 Web 镜像，记录 Git SHA、image digest、CreatedAt、StartedAt、mounts 和 healthz。
- 运行 Web typecheck、lint、Vitest、build、Templates Playwright；检查 API/DB/Redis/Worker/Proxy 健康和真实配置。
- 已新增 Templates conformance 报告并与 MCP C6 同步；Product Owner 已回复 `Templates 独立验收通过`。
- **运行摘要**：Web `logion-web:dev` image `sha256:a2b10201cd34ca7bf3d3d4df150e61db5be3a0bff5be76fc829835e7a6add82a`，Web mounts `[]`，API image `sha256:29b4844e64703400ca2081c12494f4fe10f50f29c4bcd377b8cffaa5ae0ddea4`，`/healthz=200`。

## 统一验收标准

- Function Reachability 100%；模板版本、安装、导入、创建、分享、撤销和 capability 状态均可达。
- Workspace、Space、权限、在线状态和目标上下文持续回显；Private/Shared 来源边界不泄露。
- `loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 由真实 controller 驱动并提供恢复动作。
- 320/390/1024/1440 无溢出、遮挡或不可达操作；每个可见交互层最多一个视觉 primary；失败输入保留，成功 Sheet 才关闭。
- 真实 API/Session/权限证据、同视口截图、运行镜像摘要和证据缺口进入独立报告；未获 PO 验收前不进入步骤 10。

## 变更记录

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 2026-08-27 18:55 | Collaboration PO 独立验收通过，创建 sub-012 | PO 原文 `Collaboration 独立验收通过`；关闭 sub-011 独立验收门并解锁 Templates；开始冻结 Templates 副作用与 GLM 差异 |
| 2026-08-27 20:00 | Templates 实现、真实任务与四断点证据完成 | Category Master / Detail Main / Inspector 与 Create/Import/Install/Share/Revoke Sheets 完成；真实模板版本、独立安装、非法/合法导入、一次性分享、撤销闭环通过；四断点、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary、runtime console 全通过 |
| 2026-08-27 20:06 | Templates 技术验收收口，等待 Product Owner 独立验收 | 新增 [templates-conformance.md](../../../../reports/ui-refactor/templates-conformance.md)，记录 After 截图哈希、真实镜像、API/权限证据及缺口；补齐只读 Goals GET 以支持来源目标读取；尚未关闭 sub-012 或解锁父计划步骤 10 |
| 2026-08-27 22:58 | 收口官方目录审计与最新镜像重验 | 安装审计新增 `source_scope`（官方模板为 `official_catalog`）；真实 API 集成断言通过；重建无源码挂载 Web/API 镜像并强制重建容器；Templates Playwright `1 passed (15.8s)`，Web `60 files / 230 tests`、typecheck、lint、API ruff 通过；仍等待 Product Owner 独立验收 |
| 2026-08-27 23:10 | Templates Product Owner 独立验收通过 | PO 原文 `Templates 独立验收通过`；关闭 Templates 独立验收门，允许父计划进入步骤 10；全量路由完成后统一提交 GLM 验收，随后再进行最终 review，当前不归档父计划 |
