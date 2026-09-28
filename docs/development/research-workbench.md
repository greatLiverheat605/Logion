# 在线研究工作台

依据 ADR-0038、ADR-0045，新路由位于 `apps/web/src/app/(workbench)`，
共享组件和状态位于 `apps/web/src/platform/workbench`。旧 `/app/*` 继续运行。

## 功能开关

`LOGION_RESEARCH_V3_ENABLED` 在 API 和 Web 运行时均默认为 `false`，Compose
将同一个值传给两个服务。关闭时 `/today /library /read/* /questions /graph /review
/plan /settings` 返回 HTTP 404；CSP 与原有认证保护保留。生产启用另需所有者批准。

Playwright 的 `workbench-chromium` 项目从同一构建启动两个隔离 Web 实例，
分别以开关开启和关闭运行，覆盖真实路由状态、键盘和响应式布局。

`playwright.research.config.ts` 另启真实 API（8000 开、8001 关）与 Web（3090），
仅匹配 `research-real-backend.spec.ts`，不拦截任何请求。先用
`LOGION_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm --filter @logion/web build`
构建（Next 的代理目标在构建时确定），在已迁移的合成测试数据库与 Redis 环境中运行
`pnpm exec playwright test --config playwright.research.config.ts`。
PR 的 integration 门执行此用例并上传 `pr-research-real-*` 报告；研究开关仅注入
该配置启动的服务进程，其他测试环境不变。用例零重试、无固定等待，验证真实登录、
文献创建／重复／刷新、跨上下文偏好与版本冲突、在线存储边界和关旗 404。
真实会话与合成密码不进入 trace 或 video。

关闭开关保留 v0.3 的隐私过滤，不能据此回退到未修补的 v0.2.x。
一旦存在 `research_owner_id` 非空资源（关旗时旧论文写入也会产生），旧应用会在
共享 Space 暴露私人文献，且可能拒绝新资源类型。R5 前须由所有者选择
[ADR-0039 的 A／B 回滚策略](../adr/0039-unified-source-model.md#rollback)；
Claude 建议 A，本轮仅修正文档。

## 偏好合同

复用 `GET /api/v1/users/me/settings` 和 `PUT /api/v1/users/me/settings`；
每次写入携带已读版本，新键从版本 0 创建。不建立新表。值使用 JSON 字符串：

| 键                      | 值                                     |
| ----------------------- | -------------------------------------- |
| `appearance.theme`      | `"light"`、`"dark"` 或 `"system"`      |
| `workbench.context`     | `workspace_id` 和 `space_id` 两个 UUID |
| `workbench.layouts`     | `preset`、三个 `panes`、`toolbars`     |
| `reader.selection_menu` | 布尔值                                 |
| `reader.hint_dismissed` | 布尔值，关闭首次阅读提示后为 `true`    |

每栏包含 `content`、10–80 的相对 `width` 和 `collapsed`；至少一栏保持可见。
内容标识为 `info / document / translation / quiz`，仅文献信息已实现，
其他是后续阅读功能占位。预设为 `reading / translation / quiz / focus`，
手动调整标记为 `custom`。

新键关闭时，按键读取和写入返回 404，批量读取不暴露这些研究偏好键。
旧设置键合同不变。开启时校验 JSON 结构和当前 Space 访问权限；
保存上下文不能授予权限，领域 API 必须继续独立检查权限。
版本冲突返回 `USER_SETTING_VERSION_CONFLICT`，无效值返回
`RESEARCH_PREFERENCE_INVALID`，均不记录设置值。

## 首屏外观与阅读栏

研究路由的服务端渲染通过当前请求会话读取 `appearance.theme`，禁用缓存与重定向。
已保存的日间／夜间值直接写入 HTML；跟随系统时才运行带 nonce 的系统主题脚本。
客户端在设置加载完成前保留服务端颜色。会话失效或服务不可用时由原有会话流程恢复。
栏内容增加 `pdf / outline / thumbs / note / excerpts / chat / translate`，
原有 `info / document / translation / quiz` 继续有效。

## 客户端行为

沿用现有 SessionProvider 续期、CSRF 客户端和 nonce CSP。React Query 只在内存中
合并相同资源请求；不持久化业务数据，不注册 Service Worker。
网络错误显示“需要联网”，mutation 不暂停排队或自动重试。
401 清空内存查询并转登录页。普通保存保持安静，失败在对应界面说明。

指令、导航、外观与预设使用统一注册表。保留键组合的允许列表防止占用浏览器
标签页快捷键。三栏标题固定 32px；鼠标悬停、键盘焦点或显示工具栏时出现选择器，
触摸设备始终显示。小于 768px 时一次展示一栏，通过栏目分段控件切换。
分隔条既支持拖动，也支持方向键以 2 个相对单位调整。

阅读预设条与“显示栏目”默认隐藏；⌘/Ctrl+反斜杠和指令面板共用同一显隐状态，
Esc 先关闭弹层，再收起工具栏。隐藏时仍支持预设快捷键与指令。
首次提示位于正文前的正常布局流，关闭后通过 `reader.hint_dismissed` 按版本保存；
手机始终保留栏目切换。非 Mac 快捷键提示使用 Ctrl。

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

## 私人想法与 AI 出站边界（ADR-0041）

`/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/ideas` 提供 GET 列表和
POST 创建；`/{idea_id}` 提供 GET 详情、PUT 全量编辑、DELETE 软删除。
字段为 `title`、`body`、`status`（`active` 或 `archived`），编辑／删除携带
`expected_version`。列表使用 `cursor`、`limit`，返回 `ideas`、`next_cursor`。
所有操作受研究开关和本人／Space 权限约束，关闭返回 404；写入沿用 CSRF、Origin、
限流和会员锁。账户最终注销会删除想法；旧同步、导出和 agent 注册表没有想法入口。
界面在后续知识阶段提供，R1 仅实现 API。

研究 AI 入口为 POST
`/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/ai/runs`。
提交 `id`、`idempotency_key`、`task_type`、`target`、可选 `context_entities`、
`expected_output_fields`、`requested_output_tokens`、`retain_input` 和
`send_confirmed: true`。目标和上下文均为 `{entity_type, id, version}`。
服务端校验空间、本人及版本后取源内容，客户端不能向该入口传任意正文。
创建后通过既有 `/api/v1/workspaces/{workspace_id}/ai/runs` 和 `/ai/drafts`
查看、取消任务和审查草稿；近期认证、预算预留、会话与草稿验收约束保持生效。

`ai_gateway/research_context.py` 集中维护七类实体白名单及每个任务的映射。
R1 可读 `resource`、`source_excerpt`、`note`、`research_question`、`topic`、
`research_claim`；`source_text` 预留在批准的白名单中，但 R1 尚无加载器，返回
`AI_CONTEXT_UNAVAILABLE`。想法完全没有加载器。构建前和 Worker 发送前分别检查；
遇到 `idea`／`ideas`／`research_idea`／`research_ideas` 返回
`AI_PRIVATE_CONTENT_BLOCKED`。旧 AI 入口同样拒绝以想法为目标的请求。
审计只记录任务类型和实体类型，不含正文、实体 ID 或工作区 ID。

迁移 `0045_research_privacy` 新建 `research_ideas`，并为 `ai_runs` 添加默认空数组的
`context_entity_types`，让出站复核使用持久化的来源类型。旧请求幂等哈希不变。
关闭研究开关后，排队中的研究任务也停止出站并释放预算；旧 AI 任务继续原行为。
存在想法或研究任务来源记录时，schema downgrade 明确拒绝，防止静默丢失。

## AI 任务预设与提示词

GET `/api/v1/workspaces/{workspace_id}/research/ai/presets` 返回档位映射；
POST 同一路径接收 `economical_model_ids`、`quality_model_ids` 及可选的
`max_input_tokens`、`max_output_tokens`，在现有 `ai_task_routes` 创建七条路由。
需 AI 配置权限和近期认证；模型必须属于当前工作区。已有路由或无效模型会使整组
创建回滚。之后通过既有路由编辑接口按版本调整，预设不会覆盖已有配置。

| 任务                          | 档位   | 服务端 SKILL         |
| ----------------------------- | ------ | -------------------- |
| `translate`                   | 经济   | `explain-translate`  |
| `explain`                     | 高质量 | `explain-translate`  |
| `close_reading`               | 高质量 | `close-reading`      |
| `quiz_generate`、`quiz_grade` | 高质量 | `comprehension-quiz` |
| `link_suggest`                | 高质量 | `literature-links`   |
| `weekly_comment`              | 经济   | `weekly-review`      |

五份 `packages/skills/*/SKILL.md` 由服务端读取，并随 API／Worker 镜像打包。
每次运行保存任务及提示词摘要；升级后若提示词已变，旧任务返回
`AI_PROMPT_VERSION_CHANGED`，需要重新创建。模型输出仅为待人工审查的草稿。
Provider 配置与可选模型比较见[研究 AI 配置](../operations/research-ai.md)。
