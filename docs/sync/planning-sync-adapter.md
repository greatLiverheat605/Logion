# 学习目标同步适配器

`learning_goal/create` 携带完整初始聚合：目标 Space、客户端生成的 plan/version/phase ID、目标字段和有序阶段。服务端使用同一严格规划 DTO 校验并调用规范 PlanningService，因此离线创建无法绕过 Private/Shared Space 授权、配额、审计或数据库范围约束。

目标聚合、已处理操作、变更记录和审计在同一事务提交；重放返回原序列/版本。Bootstrap 投影相同聚合结构。Pull/Bootstrap 仅在 Space 共享或由当前用户拥有时暴露目标；不可见变更序列被跳过，但 cursor 继续推进。

发布在 L3-001B 中仍是明确在线操作。离线发布、计划重构和并发阶段编辑需要感知版本的更新适配器，不能伪装成创建操作。
