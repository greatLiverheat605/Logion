# Workspace 所有权转移威胁模型

## 范围

L1-003D 覆盖当前 Owner 向活动成员直接原子转移，以及非 Owner 主动退出。双边接受、账单转移、通知和 Workspace 删除另行处理。

## 不变量

- API 事务绝不提交零个或多个 Owner。
- 只有实时 active Owner 且具有 `workspace.manage_security` 才能发起。
- 目标必须是同 Workspace 中不同的 active non-Owner membership。
- Workspace、源 membership 和目标 membership 版本必须全部匹配。
- 原 Owner 在同一事务获得明确非 Owner 角色。
- Owner 不能主动退出，必须先完成转移。

## 威胁与控制

| 威胁                               | 控制                                                                                   | 验证                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| 两个并发转移产生多个 Owner         | 锁 Workspace，以 `populate_existing` 重新解析 actor，再按稳定 ID 顺序锁两条 membership | 并发仅一个成功，Owner 数始终为 1           |
| 被撤销/降级 Owner 完成过期请求     | 获得 Workspace 锁后，每次解析都刷新 identity-map entity                                | 失败方在胜者降级 actor 后收到 403          |
| 过期 UI 转移到错误 membership 状态 | 要求 Workspace、当前 Owner、目标 membership 的精确版本                                 | 三类独立冲突测试                           |
| Admin/外部人员转移所有权           | 要求 Owner-only `workspace.manage_security`，目标按 Workspace 限定                     | Admin/外部拒绝和不透明 404                 |
| 暂停、撤销或现 Owner 成为目标      | 行锁下要求目标 active 且 non-Owner                                                     | 无效目标集成测试                           |
| 最后 Owner 退出                    | 锁定并重读 membership 后拒绝 `owner` 自离开                                            | 转移前后返回 `OWNERSHIP_TRANSFER_REQUIRED` |
| 成员离开后继续访问                 | 原子改为 revoked；所有 Workspace 访问实时解析 active membership                        | 下一请求 404，重放 leave 仍 404            |
| 审计暴露个人数据                   | 只包含 Workspace/membership ID 与 role/status 差异                                     | 断言不含邮箱                               |

## 残余风险与后续

- 直接转移不要求目标接受；未来企业策略可增加待接受、可过期的双边转移，但不能削弱原子提交不变量。
- 账单所有权和外部 Provider 凭据尚未实现，上线前必须分别定义与转移的耦合。
- 修复既存 Owner 数损坏只允许操作员执行并审计。
