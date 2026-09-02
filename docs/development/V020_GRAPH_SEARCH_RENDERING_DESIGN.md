# V20-10 图、搜索与呈现服务端合同

状态：后端增量实现中（2026-08-06）。前端 owner 仍等待用户指定，因此本文件不授权任何前端施工。

## 目标与边界

V20-10 先完成可被浏览器安全消费的服务端数据合同，不引入新的一级导航、向量数据库、Neo4j、sync-v1 实体或本地 worker。所有读取都必须先通过当前用户、Workspace 和 Space 授权；Shared Write、删除、附件和 AI Acceptance 生产启用继续关闭。

## 图读取

现有 `GET /api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge/graph` 继续是唯一正式图入口：

- 根节点只允许 `topic`、`quiz_item`、`research_claim`、`note`；首版实际关系仍只有 `topic_dependency`。
- `depth` 只能为 1 或 2；节点、边、候选行、数据库时间和响应字节均有硬上限（150 / 400 / 每语句 600 / 750ms / 1MiB）。
- 每个节点和边都在进入纯图内核前完成 Space scope 与可见性过滤；结果顺序稳定，截断只返回完整节点/边。
- `cursor` 使用现有 HMAC 不透明信封，并绑定用户、Workspace、Space、根节点、深度、方向、边类型和预览开关。当前服务端将其作为签名快照边界进行校验；在能够把完整 BFS frontier 放入 1KiB 信封前，不发放不可证明安全的续页 token，因此 `next_cursor` 可以保持 `null`。

这项选择是 fail-closed：客户端遇到 `next_cursor = null` 时应缩小深度、过滤边类型或重新发起查询，不能假设还有未披露的全局数量。

## 词法搜索

新增 `POST /api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge/search`：

- 请求只接受 2–100 个字符的纯文本 `query`、最多四种唯一 `target_types` 和 1–50 的 `limit`。
- 首版搜索四类正式目标：Topic 标题/描述、QuizItem 题干/答案键/解释、当前用户的 ResearchClaim statement、Note 标题/正文。
- 每类最多读取 101 个候选行；查询使用转义后的 PostgreSQL `ILIKE`，随后按标题命中权重、正文命中权重、更新时间和 ID 做确定性排序。
- 返回 `target_type`、ID、受限 label/snippet、version、updated_at 和 HMAC 绑定的 `next_cursor`。Cursor 绑定 query、类型过滤、limit 和 Space，过期、篡改或跨范围复用统一返回 `KNOWLEDGE_CURSOR_INVALID`。
- 不搜索不可见的 ResearchClaim，不返回 Excerpt 原文，不把查询文本写入日志，也不引入向量/语义检索。固定黄金集的 Recall@10 评估仍是后续门禁；未达到路线图阈值前不批准向量扩张。

## 浏览器呈现预留

浏览器负责图布局、节点聚焦、边语义和移动端列表/树的投影；服务端不返回布局坐标，也不把 Canvas 作为唯一操作方式。正式前端实现必须等用户指定 owner，并单独通过 1440/1024/390px、键盘/axe、loading/empty/locked/online-only 和存储型 XSS 门禁。
