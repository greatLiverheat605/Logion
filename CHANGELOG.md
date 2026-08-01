# 变更日志

本文件记录 Logion 面向使用者的重要变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 为 16 个应用视图提供统一的响应式导航外壳
- 增加 `open`、`invite`、`closed` 三种注册模式
- 增加首个 Owner 邮箱引导配置
- 增加公开贡献、安全和社区治理文档

### Changed

- 默认自托管注册策略调整为受邀模式
- 更新依赖安全版本并保留旧工具链兼容性
- 重写公开 README，明确项目范围、启动方式与限制
- Worker 改为公平轮转调度、独立心跳和真实 readiness，并增加按队列聚合诊断
- 浏览器门禁拆分公共与认证真实栈项目，认证项目按 worker 使用隔离账号并在 Release/Nightly 强制执行

### Security

- 未受邀邮箱在受邀注册模式下得到统一响应，不暴露邀请状态
- 生产配置拒绝开放注册模式

[Unreleased]: https://github.com/greatLiverheat605/Logion/compare/main...HEAD
