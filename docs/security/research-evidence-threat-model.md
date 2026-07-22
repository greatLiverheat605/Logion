# Personal research evidence threat model

Status: L4-R1 protected offline/sync baseline

| Threat                                     | Control                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Owner reads member research                | REST, Pull, and Bootstrap filter authenticated `user_id`               |
| Cross-owner evidence link                  | Composite Workspace/Space/user foreign keys plus scoped parent lookup  |
| AI asserts a conclusion or metric          | No AI write path; runs and metrics require authenticated user actions  |
| Sensitive paper, method, or feedback leaks | Empty audit metadata and Vault-protected durable offline rows          |
| Child arrives before source                | Explicit Paper→Claim, Question→Run→Metric, Claim→Feedback dependencies |
| Hidden changes stall devices               | Pull filters personal rows while advancing the global cursor           |
