# I0 最终安全与权限边界审查

日期：2026-08-12（Asia/Shanghai）

工作区：正式 `v020-integration` 集成工作区

分支：`codex/logion-redesign-i0`

固定基础提交：`e2b85987d816baf53a089007e674cd440e9ce64f`

## 审查结论

I0-A 至 I0-E 的代码、合同、权限边界和真实浏览器回归已经完成最终技术审查。审查期间发现的 Workspace/Review 上下文竞态、成员角色输入边界和知识图谱响应合同问题均已修复，并通过单元测试与真实认证浏览器回归。

当前工作体可以进入 Git 审批节点。该结论不等于已经 commit、push、merge、deploy，也不等于 v0.2.0 已发布。Shared Write、Deletion、Attachment、知识空间 Local Worker、Provider、sync-v1 与 AI Acceptance 的生产开关继续关闭。

## 最终修复

### Workspace 与 Review 上下文

- Workspace 列表、Workspace 详情、Review 工作区/设备和 Space 请求均使用 `AbortController` 与最新请求守卫。
- 快速切换 Workspace 时，旧 Space、Member 或本地解密结果不能覆盖当前选择；Review 会立即清空旧 Space、图谱根节点和 Inspector。
- 组件卸载、上下文切换和能力禁用都会取消或失效旧请求，陈旧成功与陈旧异常均不能回写新状态。
- 动态 Workspace、Space 和 Member 路径段统一编码，避免路径注入或错误路由匹配。

### 角色与写请求边界

- 邀请角色和成员角色更新在发请求前严格限制为 `viewer`、`reviewer`、`contributor`、`editor`、`admin`。
- DOM 被篡改为 `owner` 或其他合同外角色时，不发送请求。
- 写请求继续要求 CSRF，成员角色更新继续携带 `expected_version`；未放宽 Persona、SessionBoundary 或服务端授权。
- 409 冲突仍使用稳定原因映射，不自动重发，也不向界面泄漏服务端原始错误。

### 知识图谱合同

- 实际解析对象的 UTF-8 JSON 大小限制为 1 MiB，不能通过压缩或错误的长度元数据绕过。
- `next_cursor` 限制为最多 1024 字符。
- 顶层响应、根节点、节点、摘要、边和 limits 对象拒绝合同外字段。
- 原有 150 节点、400 边、UUID、重复 ID、悬空边、端点类型和截断元数据验证继续保留；任何合同异常均失败关闭。
- 图谱 Hook 继续取消旧请求、丢弃陈旧响应，并把 403/404 作为不可见或未授权状态处理。

### 最终可访问性修复

- 搜索页服务器按钮不再在禁用到启用的中间帧对文字色和背景色做过渡，避免短暂出现约 3.02:1 的低对比度组合；禁用态使用不透明语义灰色，其他触觉反馈保留。
- WorkspaceCenter 的工作区选择改为具名语义列表，每个工作区为列表项，内部继续使用原生按钮；没有通过删除可访问名称来规避 axe。
- 新增列表语义回归测试，真实认证 21 路由 axe 与横向溢出门禁再次通过。

### 隔离浏览器栈

- `8080` 上的无关 `sub2api` 未被触碰；验收使用 `127.0.0.1:8180` Web 与 `127.0.0.1:8000` API。
- 一次生产构建重启后，standalone 静态文件复制层级错误导致 `/_next/static/chunks/*` 返回 404，页面停留在会话验证状态。修正 standalone 目录层级并重启后，静态资源、登录页和 `/health` 均恢复 200；该次失败属于本机验收栈装配问题，不是产品回归。
- 没有启动 Docker，没有修改生产配置，没有使用 mock 替代认证、授权或真实 API。

## 安全审查结果

- 未发现 I0 候选文件中存在硬编码 API key、访问令牌、真实密码或数据库连接串。
- 未发现新的 SessionBoundary 绕过、客户端权限扩大、CSRF 取消、服务端原始错误泄漏或敏感生产开关启用。
- 主题持久化恶意值、移动/桌面导航、图谱键盘操作、响应式横向溢出和 axe 无障碍均由真实浏览器覆盖。
- 未新增依赖；`pnpm audit --audit-level high` 无已知漏洞，`pip-audit` 无已知漏洞。本地包 `logion-api` 与 `logion-worker` 不是 PyPI 包，按工具预期跳过。
- 候选文档中的本机用户绝对路径已经清理；既有 V20-11 本机安全证据保持历史原文，不作改写。

## 实际验证

- Web：Prettier、lint、TypeScript、`guard:context`、生产构建和 `git diff --check` 通过；62 个测试文件、449 项测试通过；生产构建生成 36 条路由。
- 定向前端回归：Workspace/Review 竞态与知识图谱合同共 45 项通过。
- Python：Ruff 通过；Mypy strict 对 171 个源文件通过；Pytest 为 402 通过、67 项按选择条件排除。
- 合同与离线：合同测试 12 项通过；离线测试 55 项通过，行覆盖率 93.01%；`contracts:check` 通过且生成文件无差异。
- 工具链：agent-state 工具和 fixture 测试 118 项通过。
- 最新 I0-E 完整矩阵：公开五浏览器 69 通过、6 项按规范跳过，`authenticated-chromium` 32/32 通过；合计 101 通过、6 项按规范跳过、0 失败。
- 最终修复后认证专项：18/18 通过。
- 新增真实竞态烟雾：1/1 通过。测试通过真实 UI 创建两个 Workspace 及各自 Space，延迟 A 的响应后快速切换到 B，确认 WorkspaceCenter 与 Review 均保持 B 的数据。
- 最终 `corepack pnpm ci:fast` 从头到尾返回 0；`pnpm audit --audit-level high` 与 `pip-audit` 均未发现已知漏洞。本地工作区包按审计工具预期不从 PyPI 解析。

## 独立未通过项

`.agents/coordination/current-run.json` 指向的历史协调 Run 仍无法通过 `agent:state:validate`：`graph.json` 与 `tasks.jsonl` 包含超出 safe scan budget 的 encoded content。工具自身和 fixture 测试均通过；本轮没有伪造该门禁通过，也没有改写历史协调事件。

该限制不改变源码、合同、依赖和真实浏览器门禁的结果，但在修复历史协调账本前，不能把当前 Run 校验写成全绿。

## Git 审批边界

- 用户已于 2026-08-13 批准创建并推送 I0 分支。主实现提交已经创建：
  `0aeacb405eb61870a05efa7424ef528763a278e1`（`feat(web): implement adaptive desk redesign`）。
- `codex/logion-redesign-i0` 已成功推送至 `origin` 并建立跟踪关系；首次文档收口提交为
  `fdad1909b8c13588d79ff50bbcce0bb85f9bba83`。当前仍未 merge 或 deploy。
- `.tmp-v020-rc2/`、`.tmp-v020-rc4/` 与 `.zcode/` 不得进入提交。
- 主实现提交包含 85 个已复核文件；提交后仍需单独执行远端 CI、集成和发布审批。
- 未获得新的生产授权前，不启用任何默认关闭能力，不进行流量切换。
