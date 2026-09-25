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
- 会话到期时间超出浏览器计时范围时不再立即续期；复习页在上下文就绪前禁止新建，图谱链接直达对应标签，关闭表单后焦点回到原按钮。
- 同一浏览器标签页中恢复复习、模板、自学、研究和协作页的工作区与空间，复习页另恢复当前标签和选中知识点；只保存对象 ID，退出登录时清除。
- 由按钮打开、没有独立触发器的表单和确认面板在关闭后，焦点回到打开它的按钮；按钮已不可用时回到页面主区域，被操作反馈遮挡时自动移到可见位置。
- Compose 现在把 `.env` 中的登录限流（`LOGION_LOGIN_IP_LIMIT_PER_FIVE_MINUTES`、`LOGION_LOGIN_ACCOUNT_LIMIT_PER_FIVE_MINUTES`）传入 API；未设置时仍为每 IP 30 次、每账号 10 次 / 5 分钟。
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
