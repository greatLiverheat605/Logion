# Logion 文档

从你要完成的事情开始：

| 目的                             | 文档                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| 首次使用、查找功能和操作流程     | [用户操作手册](user-guide.md)                                                               |
| 按页面查找功能与使用条件         | [功能总览](product/PROJECT_FUNCTION_MAP.md)                                                 |
| 部署、日常检查、升级和故障恢复   | [部署与运维手册](operations/README.md)                                                      |
| 搭建开发环境、运行测试、提交修改 | [开发指南](development/README.md) · [贡献指南](../CONTRIBUTING.md)                          |
| 理解架构与安全设计               | [ADR](adr/README.md) · [前端路由](architecture/frontend-routing.md) · [安全设计](security/) |
| 理解同步与离线                   | [sync-v1](sync/) · [IndexedDB 与离线存储](offline/)                                         |
| 构建移动端                       | [移动端说明](mobile/README.md)                                                              |
| 查看变化与后续方向               | [更新日志](../CHANGELOG.md) · [路线图](roadmap.md)                                          |

操作手册描述当前源码对应的行为。部署环境的功能开关、权限和外部服务决定实际可用范围；发布制品以 [GitHub Releases](https://github.com/greatLiverheat605/Logion/releases) 为准。

文档与相关源码在同一个 Pull Request 中维护。CI 报告、机器专属配置、个人工作记录和临时设计产物不属于公开文档；历史变更可通过 Git 提交记录追溯。
