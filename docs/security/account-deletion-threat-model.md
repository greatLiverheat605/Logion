# 账户删除威胁模型

日期：2026-07-23  
范围：Phase 5 / L5-022

| 威胁                                      | 控制                                                                                                | 验证                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| CSRF 或旧会话触发删除                     | trusted Origin、CSRF、recent auth、精确确认短语和独立限流                                           | 缺失 CSRF、过期认证和错误短语测试          |
| 删除 workspace Owner 造成团队失主         | 对每个 owner membership 检查其他 active 成员；存在协作者时强制先转移所有权                          | shared-owner 409 集成测试                  |
| 删除请求后 session、分享或日历仍有效      | 同一事务撤销全部 session/refresh/device、用户创建的 share 和 calendar feed；清 Cookie               | 请求前后访问负测                           |
| pending 用户借恢复登录继续读取正文        | 普通 `AuthContext` 只接受 active；pending 登录只允许专用 deletion context 的状态/取消端点           | pending 登录后 workspace 401、取消端点 200 |
| 他人取消删除或重放旧版本                  | deletion context 绑定当前 pending user；行锁、version、deadline、精确短语                           | 版本冲突和跨用户测试                       |
| 物理清理破坏共享团队记录                  | 有协作者的 owned workspace 在请求阶段阻断；共享贡献保留并只 pseudonymize actor                      | workspace ownership 与 FK 恢复演练         |
| 清理后仍可通过邮箱或审计识别用户          | 邮箱替换为用途域 hash pseudonym；验证时间和凭据删除；audit actor/user target 置空且 metadata 最小化 | 数据库集成断言                             |
| AI 或后台任务在删除请求后继续处理私人输入 | AI run 设置 cancel request；宽限期清理 input/draft/run；worker 状态与预算账本保持一致               | AI cancel 与清理集成测试                   |
| 备份被误称为即时擦除                      | 隐私说明明确主库完成与备份自然过期的不同期限；备份保留固定且可审计                                  | 删除/备份 runbook 演练                     |

残余风险：用户在共享 Space 发布的内容可能属于团队记录，不能在没有团队所有权政策的情况下自动删除；本阶段删除直接个人数据并保留不可登录的 pseudonymous actor。上线地区的法律政策若要求不同处理，必须以版本化策略和迁移实施，不能静默改变历史记录。
