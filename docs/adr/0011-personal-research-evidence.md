# ADR 0011: Personal research evidence and experiment loop

Status: Accepted for Phase 4 L4-R1

- PaperRecord, ResearchClaim, ResearchQuestion, ExperimentRun, MetricRecord, and
  ResearchFeedback are personal even in shared Spaces.
- Claims retain their paper source and stance. Metrics are append-only evidence for a
  completed, timezone-aware run. Feedback is advisory and cannot alter a claim or conclusion.
- All content is user supplied; no domain, paper, supervisor, dataset, metric, or conclusion
  is installed by default.
- Payloads are Vault-protected and parent operations have explicit sync dependencies. AI
  cannot create runs, metrics, feedback closure, or formal conclusions.
