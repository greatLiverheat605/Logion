# 聚合可观测性契约

Logion 发布决策只使用聚合运行窗口，不使用学习内容。监控适配器只能输出 `logion-rollout-samples-v1` 定义的字段：UTC 观测时间、请求/错误数、p95 延迟、布尔健康状态、队列滞后及同步尝试/失败数；未知字段必须失败关闭。

适配器不得包含用户 ID、邮箱、IP 地址、Workspace/对象 ID、带查询串 URL、笔记/任务/研究正文、附件名、AI 提示词或响应、token、Cookie、凭据、恢复材料或原始异常载荷。日志遵循同一边界，请求 ID 只用于有界运行关联。

## 必需信号

- Web/API 健康与依赖就绪；
- 请求量、服务端错误率及非 AI p95 延迟；
- Worker 队列深度/最老任务延迟及失败任务类别数；
- 同步尝试/失败、冲突量和需要 Bootstrap 的数量；
- PostgreSQL 连接/饱和度、存储容量和备份年龄；
- 不含凭据或账户值的认证滥用计数。

## Worker liveness 与 readiness

Worker 主进程每 5 秒把聚合运行状态原子写入容器专用 tmpfs。健康检查不得只证明 Python 可以启动：

- `python -m logion_worker.health --live` 检查主进程、运行标记和心跳新鲜度；
- `python -m logion_worker.health` 额外检查最近成功轮询、每类队列连续失败阈值、PostgreSQL、Redis 和聚合队列状态；
- 任一队列连续失败达到 `LOGION_WORKER_HEALTH_FAILURE_THRESHOLD` 时返回 `not_ready` 并以非零状态退出；其他队列的成功轮询不能清除该队列的失败计数；
- 依赖恢复且故障队列再次成功轮询后，readiness 无需重启即可恢复。

readiness 的 `queues` 只允许包含 `queued`、`scheduled`、`running`、`failed`、`oldest_age_seconds`、`lease_overdue` 和 `retry_attempts` 等聚合数字。运行状态和失败日志只记录队列类型、阶段、固定错误码、异常类型与临时关联 ID，不得记录任务正文、邮箱、Token、Provider 凭据或原始异常消息。

`config/release/rollout-policy.json` 中版本化发布策略是发布门禁。Provider 看板可以更严格，但不能静默放宽。遥测缺失、持续时间/样本量不足、窗口乱序、未知 schema 或候选不匹配都必须返回 `hold` 或拒绝，不能晋级。

## 告警与保留

P0 覆盖租户隔离、数据丢失、密钥泄露和不可恢复备份；P1 覆盖持续健康失败、错误/延迟越界、队列饱和、同步回归和备份过期。进入 Production 前必须在选定云平台配置接收人、升级时限、保留期和数据区域。告警载荷只能包含聚合值和不可变候选身份。
