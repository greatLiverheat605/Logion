# Workspace 邀请威胁模型

## 范围

本模型覆盖已认证的 Workspace 邀请创建、加密邮件入队、Worker 投递、接受和撤销。未登录直接接受、
成员修改和 Owner 转移不在本切片内。

## 资产与信任边界

- 邀请 token 是 bearer secret，只在创建响应和加密邮件载荷中出现；数据库只保存用途分离的 hash。
- 规范化受邀邮箱属于个人数据，仅用于账户绑定和加密投递载荷。
- 每个请求的 Workspace role/membership 状态以服务端为准。
- Redis 限速是防御控制；PostgreSQL 行才是 token 状态权威。

## 威胁与控制

| 威胁                              | 控制                                                                                       | 验证                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| 数据库泄露暴露可用邀请链接        | 生成至少 256 位熵，只存带域分离的 HMAC-SHA256 token hash                                   | 集成测试比较返回 token 与存储 digest |
| token 经 URL/代理/分析日志泄露    | 只在 JSON 请求体接收；一次性创建响应使用 `Cache-Control: no-store`                         | OpenAPI 测试拒绝 token 路径参数      |
| 探测 token 暴露邮箱或 Workspace   | 缺失、账户不符、过期、撤销及重放统一返回 `INVITATION_INVALID`                              | 错误账户、过期、撤销和重放测试       |
| 并发接受同一 token                | 锁定 invitation 行，在同一事务改变状态并建 membership                                      | 并发只允许一次成功和一条 membership  |
| 过期/伪造角色提权                 | 保存服务端签发角色；schema/数据库禁止 Owner；只有 `workspace.manage_members` 可创建/撤销   | 角色契约和 Viewer 拒绝测试           |
| 跨租户撤销或 ID 探测              | 选择同时限定两个 ID 的 invitation 前解析活动 membership 和命名权限                         | 不透明 Workspace 授权及撤销测试      |
| 邀请垃圾/暴力尝试                 | 分离且哈希化的 Workspace/account 创建限额，以及 IP/account 接受限额                        | 配置单测与远程 Redis 集成            |
| 审计/日志泄露 token/邮箱          | 只审计 invitation ID、Workspace ID、actor、role、result 和粗粒度拒绝原因                   | 集成断言审计元数据                   |
| Outbox 数据泄露受邀邮箱或 token   | 载荷使用 AEAD 加密，并绑定 Outbox ID、邀请者、用途和 key ID；终态清空密文                  | 密文、AAD 与终态清理测试             |
| 过期、撤销或失效 Workspace 仍投递 | Worker 在租约内重新核对 invitation、邀请者和 Workspace 状态；接受、撤销、过期时终止 Outbox | API/Worker PostgreSQL 集成测试       |
| Workspace 名称注入邮件 HTML       | 模板限制长度和换行，HTML 上下文统一转义；角色只接受固定枚举                                | 模板 XSS 与非法角色测试              |
| 旧版 pending 邀请无法补发         | 仅对没有任何关联 Outbox 的历史记录轮换 token 并原子入队；已有投递记录继续返回 409          | legacy backfill 与重复请求测试       |

## 残余风险与后续

- Workspace 邀请邮件与受邀注册的邮箱验证共用阿里云事务邮件 Worker。目标候选完成真实投递
  验收前仍不得宣称生产邀请邮件可用；接受邀请继续要求已认证、已验证且规范化邮箱匹配。
- Provider 接受邮件后、数据库写入 `sent` 前进程崩溃仍可能导致重复邮件；一次性 token 和状态
  复核阻止重复接受，但不能完全消除重复到件。
- 角色修改、移除、最后 Owner 规则及会话失效属于 L1-003C。
