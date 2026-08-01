# Logion 项目功能全景

## 一句话定位

Logion 是面向个人和最多 10 人小组的自托管、离线优先学习与研究操作系统。它把目标、执行、笔记、证据、复习、考试、研究、协作和数据主权组织成可验证闭环，而不是只提供聊天或普通任务清单。

## 目标用户

| 用户场景      | 核心诉求                             | Logion 对应能力                                 |
| ------------- | ------------------------------------ | ----------------------------------------------- |
| 考：应试学习  | 考试倒计时、覆盖大纲、模考、错因复盘 | Exam、Review、Records、Today                    |
| 学：自主学习  | 长期目标、项目路线、学习记录和模板   | Today、Self-study、Planning、Records、Templates |
| 研：学术研究  | 研究问题、声明—证据、论文记录、实验  | Research、Review、Planning、Records             |
| 导：导师/小组 | 空间、成员、审阅、Rubric、审计       | Collaboration、Spaces、Audit、Planning          |

用户也可创建自定义画像。画像只优化导航，不改变 Workspace Role 或 Space 权限。

## 功能地图

### 1. 身份与首次使用

| 能力                  | 页面/入口                       | 关键边界                                             |
| --------------------- | ------------------------------- | ---------------------------------------------------- |
| 登录、刷新、设备会话  | `/auth/login`、`/app/security`  | HttpOnly Cookie、CSRF、Origin、刷新令牌复用检测      |
| 邮箱验证、密码恢复    | `/auth/verify`、`/auth/recover` | Token 哈希、过期/次数限制、统一隐私响应              |
| Passkey、TOTP、恢复码 | `/app/security`                 | 近期认证、WebAuthn Origin、版本化加密                |
| 注册策略              | `/auth/register`、邀请入口      | open 仅开发；生产只允许 invite/closed                |
| 7 步入门引导          | `/onboarding`                   | 画像必选；真实工作区、空间、Vault 口令和今日目标动作 |
| 用户设置              | `/app/settings`                 | UserSetting 版本冲突检测；画像和 onboarding 状态同步 |

### 2. 每日执行闭环

| 能力               | 页面                | 业务结果                                       |
| ------------------ | ------------------- | ---------------------------------------------- |
| 今日驾驶舱         | `/app/today`        | 下一行动、今日序列、真实投入、阻塞与待验收状态 |
| 目标与版本化计划   | `/app/planning`     | 目标、成果、阶段、依赖、投入和目标日期         |
| 任务与学习会话     | Today/Planning      | 创建、安排、阻塞、完成；记录实际专注时间       |
| 证据与人工验收     | Today/Collaboration | 文本、链接、笔记、资料证据；显式通过/拒绝      |
| 快速捕获与命令面板 | 全局应用壳          | 在当前上下文创建真实记录，不生成演示数据       |

完成专注不等于完成任务，提交证据不等于验收通过；这些状态在数据模型中保持独立。

### 3. 内容、记忆与复习

| 能力                    | 页面           | 关键实现                                |
| ----------------------- | -------------- | --------------------------------------- |
| Markdown 笔记与安全预览 | `/app/records` | 文本节点渲染、Yjs 增量状态、端侧 Vault  |
| 链接、PDF 元数据、附件  | Records        | URL/大小/哈希约束、分段上传与服务端校验 |
| 知识点与先修图          | `/app/review`  | Topic、依赖关系、掌握记录               |
| 主动回忆、测验与错因    | Review         | 作答、信心、结果、错因模式和复习计划    |
| 周期学习审查            | Review         | 进展、阻塞、发现和下一步动作            |

### 4. 专项工作台

| 工作台     | 页面                 | 已实现内容                                         |
| ---------- | -------------------- | -------------------------------------------------- |
| 备考       | `/app/exam`          | 考试、科目、大纲、模考、成绩、用时、薄弱项         |
| 自主学习   | `/app/self-study`    | 快速收件箱、学习路线、项目、里程碑、成果           |
| 学术研究   | `/app/research`      | 研究问题、声明、证据关系、实验运行、指标、论文记录 |
| 导师与小组 | `/app/collaboration` | 共享审阅、Rubric、反馈、建议动作、不可变报告快照   |

### 5. Workspace、空间与治理

| 能力                 | 页面              | 边界                                           |
| -------------------- | ----------------- | ---------------------------------------------- |
| Workspace 与成员     | `/app/workspaces` | 最多 10 人定位；Owner/Admin/Editor/Viewer 权限 |
| Private/Shared Space | `/app/spaces`     | 私有数据不自动进入共享空间；服务端逐操作授权   |
| 邀请与角色变更       | Workspaces        | 统一隐私响应、层级与最后 Owner 保护            |
| 审计查询             | `/app/audit`      | 分页、筛选、最小元数据、拒绝事件记录           |

### 6. 搜索、模板与互动

| 能力           | 页面                | 已实现内容                                           |
| -------------- | ------------------- | ---------------------------------------------------- |
| 本地搜索与通知 | `/app/search`       | 解锁内容搜索、通知偏好、静默时间和只读 Calendar Feed |
| 模板与分享     | `/app/templates`    | 模板导入、版本、安装副本、短期只读分享与撤销         |
| 互操作中心     | `/app/integrations` | Calendar、开放格式导入、加密导出真实状态与动作       |

### 7. AI 草稿层

| 能力                       | 页面      | 安全原则                                 |
| -------------------------- | --------- | ---------------------------------------- |
| OpenAI-compatible Provider | `/app/ai` | 服务端加密凭据、SSRF 限制、显式连接测试  |
| 模型发现与健康             | AI        | 用户触发、固定 Provider 边界、状态可审计 |
| 路由与预算                 | AI        | 任务路由、候选模型、Workspace 月度预算   |
| 持久运行和草稿             | AI        | 队列、取消、重试、发送前预检、批准/拒绝  |

AI 只生成可审查草稿，不能自动修改正式记录、掌握度、研究结论、验收或权限。

### 8. 离线、同步与数据主权

| 能力                    | 页面/模块                 | 已实现内容                                    |
| ----------------------- | ------------------------- | --------------------------------------------- |
| 加密 Vault 与 IndexedDB | 多个学习工作台            | 按用户数据库隔离、本机口令、Web Crypto        |
| Outbox 与同步           | `/app/sync`               | 幂等 Push/Pull、游标、删除记录、权限失败      |
| 断点 Bootstrap          | Sync                      | 分块快照、校验和、原子切换、epoch 重建        |
| 冲突处理                | Sync                      | 保留本地/远端/合并/暂不处理；高风险冲突显式化 |
| 数据导入导出            | `/app/data`、Integrations | 预览后导入、加密导出、SHA-256 与 manifest     |
| 账户删除                | `/account/deletion`       | 确认、恢复窗口和后台删除                      |
| 备份恢复                | `infra/backup`            | 加密 PostgreSQL/附件备份、验证和异机恢复手册  |

## 信息架构

- 12 条画像主路由：Today、Exam、Review、Records、Self-study、Planning、Templates、Audit、Spaces、Settings、Profile、Help。
- 二级工作台：Research、Collaboration、Search、Workspaces、Security、Sync、Data、Integrations、AI 等。
- Desktop 使用侧边栏和命令面板；移动端按画像显示 4 个固定入口加“更多”。
- `/app/integrations` 等二级路由不扩大画像主路由契约；直接 URL 仍受认证和服务端权限保护。

## 技术架构

```text
Browser / PWA / thin mobile shell
  ├─ Next.js + React application shell
  ├─ IndexedDB + encrypted Vault + Outbox
  └─ OpenAPI client / sync-v1
             │
             ▼
Nginx reverse proxy :8080
  ├─ FastAPI API ─ PostgreSQL
  │              └─ Redis rate limits / coordination
  ├─ Worker ─ email / portability / AI / deletion
  └─ Encrypted backup and restore tools
```

仓库采用 pnpm + uv monorepo：Web、API、worker、薄移动壳、契约、离线包和基础设施在同一版本中验证。

## 当前成熟度

| 维度         | 状态      | 说明                                                      |
| ------------ | --------- | --------------------------------------------------------- |
| 核心学习闭环 | 已实现    | 目标→任务→会话→证据→验收→复习具备真实数据路径             |
| 身份与权限   | 已实现    | 多因素认证、邀请、角色、空间和审计边界完整                |
| 离线与同步   | 基础成熟  | 写入、Bootstrap、冲突和恢复完整；受保护页面冷启动仍需加强 |
| AI           | 条件可用  | 需要部署者配置 Provider；结果保持草稿                     |
| 移动端       | 预发布    | 响应式/PWA 和薄壳边界存在；签名、实体机和分发尚未完成     |
| 外部互操作   | v1 已实现 | 开放格式与 Calendar 可用；账号连接/Webhook/自动化延期     |
| 生产部署     | 候选阶段  | 需要部署者完成 TLS、邮件、异机备份、告警和观察期          |

## 明确不做

- 计费、套餐、entitlement、公共营销站和 SaaS 运营后台；
- 未经用户确认自动改变正式学习结果、研究结论或权限；
- 抓取付费墙正文或自动向 AI Provider 发送私有材料；
- 把移动安装包、模拟器通过或示例配置描述成已完成生产发布。
