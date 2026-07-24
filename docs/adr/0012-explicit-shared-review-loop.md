# ADR 0012：显式共享评审与报告闭环

状态：Phase 4 L4-G1 已接受

## 决策

- Rubric、ReviewRequest、GroupFeedback 和 ReportSnapshot 只能存在于用户创建的 `shared` Space；系统不预装导师、小组、课程、学科或评审上下文。
- Owner、Admin 和 Editor 使用 `shared_plan.write` 创建量规、评审请求及报告快照；Reviewer 使用 `review.write` 追加反馈；Viewer 只读。
- 所有父对象查询都受 Workspace 和 Space 限制。共享角色永远不能读取成员的 Private Space，或个人考试、自学、研究、笔记和掌握度记录。
- ReportSnapshot 是不可变、由用户撰写的投影，只允许创建和读取，不允许更新或删除，也不会自动聚合个人记录。
- 四类载荷均为 Vault 保护的离线实体。同步沿用 REST 的服务端授权，并记录明确的父操作依赖。
- AI 对量规、评审、反馈和报告记录没有正式写入路径。

## 兼容与恢复

迁移 0022 为增量迁移。禁用 UI 或路由不影响已有共享记录。产生生产数据后应使用前向迁移修正 schema；除非已有明确、验证过的导出和保留决定，回滚不得删除共享评审历史。
