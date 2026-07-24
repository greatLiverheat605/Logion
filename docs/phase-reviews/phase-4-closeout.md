# Phase 4 阶段验收记录

- 评审日期：2026-07-22
- 基线：`LOGION_EXECUTION_PLAN.md`、`LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`
- 最终审计候选：`4f3441f38f441927b8ae95185f813f42e1a01b22`
- PR 证据：<https://github.com/greatLiverheat605/Logion/actions/runs/29914593939>
- Main 证据：<https://github.com/greatLiverheat605/Logion/actions/runs/29914757200>
- 最终 PR：<https://github.com/greatLiverheat605/Logion/pull/108>
- Phase Issue：<https://github.com/greatLiverheat605/Logion/issues/85>
- 结论：PR Fast/Integration 和 Main 候选成功，可进入一次 Phase 4 人工批准；无已知 P0/P1

## 交付链

| 工作包                | Main commit / PR                             | 结果                                                                |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| L4-001 Mastery/Review | `c73f130`/#87, `26d9db6`/#90                 | 个人确认、复习排程、受保护离线载荷和安全同步                        |
| L4-002 测评/审查      | `afc02ae`/#92, `1c143c5`/#94                 | Quiz/Attempt/ErrorPattern、仅追加 AuditReview/Finding 和离线闭环    |
| L4-E1/E2/E3 备考      | `720be98`/#96, `7f6af30`/#98, `2272d78`/#100 | Exam→Subject→Syllabus、MockExam→ScoreRecord、倒计时和离线同步       |
| L4-S1 自学            | `ea30427`/#102                               | Inbox→LearningTrack→StudyProject→Deliverable，仅追加完成证据        |
| L4-R1 研究            | `a9d2c49`/#104                               | Paper→Claim、Question→ExperimentRun→Metric、Claim→Feedback          |
| L4-G1 协作            | `6364d43`/#106                               | Shared Space 中 Rubric→ReviewRequest→Feedback→不可变 ReportSnapshot |
| L4-FINAL 安全         | `70ff3f9`–`24a3d26`/#108                     | 跨场景 ID 猜测、跨 Workspace、Private/Shared、Bootstrap 披露审计    |

标题、学科、考试、课程、论文、问题、实验、导师、小组、量规、日程和报告均来自用户输入。Profile mode 只选择能力/导航，不安装或永久绑定上下文。

## 四场景 E2E

| 场景          | 在线/离线证据                                                                                                      | 隐私/权限证据                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Exam          | `test_exam_integration.py` 覆盖 Exam/Subject/SyllabusNode/MockExam/ScoreRecord 的 REST、Bootstrap、Push/Pull、重放 | 他人不能 list/bootstrap 个人 Exam/Score；同 ID/CSRF 失败关闭                 |
| Self-study    | `test_self_study_integration.py` 覆盖 Track/Project/Inbox/Deliverable 及因果依赖                                   | 即使 Shared Space 也按个人隔离；审计排除 objective/outcome/evidence          |
| Research      | `test_research_integration.py` 覆盖 Paper/Claim/Question/Run/Metric/Feedback                                       | 成员间隔离；审计无 paper/method/feedback 正文                                |
| Collaboration | `test_collaboration_integration.py` 覆盖按角色 REST/Sync                                                           | Owner/Editor 写结构、Reviewer 追加、Viewer 只读、Private 拒绝、Report 不可变 |

`test_phase4_security_integration.py` 在一个 Shared Workspace 中让 Viewer 猜测受害者 UUID 并重试同步创建；所有写入均被拒绝，响应不含 Exam、Track、Objective、Paper 或 Rubric criteria。同时验证跨 Workspace/Private Space 隐藏、个人 Bootstrap 排除及明确共享 Rubric 可见性。

## 退出条件

| 必需不变量                   | 结果                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| 四条独立 E2E                 | PostgreSQL Integration CI 通过                                 |
| Workspace A/B + user A/B     | 猜测 ID、外部 Workspace、成员隔离通过                          |
| Private/Shared 边界          | 个人数据 owner-only；协作必须 Shared；外部 Private ID 返回 404 |
| Owner/Admin 不读他人个人场景 | 每套测试均通过，role 不覆盖 `user_id`                          |
| Viewer 只读共享协作          | REST/Push/Bootstrap 角色矩阵通过                               |
| Report 不聚合私人记录        | 只接收有界 summary，无个人领域 import，仅 create/read          |
| 离线明文矩阵                 | 32 类实体通过；持久 entity/Outbox 只含 Vault ref               |
| 动态上下文                   | `pnpm guard:context` 通过，无写死教师/公司                     |
| migration 0017–0022          | 空库升级、drift、完整往返、旧版本种子升级通过                  |
| AI 可选且仅草稿              | Phase 4 无 AI 正式写注册，正式写均为认证人工操作               |

## 质量与安全证据

最终 PR 和 Main pipeline 均通过：Fast 包含 Ruff、Python format/type、Prettier、ESLint、TS strict、unit、contract drift、secret/supply-chain、affected build 和 context guard；Integration 包含 Compose、production Web image、PostgreSQL/Redis、迁移往返及 **37 个集成测试**；本地还有 **157 个 Python**、12 contract、**44 offline（93.29% statements）**、**20 Web**、Next production build，`pnpm audit` 为零 advisory。最终候选没有新增运行依赖。

阶段末 `security-review` 验证严格 schema、Origin/CSRF/限速、Workspace/Space/`user_id` 父查询、REST/Sync 相同授权、Shared-only Collaboration Pull/Bootstrap、审计正文排除、不可变历史证据/Report，以及 AI、前端角色提示和 Profile 标签均不构成服务端授权。详细矩阵见 `docs/security/phase4-four-scenario-security-audit.md`。

## 兼容、回滚与残余风险

- migration 0015–0022 为增量；无生产数据时可 CI 往返，有数据后只能前向修复或禁用，不能丢学习历史。
- `sync-v1` 只增量增加类型并沿用 Vault ref，不需 IndexedDB schema bump。
- Shared Space 成员被撤销后可能保留已同步副本，服务端无法远程擦除失控设备。
- 物理 Safari/iOS、容量/性能、人工 WCAG、公开 ShareSnapshot 和灾备留给 Phase 5/6。
- Phase 4 批准不授权 Production 或公开稳定版。

## 人工批准清单

1. PR #108 已合并且 Main 证据仍成功可用。
2. 四类用户创建的闭环及个人/共享边界符合预期。
3. 离线残留、Safari/PWA 和后续门禁可作为 Phase 5/6 工作。
4. AI Provider、公开分享、导入导出、备份与发布加固仍按后续阶段执行。
5. 不授权 Production。
