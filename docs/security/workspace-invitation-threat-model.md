# Workspace 邀请威胁模型

## 范围

L1-003B 覆盖已认证的 Workspace 邀请创建、接受和撤销。邮件投递、未登录接受、成员修改和 Owner 转移不在本切片内。

## 资产与信任边界

- 邀请 token 是 bearer secret，只向获授权邀请者显示一次。
- 规范化受邀邮箱属于个人数据，仅用于账户绑定和后续投递。
- 每个请求的 Workspace role/membership 状态以服务端为准。
- Redis 限速是防御控制；PostgreSQL 行才是 token 状态权威。

## 威胁与控制

| 威胁                            | 控制                                                                                     | 验证                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| 数据库泄露暴露可用邀请链接      | 生成至少 256 位熵，只存带域分离的 HMAC-SHA256 token hash                                 | 集成测试比较返回 token 与存储 digest |
| token 经 URL/代理/分析日志泄露  | 只在 JSON 请求体接收；一次性创建响应使用 `Cache-Control: no-store`                       | OpenAPI 测试拒绝 token 路径参数      |
| 探测 token 暴露邮箱或 Workspace | 缺失、账户不符、过期、撤销及重放统一返回 `INVITATION_INVALID`                            | 错误账户、过期、撤销和重放测试       |
| 并发接受同一 token              | 锁定 invitation 行，在同一事务改变状态并建 membership                                    | 并发只允许一次成功和一条 membership  |
| 过期/伪造角色提权               | 保存服务端签发角色；schema/数据库禁止 Owner；只有 `workspace.manage_members` 可创建/撤销 | 角色契约和 Viewer 拒绝测试           |
| 跨租户撤销或 ID 探测            | 选择同时限定两个 ID 的 invitation 前解析活动 membership 和命名权限                       | 不透明 Workspace 授权及撤销测试      |
| 邀请垃圾/暴力尝试               | 分离且哈希化的 Workspace/account 创建限额，以及 IP/account 接受限额                      | 配置单测与远程 Redis 集成            |
| 审计/日志泄露 token/邮箱        | 只审计 invitation ID、Workspace ID、actor、role、result 和粗粒度拒绝原因                 | 集成断言审计元数据                   |

## 残余风险与后续

- 邮件 Worker 未交付前，邀请者必须经可信通道传递一次性 token，产品不得声称已发送邮件。
- 公开注册仍缺生产邮件验证；接受邀请只绑定认证的规范化邮箱，不证明邮箱控制权。邮件验证仍是生产发布阻塞项。
- 角色修改、移除、最后 Owner 规则及会话失效属于 L1-003C。
