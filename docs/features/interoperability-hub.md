# 互操作中心 v1

## 产品目的

互操作中心把 Logion 已有的开放数据能力集中到 `/app/integrations`，帮助用户查看、创建和撤销真实操作，而不引入新的凭据边界、数据库结构或 API。页面不复刻原型中的演示连接数、健康度和自动化运行次数。

## v1 已交付范围

### Calendar Feed

- 复用工作区 Calendar Feed 列表、创建和撤销接口。
- 创建响应中的 Token 只在页面显示一次，可复制或关闭，不写入 UserSetting、通知、日志或本地持久状态。
- 公开 ICS 只包含必要标题与时间；撤销后旧地址立即返回 404。

### 开放格式导入

- 支持 Logion JSON、Markdown、CSV 和 BibTeX。
- 必须先生成预览，展示对象计数和警告。
- 提交目标只列出当前用户拥有的 Private Space；服务端继续执行权限和单次提交校验。

### 数据导出

- 输入 `EXPORT` 明确确认，并通过服务端近期认证门禁。
- 展示 queued、running、succeeded、failed、cancelled、expired 真实状态。
- 成功后提供短期下载、文件大小、SHA-256；压缩包包含 `manifest.json`、`data.json`、`notes.md`、`tasks.csv` 和 `papers.bib`。
- manifest 明确记录范围和排除项，凭据、会话、恢复材料、Provider 密钥、分享与 Calendar Token 不进入导出包。

### 状态与发现入口

- 覆盖 loading、needs-context、empty、ready、error、recent-auth-required 和 unsupported。
- 学、研、导画像在设置页和命令面板显示常驻入口；考画像和自定义画像不显示。
- `/app/integrations` 是二级路由，不改变冻结的 12 条画像主路由、侧边栏或移动底栏映射。
- 所有已认证用户可直接访问；Persona 只优化 UI，Workspace Role 和 Space 权限仍由后端决定。

## 使用流程

1. 打开互操作中心并选择工作区。
2. Calendar Feed：填写名称、创建、立即保存一次性 URL；停用时撤销。
3. 导入：选择格式、文件名和内容，生成预览，再确认写入本人的 Private Space。
4. 导出：近期登录后输入 `EXPORT`，等待 worker 完成，下载并核对 SHA-256 和 manifest。
5. 请求失败时保留页面请求编号交给管理员排查；页面不会把失败伪装成空数据或成功。

## 安全与隐私边界

- 页面只通过 `browserApiClient` 调用已有同源 API，并继续使用 Cookie 会话、可信 Origin 和 CSRF 校验。
- 不读取浏览器 Cookie 值、密码库、第三方 Token 或其他凭据。
- Calendar Token 只存在于创建响应和当前 React 内存；页面刷新或关闭提示后无法找回。
- 导入正文、私人笔记和 Token 不进入前端日志；后端审计保存最小操作元数据。
- 导出、导入、Feed 创建和撤销不能通过画像获得额外权限。

## v2 明确延期

以下能力不属于 v1，也不能通过添加假表单提前暴露：

- Zotero 等第三方账号连接与 OAuth；
- 入站或出站 Webhook；
- MCP/API Token 创建、授权、轮换和撤销；
- 自动化触发器、执行器、重试、调度和运行历史。

v2 需要独立完成凭据存储、授权范围、后台调度、幂等、审计、速率限制、失败重试和撤销传播设计，再决定数据库与 API 变更。

## 交付、限制与回滚

- v1 没有新增表、列、Alembic 迁移或 OpenAPI 端点；UserSetting 和 `sync-v1` 均未扩展。
- 运行时依赖现有 API、PostgreSQL、Redis 和 worker。worker 版本必须与 API 源码一致，否则导出任务可能停留在队列。
- 回滚无需数据库操作：按逆序撤销互操作页面、真实动作、入口和共享请求服务的提交即可；现有 Calendar Feed、导入和导出接口仍供原页面使用。
- 阶段提交点：`afab05f`（路由边界）、`c5b9da9`（能力服务）、`8368b6b`（页面与入口）、`3b7dc8e`（真实动作）、`a052130`（响应式与可访问性）、`3af26ec`（真实浏览器回归）。

## 验收证据

- `pnpm contracts:generate`：OpenAPI 和生成类型无差异。
- `pnpm ci:fast`：通过。
- `pnpm test:browser`：70 通过、135 按环境/项目条件跳过、0 失败。
- 互操作专用 Chromium 真实流程：5/5 通过。
- Calendar、导入、导出定向后端集成测试：3/3 通过。
- Docker Web、API、worker、PostgreSQL、Redis 和 8080 反向代理健康。
