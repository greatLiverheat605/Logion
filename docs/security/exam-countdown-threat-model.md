# 个人考试倒计时威胁模型

状态：L4-E1/L4-E2/L4-E3 受保护离线/同步基线

## 资产与不变量

- Exam 标题、日期、时区和目标分数是个人数据；Shared Space 不使 Exam 共享，读取始终过滤认证 `user_id`。
- scheduled 日期带时区并配有效 IANA ID；undetermined 不含 instant；目标与满分是一个有界组合。
- 倒计时仅为显示投影，不修改业务状态。

## 威胁控制

| 威胁                        | 控制                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| Owner 读取成员目标/模考分数 | REST、Pull、Bootstrap 按认证 `user_id` 过滤 Exam、MockExam、ScoreRecord |
| 隐藏变更阻塞设备            | Pull 过滤记录但推进全局 cursor                                          |
| 跨租户/Space ID             | 写前解析 Workspace/Space，组合外键强化                                  |
| ID 冲突暴露他人 Exam        | 有界错误/同步拒绝，不返回外部投影                                       |
| 伪造/歧义日期               | 严格 schema、aware datetime、IANA 白名单及数据库 shape 约束             |
| 无效分数组合                | 严格数值和数据库约束要求完整组合且 target≤scale                         |
| CSRF 写入                   | REST/Sync Push 执行可信 Origin 和双提交 CSRF                            |
| 资源耗尽                    | user 配额、写/同步限速、payload 限额和有界列表                          |
| 审计泄露                    | 只记录非敏感 date-status enum，排除标题、instant、时区和分数            |
| IndexedDB 泄露              | Exam 使用 Vault；实体/Outbox/冲突只存加密引用                           |
| 重复离线创建                | operation 重放幂等并返回原 sequence/version                             |
| AI 改正式目标               | 无 AI 写路径，正式 mutation 需要认证用户操作                            |
| 时钟漂移改变真值            | 倒计时是纯投影，绝不写回 Exam                                           |
| 跨 Owner Subject/父关联     | 组合外键和 owner-scoped 解析绑定同一 user/Space                         |
| Subject 权重超 100%         | 锁 Exam 行串行计算 basis-point 总和，DB 限制单值                        |
| 环状/伪造 syllabus          | 新节点只选同 Subject 现有父；schema/DB 拒绝 self-parent                 |
| 客户端伪造 coverage         | create 忽略输入并初始化 `not_started`；AI 无转换路径                    |
| 伪造分数/完成时间           | 数值、score≤scale、aware datetime 和数据库约束                          |
| Score 历史静默改写          | ScoreRecord 仅追加，修正需要显式 supersession 契约                      |

## 残余与后续

- 被攻陷且已解锁的浏览器会话可读解密个人数据；过期、撤销、Vault 锁和浏览器加固只能降低风险。
- 浏览器时钟可能不准；以后可显示时钟来源/服务端偏移，但不能让离线依赖服务端时钟。
- 导师/小组可见性实现前需明确同意、撤销、最小披露和独立聚合授权。
