# A5 浏览器验收夹具报告

## 验收范围

- 日期：2026-08-26
- 真实入口：`http://127.0.0.1:8080`
- 运行栈：Docker Compose `logion-a5`，包含 Web、API、Postgres、Redis、reverse proxy 与 worker
- 身份与数据：通过正式注册、登录、Session Cookie、用户设置 API、Persona、Workspace 与权限链路建立一次性验收账号；未使用业务 mock
- 浏览器：Playwright authenticated Chromium + Codex 应用内浏览器可见抽查
- 基线边界：本报告固定 B1/B2/B3 开工前的 Today、Search、Records 主体，属于 Before 证据，不代表旧主体通过 Gate 1

## 环境恢复

首次启动后，API `/healthz` 返回 200，但 worker 因空数据库缺少表结构持续产生 `ProgrammingError`。执行 `alembic -c apps/api/alembic.ini upgrade head` 将数据库从空库迁移到 `0035_add_user_settings`，再重启 worker；最终六个 Compose 服务全部 healthy。

该问题没有通过忽略 worker 或缩减 Compose 服务规避。一次性账号只存在于 `logion-a5` 的任务专用数据卷中，验收结束后随任务卷删除。

## 自动化结果

目标命令使用显式 `LOGION_E2E_BASE_URL`、一次性账号、`LOGION_E2E_REQUIRE_AUTHENTICATED=true` 与 `LOGION_E2E_CAPTURE_BEFORE=true` 运行以下三个 spec：

- `authenticated-accessibility.spec.ts`
- `authenticated-shell.spec.ts`
- `prototype-productization.spec.ts`

结果：17/17 passed，耗时 3.0 分钟。覆盖内容包括：

- Today、Search、Records 在 320、390、1024、1440 四个视口的 Axe 检查
- 21 条正式应用路由在四个视口的 document/元素横向溢出诊断
- 21 条正式应用路由的桌面 Axe、light/dark token 与 reduced-motion
- 可见 primary 数量、主操作可达性、主题持久化
- Command Palette 与真实 Capture/Vault overlay 的焦点陷阱、Escape 和触发器焦点恢复
- 正式 callback、禁止虚构 `/auth/passkey`、Vault/权限/真实诊断和功能入口合同

浏览器 console 的 warning/error 抽查结果为 0。`reports/browser/results.json` 记录 17 个 passed result。

## Before 截图矩阵

| Route | 320 x 640 | 390 x 844 | 1024 x 768 | 1440 x 900 |
|---|---|---|---|---|
| Today | [PNG](before/app-today-320x640.png) | [PNG](before/app-today-390x844.png) | [PNG](before/app-today-1024x768.png) | [PNG](before/app-today-1440x900.png) |
| Search | [PNG](before/app-search-320x640.png) | [PNG](before/app-search-390x844.png) | [PNG](before/app-search-1024x768.png) | [PNG](before/app-search-1440x900.png) |
| Records | [PNG](before/app-records-320x640.png) | [PNG](before/app-records-390x844.png) | [PNG](before/app-records-1024x768.png) | [PNG](before/app-records-1440x900.png) |

12 张图片的实际像素尺寸均与文件名一致；不存在以桌面截图缩放冒充移动截图的情况。

## 可见走查结论

### Today

- 桌面首屏仍由大标题、Persona 大卡、NEXT ACTION 卡、指标卡和右侧卡片组成，真实 Workspace/Vault 表单位于更下方。
- 390 px 没有水平溢出，但顶部 7 个工具动作挤压页面标题，NEXT ACTION 被 Persona/Vault 大卡推至首屏以下。
- 结论：功能可达、技术响应式通过；主体 IA 仍是旧 Center 卡片流，B1 必须改为 Queue Master / Next Action Main / Context Inspector。

### Search

- 桌面首屏先呈现 hero、离线百分比和四张指标卡，搜索输入位于第二屏；“搜索服务器”与“解锁离线搜索”同时使用高强调按钮。
- 390 px 先展示 hero、装饰性离线可用图和纵向指标卡，搜索输入不在首屏，唯一主任务不成立。
- 结论：权限过滤、在线/离线搜索、通知和日历语义可达；B2 必须把 Search input 提升为唯一主入口，其余能力进入 scope/filter/Inspector 或二级披露。

### Records

- 桌面首屏是状态块、Workspace/Space/Vault 表单、指标与搜索条，新建/编辑器位于下方长页面。
- 390 px 首屏主要被“缺少工作台上下文”和 Vault 表单占据；对象列表、编辑器、附件与资料索引需要长距离滚动。
- 结论：Markdown、资料、PDF 索引、附件、Yjs/Vault/sync 入口仍可达；B3 必须改为 Objects Master / Inline Editor Main / Properties & Sync Inspector。

## A5 结论

A5 验收夹具通过。它已经能够在真实身份与 API 环境中重复检查四个精确断点、Axe、横向溢出、主操作、键盘焦点、reduced-motion 与 Before/After 证据路径。

Gate 1 尚未通过。B1/B2/B3 必须分别复用该夹具生成 After 截图，并完成真实任务、功能可达性与可见浏览器走查；不得用本报告对旧主体的技术通过替代新主体体验验收。
