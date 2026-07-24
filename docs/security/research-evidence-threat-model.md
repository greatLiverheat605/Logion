# 个人研究证据威胁模型

状态：L4-R1 受保护离线/同步基线

| 威胁                     | 控制                                                       |
| ------------------------ | ---------------------------------------------------------- |
| Owner 读取成员研究       | REST、Pull、Bootstrap 均按认证 `user_id` 过滤              |
| 跨所有者证据关联         | Workspace/Space/user 组合外键及限定父查询                  |
| AI 断言结论或指标        | 无 AI 写路径；Run/Metric 必须由认证用户操作                |
| 敏感论文、方法或反馈泄露 | 空审计元数据及 Vault 保护的持久离线行                      |
| 子对象早于来源到达       | 明确 Paper→Claim、Question→Run→Metric、Claim→Feedback 依赖 |
| 隐藏变更阻塞设备         | Pull 过滤个人行并继续推进全局 cursor                       |
