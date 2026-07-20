# Web 认证客户端威胁模型

- 工作包：`L1-006A`、`L1-006B`、`L1-006C`、`L1-006D`
- 状态：Phase 1 Web 认证、账户安全与 Workspace 管理边界已实现
- 决策基线：`ADR-0002`、`ADR-0006`

## 范围与信任边界

本增量覆盖浏览器到同源 `/api/v1` 的请求边界、CSRF Header、Access Session 引导、Refresh
轮换单飞、受保护应用壳和用户可见错误。Access/Refresh Cookie、服务端 Session、用户状态和
Workspace 权限仍由 FastAPI/PostgreSQL 决定；React Context 只保存当前页面生命周期内的展示
状态，不是授权来源，也不进入 localStorage、sessionStorage、Service Worker Cache 或未来
IndexedDB 业务库。

本模型同时覆盖注册、登录、Passkey、TOTP、恢复码、设备撤销、邀请令牌、Workspace/Space 与审计展示。

## 威胁、控制与验证

| 威胁                                        | 当前控制                                                                                                                      | 验证证据                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| API Client 被用于向外部站点发送 Cookie/CSRF | 只接受不含 query/fragment 的相对 `/api/v1` 路径；Fetch 固定 `same-origin`、`redirect=error`                                   | 绝对 URL、非 v1 和 query 路径单元负测          |
| Feature 绕过 Cookie 模型注入 Bearer/Cookie  | 拒绝调用方传入 `Authorization`、`Cookie`、`Origin`、`Referer`、`Host`                                                         | 禁止 Header 单元负测                           |
| CSRF Token 从错误来源复制或泄漏             | 仅在调用方显式声明受保护请求时从 `logion_csrf` Cookie 读取并写入 `X-CSRF-Token`；调用方不得直接设置该 Header                  | 缺 Cookie 失败关闭及 Header 允许列测试         |
| 并发 Refresh 触发轮换重放检测并退出         | 页面内使用单飞 Promise，标签页间通过同源 Web Lock 串行刷新；不降低服务端重放检测；任意业务写请求不自动重试                    | 并发调用测试与 Web Lock 实现复核               |
| Access 过期被错误视为退出                   | Bootstrap 先读取 `/auth/me`，仅在明确 `401` 时尝试受 CSRF 保护的 Refresh                                                      | 当前会话、Access 过期和 Refresh 拒绝矩阵       |
| `5xx`、网络或畸形响应被当成匿名/成功        | 只把 `401` 或本地缺 CSRF 视为匿名；其他错误进入可重试错误态；成功和错误均要求 JSON                                            | 非 JSON、未知异常和网络错误负测                |
| 服务端错误正文、Token 或堆栈进入 UI/日志    | 丢弃 Error `details` 与原始响应正文；Session Context 只保留 code、retryable、request ID；全局错误页不显示 Error message/stack | 敏感 details 与未知异常序列化测试              |
| 前端“已登录”被当成服务端授权                | Session Boundary 只决定展示；所有 API 仍携带 Cookie 并由后端重新认证/授权                                                     | 架构复核；后续 Workspace UI 继续执行 IDOR 负测 |
| 刷新任意写请求导致重复副作用                | 基础 Client 不实现透明认证重试；后续写请求必须显式决定幂等与恢复                                                              | API Client 行为复核                            |
| 受保护路由断网时静默显示公共首页            | Service Worker 只缓存无用户数据的公共首页和明确离线说明；非首页导航失败统一显示离线边界                                       | 缓存清单和 fetch 路由复核                      |
| 邮件或邀请令牌进入 Referer、历史记录和日志  | 动作令牌只接受 URL fragment；首次挂载立即 `replaceState` 清除；仅保存在组件内存，格式失败关闭                                 | fragment 消费/清除单元测试                     |
| XSS 窃取认证状态或扩大注入能力              | 每个 HTML 请求生成 nonce；CSP 禁止 `unsafe-inline`/`unsafe-eval`，限制脚本、连接、对象、表单和 frame ancestor                 | 生产构建与浏览器 CSP smoke                     |
| MFA 挑战或恢复码持久化                      | MFA challenge 仅存 React 内存；恢复码只在激活响应后一次展示；不写 Web Storage、Cache 或 URL                                   | 代码审查与浏览器存储检查                       |
| 前端角色篡改形成越权                        | Web 角色只控制操作入口；服务端从 Session 与 Membership 重新决策，并执行 Workspace/Space 负向权限矩阵                          | API 跨租户与角色降级测试                       |

## 安全与性能设计

- 认证 API 通过同源路径访问；本地开发由 Next.js Rewrite 连接 FastAPI，生产由反向代理分流；
- 请求默认 `no-store`，不把认证响应交给浏览器 HTTP Cache；
- 超时限制为 `1..60000 ms`，默认 15 秒，并传播调用方取消；
- Session Provider 是最小客户端边界，布局和静态壳继续使用 React Server Components；
- 错误、匿名和加载状态使用语义化元素、可见焦点与至少 44 CSS px 的操作目标。

## 残余风险与后续门槛

- CSP 由 Next.js Proxy 为文档请求注入 nonce，根布局读取请求 Header 使 HTML 动态渲染，以便 Next.js 给框架与 hydration script 附加同一 nonce。该安全选择取消了 HTML 静态预渲染，但 JS/CSS 静态资源仍可长期缓存；部署时必须保留浏览器 console smoke，防止框架升级改变 nonce 传播。
- CSRF Cookie 名目前由 Web 与 API 配置约定。若未来允许改名，必须增加非敏感运行时配置契约，
  不能让两个部署独立漂移。
- 不支持 Web Locks 的旧浏览器退化为页面内单飞；兼容矩阵扩展时应补充 BroadcastChannel 协调，但不得把 refresh token 或挑战写入 localStorage。
- Session Context 不提供离线认证。断网时未来业务本地库可以经本地解锁只读/编辑，但不得据此恢复
  服务端权限；设备撤销后的离线残留风险由 Phase 2 明确处理。
