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

## 个人文献库（ADR-0039）

接口前缀为 `/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources`。
关闭研究开关时，包括未认证请求在内的所有新文献库接口均返回 404。
开启时复用会话认证、Space 权限、写入 CSRF、可信 Origin 和限流，响应禁止缓存。

| 方法   | 路径             | 行为                                                                     |
| ------ | ---------------- | ------------------------------------------------------------------------ |
| GET    | 前缀             | 当前用户列表；可选 `status`、完整 `tag`、UUID `cursor`、1–100 的 `limit` |
| GET    | `/{resource_id}` | 当前用户的文献详情                                                       |
| POST   | 前缀             | 手动创建，返回 201                                                       |
| PUT    | `/{resource_id}` | 全量编辑，携带 `expected_version`                                        |
| DELETE | `/{resource_id}` | 携带 `expected_version` 软删除，返回 204                                 |

列表响应为 `resources` 和可空 `next_cursor`。字段包含标题、类型、CSL 子集、
三个标识符、引用键、标签、Zotero 映射、文件定位及阅读状态。
DOI 去前缀并小写；arXiv 去网址、版本和 PDF 后缀；PMID 规范化为正整数文本。
同 Space 同用户重复返回 `LIBRARY_DUPLICATE`（409）及本人 `existing_id`；
其他人的 ID 始终返回 404。版本冲突为 `RESOURCE_VERSION_CONFLICT`。
设为 `close_read` 且没有 `read_at` 时，服务端填写当前时间。

文献列表可筛选状态、标签并继续分页。检查器支持详情、编辑、确认删除和进入阅读。
手动表单支持标题、作者、年份、期刊、标识符、引用键、网址、标签与摘要；
编辑保留未展示的 CSL、文件与 Zotero 元数据。保存失败保留输入，冲突时可显式放弃
当前输入并重新载入。切换空间重新建立当前列表和表单，缓存键含工作区及空间。

迁移 `0044_research_resources` 以新 UUID 映射旧论文并回填 claims；旧表保留。
开关关闭时旧论文新建、导入在同一事务补映射；开启时旧论文创建或含论文的导入返回
`RESEARCH_PAPERS_READ_ONLY`（409）。旧资料同步、搜索、导出、任务证据与知识引用
不包含私人文献。库变更审计不存标题、正文、工作区或文献 ID。
账户最终注销会清除本人在他人共享 Space 中的私人文献；私人映射不占用旧资料配额。
