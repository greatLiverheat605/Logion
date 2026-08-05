# V20-07：知识空间保留与威胁签核（已批准）

- 状态：设计与推荐保留矩阵已批准（用户于 2026-08-05 明确确认）；生产启用仍须独立合规门禁
- 日期：2026-08-05（Asia/Shanghai）
- 依赖：ADR-0029 / V20-M0、V20-01 和 V20-03
- 范围：Private Excerpt、Shared Contribution、Citation、AI Draft、Audit Metadata、Cache、Backup、
  Provider 保留、Attachment、删除/恢复和本地 Worker 残留
- 明确排除：生产配置、Migration、Route/Contract、认证/会话、部署、产品代码、Provider 接入和
  本地 Worker 启用

本文档把知识空间威胁模型转化为已批准的设计基线，但不声称已取得外部法律意见。所有能力必须保持关闭，
直到相应 Owner 决策和证据齐备。

审批记录：用户于 2026-08-05 批准本文设计、推荐保留期限、停止条件与默认关闭策略。该批准允许
后续受控开发门继续评估，但不等同于外部法律意见，也不授权开启 Shared Write、Deletion、
Attachment Ingestion、Local Worker、生产配置、commit 或 push。

## 1. 数据分类与已批准的推荐处理方式

| 数据类别                                              | 活动期间用途                                                                   | 推荐的删除 / 到期方式                                                                                                                                     | 恢复 / 残余边界                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Private `SourceExcerpt` 正文、定位和哈希              | 只在主 PostgreSQL 保存；仅 Private Space owner 可访问；不进入 sync-v1/离线副本 | 收到 Space/Account 删除请求后立即不可访问；沿用 ADR-0021 默认 14 天恢复期；宽限期结束后从主库清理                                                         | 加密 Backup 按获批备份上限自然到期；产品必须披露备份中的删除不是即时完成                                                      |
| Private `KnowledgeCitation`                           | 两个已授权端点都处于 active 时有效                                             | 任一端点 stale/deleted/moved 时立即关闭；所属 Private 正文不再可恢复后清理                                                                                | Security Audit 可以保留最小非正文删除证明；历史 Citation 永不自动重开                                                         |
| Shared Excerpt/Citation Contribution                  | Shared Space 存续期间作为团队记录                                              | Account 删除宽限期结束后对 Actor 去标识化；正文保留到获授权的 Shared Space/Workspace 删除；推荐 Shared Space 恢复期 30 天，之后在无独立 Legal Hold 时清理 | UI/隐私说明必须明确：Shared Contribution 会为团队保留，不能仅凭贡献者删除账号而擦除                                           |
| 已关闭的 Shared Citation 历史                         | 已接受团队关系的完整性/审计历史                                                | 推荐关闭后最长保留 365 天；无活动关系或端点保留依赖后清理                                                                                                 | Shared Write 开启前，法律/隐私 Owner 必须批准 365 天或给出适用地区的替代值                                                    |
| AI Run Input Ciphertext                               | 仅存在于现有 AI Gateway 加密边界                                               | 知识任务强制 `retain_input=false`；按 ADR-0016 在 Terminal Transition 时清除输入                                                                          | Provider 侧副本不受 Logion 直接删除控制，必须通过下述 Provider Gate                                                           |
| Pending AI Draft 正文                                 | 仅用于用户审核；绝不是正式知识                                                 | 推荐 30 天未决定即到期；清理正文并标记 expired                                                                                                            | 到期不产生正式写入，也不自动重试                                                                                              |
| Accepted/Rejected AI Draft 正文                       | 短期纠错/复核窗口                                                              | 推荐 Decision 后 30 天清理正文；只保留有界 Decision/Receipt Metadata                                                                                      | Audit 只保存 Hash/ID，不保存原 Excerpt、Prompt、Response、Filename、URL 或完整 Content Hash                                   |
| Acceptance Receipt 与最小 Audit                       | 幂等、争议处理和安全证据                                                       | 推荐保留 365 天，之后删除或聚合；如需更长时间必须有独立批准策略                                                                                           | 按 ADR-0021 对 Actor/User Target 去标识化或置空；不得包含正文元数据                                                           |
| API/Security Log 与 Metric                            | 运维和滥用响应                                                                 | 推荐 30 天；安全发布制品可沿用现有 90 天策略                                                                                                              | 不得包含 Excerpt、Prompt、模型响应、Filename、URL Query、Locator Text、Cursor、完整 Hash、Provider Endpoint 或原始 Subject ID |
| Graph/List/Browser Cache                              | 只用于性能，永远不是授权权威                                                   | v0.2.0 推荐不使用持久正文 Cache；`private, no-store`；请求级/进程内数据在请求结束时丢弃                                                                   | 不注册 IndexedDB/Vault/Outbox；单独完成 Cache 威胁评审前，Redis Key 不得保存知识正文                                          |
| Database 与 Attachment Backup Bundle                  | 灾难恢复                                                                       | 沿用 ADR-0027 默认 30 个每日加密代际；在作出删除期限承诺前再增加 30 个自然日 Age Cap                                                                      | Restore 使用 Key ID、完整性验证、隔离空目标和新 Sync Epoch；对外开放前必须重放删除/清理队列                                   |
| Provider Request/Response                             | 每次显式处理                                                                   | 知识 AI 只能使用已展示并记录适用 API 条款、承诺不用于训练且保留/删除不超过 30 天的 Provider；否则 Knowledge AI Route 保持关闭                             | Shared 正文还要求隐私/法律批准及相应合同条款；Logion 不能承诺无法验证的 Provider 擦除                                         |
| Attachment/PDF Binary                                 | 默认不属于 v0.2.0 Knowledge Ingestion                                          | 不自动上传云端。以后如有 Staged Upload，未完成对象应在 24 小时内到期；Verified Content 沿用父 `Resource` 删除策略                                         | 当前没有 Malware/CDR；文件保持 download-only 与 `nosniff`；V20-11 证据齐备前关闭生产 Attachment Binding                       |
| Local-worker Input、Model Cache、Checkpoint 和 Result | 禁用                                                                           | 因执行被禁用，不允许产生残留。将来启用后必须在 Lease 完成/取消/过期时清理 Terminal State，并证明 Crash/Reboot 清理                                        | 要求加密 Volume/Workspace、最小 ACL、Recovery-key 流程、短 Lease、仅出站网络和 Residue Scan 证据                              |

上表天数是推荐的产品默认值，不是对当前生产行为的声明。不同司法辖区或企业策略必须版本化并通过
迁移实施，不得静默改变历史删除语义。

## 2. Permission 与披露决定

1. Private Space 正文对 Workspace Owner/Admin 仍不可见，除非该用户同时是 Space owner。Backup、
   Graph Read、Export、AI 和 Cleanup Job 都必须遵循相同边界。
2. Shared Contribution 是显式披露。首次 Shared Excerpt/Citation 写入前，UI 必须说明团队保留、
   Contributor 去标识化、Provider 处理方式和删除影响。文案和策略未获批前，Shared Write 保持关闭。
3. `shared_knowledge.write` 只能准备 Excerpt/Evidence；创建/替换正式 Citation 和接受 AI Draft 必须
   使用 `shared_knowledge.accept`，防止 Contributor 绕过接受流程。
4. v0.2.0 不提供通用 Legal-hold 开关。若目标部署受法律要求必须具备 Legal Hold、E-discovery、
   Regional Storage 或更短擦除期限，则 Shared Knowledge Write 必须保持关闭，直到另行完成策略和实现。
5. Hash 是可识别/可关联的完整性数据，不是匿名化手段。完整 Hash 不得进入 Log、Metric、公开 Error
   或运维 Audit Search。

## 3. 删除与恢复状态机

### Private Account 或 Space

1. 请求必须通过现有 Recent-auth、CSRF、精确确认、Ownership 和 Version 门禁。
2. 在 ADR-0021 适用范围内立即撤销 Session/Link，移除对象可见性，取消 AI Work，撤销 Worker Lease，
   并阻止新的 Graph/Search/Cache Read。
3. 在 ADR-0021 默认 14 天 Account Grace Window 内，只有受限恢复流程可以取消删除。Pending Account
   不能通过普通 API 访问 Knowledge Data。
4. 宽限期结束后，按依赖顺序先关闭/清理 Private Citation，再处理 Excerpt 与 Source/Target，同时清除
   Pending Draft、Input、Cache Artifact，并记录不含正文的删除证据。
5. 宽限期内恢复只重新激活所属 Space/Account；已关闭 Citation 保持关闭，必须重新接受。清理完成后，
   除获授权的 Backup Disaster-recovery 流程外，不提供普通用户恢复。

### Shared Contribution 或 Shared Space

1. 删除 Contributor Account 不擦除 Team Record。宽限期结束后按 ADR-0021 对 Actor 去标识化并删除
   直接身份字段。
2. 获授权的 Shared Space 删除会立即使全部正文不可读并关闭活动关系。推荐恢复期为 30 天。
3. 到期后按依赖顺序清理，除非存在另行实现的合法策略。产品不得在尚未实现时声称支持 Legal Hold。
4. 恢复期内恢复也不得重开历史 Citation，必须重新授权并明确接受。

### Backup Restore

恢复环境对外提供流量前，必须：

- 验证加密 Bundle/Hash/Key Generation，并恢复到隔离空目标；
- 按现有要求提升 Sync Epoch；
- 重新执行 Account/Space 删除、Membership 撤销、Draft 到期、Audit 到期和清理队列；
- 扫描孤儿 Citation 和本应已不可访问的 Private Data；
- 证明旧 Session、URL、Cursor、Cache Entry 和 Worker Lease 不能复用。

若无法证明 Restore 后清理完成，恢复环境必须保持隔离，不能成为 Release Candidate。

## 4. Provider 与 AI 停止门

每个用于知识任务的 Provider/Model，审批记录必须包含：

- 准确 Provider/Model 身份和适用条款版本；
- API Input/Output 是否用于训练或进入人工复核；
- Provider 最大保留时间和删除机制；
- 适用时的 Processing Region/Subprocessor；
- 实际发送字段、发送前预览和用户确认；
- Provider 是否支持 Request Idempotency，以及如何处理未知完成/费用状态。

推荐上线规则：不用于训练，并且文档化的保留/删除期限不超过 30 天。无法满足或无法证明该规则的
Provider 不得用于 Knowledge-space AI Task。未知完成状态不得自动重放。Shared 正文还必须等待隐私/
法律审批；用户 Consent 不能覆盖部署层禁止。

## 5. 本地 Worker 前置条件

本地知识 Worker 保持禁用。启用前必须实际观察到以下全部证据：

1. 对准确的 Volume 和专用 Workspace 启用了 BitLocker 或等价加密。
2. Recovery Key 所有权、轮换、Escrow 和恢复演练有文档记录，且 Key 不进入仓库、Task Packet、
   Terminal Transcript 或普通应用日志。
3. ACL 测试证明只有 Worker Identity 和获授权 Operator 能读取 Workspace；Service Process 使用非
   Admin 身份，并且只允许出站 HTTPS。
4. Lease 绑定 Job、Subject、Workspace/Space、Input Hash、Stage 和 Expiry；撤销/过期后不得接受结果。
5. Input/Model Cache/Checkpoint/Result 清理必须覆盖成功、取消、Lease 过期、Crash、Reboot 和上传中断。
6. Worker Offline 时，网站核心学习/知识读取及普通写入仍必须通过。

缺少任何一项都是硬停止条件，不能作为已接受的残余风险。

## 6. 威胁验证矩阵

| 范围           | 启用前必须实际观察的证据                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 租户隔离       | 跨 User/Workspace/Space/Private-admin 的 Item、List、Graph、Search、Export、AI、Delete 和 Restore 负测                 |
| Typed Citation | 零 Target、多 Target、错误类型、跨范围、已删 Target 的 DB 失败，以及孤儿扫描为 0                                       |
| Acceptance     | stale Hash/Version、Revoke/Share/Delete 竞态、N 路重放和故障注入；Receipt/Audit/Formal Write 全有或全无                |
| 披露           | Shared Consent 文案、Permission 矩阵、Contributor 绕过拒绝、不透明 Error，以及无隐藏 Count/Size Oracle                 |
| Logging        | 合成敏感标记贯穿成功/失败/Timeout/Retry/Cancel；API、Worker、Audit、Metric 和 Backup Report 中均无标记                 |
| Provider       | 捕获的 Request 与获批字段完全一致；条款/保留记录存在；未知完成状态不产生第二次调用或重复费用结算                       |
| 删除           | 立即拒绝访问、宽限期取消、最终 Private 清理、Shared 去标识化、Attachment/Cache/Lease 清理，以及 Citation 不自动重开    |
| Backup         | 错误 Key/Tag 失败、空目标 Restore、Row/File Hash 验证、新 Sync Epoch、Restore 后清理和备份自然到期披露                 |
| XSS/File       | 纯文本处理、CSP/Sanitizer 测试、恶意 Markdown/URL/Filename/Polyglot Corpus、`nosniff` 和 download-only Attachment      |
| DoS            | 1–2 Hop、150/400 硬上限、Row/Byte/Time/Rate/Concurrency 限制、Dense/Cyclic Input，以及触发容量停止而非提高上限         |
| Offline/Local  | sync-v1 Golden Diff 为 0；无 Vault/IndexedDB/Outbox Entity；Local-worker 加密/ACL/Lease/Residue 门禁，或明确的禁用证明 |

## 7. Feature Flag 默认值

| 能力                                        | 默认值  | 只能在以下条件完成后改变                                                     |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `knowledge_space_api_enabled`               | `false` | V20-01/03/07 获批、Migration/Contract 获授权，并通过 Read-path Security Gate |
| `knowledge_space_shared_writes_enabled`     | `false` | 隐私/法律批准 Shared 保留与披露，并通过 Write/Accept 负测                    |
| `knowledge_space_deletion_enabled`          | `false` | 完成 Delete/Restore/Backup-expiry 实现和演练                                 |
| `knowledge_space_attachment_ingest_enabled` | `false` | 完成 V20-11 Attachment Migration、Malware 风险披露、保留与恢复证据           |
| `knowledge_space_local_worker_enabled`      | `false` | 上述全部 Local-worker 前置条件通过                                           |

即使审批完成，配置也可以继续保持能力关闭。客户端声明绝不能启用能力。关闭能力会撤销使用权，但不会
删除仍应保留的数据。

## 8. 显式停止条件

- 目标生产部署无法提供适用司法辖区、组织策略和实际披露的隐私/法律/产品 Owner 证据，或要求偏离已批准的
  Shared Team Retention、Pseudonymization、14/30/365 天默认值和 Backup 自然到期规则。
- Provider 将 Knowledge Input 用于训练、条款未知、超过获批保留期，或无法支持声明的删除/处理披露。
- Log、Metric、Audit、Error、Trace、Cursor 或 Task Packet 包含正文、Filename、Source Query Data、
  完整 Hash、Provider Endpoint、Local Path、Credential 或原始 Subject ID。
- Delete/Restore 无法证明立即撤权、按依赖关闭/清理、不自动重开、孤儿数为 0，以及 Backup Restore
  后清理。
- 只有 Write、没有 Accept Authority 的主体可以创建 Shared 正式 Citation。
- sync-v1、Vault、IndexedDB 或 Outbox 出现新 Knowledge Entity。
- Local Worker 缺少 Encryption、ACL、Recovery、Lease 或 Residue 证据。
- Attachment 可以执行/内联，或在没有扫描能力时被描述为已通过 Malware Scan。
- 容量只能依靠提高 Depth、150 Node、400 Edge、Time、Byte 或 Rate 安全上限才能满足。

## 9. 已批准的设计决定与保留门禁

1. Private Knowledge 沿用 ADR-0021 的 14 天 Account Grace Period；Shared Space 使用 30 天恢复期。
2. Shared Contribution 在 Contributor 删除后作为去标识化 Team Record 保留；已关闭 Shared Citation
   历史和最小 Acceptance Audit 最长保留 365 天。
3. Operational Log 保留 30 天、现有 Security Artifact 保留 90 天、每日最多保留 30 份加密 Backup，
   同时执行 30 个自然日 Age Cap，并如实披露 Backup 自然到期。
4. Pending Draft 30 天到期；Decided Draft 正文在 Decision 后 30 天清理；Knowledge AI Input
   Ciphertext 在 Terminal State 清除，仅保留不含正文的 Receipt/Audit。
5. Provider 不得将输入用于训练，且文档化保留/删除期限不得超过 30 天；Shared Provider Processing
   仍必须在目标生产部署取得适用的隐私/法律证据。
6. 要求 Legal Hold、不同 Data Residency 或不同 Retention 的部署继续阻塞，直到完成版本化策略和实现。
7. 在各自证据门禁通过前，继续关闭 Shared Write、Deletion Route、Attachment Ingestion 和 Local Worker。

批准本文档只授权保留/安全设计方向，不授权生产配置、Migration、OpenAPI、Route 实现、数据处理或
Feature Enablement。
