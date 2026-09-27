# 在线研究工作台

依据 ADR-0038、ADR-0045，新路由位于 `apps/web/src/app/(workbench)`，
共享组件和状态位于 `apps/web/src/platform/workbench`。旧 `/app/*` 继续运行。

## 功能开关

`LOGION_RESEARCH_V3_ENABLED` 在 API 和 Web 运行时均默认为 `false`，Compose
将同一个值传给两个服务。关闭时 `/today /library /read/* /questions /graph /review
/plan /settings` 返回 HTTP 404；CSP 与原有认证保护保留。生产启用另需所有者批准。

Playwright 的 `workbench-chromium` 项目从同一构建启动两个隔离 Web 实例，
分别以开关开启和关闭运行，覆盖真实路由状态、键盘和响应式布局。

## 偏好合同

复用 `GET /api/v1/users/me/settings` 和 `PUT /api/v1/users/me/settings`；
每次写入携带已读版本，新键从版本 0 创建。不建立新表。值使用 JSON 字符串：

| 键                      | 值                                     |
| ----------------------- | -------------------------------------- |
| `appearance.theme`      | `"light"`、`"dark"` 或 `"system"`      |
| `workbench.context`     | `workspace_id` 和 `space_id` 两个 UUID |
| `workbench.layouts`     | `preset`、三个 `panes`、`toolbars`     |
| `reader.selection_menu` | 布尔值                                 |

每栏包含 `content`、10–80 的相对 `width` 和 `collapsed`；至少一栏保持可见。
内容标识为 `info / document / translation / quiz`，仅文献信息已实现，
其他是后续阅读功能占位。预设为 `reading / translation / quiz / focus`，
手动调整标记为 `custom`。

新键关闭时，按键读取和写入返回 404，批量读取不暴露这四个键。
旧设置键合同不变。开启时校验 JSON 结构和当前 Space 访问权限；
保存上下文不能授予权限，领域 API 必须继续独立检查权限。
版本冲突返回 `USER_SETTING_VERSION_CONFLICT`，无效值返回
`RESEARCH_PREFERENCE_INVALID`，均不记录设置值。

## 客户端行为

沿用现有 SessionProvider 续期、CSRF 客户端和 nonce CSP。React Query 只在内存中
合并相同资源请求；不持久化业务数据，不注册 Service Worker。
网络错误显示“需要联网”，mutation 不暂停排队或自动重试。
401 清空内存查询并转登录页。普通保存保持安静，失败在对应界面说明。

指令、导航、外观与预设使用统一注册表。保留键组合的允许列表防止占用浏览器
标签页快捷键。三栏标题固定 32px；鼠标悬停、键盘焦点或显示工具栏时出现选择器，
触摸设备始终显示。小于 768px 时一次展示一栏，通过栏目分段控件切换。
分隔条既支持拖动，也支持方向键以 2 个相对单位调整。

原型的主色和几何尺寸保持不变；浅色辅助文字与选中导航文字使用同色系的
较深文本令牌，以满足小字号在半透明底色上的 WCAG AA 对比度。
