# ADR-0060：可恢复的空间归档与同步可见性

- 状态：Accepted（所有者 R4-5 授权；统一独立复核待 Claude）
- 日期：2026-09-29
- 关联：ADR-0004、0031、0038、0057

## 生命周期与权限

复用 Space 的既有 active／archived 状态、版本和操作者时间，不迁移、不硬删、不改子记录。
研究开关下新增独立管理 API 与设置页，旧路径和 OpenAPI schema 保持。
本人可管理自己的私人空间；共享空间复用 SPACE_DELETE_SHARED，仅 owner／admin 可变更。
管理列表按当前成员资格与私人归属过滤，最多每页 100 条，不返回他人的私人空间或数量。
归档与恢复都要求原会话、Origin、CSRF、最近认证、限流、expected_version 和明确确认。
deleted 或已有 deleted_at 的空间不能通过归档恢复路径复活。

变更先校验权限，再按 Workspace → WorkspaceSyncState → Space 加锁，并在等待 Workspace
锁后重新校验成员资格；与旧同步及新在线笔记共用锁序。Space 状态、版本、同步屏障和审计
在同一事务中提交。笔记写入等待 Space 锁后重验可见性，不能用等待前的授权写入已归档空间。
已经开始的其他请求可能完成；归档不是撤回已下载副本或已发送请求的远程擦除机制。

## 读取、同步与导出

日常空间列表及内容读取使用既有 active scope。补齐 sync-v1 的 pull／bootstrap 所有
Space joins 的 active 与 deleted_at 过滤；不虚构 Space tombstone，不在旧 payload 加状态字段。
bootstrap 每次按当前可见性重建并校验摘要，旧快照不能继续返回已归档内容。

每次归档／恢复以旧 space update payload 追加一条 ledger 记录，再把 cursor 下限提升到该
序号；历史 ledger 不删除。旧 cursor 经现有 cursor_expired 控制重新获取快照，恢复的内容
因此也能到达已跳过隐藏变更的设备。保持原 sync_epoch：已有 bootstrap 在同 epoch 下保留
pending／conflicted 的本机实体、Outbox 和 Vault；不能为了一次归档把本机工作隔离或清空。
缺少既有 entity-deletion-v1 能力的旧客户端沿用 upgrade_required，拒绝不安全的快照覆盖。
全工作区共享游标，因此私人归档也可能要求其他成员刷新快照，但不返回私人标识或正文。

导出沿用 ADR-0057 的非 deleted Space 范围，包含当前仍有权限的归档空间，便于先保留数据。
研究 AI Worker 在每次外呼前重新校验目标 Space、工作区、成员与账户是否有效；归档后尚未
发出的研究请求失败关闭。已发送的 Provider 请求可能完成，正式知识接受仍走原权限与确认。
想法仍无 AI loader、不能进入上下文；不改变模型路由、预算或出站闸门。

## 界面与后续删除

管理页选择工作区，不依赖存在 active Space；归档最后一个空间后仍能从同页恢复。
显示全部／使用中／已归档，按钮及弹窗说明共享影响，默认聚焦取消，保留过期版本失败提示。
归档无自动清理期限，可随时恢复。真正的软删除及其恢复期限尚待所有者决定，本 ADR 不定义
删除期限、不提供删除或过期清理入口；该后续项不冒充已经交付。

## 验证范围

归档／恢复保留原内容版本；最后一个空间可恢复；私人隔离、共享角色、最近认证、CSRF、
Origin、关旗、并发撤权与过期版本拒绝；ledger 故障回滚；旧快照失效、原 epoch 保持、
sync 不返回归档内容、导出仍保留；归档后的 AI 外呼为零。界面验证四宽双主题、键盘、
axe、44px 控件和无新离线存储。实际运行结果以 PR／CI artifacts 为准。

## 后续决定

所有者于 2026-09-29 选择软删除持续可恢复；后续实现见 ADR-0062。以上归档决定和原交付范围保留。
