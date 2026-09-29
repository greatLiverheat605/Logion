# ADR-0062：空间软删除可持续恢复

- 状态：Accepted（所有者于 2026-09-29 明确选择持续可恢复；Claude 统一独立复核待执行）
- 日期：2026-09-29
- 关联：ADR-0031、0038、0041、0057、0060

## 生命周期与保留

Space 软删除复用已有 status=deleted、deleted_at、version 和操作者字段。只改变空间的
可见性边界，不物理清理行、附件、PDF 原文或子对象，也不批量软删除、解绑或改写笔记、
摘录、测验、作答、掌握、连线及历史。没有自动清理任务或恢复截止时间。在账户和工作区
仍存在且当前权限有效的前提下，可从独立空间管理入口持续恢复；账户删除仍按原 ADR-0021。

恢复只清除 Space.deleted_at、把空间置为 archived，更新版本并保留原所有权。本人再明确
选择恢复使用后才进入 active；避免恢复删除时自动开放共享内容。此前独立删除的子对象
保持删除，不因恢复空间复活。删除前明确提示先导出；deleted 空间仍被既有导出范围排除，
恢复为 archived 后重新纳入当前有权限的导出。

ADR-0031 的“不物理清理、保护引用、原子事务和保留本机未提交内容”仍适用。Space 是整体
隐藏和恢复的边界；内部引用与来源一起保留，不制造可见的孤儿记录。同 Space 的复合外键
继续约束 KnowledgeCitation、研究连线与私人阅读对象。对旧 Evidence/SourceLink 表可能
存在的跨 Space 引用，删除前查询并整体拒绝，不返回外部空间标识、名称或引用数量。

## 权限、确认和并发

沿用 ADR-0060：私人空间仅本人，共享空间仅 owner/admin；每次都校验有效工作区成员、
研究开关、原会话、Origin、CSRF、最近认证、限流和 expected_version。删除需打开确认
弹窗并输入“删除”，默认焦点为取消。服务端要求匹配 action 的明确 confirmation 字段；
恢复同样需明确确认。失败不改变界面数据、不在重连后自动重放写入。

锁序为 Workspace → WorkspaceSyncState → Space；等待 Workspace 锁后复验成员，锁定
Space 后检查状态与版本，避免并发恢复、删除、归档或撤权绕过。状态、删除时间、版本、
同步屏障和不含正文的动作审计在同一事务提交。旧笔记等待 Space 锁后仍重新验证权限。
已经发出的请求可能完成；本功能不承诺远程擦除已下载副本或撤回已发送 Provider 请求。

## 加法 API 与旧同步

增加 GET research/spaces/deleted（最多每页 100 条）与 PATCH research/spaces/{id}/deletion。
DeletedSpace/DeletedSpacePage/SpaceDeletionChange/SpaceDeletionResult 是独立 schema。
旧 ManagedSpace、归档路径、所有旧 paths/schemas 与 sync-v1 wire 保持原样，无迁移和依赖。

sync-v1 没有 Space 删除处理器；不把 Space 塞进旧实体 tombstone 协议。复用 ADR-0060 的
可见性屏障：用已有 space update payload 追加 ledger，并提升 min_retained_sequence。
读取/快照仅显示 active 且未删除空间；旧游标明确 cursor_expired，当前可见性重建快照，
原 epoch 保持，因此 pending/conflicted Outbox 与 Vault 不丢失。旧离线更新不能复活
deleted/archived 空间；恢复 active 后继续通过原版本和冲突判定。

研究 AI 继续在每次外呼前复验 Space、工作区、成员及账户；排队请求发现删除空间时失败
关闭。想法及相关连线仍不能进入 AI，草稿接受、掌握确认和出站闸门保持。

## 验证

实际结果见 PR/CI artifacts：删除多年后的恢复、最后空间恢复、子对象与内部引用保留、
独立删除不复活、跨范围引用拒绝、列表分页与私人隔离、共享角色、最近认证、CSRF/Origin、
默认关旗、版本冲突、等待锁后的撤权、ledger 回滚、旧写入拒绝、快照与游标、导出及 AI
零外呼；浏览器覆盖二次确认、取消焦点、断网不自动重放、四宽双主题、44px、axe 和无新
IndexedDB/SW。未执行任何真实用户数据删除或生产操作。
