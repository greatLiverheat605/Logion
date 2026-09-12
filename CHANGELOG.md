# 变更日志

本文件记录面向使用者的重要变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
正式标签与制品见 [GitHub Releases](https://github.com/greatLiverheat605/Logion/releases)；以下未发布记录不代表任意环境已经完成生产验收。

## [Unreleased]

### Added

- 目标、任务、专注会话、成果证据和人工验收的学习闭环。
- 复习、备考、自学、研究和共享审阅工作台。
- 画像导航、七步首次使用引导、响应式 Web/PWA。
- Provider 模型发现、路由与预算、发送前确认和 AI 草稿审查。
- 开放格式导入、可校验导出、日历订阅及旧客户端同步兼容检查。
- 面向用户的功能总览、完整操作流程和部署运维手册。

### Changed

- 完善工作区切换、学习状态、导航、反馈与会话恢复。
- Worker 使用公平调度、独立心跳和真实 readiness。
- 浏览器验证区分公共页面与隔离认证栈，认证数据按 worker 隔离。
- 公开文档按使用、部署、开发与架构组织；长期技术合同改用稳定主题路径。
- UI 测试输入迁入 fixtures；运行报告、截图和个人工作计划不再作为源码跟踪。

### Security

- 生产注册保持受邀边界，拒绝开放注册和开发密钥。
- Provider 连接保留 TLS 验证，AI 输出须经人工审查。
- 保留可信 Origin、CSRF、会话与空间权限、加密存储和显式数据披露边界。
- 持续更新依赖安全版本，构建与发布执行漏洞、密钥及供应链检查。

[Unreleased]: https://github.com/greatLiverheat605/Logion/commits/main
