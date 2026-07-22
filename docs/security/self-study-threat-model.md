# Personal self-study threat model

Status: L4-S1 protected offline/sync baseline

| Threat                                   | Control                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Owner reads a member's plans or evidence | REST, Pull, and Bootstrap filter authenticated `user_id`                        |
| Cross-owner project or deliverable link  | Composite owner/Workspace/Space foreign keys and scoped parent resolution       |
| Child sync precedes parent               | Outbox dependencies order Track→Project→Deliverable and make failures explicit  |
| Sensitive text reaches audit logs        | Audit metadata is empty; objectives, notes, outcomes, and evidence are excluded |
| IndexedDB exposes private content        | Vault references replace plaintext in durable entity, Outbox, and conflict rows |
| CSRF or cross-origin creation            | Trusted-origin, double-submit CSRF, user rate limits, and strict schemas        |
| AI forges completion evidence            | No AI write route exists; Deliverable creation is an authenticated user action  |
| Hidden personal changes stall a device   | Pull omits the record while advancing the global cursor                         |
