# 学习科学基础威胁模型

状态：L4-001B 受保护离线/同步基线

## 权限与状态不变量

- Topic 标题、描述和依赖边均为用户数据，领域模型不嵌入学科、教师、班级或课题组。
- Private Space 只允许 Owner；Shared Space 图变更需 `shared_plan.write`，只读成员不能编辑。
- Mastery 即使 Topic 共享也属于个人；成员只能确认本人掌握度，列表只 join 认证用户的 MasteryRecord/ReviewSchedule。
- `suggested_level` 与 `confirmed_level` 分离；系统建议绝不改变、安排或冒充用户确认。
- 用户确认是明确、受 CSRF 保护的操作，记录 actor/time，推进乐观版本并创建/更新本人复习日程。
- AI 无掌握度 mutation 路由；后续 AI 只能产草稿，不能形成正式建议或确认。

## 威胁控制

| 威胁                         | 控制                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| 跨租户 Topic/edge            | Workspace/Space 解析及限定 Topic 外键                                    |
| 跨 Space dependency          | 两端必须是路由 Space 中存活 Topic；组合外键强化                          |
| prerequisite 环              | 拒绝 self-link；Space 行锁及插入前 reachability 检查                     |
| 并发重复 edge                | Space 串行化和 DB unique edge                                            |
| Viewer 编辑共享图            | 需 `shared_plan.write`，Viewer 只读                                      |
| 读取/修改他人 Mastery        | 查询按认证 `user_id`；公开确认从 AuthContext 取 `user_id`/`confirmed_by` |
| 猜测外部 Mastery ID 泄露投影 | 构建冲突投影前拒绝其他用户 ID                                            |
| suggestion 覆盖 confirmation | 只更新 suggestion 字段，确认级别/actor/time 不变                         |
| suggestion 指向未授权用户    | 内部 use case 验证 Private Owner 或 active Shared membership             |
| 过期/重放确认                | 稳定 ID + expected version；不匹配返回 409                               |
| 日志泄露学习详情             | 排除 Topic description/suggestion reason                                 |
| IndexedDB 泄露               | Topic、dependency、Mastery、ReviewSchedule 使用 Vault，只留加密引用      |
| Pull/Bootstrap 泄露个人状态  | Topic 按 Space 可见性，Mastery/Schedule 另加认证 `user_id`               |
| 部分网络失败改变 Schedule ID | pending 加密 Mastery 复用稳定 Schedule ID 直到 Pull 成功                 |
| 连续离线确认乱序             | 后一操作依赖前一 Mastery operation，服务端按前序派生版本                 |
| 派生日程丢失/晚到            | 同事务追加 Schedule/Mastery change，结果指向最终 sequence                |
| 无界图/存储滥用              | 严格 Pydantic、Space Topic 配额、user 限速和有界遍历                     |

## 残余与后续

- L4-002 从版本化 quiz/review 证据派生 suggestion 并实现 Review 生命周期；内部 suggestion use case 不暴露公共 HTTP。
- 导师/小组聚合必须定义报告范围和最小群体披露；Workspace Admin 默认仍不能读原始个人 Mastery。
