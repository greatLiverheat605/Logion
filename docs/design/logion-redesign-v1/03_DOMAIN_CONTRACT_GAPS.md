# Logion D0：领域对象与合同差距

## 1. 对象基线

| 用户对象           | 当前正式模型/API                                                                                    | 权限、归属与跨 Workbench                                              | sync-v1                              | 新设计可直接实现性与缺口                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Workspace          | `Workspace`、Membership、Invitation；完整管理 API                                                   | Workspace 角色治理；不读取 Private Space 正文                         | Workspace/可见上下文参与同步         | 可直接重构管理 UI；邀请/角色冲突沿用现有合同                                                  |
| Knowledge Base     | 没有平行模型；正式映射为 `Space`                                                                    | `workspace_id + space_id`；Private 仅 owner，Shared 按角色            | `space` 已在 sync-v1                 | **必须复用 Space**；只改用户语言和导航，不新建 KnowledgeBase 表                               |
| Collection         | 无正式模型/API/Schema                                                                               | 目标是库内组织，不得改变 Space 权限                                   | 无                                   | 需要独立 ADR/合同/持久化；D2 只能原型模拟，正式施工不得伪装可保存                             |
| Saved View         | 无正式模型/API/Schema                                                                               | 用户或库范围尚未决定；只能保存查询/布局投影                           | 无                                   | 需要 ADR：owner、共享、版本、大小、过滤 Schema、迁移与删除语义                                |
| Workbench          | 无 `workbench-v1` 模型/API/Schema                                                                   | 目标是正式对象投影；固定台不可删除，自定义台不提权                    | 无                                   | 需要独立 ADR/Schema/迁移；不能用 Persona JSON 偷渡模块/属性/权限                              |
| Task               | `Task`、Session、Evidence、Verification 正式模型/API                                                | Workspace/Space/Goal 定界；Task 可被多个 Workbench 引用但仍一份       | 已支持                               | 数据可直接复用；需补主要归属/引用 UI 与跨页深链接                                             |
| Source             | 当前正式对象是 `Resource`，不是新的通用 Source 表                                                   | Space 范围；来源身份与专业元数据有限                                  | `resource` 已支持                    | 首版复用 Resource；需来源类型、规范标识、重复识别/合并合同，不能另造平行 Source               |
| Note               | `Note` + Yjs document stream                                                                        | Space 范围；可在多个 Workbench 引用                                   | `note`、document state/update 已支持 | 可直接复用；需统一对象链接与回源，不复制 Note                                                 |
| Excerpt            | `SourceExcerpt` ORM/API 已实现，知识 API 默认关闭                                                   | 同 Workspace/Space Resource；创建/读取均重新授权；有版本/哈希/locator | **online-only，不在 sync-v1**        | 合同可供只读/受控写入阶段使用；生产开关关闭时原型不可声称保存成功                             |
| Topic              | `Topic` + `TopicDependency` 正式模型/API                                                            | Space 范围；正式先修关系唯一由 TopicDependency 表达                   | 已支持                               | 可直接用于 Review/Graph；正式/探索关系仍需新合同，不能滥用 Citation                           |
| ReviewSchedule     | `ReviewSchedule`、Mastery、Quiz、ErrorPattern 等                                                    | 个人学习状态；共享内容不自动共享个人掌握度                            | 已支持                               | 可直接重构 Review；AI 建议与人工确认必须分开                                                  |
| Claim              | `ResearchClaim` 正式个人 Research 模型/API                                                          | 即使位于 Shared Space 仍属于个人；可多 Workbench 引用                 | 已支持                               | 可直接用于研究工作台；正式证据支持/反驳关系尚需统一语义                                       |
| Evidence           | 当前至少有 Task `EvidenceItem`、ReviewFinding、Metric 等不同领域证据                                | 各自范围/生命周期不同，不能用一个通用 UI 假定同一合同                 | 部分实体已支持                       | 需要“证据投影层”而非强行合表；SourceExcerpt + Citation 可形成来源证据，但不能替代任务验收证据 |
| Research           | 有 PaperRecord、ResearchQuestion、Claim、ExperimentRun、Metric、Feedback，无单一 Research aggregate | 个人研究所有权；模板可共享，个人结论不因 Shared Space 自动共享        | 已支持相关实体                       | 可直接建立共享内核视图；项目/输出聚合与学术/技术模板仍需产品 Schema                           |
| Attachment         | `Attachment` 与 init/content/complete、隔离/扫描链已实现                                            | 绑定父 Resource/Note 范围；读取重新授权                               | 不把新知识附件处理结果加入 sync-v1   | 通用上传存在，但 Knowledge ingest 与 scanner 生产门关闭；PDF 解析必须独立包                   |
| AI Draft           | `AIRun`、`AIOutputDraft`、Candidate/Receipt 已实现                                                  | AI Gateway 唯一拥有 Provider/预算/运行；Draft 决策不等于正式 apply    | online-only                          | 可展示审查；正式 Knowledge Acceptance 生产开关关闭时不得显示“已应用”                          |
| Knowledge Citation | 显式 typed target：Topic/QuizItem/ResearchClaim/Note                                                | 同范围，任一端失权即失败；恰好一个 target                             | online-only                          | 可用于来源追踪；关系语义与 Topic 先修不能从 target 类型推断                                   |

## 2. PersonaSetting 专项审查

`apps/web/src/features/personas/persona-setting-service.ts` 当前持久化键为 `persona`，结构只有：

```text
activePersonaId
customPersonas[]:
  id
  name
  icon
  description
  routes[]
  isBuiltin=false
```

已实现的安全与并发边界：

- 整体 JSON 最大 8192 字符；名称 40、图标 16、说明 160 字符；
- 自定义 ID 必须是 `custom-UUID`，路由必须来自冻结列表，必需路由不能移除；
- 重复 Persona ID、重复路由、未知路由、不安全结构会被拒绝；
- 使用 UserSetting 版本；首次 409 后重新加载、合并一次并重试，第二次 409 失败；
- 画像只控制入口可见性，`PersonaProvider` 不参与权限判断。

它**不支持**：模块位置/尺寸、默认 Knowledge Base、Saved View、筛选、布局恢复、属性定义、对象引用、
固定 Workbench 保护、跨设备布局冲突语义、Schema version/migration 或 `workbench-v1`。因此 Persona
只能作为迁移输入，不能在正式重构中改名后直接充当 Workbench。

## 3. 正式关系与探索关系

| 层级     | 允许内容                                                                | 禁止替代                                           |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| 正式关系 | `TopicDependency` 先修；typed `KnowledgeCitation` 来源引用；既有领域 FK | 不允许任意字符串关系直接参与复习、掌握或正式判断   |
| 探索关系 | 用户自定义标签/边、布局聚类、临时候选；只用于探索                       | 不得改变权限、正式先修、Claim 结论或 Review 调度   |
| AI 候选  | Suggested 节点/边/摘要/问题，带来源、模型、版本和置信/不确定性          | 不得直接写正式关系；接受前必须重新授权和检查 stale |
| 转换     | 用户逐条或受控批量确认；生成审计/幂等收据                               | 不能静默升级探索边，不能因 UI 拖线即完成正式写入   |

正式/探索关系类型、方向、去重、逆关系、删除和转换需要独立 ADR/合同。D2 可验证交互，不可替代
该决策。

## 4. 默认关闭边界

`apps/api/src/logion_api/config.py` 的以下默认值为 `False`：

- `knowledge_space_api_enabled`
- `knowledge_space_shared_writes_enabled`
- `knowledge_space_ai_acceptance_enabled`
- `knowledge_space_deletion_enabled`
- `knowledge_space_attachment_ingest_enabled`
- `knowledge_space_local_worker_enabled`
- `attachment_scanner_enabled`

Deletion 目前还显式拒绝启用。UI 必须把“合同已存在”“候选已实现”“生产可用”分开；任何 D1/D2
原型都只能使用合成状态，不调用这些受控能力。

## 5. 施工前 ADR/合同门

| 决策包                    | 最晚进入点             | 必须解决                                                                                           |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `workbench-v1` ADR        | I4 施工前；D2 只能模拟 | 固定/自定义台、Schema version、模块/尺寸、默认库、Saved View、大小与数量上限、409 合并、迁移和删除 |
| Collection/Saved View ADR | 正式持久化前           | owner/scope、共享、过滤 DSL、排序、版本、URL 深链、导出/删除                                       |
| Source identity ADR       | Sources 写入重构前     | Resource 专业元数据、DOI/ISBN/URL 规范化、重复合并、来源版本和 stale                               |
| Relation semantics ADR    | 正式/探索边写入前      | 枚举、方向、反向、去重、候选接受、删除与图投影                                                     |
| Knowledge capability gate | 任何新知识写入前       | API/Shared Write/AI Acceptance/Attachment/Worker 分别启用，权限负测、迁移、恢复、监控和回滚        |
| PDF/Attachment 安全包     | PDF 解析前             | 本地原件、扫描/CDR、隔离、页码 locator、加密/ACL、Worker offline、残留清理                         |
| sync-v2 ADR               | 任何新知识离线写前     | capability negotiation、协议版本、双版本客户端、Vault/IndexedDB 迁移和回滚                         |

## 6. D0 结论

I0～I3 可以先复用现有正式对象和默认关闭的知识合同进行壳层、只读视图与交互迁移；I4 的受控
自定义 Workbench 不能直接施工，必须先补 ADR/Schema。前端方案若要求新的正式对象、跨 Space 引用、
任意关系或离线新知识写入，应立即停止并回到合同评审。
