# ADR 0011：个人研究证据与实验闭环

状态：Phase 4 L4-R1 已接受

- PaperRecord、ResearchClaim、ResearchQuestion、ExperimentRun、MetricRecord 和 ResearchFeedback 即使位于共享 Space 中也属于个人数据。
- Claim 保留论文来源和立场；Metric 是已完成且带时区的 Run 的仅追加证据；Feedback 仅供建议，不能改变 Claim 或结论。
- 所有内容由用户提供，不预装领域、论文、导师、数据集、指标或结论。
- 载荷受 Vault 保护，父操作具有明确同步依赖。AI 不得创建 Run、Metric、关闭 Feedback 或形成正式结论。
