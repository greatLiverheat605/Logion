# Phase 3 阶段验收记录

- 评审日期：2026-07-22
- 基线：`LOGION_EXECUTION_PLAN.md`、`LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`
- 实现候选：`4ecfa487792fa8693f30ad83940067e74912109f`
- 候选证据：<https://github.com/greatLiverheat605/Logion/actions/runs/29853140304>
- 跟踪：<https://github.com/greatLiverheat605/Logion/issues/81>
- 结论：关联 Main 候选成功，可进入一次 Phase 3 人工批准；无已知 P0/P1

## 交付链

| 工作包               | Main commit                     | 结果                                                                 |
| -------------------- | ------------------------------- | -------------------------------------------------------------------- |
| L3-001 目标/计划     | `03c4f81`, `6b22372`, `f80ba5d` | 用户目标、版本计划/阶段、加密离线 Planning UI/同步                   |
| L3-002 任务/会话     | `cb6c3c`, `7cc07f6`             | 约束状态机、单活动会话、因果 Outbox、Today UI                        |
| L3-003 笔记/资料     | `1c9a681`, `336f0a2`            | Markdown、HTTP(S)、PDF 元数据/页索引、加密 Records UI；不存 PDF 正文 |
| L3-004 证据/验证     | `2eafa5b`, `ce3d8f4`            | 证据、人工 verdict、仅 verified 可关闭、跨实体同步/Vault             |
| L3-005 验收/发布修复 | `72517f2`, `4ecfa48`            | 双设备完整闭环、blocked/pending/conflict UX、真实 Web 镜像/PR 门禁   |

可执行退出路径：`goal -> plan phase -> task -> study session -> note/resource -> evidence -> explicit human verification -> done`。

Review scheduling、Mastery、Quiz、ErrorPattern 和四类用户场景留给 Phase 4；没有引入写死导师、学科、课题组或 Vigils 上下文。

## 验收证据

| 不变量/故障       | 结果                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| 在线领域闭环      | REST 集成覆盖 goal/task/evidence、revision、pass、verified-only close                             |
| 离线同步闭环      | `test_phase3_learning_loop_integration.py` 经 sync-v1 驱动全部实体，第二设备收到 14 条有序 change |
| 重放/崩溃安全     | identity/hash 重放；Evidence 返回原 version/sequence                                              |
| 因果离线编辑      | Task/Session/Note/Resource/Verification 依赖推进服务端版本                                        |
| 弱网              | 中途失败保留 Outbox/cursor，重试不丢本地编辑                                                      |
| Bootstrap/epoch   | checksum、staging、原子激活、旧 Outbox 隔离、rebootstrap 仍通过                                   |
| 无静默冲突        | 过期 status/content/verification 显式冲突并保留双版本                                             |
| 租户/Private 隔离 | 服务授权、Pull/Bootstrap 过滤、组合约束和外部负向测试                                             |
| 静态保护          | 全部 Phase 3 实体/Outbox/staging/conflict 只保留加密引用                                          |
| 仅人工验收        | AI 无 verdict 路由；pass/revision/failure/close 均需认证操作                                      |
| Markdown/链接     | React 文本渲染；只接收 HTTP(S)，服务端不抓取                                                      |
| 移动/无障碍       | 单列响应、label、live status、focus、reduced-motion 基础                                          |
| 诚实状态 UX       | Today 区分 pending、blocked、permission、conflict、offline                                        |
| 可部署候选        | PR Integration 构建包含 `@logion/offline` 的真实 Web 镜像                                         |

本地关门：Ruff/mypy、141 个非集成 Python 测试、Prettier/ESLint/TS strict、12 contract、44 offline（93.29% statements）、20 Web、Next production build、`pnpm audit`/`pip-audit` 无已知漏洞、secret pattern 无发现。每个 PR 均通过 Fast 和 PostgreSQL Integration。

## 安全审查

`security-review` 验证严格 schema/allowlist、Origin/CSRF、服务端 Workspace/Space 权限、同范围 UUID 外键、禁止普通 Task 直达 verified/done、审计排除正文、AES-256-GCM 离线记录、无不安全 HTML 和凭据入库。审计发现 Main Web 镜像自 L3-003 漏掉 offline package，PR #83 已修复并把真实镜像构建加入必需 PR Integration；这是可用性构建缺陷，不是机密性/完整性事故。

## 兼容与残余风险

- 物理 Safari/iOS PWA、后台调度和存储驱逐仍需 RC 真机；前台同步完整。
- 已 ACK operation 的 Vault 记录保留到本地 wipe，仍加密但稳定版前应增加有界 GC。
- 采用保守记录级冲突；字段/CRDT 合并延后，双版本保留且不静默覆盖。
- Evidence URL 只做语法校验不抓取；以后预览需另做 SSRF/隐私审查。
- 专门导师流程/报告属于 Phase 4；Production、恢复、真机、性能、WCAG 门禁仍未批准。

## 人工批准清单

1. 关联 Main 候选及 Web/API/Worker/Backup 产物成功。
2. 证据闭环和仅人工验证符合预期。
3. Review/Mastery/Quiz/场景模式可留到 Phase 4。
4. Safari/PWA 与 Vault GC 可作为后续 P2 风险。
5. 不授权 Production 或公开稳定版。
