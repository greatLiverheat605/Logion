# 审计查询威胁模型

## 范围

L1-005A 提供只读、隐私最小化查询 API：认证用户查看本人 identity 事件，Workspace Owner 查看 Workspace 审计。导出、保留管理、跨 Workspace 搜索、原始元数据和管理员 impersonation 不在范围内。

## 资产与信任边界

- 审计行可能含安全敏感事件关系和内部关联数据；PostgreSQL 是范围、顺序和保留的权威。
- 认证用户及服务端解析 membership 是访问权威；客户端 role/Workspace 上下文不可信。
- 分页 cursor 跨服务端/客户端边界，按不可信输入处理；Redis 限速不授予权限，也不改变查询范围。

## 威胁与控制

| 威胁                        | 控制                                                                                         | 验证                          |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| 个人端点跨账户披露          | 每个查询限定认证 actor ID 和 `identity.%` namespace                                          | 多 actor/非 identity 事件集成 |
| 跨 Workspace 披露/ID 探测   | 查询前解析 active membership，要求 `workspace.manage_security`，外部统一 404                 | Owner/非 Owner/外部用例       |
| 客户端 role 提权            | 权限来自当前 DB membership；只有 Owner 有所需权限                                            | Admin 在有效会话下仍 403      |
| 原始元数据/关联 ID 暴露秘密 | 响应精确白名单，排除 `event_metadata`/`request_id`                                           | OpenAPI/序列化断言            |
| 伪造 cursor 改 scope/filter | HMAC 签名版本化 cursor，绑定 account/Workspace 和规范 filter fingerprint                     | scope/filter 重用/篡改测试    |
| 同时间戳分页跳过/重复       | `(occurred_at, id)` newest-first keyset 与组合索引                                           | 同时间戳多页用例              |
| 无界查询耗尽数据库          | page size `1..100`、最多一行 look-ahead、filter 长度校验、Workspace 查询前 account-wide 限速 | schema/限速测试               |
| 敌意时间过滤                | 要求带时区、归一 UTC、拒绝空或逆序半开区间                                                   | 单元/集成过滤测试             |
| 浏览器/中间缓存保留数据     | 成功响应使用 `Cache-Control: no-store`                                                       | 两类端点 header 断言          |
| 意外削弱写保护              | 仅 GET handler，无 mutation/事务副作用，除既有拒绝访问审计                                   | 路由/集成审查                 |

## 残余风险与后续

- 审计保留、legal hold、脱敏、导出和删除需后续治理切片。
- Owner 可见稳定 actor/target ID；展示层只能解析 viewer 独立获授权的 ID。
- 限速不替代监控；Production 应告警重复查询和授权失败但不记录 cursor。
- 签名密钥轮换按设计使旧 cursor 失效；客户端遇 `AUDIT_CURSOR_INVALID` 后重启分页。
- Keyset 提供稳定排序遍历但不是数据库快照；遍历中新增事件需从首页重启后才能看到。
