# ADR 0010: Personal self-study inbox-to-deliverable loop

Status: Accepted for Phase 4 L4-S1

## Decision

- LearningTrack, StudyProject, InboxItem, and Deliverable are personal records even in a
  shared Space. Workspace roles do not grant access to another user's records.
- All titles, objectives, outcomes, notes, and evidence come from user input. Empty accounts
  contain no predefined course, profession, schedule, or subject.
- InboxItem is independent capture. StudyProject belongs to one same-owner LearningTrack.
  Deliverable is append-only completion evidence under one same-owner StudyProject and
  requires a timezone-aware completion instant.
- All four payloads are Vault-protected offline entities. Parent operations are explicit
  sync dependencies. AI cannot create a completed Deliverable or alter formal evidence.

## Compatibility and recovery

Migration and sync entity types are additive. After production records exist, prefer a
forward fix or feature disablement over dropping personal learning history.
