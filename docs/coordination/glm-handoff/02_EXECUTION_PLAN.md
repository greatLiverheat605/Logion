# GLM 主线执行计划

## 主线原则

现在只保留 GLM 作为主线实施模型。Kimi、DeepSeek、OpenCode 暂停派发；只有用户明确要求或出现特定专业门禁时，协调者才提出模型建议。GLM 负责实现、测试、问题修复和结构化交接；用户保留产品批准权，协调者保留独立验收和发布门禁权。

## 阶段 0：接手与基线核对（立即）

验收目标：GLM 能够从文档恢复上下文，不依赖聊天记录。

必须完成：

1. 读取仓库 `AGENTS.md`，再按其中顺序读取 `AGENT_DELIVERY_WORKFLOW.md`、`V020_EXECUTION_PLAN.md`、`V020_STATUS.md` 和当前 Run。
2. 确认 Git 工作树、分支、远端可达性和 `main` 当前 SHA。
3. 查询 Main candidate `31300835608`，核对最终 `status/conclusion/head_sha`。
4. 把核对结果写入本目录的 `00_CURRENT_STATE.md` 和正式状态文档；未完成的检查保持 `in_progress`/`not_run`。

阶段 0 不修改业务代码，不启用任何生产开关，不发送真实邮件，不启动本机 Docker。

## 阶段 1：v0.2.0 发布候选收口

仅在 Main candidate 通过后执行：

- 在受控 prerelease 环境验证合并后的 UX 反馈：成功、失败、空值、加载、重复提交、权限、离线和邀请 409 的就地提示。
- 不发送真实邀请；使用现有受控测试账号/夹具，任何外部副作用必须先向用户申请。
- 记录浏览器、审计、迁移、恢复、依赖和安全证据；发现问题只做最小修复并重新跑受影响门禁。
- 更新 `V020_STATUS.md`、本目录和当前协调 Run。没有真实证据不得宣称 v0.2.0 发布完成。

## 阶段 2：V20-15 发布门

需要用户��次明确批准：真实受邀邮件/设备验收、观察期、最终发布和流量切换。GLM 可以准备清单和修复，但不能自行执行生产动作。

## 阶段 3：v0.2.1

目标是本地解析与论文证据工作台：公开元数据查询（Crossref/OpenAlex 等）、PDF 页码定位、批注、引用摘录、研究问题/声明/证据连接、BibTeX 导出、受控本地 Worker。边界是：不抓付费墙、不把私有 PDF 自动发送给 Provider、不自动判断论文质量、不引入 Neo4j/Qdrant/Milvus/完整 GraphRAG、不让本地 Worker 成为在线核心依赖。

进入条件：v0.2.0 发布门完成或用户明确允许并行；新增设计/威胁/容量门通过；所有 AI 输出仍为 Draft/Suggested，必须人工接受后写入正式知识。

## 阶段 4：v0.3.0 移动端候选

Android PWA + Digital Asset Links、iOS App-bound WKWebView、HarmonyOS ArkUI Web 薄壳；覆盖 onboarding、Vault、弱网、恢复和会话撤销。移动端不复制服务端权限/同步模型，不包含密钥或恢复码，不以自动化测试替代真实设备验收。

## 阶段 5：v0.4.0 Connector/Automation v2

先完成 Credential Vault、OAuth/PKCE、Webhook 签名/重放保护、MCP/API Token 能力授权，再实现默认关闭的 Automation 草稿、dry-run、人工确认点、审计与回滚。任何外部写入、分享、正式验收或掌握度修改必须人工确认。

## 统一停止条件

- 基线、路径、模型证据或用户授权不明确：停止并报告。
- 检查未执行、环境不可用、头 SHA 不一致、冲突未解决或任一门禁失败：保留断点，不伪造通过，不进入下一阶段。
- 生产开关、共享写入、删除、附件、Local Worker、Provider、sync-v1、AI Acceptance 未经用户逐项批准不得开启。
- GLM 不得自行 merge/push/release；完成后返回结构化 handoff，等待协调者或用户批准。
