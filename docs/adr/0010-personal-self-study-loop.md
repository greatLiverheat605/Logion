# ADR 0010：个人自学从收集箱到产出的闭环

状态：Phase 4 L4-S1 已接受

## 决策

- LearningTrack、StudyProject、InboxItem 和 Deliverable 即使位于共享 Space 中也属于个人记录，Workspace 角色不授予读取他人记录的权限。
- 标题、目标、结果、笔记和证据均来自用户输入；空账户不预装课程、职业、日程或学科。
- InboxItem 是独立采集项；StudyProject 属于同一所有者的一条 LearningTrack；Deliverable 是同一所有者 StudyProject 下仅追加的完成证据，且必须有带时区完成时间。
- 四类载荷都是 Vault 保护的离线实体，父操作必须声明同步依赖。AI 不得创建已完成的 Deliverable 或改变正式证据。

## 兼容与恢复

迁移和同步实体类型均为增量变更。存在生产记录后，应以前向修复或禁用功能代替删除个人学习历史。
