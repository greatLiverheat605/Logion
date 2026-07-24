# 证据与人工验证威胁模型

状态：L3-004B 实现基线

## 状态与权限不变量

- 活动不等于掌握；普通 Task 转换不能进入 `verified`/`done`。
- 提交 Evidence 将 `in_progress` Task 变为 `submitted`，并创建恰好一条 pending Verification。
- 只有明确的认证 Verification 端点可记录 `passed`、`failed`、`needs_revision`；AI/service 无此 use case 路由。
- `passed` 将 Task 变为 `verified`；失败/修订回到 `in_progress`。关闭 Task 同时要求 `verified` 和持久 passed Verification。
- Shared Space 提交需 `evidence.submit`，决策/关闭需 `review.write`；Private Space 仍只允许 Owner。

## 威胁控制

| 威胁                    | 控制                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| 跨租户 Evidence/引用    | Workspace/Space 检查和组合外键                                                         |
| 伪造 Note/Resource 证据 | 引用对象必须存活且位于同一 Workspace/Space                                             |
| 自报完成绕过            | Evidence/Verification 状态机和 Task 行锁                                               |
| 决策丢失/重复           | expected version、仅 pending 可决策、每 Evidence 唯一 Verification                     |
| AI 自动批准             | 无 AI principal/adapter 调决策；`decided_by` 来自认证用户                              |
| CSRF/批量滥用           | 可信 Origin、CSRF token、user/Workspace 限速和 Space 配额                              |
| 敏感评审泄露            | summary、URL 和 reviewer notes 排除在日志/审计外                                       |
| 恶意链接                | 严格 HTTP(S) 语法，服务端只存不抓                                                      |
| 离线明文泄露            | Evidence/Verification 使用 Vault，IndexedDB 实体、Outbox、staging 和冲突行只含加密引用 |
| 跨设备状态漂移          | Evidence 创建在同一事务发 Verification 变更；决策/关闭发 Task 变更                     |
| 重复/崩溃重放           | 父操作和确定性派生 operation ID 原子提交且幂等重放                                     |
| 伪造离线投影            | Sync adapter 校验 Workspace/Space、引用 ID、字段、版本和因果前序后才调领域服务         |
| 静默 Verification 冲突  | 过期版本返回明确 status 冲突，远端载荷由客户端加密落盘                                 |

## 客户端交互不变量

Today 流程先保存本地 mutation，再尝试网络。证据支持文本、HTTP(S) 链接及同 Space 的既有 Note/Resource 引用。验证提供明确的 `passed`、`failed`、`needs_revision` 人工按钮；只有 passed 记录和 `verified` Task 才显示独立关闭操作。pending、offline 和 conflict 状态始终可见。
