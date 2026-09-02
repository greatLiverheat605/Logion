# I3-C1 自定义 Workbench 合同提案

状态：Proposed，仅供产品、API、Schema、迁移、配额、威胁模型和冲突方案审批
日期：2026-08-19
适用基线：`codex/product-workbench-v1-spec` / `4d538645305d72dcc8a9c67de6d973743a3fb018`

本文件只定义自定义 Workbench v1 的候选合同。它不批准前端施工、API、OpenAPI、数据库表、迁移、配额、Feature Flag 或生产写入能力。未取得本文第 14 节所列门禁的单独批准前，现有产品仍只使用固定 Workbench 和旧 Persona 兼容路径。

## 1. 目标与非目标

目标是让用户在固定 Workbench 模板或空白模板上创建受控的个人工作台，并保持以下心智模型：

```text
Workspace 决定我和谁协作
Space 决定数据放在哪里、谁能看
Workbench 决定我现在怎样完成任务
正式对象仍是唯一事实源
```

非目标：

- 不创建新的权限角色、Space、Workspace、对象类型、同步协议或 AI 正式写入规则；
- 不允许用户上传 JavaScript、CSS、HTML、SQL、查询、模板脚本或任意自动化；
- 不把自定义定义、工作台引用和正式对象字段塞进一个无界 JSON；
- 不把前端隐藏入口当作授权控制；
- 不把旧 `persona` 设置直接升级为自定义 Workbench 定义。

相关基线：[产品规格](../../product/WORKBENCH_V1_PRODUCT_SPEC.md)、[ADR-0030](../../adr/0030-workbench-v1.md)、[I3 施工任务包](../../coordination/mainline-handoff/10_WORKBENCH_V1_I3_CONSTRUCTION_TASK_PACKET.md)。

## 2. 三种数据职责

| 数据                        | 所有者和用途                                      | 允许包含                                                               | 明确不允许                                                                  |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `WorkbenchPreference`       | 当前用户；设备间同步个人显示偏好                  | 当前工作台、固定入口隐藏/顺序、密度、默认视图、受控默认 Space 引用     | 自定义模块定义、对象快照、ACL、Workspace Role、正式业务状态                 |
| `CustomWorkbenchDefinition` | 当前用户的个人配置实体；描述一个受控工作台        | 名称、说明、模板来源、注册模块、有限布局、筛选、快捷创建和有限属性定义 | 任意代码、权限规则、对象内容、成员列表、服务端查询、共享所有权              |
| `WorkbenchObjectLink`       | 当前用户与一个 Workbench 的关系实体；引用正式对象 | 明确类型的目标引用、顺序、主要上下文、工作台局部属性                   | 正式对象副本、无约束 `target_type + target_id`、跨 Space 授权、替代正式字段 |

三者的生命周期和版本独立。删除自定义 Workbench 只删除其定义和链接；正式对象、Space、成员和历史记录不随之删除。Preference 可以引用一个已删除的 Workbench，但读取时必须回退到安全模板并生成可行动的修复提示。

## 3. 版本化外壳

每种持久化实体都使用独立的严格外壳，候选字段如下：

```json
{
  "contract": "workbench.preference",
  "schemaVersion": 1,
  "revision": 7,
  "payload": {}
}
```

规则：

1. `contract`、`schemaVersion`、`revision`、`payload` 为必需字段；字段名大小写敏感。
2. `schemaVersion` 只接受已注册版本。大于当前版本或缺失版本直接拒绝，不猜测、不降级为任意 JSON。
3. 对象只接受合同列出的键；未知键、重复键（若解析器可检测）和危险键 `__proto__`、`prototype`、`constructor` 直接拒绝。
4. 所有 ID、枚举、数量、字符串长度和递归深度在服务端重新校验；客户端校验只是体验优化。
5. 读取旧版本时只允许显式迁移器生成新版本；迁移失败保留原始值供导出/修复，不静默清空。
6. `revision` 是服务端单调递增版本，写入必须携带基准版本；时间戳不能替代版本并发控制。

### 3.1 Preference v1 候选形状

`contract` 为 `workbench.preference`。`payload` 仅允许：

```json
{
  "activeWorkbenchId": "fixed.learning",
  "hiddenFixedWorkbenchIds": [],
  "workbenchOrder": ["fixed.learning", "fixed.research"],
  "density": "comfortable",
  "defaultViewByWorkbench": {
    "fixed.learning": "projects"
  },
  "defaultSpaceByWorkbench": {
    "fixed.learning": {
      "workspaceId": "…",
      "spaceId": "…"
    }
  }
}
```

`defaultSpaceByWorkbench` 是导航偏好，不是授权事实。每次使用前仍需按现有 Workspace/Space/Role/ACL 链重新读取；无权或已删除时显示安全空态并清除该偏好。固定 Workbench 不能被删除或隐藏必需入口，只能隐藏可选入口、调整允许的顺序/密度和默认视图。

兼容建议：第一阶段可继续使用现有 `/api/v1/users/me/settings`，但使用新的受控 key（建议 `workbench.preference`），不要把它拼接到 `persona` JSON。设置服务现有的 8192 字符上限和整数版本可复用；Preference 序列化结果建议控制在 4096 UTF-8 字节以内，超过 8192 字节必须拒绝。

### 3.2 Custom Definition v1 候选形状

`contract` 为 `workbench.definition`。定义实体必须有服务端生成的 `id`、`ownerUserId`、`revision`、`createdAt`、`updatedAt`；客户端不得提交或覆盖所有者、权限和审计字段。

`payload` 允许：

- `name`、`description`、`icon`、`accent`：纯文本和受控色板值；
- `templateId`：四个固定 Workbench 或 `blank`；只复制配置，不复制正式对象；
- `modules`：注册目录中的模块实例；
- `layout`：有限的区域、顺序、密度和默认视图；
- `filters`、`quickCreate`、`fieldDefinitions`：只使用下列 allowlist；

定义不允许保存 Workspace Role、Space ACL、成员、正式对象内容、任意查询或任意组件代码。`ownerUserId` 始终为当前用户；v1 不支持共享定义、团队模板发布或转移所有权。`id`、`ownerUserId`、`revision`、时间戳和 `lifecycle`（`active`/`archived`）都是服务端元数据，客户端提交这些键必须被拒绝，而不是静默覆盖或剥离。

### 3.3 Object Link v1 候选形状

`contract` 为 `workbench.link`。链接实体由服务端生成 `id`、`ownerUserId`、`revision`、`createdAt`、`updatedAt`；客户端只能提交下列 `payload`：

```json
{
  "workbenchId": "wb-…",
  "target": { "kind": "task", "id": "…" },
  "position": 12,
  "primaryContext": false,
  "attributes": { "reading_priority": "high" }
}
```

`target` 是注册目录中的 discriminated union，不是可自由拼接的 `target_type + target_id`。服务端根据 `kind` 选择 typed target 校验器并重新解析 Workspace/Space/授权；`workspaceId`、`spaceId`、成员、角色和权限字段不接受客户端提交。一个 Workbench 内同一 `(kind, id)` 只能有一个链接；重复目标、空 ID、tombstone、跨 Space 或无权目标直接拒绝。

链接集合维护独立的 `linkSetRevision`。新增、删除和排序必须携带 `baseLinkSetRevision` 并作为一个原子操作结算；链接局部属性修改还必须携带该链接自己的 `revision`。服务端返回成功后的新版本和 receipt；版本不匹配返回包含链接增删、排序和属性冲突路径的 409，不自动覆盖远端。

## 4. 注册模块与限制

首批模块只能来自现有注册目录：

`next-action`、`task-queue`、`projects`、`sources`、`topics`、`review`、`evidence`、`timeline`、`graph-projection`、`saved-view`、`recent-objects`、`pinned-objects`。

模块参数是每个模块自己的版本化 allowlist；未知模块、未知参数、重复模块 ID 和模块间循环依赖直接拒绝。模块没有代码执行能力，模块只调用已经存在且有授权保护的读取/命令合同。

为避免配置失控，v1 提案上限如下。它们是待配额门批准的候选值，不是当前实现承诺：

| 项目                                |                             候选上限 |
| ----------------------------------- | -----------------------------------: |
| 定义 UTF-8 序列化总大小             |                               32 KiB |
| 名称 / 说明                         |           80 / 280 个 Unicode 标量值 |
| 模块实例 / 布局节点                 |                              24 / 64 |
| 自定义字段定义 / 每字段枚举选项     |                              32 / 32 |
| 筛选条件 / 快捷创建                 |                              32 / 16 |
| 字符串值 / 多选项                   |                           2 KiB / 32 |
| 嵌套递归深度                        |                                    3 |
| 外部 URL                            | 仅 `http:`/`https:`，长度不超过 2048 |
| 每个 Workbench 的 ObjectLink 数量   |                                  500 |
| 单个 ObjectLink 序列化大小 / 属性数 |                           2 KiB / 32 |
| 单个 Workbench 链接属性总大小       |                               16 KiB |
| 个人自定义 Workbench 数量           |       20 个 active，50 个含 archived |

字段名使用 `[a-z][a-z0-9_]{0,47}`；禁止原型污染键和保留字段。服务端按 UTF-8 字节、Unicode 标量值、数组元素数和递归深度分别计算，不能只依赖 JavaScript `length`。

## 5. 有限属性与对象引用

允许的属性类型只有：`text`、`number`、`date`、`single-select`、`multi-select`、`boolean`、`url`、`rating`、`object-reference`。属性定义附着在 Workbench 链接上，不能覆盖正式对象的标题、状态、版本、Space、归属或授权。每个属性的键、类型、枚举、最小/最大值和可引用目标必须在 `fieldDefinitions` 的注册 Schema 中声明；`quickCreate` 只能调用已存在的、逐项列入 allowlist 的命令，不能从配置生成新命令或任意输入字段。

对象引用必须使用注册的 typed target。v1 候选目标为 `task`、`source`、`topic`、`note`、`evidence`、`claim`、`project`；每种目标对应明确的服务端校验器。禁止以任意 `target_type + target_id` 作为最终数据库完整性方案。

引用规则：

- 读取、加入、移动、移除和删除正式对象时，每次重新执行现有授权；
- 跨 Space 的引用默认拒绝，不因 Workbench 配置而扩权；
- 无权读取或对象不存在时统一失败关闭，不显示对象标题、数量、成员或“仍被引用”；
- 从当前 Workbench 移除只删链接，加入其他 Workbench 创建新链接，不复制正式对象；
- “移动主要上下文”和“删除正式对象”是独立命令，必须使用各自既有影响确认和版本合同。

## 6. 模板、生命周期和导出

### 6.1 创建与复制

创建器只允许“复制固定模板”或“空白创建”。复制操作复制经过 allowlist 校验的配置，不复制对象、成员、Space 权限或历史。固定模板的必需模块和安全状态由产品版本维护，用户不能删除固定 Workbench。

### 6.2 归档与删除

- 自定义 Workbench 可重命名、归档、恢复和删除配置；归档不删除定义或链接；
- 删除前显示当前用户可见的链接数量和受影响的局部属性；无权对象不计数、不泄露；
- 删除只删除配置和链接，不删除正式对象、Space、成员、任务、证据或审阅记录；
- 固定 Workbench 只允许隐藏或恢复，删除命令必须不存在；
- 删除成功后 Preference 中的活动/默认引用自动回退到固定学习 Workbench，并产生 success receipt。

### 6.3 导出与导入

导出默认只包含 `workbench.definition` 和可修复的版本信息，不包含正式对象正文、成员信息、令牌、Cookie、密钥或私有 Space 内容。可选链接包只包含 typed target ID，不包含对象快照，且必须经过当前用户授权过滤。

导入必须：

1. 先解析并验证合同、版本、大小、危险键、模块和属性；
2. 为本地定义生成新 ID，不接受覆盖当前用户已有 ID；
3. 清除 owner、Workspace、Space 和服务端审计字段；
4. 对无权、失效或未知目标以“未导入链接”报告，不恢复对象、不猜测对象存在；
5. 整体失败时不产生半个定义；提交点前的可恢复失败返回 `503 retryable=true` 且不创建 receipt，终态失败 receipt 固定为 `retryable=false`。

为使重放安全可执行，每次导入都必须携带客户端生成的 `importIdempotencyKey` 和规范化导出内容的 `sourceFingerprint`（SHA-256）。服务端按 `(ownerUserId, importIdempotencyKey)` 唯一保存终态导入 receipt 和指纹：相同键、相同指纹直接返回第一次成功或终态失败的 receipt；相同键、不同指纹返回 409，不创建新定义。提交点前的可恢复事务失败全部回滚，返回 `503 retryable=true`，不保存 receipt，并允许相同键重试；终态失败 receipt 固定为 `retryable=false`。定义和可导入链接在一个事务中提交；无权/失效链接只作为成功 receipt 中的 `skippedLinks`，不会写入半个链接。用户要再次创建副本必须显式使用新的幂等键。

## 7. Persona 迁移

旧 `persona` 设置仍是兼容来源。现有服务已经限制：`activePersonaId`、合法自定义 Persona、完整必要路由、重复 ID 和总值不超过 8192 字符，并通过整数版本执行一次 409 重试；这些边界必须保留。

迁移只做一次性投影：

| 旧数据                            | Workbench v1 结果                                    |
| --------------------------------- | ---------------------------------------------------- |
| 四个内置 Persona                  | 对应固定 Workbench 偏好，不创建自定义定义            |
| 合法自定义 Persona 名称/图标/说明 | 生成待确认的自定义草稿，模块由路由映射和安全模板推导 |
| 路由集合                          | 仅作为默认入口候选，不作为权限或对象范围             |
| 非法、未知或冲突 Persona          | 回退固定学习模板，保留迁移失败原因                   |

迁移要求：

- 幂等键建议为 `persona-to-workbench:v1:<source-setting-version>:<source-value-hash>`；同一来源重复执行不得创建第二份定义；
- 先读旧设置并生成校验报告，全部通过后才写入新偏好/草稿；
- 双读期只能有一个权威写路径，不能让 Persona 和 Workbench 同时互相覆盖；
- 迁移失败继续读取旧 Persona，保留可导出的原值并显示可行动的失败提示；
- 迁移不得改变直接 URL、Workspace/Space 授权、SessionBoundary、旧 409 语义或正式对象数量。

## 8. 409 冲突合同

### 8.1 版本与响应

每个定义和 Preference 写入都携带 `baseRevision`。服务端发现版本不匹配返回 409，并提供不含越权对象内容的：`base`、`local`、`remote`、`conflictPaths` 和新的 `remoteRevision`。不得静默覆盖远端或丢弃本地配置。

现有 Persona 设置的“一次重新读取、合并、重试；再次 409 停止”语义继续保留，不因自定义 Workbench 提案自动扩大旧服务的合并范围。

### 8.2 合并规则

- 不相交的标量字段可生成待保存的 merged draft，但仍需用户确认后写入；
- 模块列表、布局顺序、字段定义和快捷创建按稳定 ID 做三方比较；同一 ID 的删除/修改、顺序冲突或重复 ID 必须进入显式冲突；
- `WorkbenchObjectLink` 的新增/删除/排序按 `linkSetRevision` 做三方比较；同一目标的重复添加、删除与修改、排序交叉或属性修改冲突必须显式选择，不得用最后写入者覆盖；
- 链接局部属性按链接 `revision` 比较；对象本身的正式字段和授权不进入合并结果；
- `ownerUserId`、生命周期、模板安全状态、Space/对象授权字段永不自动合并；
- 用户可选择“保留本地”“保留远端”或“编辑合并草稿”；每次选择都展示差异和影响范围；
- 提交合并草稿必须重新携带最新 `remoteRevision`，再次 409 则停止并要求重新比较；
- 放弃本地修改只能删除本地草稿，不删除远端定义。

### 8.3 多设备和离线

离线只能保存本地未提交草稿；没有真实 Outbox 合同就不能显示“已排队”。重新上线后先拉取远端版本再比较。若配置失效或合并失败，回退到安全模板并保留导出副本。

## 9. Fail-closed 规则

以下任一情况必须拒绝保存/导入/合并，或返回安全模板，不得部分猜测：

- 未知 `contract`、未知 `schemaVersion`、缺失必需字段或未知字段；
- 重复 ID、非法 ID、危险键、超出字段/枚举/递归/总大小限制；
- 未注册模块、非法模块参数、任意代码/查询/URL 协议；
- Workspace、Space、对象、成员、角色或 owner 字段出现在自定义配置中；
- typed target 未注册、跨 Space、无权、tombstone 或无法证明归属；
- 固定 Workbench 删除、移除必需入口、覆盖全局安全状态；
- 迁移来源非法、幂等键重复但内容不一致、合并基线过期；
- 解析器无法确认重复键、Unicode/UTF-8 大小或数组边界。

错误响应应说明“配置无法使用及下一步”，但不泄露无权对象、Space、成员或 Workspace 是否存在。

## 10. 推荐实体关系（不等于 DDL 批准）

```text
User 1 ── * CustomWorkbenchDefinition
User 1 ── 1 WorkbenchPreference
CustomWorkbenchDefinition 1 ── * WorkbenchObjectLink
WorkbenchObjectLink * ── 1 typed formal object
```

Preference 只引用 Workbench ID 和受控显示偏好；Definition 只描述配置；ObjectLink 只保存引用和工作台局部属性。任何正式对象、Space、Member、Role、ACL 和 SessionBoundary 仍由原有领域模型和授权链负责。

## 11. 可观测性与隐私

日志只能记录合同名、版本、实体哈希前缀、结果类别、冲突路径数量和迁移状态。禁止记录配置正文、对象正文、成员邮箱、令牌、Cookie、密钥、私有 Space 内容或完整导出包。导出文件必须由用户主动下载，默认不进入服务端长期存储。

## 12. 兼容和回滚

- 关闭自定义能力时，固定 Workbench、旧 Persona 路径和已有导出仍可读；
- 读取新配置失败时，先回退固定学习模板，再提供修复/导出入口；
- 模板升级必须有版本迁移、旧版本保留窗口和逐项回滚测试；
- 回滚不得删除正式对象或撤销 Workspace/Space 权限；
- 删除/归档操作必须产生可审计的 success receipt 或明确失败原因，不能静默成功。

## 13. 验收矩阵（合同阶段）

| 场景                 | 必须证明                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| 固定模板不可删除     | 删除命令不存在，隐藏/恢复不改变权限                                              |
| 自定义复制           | 只复制配置，不复制对象、成员和 Space 权限                                        |
| 跨 Workbench 引用    | 同一正式对象只有一份，链接可独立移除                                             |
| 无权/跨 Space        | 失败关闭，不枚举对象或引用数量                                                   |
| 未知版本/字段/危险键 | 拒绝并保留可修复原值                                                             |
| 超限和重复 ID        | 拒绝，不能部分保存                                                               |
| ObjectLink 合同      | typed target、唯一目标、链接/属性上限和 `linkSetRevision` 冲突均有拒绝或显式选择 |
| Persona 迁移         | 幂等、可回退、不扩权、不丢失旧设置                                               |
| 409                  | 展示 base/local/remote 差异，显式选择后再提交                                    |
| 导入重试             | 相同幂等键和源指纹返回同一收据，不重复创建；指纹变化返回 409                     |
| 删除                 | 只删配置/链接，正式对象保持不变                                                  |
| 关闭能力             | 旧 Persona 路径仍可用，不留下假按钮                                              |

## 14. 后续审批门与停止条件

以下门必须分别获得书面批准，顺序不限但缺一不可：

1. **Product Owner**：确认个人所有、固定模板、创建/删除、导入导出和 409 用户体验；
2. **Schema/合同**：确认三个实体、严格字段、版本兼容和 typed target 注册表；
3. **API/OpenAPI**：确认资源、状态码、ETag/整数版本、409 响应和错误非泄露语义；
4. **数据库/迁移**：确认 Definition、Preference、ObjectLink 的存储、唯一性、索引、删除和回滚；
5. **配额**：确认总大小、数量、模块、字段和导出速率上限；
6. **威胁模型**：审查原型污染、XSS、URL、配置注入、越权引用、导入和日志泄露；
7. **迁移**：确认 Persona 双读期、幂等键、失败回退和唯一写路径；
8. **409 方案**：确认三方比较、列表冲突、离线草稿和再次冲突处理；
9. **前端施工授权**：在上述门和完整原型审查通过后，才可进入正式 Web/API 施工和 Feature Flag。

任何门发现未知字段、越权引用、无界配置、持久化职责混淆或冲突语义不完整，立即停工，不能用前端隐藏或默认值规避。

## 15. 本轮明确不做

- 不修改 `apps/web/src/**`、API、contracts、数据库、迁移、OpenAPI、锁文件或生产配置；
- 不创建真实自定义 Workbench、不写入用户设置、不发送邮件、不读取密码/Token/生产数据；
- 不把本提案中的候选上限、键名、实体关系或迁移 ID 视为已批准实现；
- 不在没有独立 `Verdict: PASS` 的情况下进入下一 I3 子任务或提交代码。
