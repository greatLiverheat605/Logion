# Logion 21 条路由迁移映射

旧 URL 全部保留，先通过可见任务区域和兼容路由适配器迁移。以下是 UI 归属，不代表删除后端能力或改变权限。

| 旧路由               | 新可见区域 | 首版模板       | 迁移规则                          |
| -------------------- | ---------- | -------------- | --------------------------------- |
| `/app/today`         | 今天       | Today          | 默认入口                          |
| `/app/self-study`    | 工作台     | 学习           | 保留深链接，进入学习模板          |
| `/app/research`      | 工作台     | 研究           | 保留深链接，进入研究模板          |
| `/app/exam`          | 工作台     | 考试           | 保留深链接，进入考试模板          |
| `/app/collaboration` | 协作空间   | 成员与邀请     | Workspace 管理，不改变 Space 权限 |
| `/app/planning`      | 工作台     | 计划           | 作为学习/研究阶段视图             |
| `/app/templates`     | 工作台     | 模板           | 受控模板选择                      |
| `/app/records`       | 知识库     | Sources/Reader | Source 与记录列表                 |
| `/app/review`        | 知识库     | Review         | Knowledge Base 的复习投影         |
| `/app/spaces`        | 知识库     | Space 管理     | 用户语言显示为 Knowledge Base     |
| `/app/search`        | 命令面板   | Search         | 保留直达 URL，复用全局搜索        |
| `/app/workspaces`    | 协作空间   | Workspace 管理 | 保留成员、空间和邀请入口          |
| `/app/audit`         | 系统中心   | 审计           | 只读审计表/时间线                 |
| `/app/settings`      | 系统中心   | 设置           | 设置列表入口                      |
| `/app/profile`       | 系统中心   | 账户与外观     | 账户详情与主题                    |
| `/app/security`      | 系统中心   | 安全           | Passkey、TOTP、会话               |
| `/app/sync`          | 系统中心   | 数据与同步     | Vault、sync-v1、离线状态          |
| `/app/data`          | 系统中心   | 数据           | 导入、导出、恢复                  |
| `/app/integrations`  | 系统中心   | 互操作         | Zotero/Connector 分阶段状态       |
| `/app/ai`            | 系统中心   | AI 治理        | Provider、预算、Draft；生产关闭   |
| `/app/help`          | 系统中心   | 帮助           | 受控状态与安全边界说明            |

`/app` 继续作为承接/重定向页；`/app/knowledge-prototype` 保留为历史验收入口，不计入 21 条正式业务路由。
