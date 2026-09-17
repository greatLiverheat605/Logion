# 同步删除与收件箱分诊

沿用 sync-v1 的 delete、版本检查、操作幂等、权限、tombstone 与 entity-deletion-v1 能力声明，不增加数据库字段。

- 删除预检新增 inbox_item、exam、topic。收件箱与考试按个人所有者隔离；知识点沿用 Space 与共享写权限。
- 考试根对象、科目、大纲、模拟考试、成绩在同一事务软删除，各对象发布 tombstone。子项写入与删除使用相同父对象锁。
- 知识点有学习记录、依赖或有效引用时拒绝删除，避免破坏历史及其他成员的个人记录。共享删除权限不扩大到个人数据。
- learning_track / study_project 的 create payload 可选 inbox_source: {id, version}。服务端校验来源所有者、Space、版本及未删除状态，目标创建成功后同事务软删除来源并发布 tombstone；任何失败全部回滚。同一 operation_id 重试幂等，来源已分诊后的其他创建操作拒绝执行。
- 不支持 tombstone 的客户端提交分诊或删除时收到 upgrade_required；旧服务端拒绝未知操作字段时，新端保留 Outbox 供升级后处理。
- 拉取仅向当前有权限的所有者或 Space 成员返回 tombstone；已删除对象的历史正文仍被过滤。Bootstrap 不包含已删除的新对象。

规划页快照补全在当前工作区没有 Outbox 或未解决冲突时启用；同步世代变化时转同步中心处理。快照使用既有校验、加密暂存及原子激活流程，同世代期间新出现的未同步实体由底层恢复流程保留。
