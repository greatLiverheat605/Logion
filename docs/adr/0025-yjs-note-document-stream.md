# ADR 0025：Yjs 笔记文档流与可读快照

- 状态：已接受
- 日期：2026-07-23
- 决策负责人：Logion 同步/内容契约负责人
- 跟踪：[Issue #160](https://github.com/greatLiverheat605/Logion/issues/160)

## 背景

`sync-v1` 原本把笔记编辑视为整条记录更新，因此两台设备即使修改 Markdown 的不同部分，也会产生记录冲突。产品基线要求 Markdown/Yjs 更新以幂等文档流合并，而关键状态、层级、权限、删除/更新及验收冲突仍必须显式处理。

现有笔记载荷可包含 500 KB Markdown。若在同一记录加入 base64 CRDT 状态，会超过离线单记录完整性限制；改变同步信封或 `note.update` 语义也会破坏严格旧客户端。

## 决策

保持 `sync-v1` 信封和已有 `note` 快照兼容，新增两个有界、增量实体类型：

- `note_document_state` 出现在 Bootstrap 中，包含 note ID、Space ID、笔记版本和 base64 Yjs 兼容状态更新。它是受保护记录，持久化到 IndexedDB 前必须加密。
- `note_document_update` 出现在 Push/Pull 中，包含一条 base64 Yjs 兼容更新。服务端在锁定文档上应用更新，不执行整记录版本拒绝；保存合并状态、重新生成可读 Markdown、推进笔记版本，并将操作追加到既有幂等/变更账本。

Yjs 根类型是名为 `markdown` 的单一 `Y.Text`。更新字节必须使用规范 base64、非空且不超过现有同步操作限制，合并后的可读快照也不得超过笔记 Markdown 限额。授权由服务端解析 Workspace、Space 和笔记，客户端不能通过嵌入标识选择外部文档。

普通 REST/整记录笔记更新继续受支持：以已接受的 Markdown 快照重置 Yjs 状态，并推进单调递增的文档 generation。增量更新只在其 Bootstrap generation 匹配时接受，防止旧更新合入无关的重建文档。旧客户端可以忽略未知增量实体并读取更新后的 `note` 快照；其过期整记录更新仍会冲突，不采用最后写入覆盖。

## 安全与隐私不变量

- CRDT 状态和更新属于笔记内容而非元数据；离线时由 Vault 加密，不进入审计元数据，也绝不作为 HTML 渲染。
- 可移植导出保留可读 Markdown，明确排除内部 CRDT 状态和 generation 字段。
- 载荷哈希与 operation ID 沿用重放保护：同操作同哈希幂等，同 operation ID 但字节变化必须失败关闭。
- 畸形、空、超限或非规范 base64，以及合并后超过 500 KB 的 Markdown 均被拒绝。
- 跨 Workspace、跨 Space、已删除笔记和已撤销设备请求沿用不透明授权边界。
- 状态和结构冲突不得进入 Yjs 路径。

## 兼容与回滚

迁移 `0033_note_yjs_state` 从现有可读 Markdown 回填每条笔记；开始 Yjs 写入后只能前向处理。旧兼容二进制可读取 Markdown 快照，但不能作为写入者发布，因为它无法保留 Yjs 状态。因此回滚意味着停止写入并部署前向修复，不能在已有文档更新后删除状态列。

实时在线状态、光标和机构规模并发编辑不在范围内。首版保证异步/离线合并、确定性重放和可读快照。
