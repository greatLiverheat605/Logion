# I3-C6 配额与威胁模型冻结门（C6-Q0）

状态：Gate output——本文冻结的运行时配额、速率、日志、部署前置与安全边界直接约束 C6-S/C6-A 实现；候选数值已完成逐项裁决。待协调方验收与独立复审 PASS 后生效。
日期：2026-08-20
基线：`codex/workbench-v1-c6-m` / `80f26dea4163650a3e466307f7146e55a5b20bfb`（含 C6-M 持久化基础与 [合同基线修正案](../../coordination/mainline-handoff/11_WORKBENCH_V1_CONTRACT_BASELINE_AMENDMENT.md)）
上游合同：[I3-C1](./I3_C1_CUSTOM_WORKBENCH_CONTRACT_PROPOSAL.md)、[I3-C2](./I3_C2_API_SCHEMA_DESIGN_PROPOSAL.md)、[I3-C3](./I3_C3_SCHEMA_CONTRACT_DESIGN_PROPOSAL.md)、[I3-C4](./I3_C4_API_OPENAPI_CONTRACT_PROPOSAL.md)、[I3-C5](./I3_C5_API_OPENAPI_IMPLEMENTATION_GATE_PROPOSAL.md)

本门只产出文档。不修改 API、Web、迁移、ORM、contracts、配置、锁文件；不启用 Feature Flag；不启动 C6-S/C6-A；不读取生产数据。

## 1. Outcome 与适用范围

本门把 I3-C1～C5 与修正案遗留的“待配额/威胁模型门批准”事项全部收口为唯一事实源：

- Schema 硬限制（单文档结构上限）继续由 Pydantic/OpenAPI 合同承载，本文第 2 节逐项裁决并声明归属，不产生第二套数值；
- 运行时配额（跨文档聚合数量、速率、导出频率、正文传输上限、日志与保留）由本文冻结，C6-S/C6-A 只能引用本文，不得自定；
- 部署前置（DELETE body 代理门、Feature-off 门、导入幂等结算）给出可执行验收步骤。

适用范围：`/api/v1/users/me/workbenches` 全部 15 个 operation、`workbench.preference` key 的服务端二次校验、三张 C6-M 表（`workbench_definitions`、`workbench_links`、`workbench_idempotency_receipts`）的运行时行为。不适用于固定 Workbench、旧 Persona、sync-v1 与正式对象 API。

## 2. 已批准数值表及计算口径

### 2.1 候选数值逐项裁决

| #   | 候选（出处）                                                                 | 裁决                     | 归属                                        | 理由与口径                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Definition 32 KiB（C1 §4；C3 §4.5）                                          | **批准**                 | Schema 硬限制                               | 规范化后（RFC 8785 canonical）UTF-8 字节数；C3 已作为解析安全上限冻结，C6-M `document JSONB` 落库即此形态                                                                                                                                                                                                                                        |
| 2   | 单 Link mutable 2 KiB（C1 §4；C3 §5.1）                                      | **批准**                 | Schema 硬限制                               | canonical UTF-8 字节；含 `target`+`position`+`primaryContext`+`attributes` 整个 mutable 文档                                                                                                                                                                                                                                                     |
| 3   | 每 Workbench 500 Links（C1 §4；C4 §6.3）                                     | **批准**                 | 运行时配额                                  | 与 `position 0-499`（Schema+DDL）一致；在 create/import/reorder 三处入口计数校验                                                                                                                                                                                                                                                                 |
| 4   | Link 属性合计 16 KiB（C1 §4）                                                | **批准，口径收紧**       | 运行时配额                                  | 口径：同一 Workbench 全部 Link 的 `attributes` 对象 canonical UTF-8 字节求和（不含 target/position 字段）；写入时校验，超限 422                                                                                                                                                                                                                  |
| 5   | 20 active / 50 含 archived（C1 §4）                                          | **批准**                 | 运行时配额                                  | active 上限约束 create 与 restore；总数上限约束 create；archive 释放 active 名额但计入总数                                                                                                                                                                                                                                                       |
| 6   | 列表 50、Link 列表 100（C4 §5.1/§6.1）                                       | **批准（确认既有冻结）** | Schema 硬限制                               | 分页 page size，非配额；Definition list `1-50 默认 25`，Link list `1-100 默认 50`                                                                                                                                                                                                                                                                |
| 7   | Retry-After 1～3600 秒（C4/C5 Header）                                       | **批准**                 | Schema 硬限制（界）+ 运行时（值）           | Header 界已冻结；运行时取固定窗口剩余秒数，clamp 到 `[1,3600]`                                                                                                                                                                                                                                                                                   |
| 8   | 嵌套递归深度：C1 §4 为 3，C3 §4.5 为 6                                       | **批准 6，拒绝 3**       | Schema 硬限制                               | C3 为更晚的 Schema 定型门且明确“从文档根按 1 计数”；按该口径最深的合法结构是 `payload→fieldDefinitions→字段项→options→option 项`（根=1 时恰为 6 层），`filters→attribute-equals→value` 链为 5 层；深度按各合同文档自身根对象计数，import/replace 等请求信封只增加请求 Schema 固定的有限层级且原始解析有界。本文宣告 C1 的 3 被取代，消除双事实源 |
| 9   | Preference 附加上限 4096 UTF-8 字节（C1 §3.1 建议、C2 §4.1、C3 §3 移交本门） | **批准**                 | 运行时配额（仅 `workbench.preference` key） | 服务端对该 key 的 value 追加校验；通用 8192 **字符**合同不变，`persona` 及其他 key 不受影响                                                                                                                                                                                                                                                      |
| 10  | 字符串值 2 KiB / 多选 32（C1 §4）                                            | **批准（映射）**         | Schema 硬限制                               | 映射为 C3 已冻结的 `text.maxLength ≤2000`、`multi-select.maxSelections ≤32`；不新增第二数值                                                                                                                                                                                                                                                      |
| 11  | URL ≤2048 UTF-8 字节、仅 http/https（C1 §4；C3 §2.2）                        | **批准**                 | Schema 硬限制                               | 仅语法校验，见第 6 节网络策略                                                                                                                                                                                                                                                                                                                    |

### 2.2 本门新增冻结（此前无数值）

| 项目                                                 | 冻结值                        | 归属       | 口径                                                                                                                                |
| ---------------------------------------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JSON 请求原始传输上限（import）                      | 2 MiB                         | 运行时配额 | JSON 解析前按原始 body 字节；超限走现有通用 413。合法最大包 = 32 KiB Definition + 500×2 KiB Links + 信封 ≈ 1.05 MiB，2 MiB 留出冗余 |
| JSON 请求原始传输上限（其余全部 Workbench endpoint） | 256 KiB                       | 运行时配额 | 最大合法请求为 replace 的 base+local ≈ 64 KiB 与 reorder 的 2×500 UUID ≈ 40 KiB；256 KiB 足够并防压缩/膨胀炸弹                      |
| 读操作合并预算                                       | 600 次/小时/用户              | 运行时配额 | 覆盖 definition list/get、deletion-impact、link list 四个读 endpoint 的合计次数                                                     |
| 导出频率                                             | 10 次/小时/用户               | 运行时配额 | export 为敏感读取，单独计数                                                                                                         |
| 导出响应体上限                                       | 2 MiB                         | 运行时配额 | 按序列化后响应字节计；合法最大导出 ≈ 1.05 MiB（32 KiB Definition + 500×2 KiB Links），正常不可达，超限属异常状态按 503 处理而非截断 |
| 删除后同 Definition 重复 delete 重放                 | 以 receipt 精确重放为唯一路径 | 运行时语义 | 同 Key 同 fingerprint 返回原 receipt；不再执行第二次删除                                                                            |

### 2.3 单一事实源规则

- 第 2.1/2.2 表中标注“Schema 硬限制”的数值只能存在于 Pydantic Schema / OpenAPI / DDL CHECK，C6-S/C6-A 服务代码不得重复实现为独立常量；
- 标注“运行时配额”的数值只允许两个经批准载体：本文对应小节，以及 `config.py` 中 `workbench_*` 字段的 `Field(default=...)` 默认值（两者必须相等）；配额/限流模块只能读取 `Settings`，不得内联第二份数值；发现冲突时以本文为准并立即停工报告；
- 任何一方（合同或配额）要改数值都必须回到新门，禁止实现 PR 内“顺手调整”。

## 3. Endpoint/操作配额矩阵

限流复用现有 `RateLimiter.enforce(scope, subject_hash, limit, window)`（Redis 固定窗口）与 `Settings` 字段惯例 `workbench_*_limit_per_hour`（默认值即冻结值，`ge=1` 上限按 C6-A 实现 Allowlist 中的 `le`）。窗口统一 3600 秒；429 `WORKBENCH_RATE_LIMITED`、`retryable=true`、`Retry-After` 见 2.1#7，details 不含剩余配额。注意现有 `RateLimiter` 硬编码认证错误码（`AUTH_RATE_LIMITED` 与 `retry_after_seconds` details）：C6-A 必须经包装/适配层产出 Workbench 的 429 语义，不得修改既有认证限流行为或其错误码。Redis 不可用时按现有 `RateLimiter` 语义返回 503（fail-closed），不降级为放行。

| 操作                                                | 限流（次/小时/用户） | 数量配额                                         | 其他前置                                  |
| --------------------------------------------------- | -------------------- | ------------------------------------------------ | ----------------------------------------- |
| definition list / get / deletion-impact / link list | 600（合并预算）      | page size 见 2.1#6                               | —                                         |
| definition create                                   | 10                   | ≤20 active 且 ≤50 总数                           | Idempotency-Key                           |
| definition replace                                  | 60                   | —                                                | expectedRevision（+可选 If-Match）        |
| definition archive / restore                        | 30 / 30              | restore 计入 ≤20 active                          | expectedRevision                          |
| definition delete                                   | 10                   | —                                                | impact 预览 + 三重前置 + Idempotency-Key  |
| import                                              | 10                   | 同 create 数量配额                               | Idempotency-Key + sourceFingerprint       |
| export                                              | 10                   | ≤2 MiB 响应体                                    | Origin+CSRF；`include_links` 逐项授权过滤 |
| link create                                         | 60                   | ≤500/Workbench；(kind,id) 唯一；属性合计 ≤16 KiB | baseLinkSetRevision + Idempotency-Key     |
| link patch                                          | 120                  | 属性合计 ≤16 KiB                                 | expectedRevision + baseLinkSetRevision    |
| link delete                                         | 60                   | —                                                | expectedRevision + baseLinkSetRevision    |
| link reorder                                        | 60                   | 全集恰好一次                                     | baseLinkSetRevision                       |

限流顺序遵守 C3 §10/C4 §9.2：Session → Origin/CSRF/限流 → owner 解析 → Schema → target ACL → 配额/版本/事务。配额当前值在授权失败时不可返回。

## 4. 威胁、攻击面、控制措施与验证证据矩阵

| 威胁               | 攻击面                           | 控制措施（冻结）                                                                                                                                                                      | 验证证据（C6-S/C6-A 必测）                                  |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 原型污染           | document/attributes 键           | 任意层精确键 `__proto__`/`prototype`/`constructor` 422；duplicate-aware 解析器重复键 422                                                                                              | 注入 fixture 全部 422；无部分写入                           |
| XSS / HTML 注入    | name/description/icon/accent/URL | C3 §2.2 PlainText 禁 C0/C1 控制；icon/accent 枚举 token；无 HTML/CSS/组件名字段。前端渲染仍必须转义（C6-S 范围）                                                                      | 后端拒绝越界字符串；前端转义单测                            |
| 配置注入           | 字段名/模块参数                  | 字段名 `[a-z][a-z0-9_]{0,47}`、StableItemId `[a-z][a-z0-9_-]{0,63}`、模块无 params、quickCreate 仅 4 注册命令                                                                         | 未知字段/命令 422 fixture                                   |
| Unicode/UTF-8 混淆 | 字节 vs 标量计数                 | 服务端按 UTF-8 字节与 Unicode 标量分别计数（C1 §4）；无 NFC/NFKC 改写；拒绝 BOM 与无效 UTF-8                                                                                          | 边界标量/字节数 fixture（80 标量 320 字节等）               |
| 重复键 / 解析歧义  | JSON 解析                        | duplicate-aware parser，任意层重复键 422；无法确认时按 C1 §9 fail-closed                                                                                                              | 重复键 fixture                                              |
| 递归炸弹           | 深嵌套 JSON                      | 深度上限 6（根=1）；未知层在计数前拒绝                                                                                                                                                | 深度 7 拒绝 fixture                                         |
| 压缩/膨胀炸弹      | 超大正文                         | 不接受压缩嵌套包（C4 §4.1）；解析前原始字节上限（import 2 MiB / 其余 256 KiB）→ 通用 413                                                                                              | 超限 413；无 OOM/慢速解析                                   |
| SSRF / URL 抓取    | url 字段/属性                    | v1 仅语法校验（C3 §2.2 HttpUrl 规则）；服务端零出站连接、零预览、零重定向跟随；后续任何抓取需新门                                                                                     | 网络调用 spy=0 的负测                                       |
| 越权/IDOR          | 跨 owner、跨 Workspace/Space     | owner 从 Session 派生；跨用户统一 404；target 逐项按 C3 §6 registry 重新授权；`claim`/`project` 额外要求 `user_id=当前用户`；Workspace 成员 ≠ Space 成员，私有 Space 不因成员身份可见 | 跨用户/跨 Space/私有 Space fixture 全 404，无对象元数据泄露 |
| Tombstone/孤儿目标 | deleted_at 目标                  | 合法 kind 的 tombstone 统一 404；列表/导入只过滤或聚合 `skippedLinks`，不返回数量差异或原因细分                                                                                       | tombstone fixture                                           |
| 枚举侧信道         | 列表长度/ETag/时序/错误码        | 授权先于版本/配额/详情；404 与“不存在”不可区分；422 不回显值；409 不含越权 remote                                                                                                     | 时序与响应形状一致性测试                                    |
| 幂等滥用           | 同 Key 重放/跨操作               | `(owner, idempotency_key)` 唯一 + operation 进 fingerprint；异 operation/fingerprint 409；重放重新验证当前授权与 owner                                                                | 并发同 Key 双请求恰一次写入                                 |
| Receipt 探测       | 他人 receipt                     | receipt 按 owner 隔离；重放仅返回本人结算                                                                                                                                             | 跨用户 receipt 404                                          |
| 日志泄露           | 结构化日志                       | 见第 7 节                                                                                                                                                                             | 日志断言仅含允许字段                                        |
| 配额旁路           | 归档复活/导入绕过                | restore 计入 active；import 复用 create 数量与 Link 配额；reorder 校验全集                                                                                                            | 配额边界 fixture                                            |

## 5. 授权与非泄露顺序（冻结）

C6-S/C6-A 必须按以下顺序落测试，任何倒置即停工（继承 C3 §10、C4 §9）：

1. Session；
2. mutation/import/export 的 trusted Origin、CSRF、用户级限流（本门第 3 节）；
3. flag 关闭 → 路由未注册（第 9 节）；
4. URL 范围内 Definition/Link 的 owner 解析（失败先于 body 422/版本/冲突/配额）；
5. 有界严格 JSON、合同版本、Schema；
6. typed target 真实 scope、活动状态与现有 ACL；
7. 配额、revision/ETag、冲突计算与事务写入。

非泄露铁律：404/403/409/429 不返回对象标题、目标 kind/ID、Space、成员、ACL、剩余配额或任一 fingerprint；cursor 不回显；`skippedLinks` 只含聚合 `{count, reason:"not_available"}`。

## 6. URL 与网络策略（冻结）

- URL 字段（url field 与属性值）只做 C3 §2.2 语法校验：绝对 `http:`/`https:`、≤2048 UTF-8 字节、ASCII 主机规则、拒绝凭据/fragment/反斜杠/控制字符；
- **本版本服务端不得抓取、预览、重定向跟随、DNS 解析或发起任何由 Workbench 输入驱动的网络访问**；Workbench 代码路径的网络调用 spy 必须为 0；
- 未来任何 URL 抓取/预览能力必须经独立 SSRF/重定向/私网策略门重新批准，本文不预授权。

## 7. 日志与隐私策略（冻结）

允许记录：合同名（`workbench.definition` 等）、结果类别（status 类别/错误 code）、实体 ID 的 SHA-256 哈希前缀（≤16 hex）、有界计数（页大小、冲突路径数、skippedLinks count）、`request_id`、限流 scope 与是否命中。

禁止记录：配置正文、对象正文、URL 值、成员邮箱、Token、Cookie、密钥、私有 Space 内容、完整导入/导出包、两个 fingerprint 的值、receipt 正文。导出不写响应正文日志；错误 message 使用固定服务端文案（C3 §9）。日志注入防护：除哈希前缀与枚举外不接受用户输入进日志。

## 8. DELETE body 代理门（部署前置）

Definition delete 与 link delete 携带 JSON body（C4 §5.4/§6.2）。部署验收步骤（C6-A 完成后、生产启用前执行）：

1. 在目标部署链路（反向代理 + 应用）发送带 JSON body 的 DELETE 请求，应用端断言收到完整 body；
2. 断言代理不剥离 `Origin`/`X-CSRF-Token`/`Idempotency-Key` Header；
3. 任一失败 → **不得注册这两个 DELETE 路由**（flag 保持关闭或路由条件剔除），禁止把关键字段降级到 query/URL/未认证 fallback；
4. 验收证据（请求/响应样本，脱敏）归档到部署门记录。

## 9. Feature-off 门（冻结）

- `workbench_custom_api_enabled` 默认 `false`（部署配置，重启生效；不接受请求参数或 UserSetting 开关）；
- 关闭时 15 个路由**不注册**：status/body/headers 与未知路径完全一致，零 DB 查询、零限流调用、零 receipt 创建、不解析 Workbench body；
- 既有 `include_dormant_contracts` 合同导出机制不受影响；
- 关闭不删除已存数据；旧 Persona 与固定 Workbench 照常工作。

## 10. 数据保留、删除与回滚（冻结）

- Definition 删除：单事务内删 Definition + 全部 Link（DDL CASCADE）+ Preference 活动引用回退 `fixed.learning`；`formalObjectDeleteCount=0`；
- Receipt 保留：随账号存活（满足 C4 “永久绑定”重放语义）；账号删除经 `owner_user_id` CASCADE 一并清除；v1 不做 TTL 清理；receipt 的 `definition_id` 无 FK，Definition 删除后重放仍可结算（安全 404 或原 receipt）；
- 归档数据无保留期限，受 50 总数配额约束；
- Downgrade/回滚：`0039_workbench_foundation` 的 `downgrade()` **拒绝丢弃数据**——离线 `as_sql` 模式恒抛 `RuntimeError`，在线模式逐表检查，任一表非空即拒绝；仅在三表全空时才允许 drop。因此回滚前必须先关闭 flag，并经独立批准的数据清空路径（按 owner 清理或账号删除）使三表为空后再 downgrade；downgrade 与升级/降级/升级循环不得留下孤儿行，`user_settings` 与正式对象零变化；回滚不撤销任何 Workspace/Space 权限或正式对象。

## 11. C6-S/C6-A 写入白名单建议

C6-S（服务/仓储层）：

```text
apps/api/src/logion_api/workbenches/service.py            # 新建：配额、幂等、409、事务编排
apps/api/src/logion_api/workbenches/repository.py         # 新建：三表数据访问
apps/api/src/logion_api/workbenches/registry.py           # 新建：七类 target resolver
apps/api/tests/test_workbench_service.py                  # 新建
apps/api/tests/test_workbench_registry.py                 # 新建
```

C6-A（API 接线层）：

```text
apps/api/src/logion_api/workbenches/routes.py             # 新建：真实 handler 替换 dormant 拦截
apps/api/src/logion_api/workbenches/quota.py              # 新建：第 3 节矩阵的限流/配额入口
apps/api/src/logion_api/main.py                           # flag 条件 include（单节点）
apps/api/src/logion_api/config.py                         # 仅新增 workbench_* 限流与 flag 字段
apps/api/tests/test_workbench_api_integration.py          # 新建
apps/api/tests/test_workbench_flag_off.py                 # 新建
```

两阶段均不得触碰：schemas.py / contract_routes.py / 迁移 / models.py / users/** / workspaces/** / packages/contracts/\*\*（除非独立合同门批准）。

## 12. 必跑测试与停止条件

必跑（C6-S）：配额边界（第 20/50/500/16 KiB/4096B 的边界与超限）、幂等并发、409 三方比较、tombstone/跨 Space/跨用户 404、registry 七 kind、RFC 8785 指纹 fixture。
必跑（C6-A）：第 4 节证据矩阵全部负测、flag-off 与未知路径逐字节一致 + 零副作用 spy、授权顺序 1-7、429 与 Retry-After 界、DELETE body 代理门步骤、import 零半写入与 503 语义。
命令基线：`uv run --group dev ruff check / format --check / mypy <allowlist>`、`uv run --package logion-api pytest <新测试>`、`git diff --check`、白名单边界断言（参照 C5 §1 快照法）。

停止条件：任何测试需要修改合同文件才能通过；发现本文数值与 Schema/DDL 冲突；Redis 不可用时要求放行限流；DELETE body 代理验证失败且要求降级字段；需要预授权 URL 网络访问。

## 13. 明确不做与剩余 Product Owner 决策

明确不做：不实现任何代码；不启用 flag；不做 Persona 迁移（独立门）；不做前端；不做生产部署；不改既有合同文本。

剩余 PO 决策：① `impactFingerprint` 签名算法与密钥管理（HMAC 密钥来源/轮换）仍未定，C6-A 删除路径实现前必须裁定；② 限流 Redis 在目标部署的可用性与降级策略确认（本门按 fail-closed 503 冻结）；③ 生产 flag 启用时间与灰度顺序；④ 未来 URL 抓取/预览能力（本门明确不预授权）。
