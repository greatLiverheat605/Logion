# 笔记与资料同步适配器

状态：L3-003B 实现基线

- `note` 和 `resource` 支持幂等创建及感知版本的完整投影更新。
- `base_version=0` 的离线更新必须依赖同一 Workspace、device、entity type 和 entity ID 已处理的因果前序，否则拒绝。
- 过期更新返回明确内容冲突；远端载荷先加密进入本地 Vault，之后才能提交冲突行。
- Pull/Bootstrap 只包含当前用户可见的 Shared Space 对象或本人拥有的 Private Space 对象；不可见序列间隙只推进 cursor，不泄露内容。
- 笔记和资料是受保护类型：实体、Outbox、Bootstrap 和冲突表只能保存 `encrypted_payload_ref`；明文仅短暂存在于已解锁 Vault 边界。
- Records UI 在 React 文本节点（`pre`）内渲染 Markdown，绝不作为 HTML；外链使用 `noopener`/`noreferrer`，服务端只存储而不抓取。
- PDF 仅支持元数据和页码索引；本切片不存 PDF 正文、提取全文或附件。
