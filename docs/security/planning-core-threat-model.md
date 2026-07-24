# 规划核心威胁模型

L3-001A 引入用户撰写的目标、每目标一份计划、不可变计划版本及有序阶段快照。模型保持通用，不包含写死的考试、学科、导师或课题组上下文。

每行都带 Workspace 范围；Goal 另带 Space 范围，组合外键强制其 Plan 留在同一 Workspace/Space。Version 和 Phase 使用 Workspace 组合外键，因此其他租户的有效 ID 不能挂到本地聚合。插入前须跨全部规划表检查客户端 UUID 冲突。

Private Space 写入要求认证用户为该 Space Owner；Shared Space 写入另需规范 `shared_plan.write` 权限。服务端从当前 membership 推导两项结论，绝不接受请求体里的 role、owner 或 authorization 声明。

状态变更端点要求 Cookie 认证、可信 Origin、双提交 CSRF 和 user/Workspace 限速。Pydantic 拒绝未知字段、不连续阶段位置、重复 ID/criteria、超长文本和无效时间预算。SQLAlchemy 只发参数化 SQL。审计只存 ID、阶段数和版本，排除描述、结果和验收标准。

创建在一个事务写入 Goal、Plan、draft Version、Phase 和审计事件。发布锁定聚合、验证乐观版本并将 draft 变为 published snapshot。重复或过期发布返回稳定冲突，不能静默覆盖新计划。

`0010_planning_core` 仅可在尚无真实规划数据时降级；使用后应用层只能回滚，schema 修复只能前向进行。
