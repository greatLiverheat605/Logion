# AI Provider 凭据威胁模型

状态：L5-001 配置基线；尚无外部 Provider 调用

| 威胁                                   | 控制                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| API key 进入浏览器响应或离线数据库     | 创建/更新使用只写 `SecretStr`；响应只暴露布尔值；同步和 Vault schema 不含 Provider 类型                          |
| 数据库泄露暴露 API key                 | 每记录 AES-256-GCM 数据密钥、版本化 KEK 信封加密及 Workspace/Provider AAD                                        |
| 密文被复制到其他 Workspace/行          | AAD 不匹配以 `AI_PROVIDER_KEY_UNAVAILABLE` 失败关闭                                                              |
| Workspace A Owner 猜测 Provider B UUID | 每次查询都限定认证 Workspace 和 `ai.configure`；跨租户 ID 返回 not found                                         |
| Editor/Reviewer/Viewer 配置 Provider   | 只有 Owner/Admin 获得 `ai.configure`，REST 集成测试覆盖拒绝                                                      |
| CSRF 更改凭据                          | 每次写入受可信 Origin、双提交 CSRF、recent authentication 和专用认证限速保护                                     |
| URL 指向回环/私网/元数据服务           | 静态校验要求公网 HTTPS，阻止非全局 IP 字面量、本地/内部后缀、凭据、query/fragment、路径穿越及未批准端口          |
| DNS rebinding 或重定向进入私网         | L5-001 不发网络请求；L5-002 必须在每次连接前和每次重定向后解析并分类所有地址                                     |
| 审计/错误/日志泄露秘密                 | 审计元数据为空；校验返回稳定通用错误；集成测试扫描审计/响应文本；CI 密钥扫描保持强制                             |
| 删除后仍留可解密秘密                   | 软删除在同一事务清空 ciphertext、nonce、wrapped key 和 key ID，只保留最小审计元数据                              |
| AI 故障阻塞学习                        | Provider 配置是可选服务端模块，planning、execution、memory、exam、self-study、research、collaboration 均不依赖它 |

残余风险：能访问活动 KEK 的受控应用进程可以解密已配置凭据。Production 必须限制环境密钥访问、轮换密钥；加入外部调用后监控解密操作，并在基础设施允许时将密钥与数据库备份分离。
