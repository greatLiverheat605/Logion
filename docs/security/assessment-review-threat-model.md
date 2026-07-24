# 测评与审查威胁模型

状态：L4-002B 受保护离线/同步基线

## 资产与不变量

- Quiz 创建/列表不披露答案和解析；只有作答持久化后，认证学习者本人才获得。
- QuizAttempt、ErrorPattern、AuditReview、ReviewFinding 即使其 QuizItem/Topic 共享也属于个人记录；Workspace 角色不授予访问。
- 精确匹配由服务端计算；自评必须由用户明确选择。AI 不得提交作答、完成审查或解决 Finding/Pattern。
- 错误作答可使同一用户 ReviewSchedule 到期，不能改变 MasteryRecord 或他人日程。
- Attempt 仅追加；Review/Finding 状态使用乐观版本并进行不含敏感文本/错误详情的安全审计。

## 威胁控制

| 威胁                             | 控制                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| 通过列表收集答案                 | QuizItem 响应排除 answer/explanation                                             |
| 跨租户/Space 使用 Item           | Item/Topic 按路由 Workspace/Space 解析，组合外键强化                             |
| Owner 读取成员分数/薄弱点        | Attempt/Pattern/Review/Finding 全按认证 `user_id` 过滤                           |
| Member 创建共享 Quiz             | 需 `shared_plan.write`；只读成员只能作答                                         |
| 客户端伪造精确匹配成功           | 服务端规范化并比较回答；精确题拒绝自评                                           |
| AI/隐式流程改变正式状态          | 仅受 CSRF 保护的用户路由可作答、完成 Review 或解决个人项                         |
| 错误作答改变掌握度               | 只更新 ErrorPattern 和 source=`quiz_error` 的 ReviewSchedule                     |
| ID 冲突暴露他人                  | 返回有界冲突且不含外部记录投影                                                   |
| 敏感内容进审计                   | prompt、answer、response、confidence、cause、summary、description、action 均排除 |
| 存储/响应耗尽                    | 严格边界、Space/user 配额、限速、串行配额锁和有界列表                            |
| 重复周期/过期完成                | 用户周期唯一性与 expected-version 转换                                           |
| 共享 Quiz 同步泄露答案           | QuizItem sync 不含答案；只在个人提交后 Attempt 载荷披露                          |
| IndexedDB 暴露弱点               | 使用 Vault；持久实体/Outbox/冲突只含加密引用                                     |
| Owner 收到成员测评变更           | Pull/Bootstrap 按认证 `user_id` 过滤但继续推进 cursor                            |
| 部分同步丢派生反馈               | Pattern/Schedule 与 Attempt 同事务，Push 指向最终序列                            |
| 重复离线作答分叉派生 ID          | pending 加密 Attempt 保留稳定 Pattern/Schedule ID，后续依赖前序                  |
| Offline Review 早于 Finding 完成 | Completion 依赖 pending Review/Finding，失败依赖保持显式                         |

## 残余与后续

- 学习者可故意提交空错误答案以查看答案；这些是形成性自学工具，不是监考考试，高风险控制不在范围内。
- 导师/小组报告需另定义聚合范围和最小披露阈值，不得复用原始个人查询。
