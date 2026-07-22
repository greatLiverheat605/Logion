# 数据可移植性威胁模型

日期：2026-07-22  
范围：Phase 5 / L5-020

| 威胁                                      | 控制                                                                                                                    | 验证                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 用户导出其他租户或私有 Space              | 创建和下载均重新校验 active membership；构建时只选择共享 Space 与请求者拥有的私有 Space；个人对象限制 requester user ID | Viewer 无法看到 owner 私有数据和其他用户 export 的集成负测 |
| 可猜测 export UUID 导致 IDOR              | 查询同时绑定 export ID、workspace 和 requested_by；不存在与无权限统一 404                                               | 跨用户下载/列表负测                                        |
| Provider Key、会话、恢复码或 Token 进入包 | 模型显式白名单；身份、AI、分享、日历和审计表不参与；通用序列化器仅作用于白名单学习对象并剔除 actor/workspace 字段       | ZIP 精确成员、manifest exclusion 与敏感标记测试            |
| 数据库或备份读取明文导出                  | 独立 256-bit keyring；AES-GCM；AAD 绑定 workspace/job/key ID；数据库只存密文                                            | 密文不含私人标记；篡改/错误 key 失败关闭                   |
| 下载缓存或 MIME 嗅探泄漏                  | recent-auth；`private, no-store`、`nosniff`、`no-referrer`、attachment disposition                                      | 响应头集成测试                                             |
| 后台任务重复、并发或取消竞争              | `FOR UPDATE SKIP LOCKED` 领取；状态机和 version；取消清除未完成密文；终态写入加锁                                       | 重复执行、取消和并发 worker 测试                           |
| 产物损坏或静默截断                        | 生成后记录 SHA-256 和字节数；每次下载解密后重新计算并比对                                                               | 摘要不匹配返回稳定 503                                     |
| CSV/BibTeX 公式或语法注入                 | CSV 使用标准 writer；当前任务字段作为数据输出；BibTeX key 字符白名单，花括号从 title/URL 剔除                           | 单元测试特殊字符；后续 CSV 导入仍按不可信数据处理          |
| 过量导出耗尽数据库或 worker               | 每用户/workspace 仅允许一个 active job；独立写限流；worker 异步处理；产物短期到期                                       | 配额与限流测试；Phase 6 容量基线                           |
| 日志泄漏正文或 ZIP                        | worker 只记录错误类型；审计只含 schema、字节数和对象 ID                                                                 | 日志/审计字段审查                                          |

残余风险：当前产物密文保存在 PostgreSQL，会增大主库和备份体积。公开稳定版前应迁移到同等加密、生命周期和完整性控制的私有对象存储；迁移不得把 bucket 或预签名 URL 变成长期访问凭证。

## 导入补充

| 威胁                                        | 控制                                                                                 | 验证                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| 恶意 JSON/CSV/BibTeX 触发代码、宏或远程抓取 | 自建保守数据解析器；无 eval、模板执行、宏展开、路径读取或网络请求；URL 只验证并存储  | 四格式单元测试与恶意凭据 URL/NUL 测试 |
| 超大或深层输入耗尽服务                      | API 限制源为 1 MiB；规范记录最多 1000；字段、列表和 URL 均有界；独立写限流           | schema 边界与超限测试                 |
| 导入恢复源 ACL、成员或可猜测 ID             | 只映射白名单内容字段；目标必须是请求者拥有的 private Space；每条记录生成 UUIDv7      | 跨用户 target 负测与新 ID 断言        |
| 预览被其他用户提交或重复使用                | preview 查询绑定 workspace/requested_by；commit 加行锁、version、expiry 和单次状态机 | IDOR、版本冲突和二次提交测试          |
| 预览正文在数据库或备份中泄漏                | 不保存原文；规范记录用独立 keyring 和 import 专属 AAD 加密；commit 后清除密文        | 数据库密文/清除断言与 AAD 篡改测试    |
| 未支持对象被静默丢弃                        | preview 返回逐类型 warning 和实际 counts；用户显式确认后才提交                       | Logion JSON skipped-type 测试         |
| 部分导入造成悬空或重复数据                  | 配额预检；新对象和 preview 终态在同一事务；DB 约束失败整笔回滚                       | Integration 原子性与单次状态测试      |
