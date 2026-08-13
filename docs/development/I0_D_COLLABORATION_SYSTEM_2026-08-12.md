# I0-D Collaboration / System Center 交付记录

日期：2026-08-12

工作分支：`codex/logion-redesign-i0`

固定基础：`e2b85987d816baf53a089007e674cd440e9ce64f`
状态：施工完成，等待认证浏览器回归；未 commit、未 push、未 merge、未 deploy。

## 本批次目标

按照 D2 原型和 I0 施工包，将低频路径迁移到统一的桌面工具式信息架构：

- 协作空间：区分共享审阅与 Workspace/Space 成员治理。
- 系统中心：以“分组列表 + 当前详情”承载账户、偏好、安全、数据、审计、互操作、AI 治理和帮助。
- 不改变任何 API、权限、SessionBoundary、Vault、sync-v1、迁移或默认关闭生产开关。

## 已实施

### Collaboration / Workspace

- 新增 `apps/web/src/components/desk/collaboration-subview-nav.tsx`，固定两个协作子视图：
  - `/app/collaboration`：审阅与反馈，继续使用真实的共享 Space、本地 Vault 和 Rubric 功能。
  - `/app/workspaces`：空间与成员，负责 Workspace、Space、成员、邀请和角色治理。
- `WorkspaceCenter` 重构为左侧 Workspace/Space 上下文、右侧成员与邀请的双栏布局；窄屏自动堆叠。
- `/app/spaces` 继续保留同一数据组件，但以 Knowledge Base / Space 边界语义显示，并提供知识库子视图导航。
- Workspace、Space、邀请和角色操作统一使用现有 `DeskButton`、`DeskField`、`DeskInput`、`DeskSelect` 与就地反馈。
- 成员角色更新显示行级 pending，并使用 `expected_version`；失败时恢复旧选择，不声称成功。

### Invitation 409

- `workspace-feedback.ts` 新增安全的冲突原因映射：
  - 已是当前 Workspace 成员。
  - 已有待处理邀请。
  - 未知 409 视为远端状态变化。
- 不展示任意服务端错误原文。
- 409 不会重发邀请；`DeskConflictResolver` 提供“刷新并比较 / 调整角色 / 关闭”。
- 邀请表单保持就地状态和请求编号，pending 阶段禁止重复提交。

### System Center

- 新增 `apps/web/src/components/desk/system-center-frame.tsx` 与测试。
- 三组设置导航：账户与偏好、安全与数据、服务与治理。
- 覆盖 9 个可发现入口（包括审计）：`/app/profile`、`/app/settings`、`/app/help`、`/app/security`、`/app/sync`、`/app/data`、`/app/audit`、`/app/integrations`、`/app/ai`。
- 八条正式系统路由均包裹同一个 Frame，右侧仍渲染原有业务组件；未复制或迁移业务数据逻辑。
- 桌面使用列表 + 详情两列，900px 以下堆叠，移动端导航横向滚动，避免横向溢出。

## 实际运行并观察到的门禁

- `corepack pnpm --filter @logion/web exec vitest run ...`：协作/邀请/系统中心聚焦测试通过，9 tests。
- `corepack pnpm --filter @logion/web test`：60 个测试文件、441 个测试通过。
- `corepack pnpm --filter @logion/web lint`：通过。
- `corepack pnpm --filter @logion/web typecheck`：通过。
- `corepack pnpm exec prettier --check apps/web/src`：通过。
- `corepack pnpm --filter @logion/web build`：通过，36 条路由编译完成。
- `git diff --check`：通过。
- `pnpm guard:context`：此前 I0-C2 已通过；本批次未改变其约束路径。

## 未运行与原因

- 真实认证 Playwright、21 条认证路由、认证 axe、真实邀请邮件、真实 Records/Research 数据、Vault 解锁和真实图谱键盘/移动节点门禁：此前本机 `127.0.0.1:8080` 被无关 `sub2api` 容器占用，不是 Logion API；E2E 保护已改为允许显式指定任意回环端口（默认仍为 8080），后续隔离栈将使用 8180。当前隔离 API/网关尚未启动，未创建临时账户，也未发送邮件。
- 1440/1024/390/320 真实浏览器矩阵、主题持久化 XSS、reduced-motion 和系统中心视觉比较：需要可用的 Logion API/Web 认证栈；不能用静态构建或 mock 冒充通过。
- `pnpm ci:fast`：仓库脚本要求 `pnpm` 直接存在于子进程 PATH，本环境只能通过 Corepack 调用；等 CI 或环境 PATH 修复后再执行。
- 协调 Run 验证：历史 `.agents/coordination/runs` 目录当前被安全扫描预算/目录结构问题阻塞（缺少该命令要求的单一 Run 结构），未伪造通过，也未改写历史账本。

## 边界与风险

- 本批次没有新增邀请列表 API；409 的恢复动作只读取现有成员/空间接口，未知原因不会被猜测。
- `/app/collaboration` 仍是共享审阅领域，`/app/workspaces` 是治理领域；二者共享 Workspace/Space 数据但不合并业务对象。
- System Center Frame 只负责导航和布局；各现有页面仍自行处理权限、最近认证、危险确认、离线和能力关闭。
- 认证浏览器门禁未完成前，I0-D 只能标记为“施工完成，待真实验收”，不能标记版本完成或发布就绪。

## 下一步

1. 在隔离的真实 Logion Web/API 栈中执行认证浏览器矩阵，优先验证 `/app/workspaces` 的邀请 409、角色版本冲突和 390px 视图。
2. 验证系统中心九个入口在 Light/Dark、1440/1024/390/320 下无溢出，并检查 axe、焦点顺序和返回深链。
3. 若浏览器回归发现确定性问题，继续在当前分支修复并追加记录；未获得新的 Git 授权前不提交、不推送。
