# Logion 项目功能全景

> 21 条正式应用路由、公共流程、权限状态与恢复动作的迁移合同见
> [LOGION_ROUTE_FUNCTION_CONTRACT.md](./LOGION_ROUTE_FUNCTION_CONTRACT.md)。

## 一句话定位

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
