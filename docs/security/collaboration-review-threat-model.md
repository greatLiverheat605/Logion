# 共享协作评审威胁模型

状态：L4-G1 受保护离线/同步基线

| 威胁                             | 控制                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| Viewer/Reviewer 改变共享结构     | 服务端命名权限；Reviewer 只能追加反馈，Viewer 无写权限         |
| Workspace 角色读取 Private Space | CollaborationService 在读写前拒绝所有非 shared Space           |
| 跨 Workspace/Space 父 ID         | 限定父查询、组合外键和 IDOR 集成测试                           |
| 自选 UUID 暴露其他租户记录       | 范围外冲突统一返回 not-found 边界，不披露载荷                  |
| 报告发布后静默改变               | ReportSnapshot 只开放创建/读取；同步 update/delete 被拒绝      |
| 报告泄露私人学习/研究数据        | 报告服务只接受明确 summary，不导入个人领域服务或表             |
| 日志/审计泄露评审载荷            | 审计元数据为空；测试扫描量规、提交、反馈和报告正文             |
| 离线持久行暴露共享内容           | 四类实体均进入加密 Vault，实体/Outbox 投影不含明文             |
| 离线客户端绕过角色校验           | 同步 create 调用与 REST 相同的 CollaborationService 授权       |
| 子操作早于父对象到达             | Rubric→Review、Review→Feedback/Report 依赖明确，父查询失败关闭 |
| AI 发布正式反馈或报告            | 无 AI route、worker 或草稿接受路径以协作记录为目标             |

残余风险：已获授权的 Shared Space 成员可以保留已经同步到设备的内容。撤销会阻止后续服务端访问和同步，但无法擦除平台控制范围外设备的离线副本，产品必须披露此限制。
