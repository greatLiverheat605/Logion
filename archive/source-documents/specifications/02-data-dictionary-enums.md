# 研途 Lab 数据字典与枚举

> 数据库：PostgreSQL  
> ORM：SQLAlchemy 2  
> 主键：UUIDv7（由客户端或服务端生成）  
> 时间：UTC `timestamptz`，客户端负责显示本地时区

---

## 1. 通用约定

### 1.1 命名

- 数据库表和字段使用 `snake_case`；
- API JSON 也使用 `snake_case`；
- 主键统一为 `id`；
- 外键使用 `<entity>_id`；
- 布尔字段使用 `is_`、`has_` 或明确动词；
- 密文使用 `_ciphertext` 后缀；
- 哈希使用 `_hash` 后缀；
- 业务状态使用受约束字符串枚举，不使用数据库原生 enum，以降低迁移成本。

### 1.2 同步实体通用字段

除纯事件表和关联表外，离线同步实体包含：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | PK | UUIDv7 |
| workspace_id | uuid | FK, not null | 所属工作区 |
| version | bigint | not null, default 1 | 乐观锁版本 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | nullable | 软删除/tombstone |
| origin_device_id | uuid | nullable | 最近变更来源设备 |

### 1.3 事件表通用字段

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 事件 ID |
| workspace_id | uuid | 工作区 |
| sequence | bigint | 工作区内单调序号 |
| event_type | varchar(80) | 事件类型 |
| actor_type | varchar(30) | user/device/system/ai |
| actor_id | uuid | 操作者 |
| device_id | uuid | 来源设备 |
| entity_type | varchar(50) | 目标实体类型 |
| entity_id | uuid | 目标实体 |
| payload | jsonb | 事件内容 |
| occurred_at | timestamptz | 发生时间 |

---

## 2. 核心枚举

### 2.1 计划状态 `plan_status`

```text
draft
active
paused
completed
archived
cancelled
```

### 2.2 阶段状态 `phase_status`

```text
planned
active
gate_pending
passed
completed
skipped
```

### 2.3 任务状态 `task_status`

```text
draft
scheduled
in_progress
viewed
practiced
submitted
verified
blocked
deferred
skipped
cancelled
```

### 2.4 任务类型 `task_type`

```text
reading
video
exercise
coding
math_derivation
quiz
paper_reading
experiment
project
review
writing
presentation
security_lab
other
```

### 2.5 优先级 `priority`

```text
low
normal
high
critical
```

### 2.6 掌握度 `mastery_level`

```text
0_unseen
1_viewed
2_explain
3_apply
4_transfer
```

### 2.7 资料类型 `resource_type`

```text
webpage
course
video
book
paper
official_doc
exercise
code_repository
pdf_index
local_file_index
dataset
other
```

### 2.8 资料角色 `resource_role`

```text
primary
remedial
practice
advanced
reference
```

### 2.9 学习会话事件 `session_event_type`

```text
started
paused
resumed
stopped
manual_adjustment
note_added
resource_opened
```

### 2.10 证据类型 `evidence_type`

```text
note
attachment
external_url
git_reference
quiz_attempt
experiment_run
recording_reference
manual_statement
```

### 2.11 验收状态 `verification_status`

```text
pending
passed
failed
needs_revision
waived
```

### 2.12 复习状态 `review_status`

```text
scheduled
due
in_progress
completed
skipped
cancelled
```

### 2.13 审查类型 `audit_review_type`

```text
daily
weekly
phase
monthly
quarterly
semester
custom
```

### 2.14 发现严重度 `finding_severity`

```text
info
warning
important
critical
```

### 2.15 论文状态 `paper_status`

```text
inbox
queued
skimming
reading
deep_read
summarized
reproducing
completed
archived
```

### 2.16 实验状态 `experiment_status`

```text
draft
planned
running
analyzing
completed
failed
cancelled
archived
```

### 2.17 AI Provider 类型 `ai_provider_type`

```text
openai_compatible
anthropic
ollama
vllm
custom
```

### 2.18 AI 运行状态 `ai_run_status`

```text
queued
running
succeeded
failed
cancelled
rejected_by_policy
```

### 2.19 AI 草稿状态 `ai_draft_status`

```text
pending
accepted
edited_and_accepted
rejected
expired
```

### 2.20 同步操作 `sync_operation_type`

```text
create
update
delete
restore
append_event
crdt_update
```

### 2.21 同步结果 `sync_result_status`

```text
applied
duplicate
conflict
rejected
retryable_error
permanent_error
```

### 2.22 冲突状态 `conflict_status`

```text
open
resolved_local
resolved_server
resolved_merged
dismissed
```

### 2.23 附件状态 `attachment_status`

```text
local_only
queued
uploading
uploaded
verified
failed
deleted
```

---

## 3. 身份与设备

### 3.1 `users`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | uuid | PK |
| email | citext | unique, not null |
| display_name | varchar(120) | not null |
| password_hash | text | 恢复密码哈希 |
| timezone | varchar(60) | 默认 Asia/Shanghai |
| locale | varchar(20) | 默认 zh-CN |
| is_active | boolean | default true |
| created_at | timestamptz | not null |
| updated_at | timestamptz | not null |

### 3.2 `workspaces`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| owner_user_id | uuid | FK users, unique |
| name | varchar(120) | 工作区名称 |
| settings | jsonb | 非敏感工作区设置 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 3.3 `devices`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users |
| name | varchar(120) | 用户可改设备名 |
| device_type | varchar(30) | desktop/mobile/tablet/browser |
| public_key | text | 可选设备公钥 |
| registered_at | timestamptz | |
| last_seen_at | timestamptz | |
| last_sync_at | timestamptz | |
| revoked_at | timestamptz | nullable |
| metadata | jsonb | 浏览器/平台摘要，不保存高敏指纹 |

### 3.4 `passkey_credentials`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users |
| credential_id | bytea | unique |
| public_key | bytea | WebAuthn 公钥 |
| sign_count | bigint | 防克隆计数 |
| transports | jsonb | transport 列表 |
| name | varchar(120) | 用户命名 |
| created_at | timestamptz | |
| last_used_at | timestamptz | |

### 3.5 `totp_credentials`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users, unique |
| secret_ciphertext | bytea | 加密 TOTP secret |
| verified_at | timestamptz | |
| created_at | timestamptz | |

### 3.6 `recovery_codes`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users |
| code_hash | text | unique per user |
| used_at | timestamptz | nullable |
| created_at | timestamptz | |

### 3.7 `refresh_tokens`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK |
| device_id | uuid | FK |
| token_hash | text | unique |
| family_id | uuid | 旋转 Token 家族 |
| expires_at | timestamptz | |
| revoked_at | timestamptz | nullable |
| replaced_by_id | uuid | nullable self FK |
| created_at | timestamptz | |

---

## 4. 学习计划与知识点

### 4.1 `learning_plans`

通用同步字段之外：

| 字段 | 类型 | 说明 |
|---|---|---|
| title | varchar(200) | |
| description_md | text | |
| status | varchar(30) | plan_status |
| start_date | date | nullable |
| end_date | date | nullable |
| daily_budget_minutes | integer | >= 0 |
| current_version_id | uuid | FK plan_versions |
| source_type | varchar(30) | manual/markdown/import/template |

### 4.2 `plan_versions`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| plan_id | uuid | FK |
| version_number | integer | plan 内 unique |
| parent_version_id | uuid | nullable self FK |
| snapshot | jsonb | 版本快照或规范化引用 |
| change_summary | text | |
| source | varchar(30) | manual/import/ai/restore |
| created_by_device_id | uuid | nullable |
| created_at | timestamptz | |

### 4.3 `phases`

| 字段 | 类型 | 说明 |
|---|---|---|
| plan_id | uuid | FK |
| title | varchar(200) | |
| description_md | text | |
| status | varchar(30) | phase_status |
| position | numeric(20,8) | 可重排顺序 |
| start_date | date | |
| end_date | date | |
| gate_policy | jsonb | 阶段门槛规则 |

### 4.4 `milestones`

| 字段 | 类型 | 说明 |
|---|---|---|
| phase_id | uuid | FK |
| title | varchar(200) | |
| description_md | text | |
| due_date | date | nullable |
| criteria | jsonb | 验收标准 |
| status | varchar(30) | planned/passed/failed/waived |
| passed_at | timestamptz | nullable |

### 4.5 `topics`

| 字段 | 类型 | 说明 |
|---|---|---|
| parent_topic_id | uuid | nullable self FK |
| title | varchar(200) | |
| description_md | text | |
| domain | varchar(80) | python/math/ml/recsys/security 等 |
| importance | varchar(20) | priority |
| is_active | boolean | |

### 4.6 `topic_dependencies`

| 字段 | 类型 | 说明 |
|---|---|---|
| workspace_id | uuid | FK |
| topic_id | uuid | FK |
| prerequisite_topic_id | uuid | FK |
| dependency_type | varchar(30) | required/recommended |
| strength | smallint | 1–5 |
| created_at | timestamptz | |

唯一约束：`(topic_id, prerequisite_topic_id)`；禁止自依赖和有向环。

### 4.7 `mastery_records`

| 字段 | 类型 | 说明 |
|---|---|---|
| topic_id | uuid | FK |
| level | varchar(30) | mastery_level |
| confidence | smallint | 0–100，主观信心，不等于掌握度 |
| reason_md | text | |
| evidence_id | uuid | nullable FK |
| source | varchar(30) | user/verification/import |
| effective_at | timestamptz | |

掌握度使用追加记录；当前状态由最新有效记录计算或物化。

---

## 5. 任务、会话与状态事件

### 5.1 `tasks`

| 字段 | 类型 | 说明 |
|---|---|---|
| plan_id | uuid | nullable FK |
| phase_id | uuid | nullable FK |
| parent_task_id | uuid | nullable self FK |
| title | varchar(240) | |
| description_md | text | |
| task_type | varchar(40) | task_type |
| status | varchar(30) | task_status 当前快照 |
| priority | varchar(20) | priority |
| scheduled_date | date | nullable |
| due_at | timestamptz | nullable |
| estimated_minutes | integer | >= 0 |
| position | numeric(20,8) | |
| completion_policy | jsonb | 证据和验收要求 |
| review_policy | jsonb | 复习策略 |
| deferral_count | integer | default 0 |
| verified_at | timestamptz | nullable |

### 5.2 `task_topic_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | uuid | FK |
| topic_id | uuid | FK |
| role | varchar(30) | primary/supporting/prerequisite |

### 5.3 `task_dependencies`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | uuid | FK |
| prerequisite_task_id | uuid | FK |
| is_blocking | boolean | |

### 5.4 `task_status_events`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | |
| task_id | uuid | FK |
| from_status | varchar(30) | nullable |
| to_status | varchar(30) | |
| reason_md | text | |
| actor_type | varchar(30) | |
| device_id | uuid | nullable |
| occurred_at | timestamptz | |

### 5.5 `study_sessions`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | uuid | nullable FK |
| status | varchar(20) | active/paused/completed/abandoned |
| started_at | timestamptz | |
| ended_at | timestamptz | nullable |
| effective_seconds | integer | 服务端重算/校验 |
| focus_score | smallint | 1–5 nullable |
| difficulty_score | smallint | 1–5 nullable |
| confidence_before | smallint | 0–100 nullable |
| confidence_after | smallint | 0–100 nullable |
| summary_md | text | |
| questions_md | text | |
| mistakes_md | text | |
| next_action_md | text | |

### 5.6 `session_events`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | |
| study_session_id | uuid | FK |
| event_type | varchar(30) | session_event_type |
| client_occurred_at | timestamptz | 离线时间 |
| server_received_at | timestamptz | nullable |
| duration_adjustment_seconds | integer | manual_adjustment 时使用 |
| metadata | jsonb | |
| device_id | uuid | |

---

## 6. 笔记、资料与附件

### 6.1 `notes`

| 字段 | 类型 | 说明 |
|---|---|---|
| title | varchar(240) | 元数据，使用版本冲突 |
| current_snapshot_md | text | 最近可读快照 |
| crdt_state | bytea | 压缩 CRDT 状态，可拆独立表 |
| is_sensitive | boolean | |
| last_compacted_at | timestamptz | |

### 6.2 `note_updates`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| note_id | uuid | FK |
| update_data | bytea | Yjs update |
| client_id | varchar(120) | CRDT client 标识 |
| client_clock | bigint | |
| device_id | uuid | |
| created_at | timestamptz | |

唯一约束建议：`(note_id, client_id, client_clock)`。

### 6.3 `note_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| note_id | uuid | FK |
| target_type | varchar(40) | task/topic/resource/paper/experiment/session |
| target_id | uuid | |
| relation | varchar(30) | note_for/mentions/evidence/supports |

### 6.4 `resources`

| 字段 | 类型 | 说明 |
|---|---|---|
| title | varchar(300) | |
| resource_type | varchar(40) | resource_type |
| canonical_url | text | nullable |
| author | text | nullable |
| publisher | text | nullable |
| published_at | date | nullable |
| language | varchar(20) | |
| difficulty | smallint | 1–5 nullable |
| estimated_minutes | integer | nullable |
| version_label | varchar(120) | |
| description_md | text | |
| personal_note_md | text | |
| availability_status | varchar(30) | unknown/available/broken/restricted/local_missing |
| last_health_check_at | timestamptz | nullable |

### 6.5 `resource_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| resource_id | uuid | FK |
| target_type | varchar(30) | task/topic/paper |
| target_id | uuid | |
| role | varchar(30) | resource_role |
| position | numeric(20,8) | |

### 6.6 `pdf_indexes`

| 字段 | 类型 | 说明 |
|---|---|---|
| resource_id | uuid | FK, unique |
| doi | varchar(255) | nullable |
| arxiv_id | varchar(80) | nullable |
| local_path_hint | text | nullable，不允许服务端直接读取 |
| file_sha256 | char(64) | nullable |
| page_count | integer | nullable |
| file_size_bytes | bigint | nullable |

### 6.7 `attachments`

| 字段 | 类型 | 说明 |
|---|---|---|
| filename | varchar(255) | 原始显示名 |
| storage_key | text | 服务端内部键 |
| media_type | varchar(160) | 服务端检测 |
| size_bytes | bigint | |
| sha256 | char(64) | |
| status | varchar(30) | attachment_status |
| uploaded_at | timestamptz | nullable |
| verified_at | timestamptz | nullable |
| is_sensitive | boolean | |

### 6.8 `evidence_items`

| 字段 | 类型 | 说明 |
|---|---|---|
| evidence_type | varchar(30) | evidence_type |
| title | varchar(240) | |
| description_md | text | |
| reference_type | varchar(40) | note/attachment/url/quiz/experiment 等 |
| reference_id | uuid | nullable |
| external_url | text | nullable |
| created_by | varchar(30) | user/system/ai |

### 6.9 `verification_records`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | uuid | FK |
| status | varchar(30) | verification_status |
| criteria_snapshot | jsonb | 当时验收标准 |
| rule_results | jsonb | 确定性检查 |
| self_assessment_md | text | |
| ai_suggestion_id | uuid | nullable |
| final_reason_md | text | |
| verified_at | timestamptz | nullable |

### 6.10 `verification_evidence_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| verification_id | uuid | FK |
| evidence_id | uuid | FK |

---

## 7. 复习、测验与审查

### 7.1 `review_schedules`

| 字段 | 类型 | 说明 |
|---|---|---|
| topic_id | uuid | FK |
| source_task_id | uuid | nullable |
| algorithm | varchar(40) | fixed_intervals/sm2_v1/custom |
| algorithm_version | varchar(30) | |
| due_at | timestamptz | |
| interval_days | numeric(10,2) | |
| ease_factor | numeric(6,3) | nullable |
| repetition_count | integer | |
| status | varchar(30) | review_status |

### 7.2 `quiz_items`

| 字段 | 类型 | 说明 |
|---|---|---|
| topic_id | uuid | nullable FK |
| question_type | varchar(30) | choice/short/code/calculation/self_assess |
| prompt_md | text | |
| answer_spec | jsonb | 答案/评分规范 |
| difficulty | smallint | 1–5 |
| source | varchar(30) | user/import/ai |
| ai_run_id | uuid | nullable |
| is_approved | boolean | AI 题经确认后 true |

### 7.3 `quiz_attempts`

| 字段 | 类型 | 说明 |
|---|---|---|
| quiz_item_id | uuid | FK |
| task_id | uuid | nullable |
| review_schedule_id | uuid | nullable |
| answer | jsonb | |
| score | numeric(6,3) | nullable |
| is_correct | boolean | nullable |
| confidence | smallint | 0–100 |
| duration_seconds | integer | |
| error_pattern_id | uuid | nullable |
| attempted_at | timestamptz | |

### 7.4 `error_patterns`

| 字段 | 类型 | 说明 |
|---|---|---|
| title | varchar(240) | |
| description_md | text | |
| category | varchar(80) | concept/calculation/code/reading/experiment |
| occurrence_count | integer | 物化值 |
| last_occurred_at | timestamptz | |
| status | varchar(30) | open/improving/resolved/recurring |

### 7.5 `audit_reviews`

| 字段 | 类型 | 说明 |
|---|---|---|
| review_type | varchar(30) | audit_review_type |
| period_start | date | |
| period_end | date | |
| status | varchar(30) | draft/completed/reopened |
| summary_md | text | |
| decisions_md | text | |
| completed_at | timestamptz | nullable |

### 7.6 `review_findings`

| 字段 | 类型 | 说明 |
|---|---|---|
| audit_review_id | uuid | nullable FK |
| rule_id | varchar(100) | |
| rule_version | varchar(30) | |
| severity | varchar(20) | finding_severity |
| title | varchar(240) | |
| evidence | jsonb | 触发依据 |
| suggested_action_md | text | |
| status | varchar(30) | open/accepted/dismissed/resolved |
| resolved_at | timestamptz | nullable |

---

## 8. 科研领域

### 8.1 `papers`

| 字段 | 类型 | 说明 |
|---|---|---|
| title | text | |
| authors | jsonb | 规范作者列表 |
| publication_year | integer | |
| venue | varchar(255) | |
| doi | varchar(255) | nullable |
| arxiv_id | varchar(80) | nullable |
| canonical_url | text | nullable |
| bibtex | text | nullable |
| status | varchar(30) | paper_status |
| abstract_md | text | |
| problem_md | text | |
| assumptions_md | text | |
| method_md | text | |
| formulas_md | text | |
| experiments_md | text | |
| conclusions_md | text | |
| limitations_md | text | |
| reproduction_status | varchar(30) | not_started/planned/running/partial/reproduced/failed |

### 8.2 `paper_relations`

| 字段 | 类型 | 说明 |
|---|---|---|
| source_paper_id | uuid | FK |
| target_paper_id | uuid | FK |
| relation_type | varchar(30) | cites/extends/contradicts/baseline/related |
| note_md | text | |

### 8.3 `research_questions`

| 字段 | 类型 | 说明 |
|---|---|---|
| title | varchar(300) | |
| current_statement_md | text | |
| status | varchar(30) | idea/investigating/active/paused/answered/rejected |
| priority | varchar(20) | |
| current_version_number | integer | |

### 8.4 `research_question_versions`

| 字段 | 类型 | 说明 |
|---|---|---|
| research_question_id | uuid | FK |
| version_number | integer | question 内 unique |
| statement_md | text | |
| rationale_md | text | |
| supporting_evidence_md | text | |
| opposing_evidence_md | text | |
| change_reason_md | text | |
| created_at | timestamptz | |

### 8.5 `experiments`

| 字段 | 类型 | 说明 |
|---|---|---|
| research_question_id | uuid | nullable FK |
| title | varchar(300) | |
| hypothesis_md | text | |
| design_md | text | |
| status | varchar(30) | experiment_status |
| reproducibility_status | varchar(30) | incomplete/checkable/reproducible/verified |

### 8.6 `experiment_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| experiment_id | uuid | FK |
| run_number | integer | experiment 内 unique |
| status | varchar(30) | queued/running/succeeded/failed/cancelled |
| dataset_version | varchar(255) | |
| code_reference | text | commit/tag/path |
| environment | jsonb | |
| configuration | jsonb | |
| random_seeds | jsonb | |
| started_at | timestamptz | |
| ended_at | timestamptz | nullable |
| conclusion_md | text | |
| failure_reason_md | text | |

### 8.7 `experiment_metrics`

| 字段 | 类型 | 说明 |
|---|---|---|
| experiment_run_id | uuid | FK |
| metric_name | varchar(120) | |
| split | varchar(30) | train/validation/test/other |
| step | bigint | nullable |
| value | double precision | |
| unit | varchar(40) | nullable |
| metadata | jsonb | |

---

## 9. AI 领域

### 9.1 `ai_providers`

| 字段 | 类型 | 说明 |
|---|---|---|
| name | varchar(120) | |
| provider_type | varchar(40) | ai_provider_type |
| base_url | text | |
| api_key_ciphertext | bytea | nullable，本地无鉴权服务可为空 |
| enabled | boolean | |
| timeout_seconds | integer | |
| max_retries | smallint | |
| organization_id_ciphertext | bytea | nullable |
| project_id_ciphertext | bytea | nullable |
| default_headers_ciphertext | bytea | nullable |
| tls_verify | boolean | default true |
| last_health_status | varchar(30) | unknown/healthy/degraded/failed |
| last_health_check_at | timestamptz | nullable |

### 9.2 `ai_models`

| 字段 | 类型 | 说明 |
|---|---|---|
| provider_id | uuid | FK |
| model_id | varchar(255) | Provider 中的 ID |
| display_name | varchar(255) | |
| enabled | boolean | |
| context_window | integer | nullable |
| supports_json | boolean | |
| supports_tools | boolean | |
| supports_vision | boolean | |
| supports_streaming | boolean | |
| input_price | numeric(18,8) | nullable |
| output_price | numeric(18,8) | nullable |
| custom_parameters | jsonb | |

唯一约束：`(provider_id, model_id)`。

### 9.3 `ai_task_routes`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_type | varchar(80) | weekly_review/paper_card 等 |
| primary_model_id | uuid | FK ai_models |
| fallback_model_ids | jsonb | 有序列表 |
| max_cost | numeric(18,8) | nullable |
| max_output_tokens | integer | nullable |
| allow_external | boolean | |
| allow_sensitive | boolean | default false |
| require_json | boolean | |
| parameters | jsonb | |

### 9.4 `ai_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| task_type | varchar(80) | |
| provider_id | uuid | FK |
| model_id | uuid | FK |
| route_id | uuid | nullable FK |
| prompt_version_id | uuid | nullable FK |
| status | varchar(30) | ai_run_status |
| input_scope | jsonb | 发送了哪些对象/字段 |
| request_hash | char(64) | |
| started_at | timestamptz | |
| ended_at | timestamptz | nullable |
| input_tokens | integer | nullable |
| output_tokens | integer | nullable |
| estimated_cost | numeric(18,8) | nullable |
| error_code | varchar(120) | nullable |
| error_message_redacted | text | nullable |

### 9.5 `ai_output_drafts`

| 字段 | 类型 | 说明 |
|---|---|---|
| ai_run_id | uuid | FK |
| target_type | varchar(40) | note/review/paper/task 等 |
| target_id | uuid | nullable |
| content | jsonb | 结构化草稿或 Markdown |
| status | varchar(30) | ai_draft_status |
| accepted_content | jsonb | nullable |
| decided_at | timestamptz | nullable |

---

## 10. 同步、冲突和审计

### 10.1 `processed_operations`

| 字段 | 类型 | 说明 |
|---|---|---|
| operation_id | uuid | PK，等同幂等键 |
| workspace_id | uuid | |
| device_id | uuid | |
| entity_type | varchar(50) | |
| entity_id | uuid | |
| operation_type | varchar(30) | sync_operation_type |
| request_hash | char(64) | |
| result_status | varchar(30) | sync_result_status |
| result | jsonb | |
| processed_at | timestamptz | |

### 10.2 `change_log`

| 字段 | 类型 | 说明 |
|---|---|---|
| sequence | bigint | PK/单调递增 |
| workspace_id | uuid | indexed |
| entity_type | varchar(50) | |
| entity_id | uuid | |
| operation_type | varchar(30) | |
| entity_version | bigint | |
| origin_device_id | uuid | nullable |
| changed_at | timestamptz | |

### 10.3 `sync_conflicts`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | |
| entity_type | varchar(50) | |
| entity_id | uuid | |
| base_version | bigint | |
| server_version | bigint | |
| local_payload | jsonb | |
| server_payload | jsonb | |
| auto_merge_payload | jsonb | nullable |
| status | varchar(30) | conflict_status |
| resolution | jsonb | nullable |
| created_at | timestamptz | |
| resolved_at | timestamptz | nullable |

### 10.4 `audit_events`

使用事件通用字段，额外包含：

| 字段 | 类型 | 说明 |
|---|---|---|
| action | varchar(100) | |
| old_value | jsonb | 敏感字段必须脱敏 |
| new_value | jsonb | 敏感字段必须脱敏 |
| reason | text | nullable |
| request_id | uuid | nullable |
| ip_prefix | inet | 可选，仅保存最小必要信息 |

---

## 11. 标签

### 11.1 `tags`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | |
| name | citext | workspace 内 unique |
| description | text | nullable |

### 11.2 `tag_links`

| 字段 | 类型 | 说明 |
|---|---|---|
| tag_id | uuid | FK |
| target_type | varchar(40) | |
| target_id | uuid | |

唯一约束：`(tag_id, target_type, target_id)`。

---

## 12. JSONB 使用原则

适合 JSONB：

- 规则快照；
- AI 模型能力；
- 实验配置；
- 环境信息；
- 作者列表；
- 不稳定的扩展字段。

不适合 JSONB：

- 需要频繁过滤、关联或唯一约束的核心字段；
- 任务状态、日期和外键；
- 金额、计数和版本；
- 需要严格数据完整性的身份字段。

JSONB 必须有 schema 校验层，不能成为任意数据垃圾箱。
