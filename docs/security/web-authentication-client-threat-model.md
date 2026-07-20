# Web 认证客户端威胁模型

- 工作包：`L1-006A`
- 状态：实现增量，完整认证表单与 Phase 1 退出审查尚未完成
- 决策基线：`ADR-0002`、`ADR-0006`

## 范围与信任边界

本增量覆盖浏览器到同源 `/api/v1` 的请求边界、CSRF Header、Access Session 引导、Refresh
轮换单飞、受保护应用壳和用户可见错误。Access/Refresh Cookie、服务端 Session、用户状态和
Workspace 权限仍由 FastAPI/PostgreSQL 决定；React Context 只保存当前页面生命周期内的展示
状态，不是授权来源，也不进入 localStorage、sessionStorage、Service Worker Cache 或未来
IndexedDB 业务库。

具体注册、登录、Passkey、TOTP、恢复、设备和 Workspace 表单不在本工作包内。

## 威胁、控制与验证

| 威胁                                        | 当前控制                                                                                                                      | 验证证据                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| API Client 被用于向外部站点发送 Cookie/CSRF | 只接受不含 query/fragment 的相对 `/api/v1` 路径；Fetch 固定 `same-origin`、`redirect=error`                                   | 绝对 URL、非 v1 和 query 路径单元负测          |
| Feature 绕过 Cookie 模型注入 Bearer/Cookie  | 拒绝调用方传入 `Authorization`、`Cookie`、`Origin`、`Referer`、`Host`                                                         | 禁止 Header 单元负测                           |
| CSRF Token 从错误来源复制或泄漏             | 仅在调用方显式声明受保护请求时从 `logion_csrf` Cookie 读取并写入 `X-CSRF-Token`；调用方不得直接设置该 Header                  | 缺 Cookie 失败关闭及 Header 允许列测试         |
| 并发 Refresh 触发轮换重放检测并退出         | 每个 Session Coordinator 对 Refresh 使用单飞 Promise；任意业务写请求不自动重试                                                | 并发调用只产生一次 Refresh 测试                |
| Access 过期被错误视为退出                   | Bootstrap 先读取 `/auth/me`，仅在明确 `401` 时尝试受 CSRF 保护的 Refresh                                                      | 当前会话、Access 过期和 Refresh 拒绝矩阵       |
| `5xx`、网络或畸形响应被当成匿名/成功        | 只把 `401` 或本地缺 CSRF 视为匿名；其他错误进入可重试错误态；成功和错误均要求 JSON                                            | 非 JSON、未知异常和网络错误负测                |
| 服务端错误正文、Token 或堆栈进入 UI/日志    | 丢弃 Error `details` 与原始响应正文；Session Context 只保留 code、retryable、request ID；全局错误页不显示 Error message/stack | 敏感 details 与未知异常序列化测试              |
| 前端“已登录”被当成服务端授权                | Session Boundary 只决定展示；所有 API 仍携带 Cookie 并由后端重新认证/授权                                                     | 架构复核；后续 Workspace UI 继续执行 IDOR 负测 |
| 刷新任意写请求导致重复副作用                | 基础 Client 不实现透明认证重试；后续写请求必须显式决定幂等与恢复                                                              | API Client 行为复核                            |
| 受保护路由断网时静默显示公共首页            | Service Worker 只缓存无用户数据的公共首页和明确离线说明；非首页导航失败统一显示离线边界                                       | 缓存清单和 fetch 路由复核                      |

## 安全与性能设计

- 认证 API 通过同源路径访问；本地开发由 Next.js Rewrite 连接 FastAPI，生产由反向代理分流；
- 请求默认 `no-store`，不把认证响应交给浏览器 HTTP Cache；
- 超时限制为 `1..60000 ms`，默认 15 秒，并传播调用方取消；
- Session Provider 是最小客户端边界，布局和静态壳继续使用 React Server Components；
- 错误、匿名和加载状态使用语义化元素、可见焦点与至少 44 CSS px 的操作目标。

## 残余风险与后续门槛

- 当前 CSP 尚未引入 nonce。Next.js App Router 会注入框架脚本，不能用未经验证的
  `unsafe-inline` 作为完成方案；`L1-006B` 合并前必须选择并验证 nonce/SRI 路径，覆盖首页、认证页、
  PWA 与错误页，且不能无说明地取消公共页面静态性能。
- CSRF Cookie 名目前由 Web 与 API 配置约定。若未来允许改名，必须增加非敏感运行时配置契约，
  不能让两个部署独立漂移。
- 单飞只覆盖同一 React Session Provider。多标签页仍可能并发 Refresh；完整认证体验需增加
  BroadcastChannel/租约策略或由服务端 ADR 定义短暂 grace window，不能降低 Refresh 重放检测。
- Session Context 不提供离线认证。断网时未来业务本地库可以经本地解锁只读/编辑，但不得据此恢复
  服务端权限；设备撤销后的离线残留风险由 Phase 2 明确处理。
- 本增量没有真实登录表单或认证 E2E，不能据此宣布 Phase 1 完成。
