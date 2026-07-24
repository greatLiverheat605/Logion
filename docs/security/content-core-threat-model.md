# 笔记与资料索引威胁模型

状态：L3-003A 实现基线

## 不变量

- Note/Resource 属于一个 Workspace/Space；可选 Task 必须属于同一 Workspace/Space。
- Markdown 作为源文本存储，绝不视为可信 HTML；客户端必须转义为文本或通过批准的白名单 sanitizer。
- Resource 只保存链接或 PDF 元数据/页码索引。本切片不上传、抓取、解析或保留 PDF 二进制/全文。
- 笔记正文、标题、页注和 URL 排除在审计元数据及运行日志外。

## 控制

| 威胁               | 控制                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 跨租户 IDOR        | 每个限定查询前解析 membership/Space 授权；隐藏对象返回 not found                |
| Private Space 泄露 | Private Space 始终只允许 Owner；Shared Space 写使用规范权限                     |
| CSRF/跨源写入      | 每个 create/update 路由执行可信 Origin 与双提交 CSRF                            |
| 过度提交/超大内容  | 严格 Pydantic DTO、有界 Markdown/页索引和数据库约束                             |
| Markdown XSS       | 服务端不生成 HTML；未经批准 sanitizer，客户端不得使用 `dangerouslySetInnerHTML` |
| 危险 Resource URL  | 只接收绝对 HTTP/HTTPS；服务端不抓取                                             |
| 丢失更新           | expected version 与行锁；过期更新返回冲突                                       |
| 资源耗尽           | Space 总内容配额及认证 Workspace 写限速                                         |
| 审计泄露           | 元数据白名单只含类型、数量、版本和关系是否存在                                  |

## 后续

- L3-003B 必须先在浏览器 Vault 加密载荷，再写实体、Outbox、冲突或 Bootstrap。
- 以后 URL 健康检查必须在 Worker 增加 SSRF、重定向、DNS rebinding 和响应大小防护；保存链接不等于授权抓取。
- 以后附件/PDF 上传必须独立校验大小、MIME、扩展名、哈希和隔离对象路径，才可成为证据。
