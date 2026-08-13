# I0-E 浏览器验收记录

日期：2026-08-12（Asia/Shanghai）

工作区：正式 `v020-integration` 集成工作区

分支：`codex/logion-redesign-i0`

固定基础提交：`e2b85987d816baf53a089007e674cd440e9ce64f`

## 验收边界

本记录覆盖 I0 产品重构的公开页面与真实认证浏览器门禁。验收使用本机隔离 PostgreSQL、Redis、API 和 Next standalone Web，不使用 mock 代替认证、权限或真实 API 流程。

本轮没有 commit、push、merge、deploy，也没有修改生产配置。`8080` 上的无关 `sub2api` 未被停止或修改。Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1 和 AI Acceptance 的生产能力没有启用；仅在本机隔离 API 临时启用知识空间只读主开关，以验证正式 Review 图谱。

## 隔离验收栈

- Web：`http://127.0.0.1:8180`，Next standalone，`/health` 返回 200。
- API：`http://127.0.0.1:8000`，`/health/live` 与 `/health/ready` 返回 200；ready 检查包含 PostgreSQL 与 Redis。
- PostgreSQL：隔离的 Windows 服务 `LogionV20PostgreSQL`，数据目录位于仓库外的非系统盘。
- Redis：`127.0.0.1:6379`，返回 `PONG`。
- Web 的 `/api/*` 真实代理到 8000；未登录访问 `/api/v1/workspaces` 返回 401。
- 数据库凭据从仓库外的 DPAPI 保护文件导入，只进入子进程环境；未输出、未写入仓库。
- 本机 API 的注册限额仅在本轮进程中提高为 `100/hour`，并清理一条旧的本机注册限流桶；源码默认值保持不变。
- 为验证真实加密导出，临时运行了只消费 `PortabilityService.execute_next()` 的导出队列消费者。它没有轮询邮件、AI、账号删除或知识空间 Local Worker 队列；完整验收结束后已停止。

## 发现与修复

1. 暗色三级文字 `#7f8998` 在知识空间部分表面低于 WCAG 小文本 4.5:1。暗色 `--text-tertiary` 调整为 `#98a2b0`；对 `#292d33` 和 `#32373e` 的对比度分别约为 5.36:1 与 4.64:1。
2. `integration-hub.spec.ts` 仍期待旧命令名称“打开互操作中心”。断言已对齐 route manifest 的“打开互操作”。
3. `persona-system.spec.ts` 仍把“考试、复习、审计、空间”作为侧栏一级入口，并期待旧的移动端“四项 + 更多”结构。断言已改为固定五区：今天、工作台、知识库、协作空间、系统中心；Persona 仅改变工作台默认目标，考试画像指向 `/app/exam`，其余画像指向 `/app/self-study`。
4. 首次完整认证矩阵中，真实数据导出停留在 `queued`，原因是隔离栈没有导出队列消费者。启动仅处理导出的临时消费者后，互操作串行组 5/5 通过，完整认证矩阵随后全绿。
5. 最终安全审查发现 WorkspaceCenter 与 Review 在快速切换 Workspace 时可能被旧 Space/Member/本地解密响应覆盖。相关请求已加入取消和最新请求守卫，切换时立即清理旧上下文；真实 UI 竞态烟雾 1/1 通过。
6. 邀请与成员角色更新增加客户端白名单，合同外角色不会发送请求；动态 Workspace、Space 与 Member 路径段统一编码。CSRF 与成员 `expected_version` 保持不变。
7. 知识图谱响应解析增加实际 UTF-8 JSON 1 MiB 上限、`next_cursor` 1024 字符上限和各对象合同外字段拒绝；原有 150/400 上限、UUID、重复 ID、悬空边和截断元数据校验继续失败关闭。
8. 一次 standalone 重启后因静态文件复制层级错误出现 `/_next/static/chunks/*` 404，页面停留在会话验证状态。修正 standalone 目录层级并重启后，静态资源、登录页和 Web health 均恢复 200；该失败属于本机验收栈装配问题，不是产品回归。

## 静态与构建门禁

- `corepack pnpm exec prettier --check apps/web/src tests/browser/integration-hub.spec.ts tests/browser/persona-system.spec.ts`：通过。
- `corepack pnpm --filter @logion/web lint`：通过。
- `corepack pnpm --filter @logion/web typecheck`：通过。
- `corepack pnpm --filter @logion/web test`：62 个文件、448 项测试通过。
- `corepack pnpm --filter @logion/web build`：通过，生成 36 条路由。
- Workspace/Review 竞态与知识图谱合同定向测试：45/45 通过。
- Python：Ruff 通过；Mypy strict 对 171 个源文件通过；Pytest 402 项通过、67 项按选择条件排除。
- 合同与离线：合同测试 12 项通过；离线测试 55 项通过，行覆盖率 93.01%；`contracts:check` 通过且生成文件无差异。
- 依赖审计：`pnpm audit --audit-level high` 与 `pip-audit` 均未发现已知漏洞。
- `git diff --check`：通过。

## 真实认证浏览器结果

### 专项回归

- 原失败集与完整 Persona 文件：9/9 通过。
- 互操作真实流程：5/5 通过。

覆盖内容包括暗色/全路由 axe、命令面板、固定五区导航、Persona 感知 href、移动五区导航、新账号 onboarding、Calendar URL 创建/复制/撤销、Private Space 导入、近期认证门、加密导出、实际下载、归档内容与 SHA-256 校验。

### 完整矩阵

- `authenticated-chromium`：31/31 通过，0 失败，0 跳过。

完整覆盖：

- 21 条正式认证路由和所有已迁移产品页面；
- axe WCAG 2.2 AA；
- 1440/1250/900/720/420/390/320 响应式与横向溢出；
- 明暗主题令牌、主题持久化和恶意持久化主题值 XSS 防护；
- reduced-motion；
- 命令面板与全局快捷键焦点陷阱和焦点恢复；
- 移动端知识空间节点列表；
- 桌面知识图谱方向键、Enter 和 Escape；
- 正式 Review 图谱的真实授权 API 状态；
- Vault、设备清理、Workspace/Private Space、导入导出和错误边界。

首次完整认证运行曾得到 29 通过、1 失败、1 因串行依赖未运行；唯一失败是隔离环境缺少导出队列消费者，不是前端或 API 合同失败。补齐仅导出消费者后，最终完整矩阵为 31/31。

## 公开页面浏览器结果

五项目公开矩阵最终结果：69 通过、6 个按测试规范跳过、0 失败。

- `public-chromium`：15 通过。
- `public-firefox`：14 通过、1 跳过。
- `public-webkit`：13 通过、2 跳过。
- `public-mobile-chrome`：14 通过、1 跳过。
- `public-mobile-safari`：13 通过、2 跳过。

规范跳过项为 Chromium 专属 Service Worker fallback，以及 Safari/移动端需要人工签字的键盘 Tab 行为。其余覆盖公开页 axe、键盘可达性、320px 溢出、主题启动、reduced-motion、manifest 与离线 shell。

## 最终修复后回归

- 认证专项 18/18 通过，覆盖 21 条认证路由、axe、1440/1250/900/720/420/390/320、横向溢出、主题持久化/XSS、reduced-motion、正式 Review 图谱、图谱键盘导航和 Vault/设备边界。
- 新增 Workspace/Review 真实竞态烟雾 1/1 通过：通过真实 UI 创建两个 Workspace 与各自 Space，故意延迟 A 响应并快速切换到 B，确认两个页面均不会被 A 的晚到响应覆盖。
- 最终安全与权限边界结论见 [`I0_FINAL_SECURITY_REVIEW_2026-08-12.md`](./I0_FINAL_SECURITY_REVIEW_2026-08-12.md)。

## 剩余限制

- `.agents/coordination/current-run.json` 指向的历史 Run 已再次真实校验，但仍失败：`graph.json` 与 `tasks.jsonl` 包含超出 safe scan budget 的 encoded content。该协调账本门禁没有被记为通过，也没有改写历史事件。
- 本轮结论仅为 I0-E 本机技术验收通过，不等于用户批准 commit、push、merge、部署、生产发布或敏感能力启用。
- 临时导出消费者已停止。8180 Web 与 8000 隔离 API 保留在线，供当前会话人工复核；8080 未触碰。
