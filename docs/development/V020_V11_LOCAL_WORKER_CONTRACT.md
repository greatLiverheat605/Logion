# V20-11 Local Worker 与附件扫描接入合同

状态：API/迁移候选已实现并通过本机验收，生产默认关闭；本文件不授权 Provider、常驻 Worker 或任何生产开关。

## 目的与边界

Local Worker 只能作为用户明确授权后的本机执行器。服务端是租约和权限的唯一裁决者；本机只保存短期租约摘要、受限检查点和输出摘要。执行输入必须绑定 `job_id`、`workspace_id`、`space_id` 与 `input_sha256`，不得从客户端声明中推断租户或权限。当前已实现的 API/迁移候选仍由 `knowledge_space_local_worker_enabled=false` 的 Feature Boundary 隔离，未获得生产启用授权。

附件在进入 `verified` 前必须经过服务端约束、魔数/MIME/大小/hash 校验以及批准的恶意扫描器。扫描器必须使用流式输入、隔离目录和固定错误码；命中、超时、不可用、隔离失败均 fail-closed，不得把样本内容写入日志。告警、隔离、人工处置和残留清理必须有可执行 Runbook 与审计事件。

## 远端租约合同（候选已实现，生产仍关闭）

| 操作                                       | 要求                                                                                                                                      | 失败语义                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST /local-worker/leases`                | 认证会话、近期重新认证、Private Space owner 权限；服务端生成不可预测 lease/token 并只持久化 SHA-256 摘要；请求只接受 job/space/input 摘要 | 默认关闭返回固定 `KNOWLEDGE_LOCAL_WORKER_DISABLED`；不枚举对象 |
| `POST /local-worker/leases/{id}/revoke`    | 仅任务所有者或授权管理员；幂等撤销；审计不含 token                                                                                        | 已过期/已撤销返回稳定状态，不恢复租约                          |
| `POST /local-worker/jobs/{id}/checkpoints` | 每次请求携带 lease token；服务端重新校验 scope、input hash、阶段单调性、大小上限和版本                                                    | 401/403/409/413；任何不确定状态均拒绝接受                      |
| `POST /local-worker/jobs/{id}/result`      | 单次提交；输出摘要与服务端 job 绑定；提交后租约终态并清理临时工件                                                                         | 重放返回同一收据或稳定冲突，不重复计费/写入                    |
| `GET /local-worker/jobs/{id}/recovery`     | 只返回当前用户可见的阶段和摘要，不返回原始输入/输出                                                                                       | worker 离线不影响在线核心读路径                                |

候选实现包含 `0038_local_worker_protocol` 迁移、严格 Pydantic 合同、认证/CSRF/Origin/近期重新认证、Private Space owner/admin 授权、租约撤销、检查点单调性、scope/workspace/space/input hash 绑定、单次 result receipt、幂等 replay/冲突拒绝和受限 recovery。候选已经通过 74 项目标单测、3 项真实认证集成测试、3 项迁移集成测试及 `alembic check`；这些证据只证明候选边界，不改变默认关闭门禁。

租约建议有效期 30--600 秒，服务端时钟为准；撤销、过期、会话失效、scope/input 不匹配和 token 摘要不匹配均 fail-closed。租约 token 只能通过受保护会话传递，不能进入 URL、日志、浏览器存储或协调账本。

## 恢复与残留

检查点采用允许列表（`checkpoint.json`、`checkpoint.json.part`）、大小上限和原子替换；符号链接、未知工件、损坏 JSON、非 UTC 时间、阶段回退和超限内容均拒绝。Crash、重启、上传中断和租约过期必须分别演练：`.part` 可清扫，终态检查点必须清理，旧租约在重启后不得恢复执行。恢复演练必须记录实际命令、退出码、残留扫描结果和失败现场。

## 扫描器准入

正式实现前必须锁定扫描器版本、病毒库来源、超时/大小上限、隔离目录 ACL、告警路由、人工处置、重试与恢复策略。至少实际观察：EICAR 命中、PDF/HTML/PNG/文本干净样本、Polyglot/魔数不匹配、扫描超时/不可用、隔离失败、重试幂等和备份恢复后的残留清理。临时 ClamAV 命中只证明引擎能力，不能单独关闭 V20-11 硬停止。

## 进入 V20-12 的必要条件

1. 远端 lease/revoke/checkpoint/result 合同有服务端模型、迁移、认证/权限和 fail-closed 集成测试。
2. Crash/Reboot/上传中断/worker-offline 的真实认证演练通过，并证明不重复正式写入或计费。
3. 扫描器接入、隔离、告警和 Runbook 在批准环境实际演练通过。
4. 加密卷、ACL、备份恢复与残留清理证据保持可复核；所有敏感生产开关仍关闭，直至用户另行批准。
