# 个人自学威胁模型

状态：L4-S1 受保护离线/同步基线

| 威胁                              | 控制                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| Owner 读取成员计划或证据          | REST、Pull、Bootstrap 均按认证 `user_id` 过滤              |
| 跨所有者 Project/Deliverable 关联 | Workspace/Space/user 组合外键及限定父解析                  |
| 子对象先于父对象同步              | Outbox 依赖按 Track→Project→Deliverable 排序并显式报告失败 |
| 敏感文本进入审计日志              | 审计元数据为空，排除目标、笔记、结果和证据                 |
| IndexedDB 暴露私人内容            | 持久实体、Outbox 和冲突行以 Vault 引用替代明文             |
| CSRF/跨源创建                     | 可信 Origin、双提交 CSRF、用户限速和严格 schema            |
| AI 伪造完成证据                   | 无 AI 写入路由；Deliverable 创建必须由认证用户操作         |
| 隐藏个人变更阻塞设备              | Pull 略去记录但继续推进全局 cursor                         |
