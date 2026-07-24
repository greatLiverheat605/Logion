# 任务与学习会话威胁模型

状态：L3-002A 实现基线

## 受保护资产与不变量

- 每个 Task/Session 都限定 Workspace/Space；服务端从认证 membership 推导权限，不信任客户端授权结论。
- Private Space 只允许 Owner；Shared Space 写入需要规范 shared-plan 写权限。
- 任务完成不等于掌握。普通状态转换不能进入 `verified` 或 `done`；L3-004 Verification 是唯一规划路径。
- 完成或放弃学习会话不自动完成任务。
- 每个 user/Workspace 最多一个活动会话；Workspace 行锁串行检查，PostgreSQL partial unique index 二次保证。
- 描述和反思是用户内容；反思存于 Session，但排除在 SessionEvent 和审计元数据之外。

## 信任边界与控制

| 边界           | 威胁                           | 控制                                                          |
| -------------- | ------------------------------ | ------------------------------------------------------------- |
| Browser→API    | CSRF 或不可信跨源写入          | HttpOnly Cookie、可信 Origin、双提交 CSRF                     |
| DTO→Domain     | 过度提交、无效状态、无时区时间 | 严格 Pydantic、边界、带时区时间戳和显式状态机                 |
| User→Workspace | 跨租户对象引用                 | 查询前解析 membership/Workspace/Space，隐藏资源返回 not-found |
| 并发写入者     | 丢失更新或重复活动会话         | expected version、行锁、partial unique index                  |
| API→数据库     | SQL 注入或 ID 冲突             | SQLAlchemy 参数绑定、客户端 UUID 冲突检查和数据库约束         |
| 审计链         | 敏感反思泄露                   | 元数据白名单只含 ID、状态、结果和时长                         |
| 资源消耗       | Task/写入洪泛                  | 每 Goal Task 配额和 user/Workspace 执行写限速                 |

## 负向与兼容测试

- 拒绝 CSRF 缺失、过期版本、无效转换及无原因 blocked Task。
- 跨租户和 Private Space 访问拒绝且不披露对象。
- 拒绝第二个活动会话；完成 Session 后 Task 仍为 `in_progress`。
- 迁移测试覆盖空库升级、从 `0010_planning_core` 升级、降级、PostgreSQL 约束和活动会话 partial index。
- OpenAPI 和生成 TypeScript 契约在同一变更中更新。

## 残余风险与后续

- L3-002B 必须在离线 Vault 加密任务描述/会话反思，实体和 Outbox 只能含加密引用。
- L3-004 必须实现证据提交与人工验证后才能启用 `verified`/`done`。
- 运行指标只可使用数量和延迟，不得包含标题、描述或反思。
