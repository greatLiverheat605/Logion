# 附件上传威胁模型

范围：首版小型截图、PDF/文本/CSV/JSON 实验结果的直传与离线队列。文件系统适配器位于附件服务边界后，未来可换成私有对象存储，不改变授权或验证语义。

## 不变量

- 必须执行 `init -> content -> complete`；只有 `verified` 内容可下载。
- 每个请求限定认证 user/Workspace/Space。upload/complete 只允许记录发起者；读取者仍需实时访问目标 Space/对象。
- 客户端 filename 仅为元数据；存储路径只用生成 key/UUID，绝不用 filename。
- 默认每文件 20 MB、每用户 500 MB reserved bytes。流式读取在声明大小停止；未知字段、不支持 MIME/扩展名和无效 hash 失败关闭。
- `complete` 独立重算字节数、SHA-256 和白名单内容签名。只有同一记录完全 verified 后才幂等；ID 重放但元数据变化会拒绝。
- 响应/审计不含 staging/storage key、文件名、hash 或正文。下载使用 `private, no-store`、`nosniff`、binary media type 和编码 attachment filename。
- API/Worker 使用 UID/GID 10001 和只读根文件系统。一次性无网络 initializer 只拥有共享附件卷并仅保留 `CHOWN`；staging 为 0700，verified 目录/文件为 0750/0640，使只读 Backup 附加组可归档但不能写入。

## 滥用与控制

| 威胁                         | 控制                                                                                        | 证据                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| 跨租户 ID/key 猜测           | Workspace/Space/creator 条件与不透明 404；API 不返回 storage key                            | 两 Workspace 同 UUID 外部上传测试 |
| 路径穿越/Header 注入         | filename 拒绝分隔符/控制字节；生成路径白名单；RFC 5987 编码下载名                           | schema/存储单测                   |
| MIME 欺骗/polyglot           | 扩展名与声明 MIME 一致；complete 嗅探 PNG/JPEG/WebP/PDF 或校验 UTF-8/JSON；绝不 inline 下载 | PDF 冒充 PNG 的单测/集成          |
| 超大/chunked body 或配额耗尽 | 按声明大小和配置上限流式限制；配额计 pending/failed；专用写限速                             | 存储单测/API 策略                 |
| 部分/重放上传                | 临时文件原子替换；complete 锁行校验版本；verified 重放返回同版本                            | 集成/离线队列测试                 |
| 文件提升后 DB 提交失败       | 原子复制且保留 staging；提交后清理由 complete 重放重试                                      | 实现审查                          |
| 离线重试泄露错误/内容        | IndexedDB 只存有界 Blob/hash；传输异常归一为稳定 code                                       | 队列测试                          |
| 备份恢复文件无元数据         | RC fixture 将 verified 行绑定恢复文件并比对 DB/file SHA-256                                 | `scripts/release/rc_recovery.sh`  |
| 容器权限/卷漂移              | initializer 无网络且仅 `CHOWN`；API/Worker 非 root；Backup 只读挂载                         | Compose 边界测试/Main smoke       |
| 账户删除遗留文件             | 删除用户前枚举其 attachment storage key，再删除行/用户数据                                  | deletion service                  |

## 残余风险

文件系统适配器只适用于单服务器，不代表异地灾备或云对象存储耐久性。未提供防病毒/CDR；白名单文件只作为附件下载，API 不渲染、不执行。Production 对象存储、恶意软件策略、保留和异地恢复仍由操作员/人类发布决策。
