# 开发与交付文档导航

## 当前版本

| 文档                                                                      | 唯一职责                                   |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| [v0.2.1 状态](V021_STATUS.md)                                             | 当前阶段、候选、授权边界与下一步；先读此页 |
| [交付范围](V021_DELIVERY_SCOPE.md)                                        | 本版纳入/延后内容及生效验收口径            |
| [FABLE 总表](FABLE_PLAN_REGISTER.md)                                      | T/OPS/O/N/U/D 编号、原始来源与后续待办     |
| [M5 结论](V021_M5_CLOSEOUT.md)                                            | 已完成验收、计数、豁免与残余限制           |
| [58 项映射](FABLE_REGRESSION_CHECKLIST.md)                                | 逐项状态及补充验收索引                     |
| [M6 发布准备](V021_M6_RELEASE_PREPARATION.md)                             | 实际 SHA、工作流/镜像证据和生产发布门      |
| [M6 执行计划](../../.codex/plans/current/2026-09-09_logion-m6-release.md) | 当前操作顺序与直接子计划，完成前留 current |

## 开发规则

- [交付工作流](AGENT_DELIVERY_WORKFLOW.md)：授权、单写入者、复核与 Git 边界。
- [状态模型](AGENT_STATE_MODEL.md)：本地 Run、事件与证据校验。
- [v0.2.0 架构执行计划](V020_EXECUTION_PLAN.md)：V20 设计与实现不变量；其编号不等同于 FABLE M0–M6。
- [原始 FABLE 规划来源](FABLE_PLAN_REGISTER.md#1-来源与使用口径)：保留原始提议，后续批准见当前总表。

## 验收与历史依据

| 记录                                                                                                                                    | 适用范围                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [M5 初轮回归](V021_M5_LOCAL_REGRESSION.md) · [修复复验](V021_M5_FIXES_REVIEW.md)                                                        | 各报告注明的本地候选和测试                 |
| [M5 完整过程](history/V021_M5_ACCEPTANCE_LOG.md)                                                                                        | R 系列、真实 Provider/邮件、失败和恢复记录 |
| [M6 准备过程](history/V021_M6_PREPARATION_LOG.md)                                                                                       | 初始交付、D-18、合并与镜像安全修复         |
| [范围决策过程](history/V021_SCOPE_DECISION_LOG.md)                                                                                      | 原推荐稿、批准与分阶段范围变化             |
| [v0.2.0 收口](V020_STATUS.md) · [完整历史](history/V020_STATUS_THROUGH_20260910.md)                                                     | 旧版本及跨版本迁移时期的有日期记录         |
| [T-03](V021_T03_FEEDBACK_REVIEW.md) · [T-05](V021_T05_ENTITY_DELETION_REVIEW.md) · [T-05a](V021_T05A_ATTACHMENT_QUEUE_REVIEW.md)        | 专项实现与原始检查                         |
| [T-06 文案](V021_T06_STATUS_COPY_REVIEW.md) · [剩余项](V021_T06_REMAINING_REVIEW.md) · [StudySession](V021_T06_STUDY_SESSION_REVIEW.md) | 分阶段实施与补修                           |

- [FABLE 整理前快照](history/FABLE_REGISTER_THROUGH_20260910.md)：原来源、任务、决策与过程补记。

## 维护方式

当前概览更新 V021_STATUS，制品与生产门更新 M6 准备页，逐项验收更新清单。需要追溯的结果保存到相应历史记录；其他入口以链接引用，避免复制整段进度。历史中的失败不删，未运行不记 passed，已批准范围不因整理文档而扩张。状态文档提交与产品源码 SHA 分开标识。
