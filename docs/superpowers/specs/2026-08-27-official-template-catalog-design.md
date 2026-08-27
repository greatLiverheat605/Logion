# Global Official Template Catalog Design

## Status

- Date: `2026-08-27`
- Product Owner direction: global official catalog (`A`)
- Initial catalog: two templates (`C`)
- Initial templates: `每日工作台 · 7 天执行循环` and `研究项目 · 问题到证据`
- Approved design direction: extend the existing template package model; no new UI framework or mock data path

## Problem

The Templates workbench currently lists only templates owned by or shared into the current Workspace. A new account therefore starts with an empty catalog and cannot discover a trustworthy starting point. The product needs a small official catalog visible in every Workspace while preserving Workspace/Space isolation, role permissions, immutable template versions, and independent installation.

## Goals

- Make the two official templates visible in every authenticated Workspace.
- Keep official source versions read-only and globally identical.
- Install an official template into the currently selected writable Space as a new independent goal/plan/phase graph.
- Keep private and Workspace templates isolated exactly as they are today.
- Make the official source, version, license, risk metadata and install target explicit in the existing Templates workbench.
- Preserve real API, audit, CSRF, recent-authentication, capability and sync semantics.

## Non-goals

- No public anonymous template endpoint.
- No user editing, sharing, revoking, or publishing of official source versions.
- No template marketplace, ratings, remote connector, or user-uploaded official content.
- No copy of GLM fixtures, hash routing, or mock stores into production code.

## Decision

Use the existing `TemplatePackage` as the single package and version model. Extend its catalog scope with `visibility = "official"`.

Official rows have `workspace_id = NULL` and `created_by = NULL`, fixed canonical UUIDs, immutable `template_key`/`version_number`, and content hashes checked into the migration seed. Private and Workspace rows keep their existing non-null Workspace and creator fields. The database check constraint must enforce these combinations so an official row cannot accidentally become a tenant-owned row or vice versa.

The response schema changes `workspace_id` to nullable and allows the `official` visibility value. Existing write payloads remain limited to `private` and `workspace`; users cannot create an official row through the normal API.

### Read and install flow

`GET /api/v1/workspaces/{workspace_id}/templates` returns:

```text
official templates
+ templates visible in the requested Workspace
```

The service still resolves the requested Workspace before returning rows. Official rows are only readable through this authenticated Workspace-scoped catalog call; they are not copied to tenant storage during listing.

`POST /api/v1/workspaces/{workspace_id}/template-installations` accepts an official `template_id` in addition to an authorized tenant template. It verifies the official row is active, validates the target Space through the existing Workspace/Space permission path, then creates new object IDs for the installed graph. The installation records the official content hash, so a later official version cannot mutate an earlier installation.

Create-from-goal and import paths reject `official` as an input scope. Share creation and revocation continue to operate only on tenant-owned goal snapshots; the UI must not offer those actions for an official source.

## Canonical seed content

The initial migration inserts two active version `1` rows idempotently. Seed data is deterministic and contains no account, Workspace, Space, or user IDs.

### `每日工作台 · 7 天执行循环`

- Persona: `self-study`, `execution`
- License: `CC-BY-4.0`
- Graph: capture inbox → weekly goal → daily execution → evidence/review
- Relative date: enabled, with a required install start date
- Acceptance: one executable next action and one evidence checkpoint per phase

### `研究项目 · 问题到证据`

- Persona: `research`, `self-study`
- License: `CC-BY-4.0`
- Graph: research question → source review → claim/evidence → experiment → synthesis
- Relative date: enabled, with a required install start date
- Acceptance: each phase has a verifiable artifact or decision record

The seed migration must use a stable content hash and `ON CONFLICT`/equivalent idempotency guard. A future official revision appends `version_number = 2` under the same `template_key`; it never updates version `1` in place.

## UI and interaction

The existing `Category Master / Template Detail Main / Template Inspector` structure remains the page-specific layout. The change is in catalog semantics and action availability, not a new generic page shell.

- Category Master adds an `官方` scope filter and an unmistakable `Logion 官方` source marker.
- Detail Main shows `官方模板`, canonical version, license, risk metadata, changelog, and “installed copies are independent” language.
- The single visual primary for an official selection is `安装独立副本`.
- Create, import, share, and revoke actions remain discoverable for eligible tenant templates but are hidden or disabled with an explanation for official selections.
- Install Sheet shows the current Workspace/Space, the required start date, the phase/object count, and the fact that no existing goal will be overwritten.
- Viewer/Reviewer, offline, missing Space, and stale/error states keep the official row visible while exposing the precise recovery action or required capability.
- After success, the installed copy and its new object IDs are visible in the Inspector; the official row remains selected and unchanged.

## Permissions and security

- Listing official rows requires an authenticated, resolved Workspace context.
- Installing still requires the existing template-install permission and a writable target Space; Viewer and Reviewer cannot install.
- Official rows cannot be edited, imported over, shared, revoked, or deleted by tenant users.
- CSRF, trusted-origin, recent-authentication, rate limiting and request IDs remain on all write paths.
- No official content is copied into private Spaces until the user explicitly confirms installation.
- Audit events identify the official template ID/content hash and target Space without storing secrets.

## Data flow

```text
Session → Workspace resolve → catalog query (official + tenant-visible)
       → select official row → permission/capability check
       → Install Sheet (target Space + relative date)
       → template install service → new goal/plan/phase IDs
       → installation record(content hash) → controller reload
```

## Testing and acceptance

### API and contract tests

- Official rows are returned for two different Workspaces and are not duplicated into either Workspace.
- Private and Workspace rows remain isolated by the existing visibility rules.
- Official install succeeds for an Editor/Owner writable Space and fails with the existing permission error for Viewer/Reviewer.
- Official install requires a start date when the graph contains relative dates.
- Create/import cannot submit `official`; official rows cannot be shared or revoked.
- Re-running the seed migration is idempotent; version `1` content hash is unchanged.
- OpenAPI and generated TypeScript contracts agree on nullable `workspace_id` and `official` visibility.

### Browser and UI tests

- Real Session: official rows appear immediately in a fresh Workspace.
- Install both official templates into a real Space and verify new object IDs and independent copies.
- Verify official selection has exactly one primary and no tenant mutation actions.
- Verify tenant templates retain create/import/share/revoke paths.
- Run 320/390/1024/1440 overflow, GLM geometry, Axe, keyboard/focus, reduced-motion and runtime-console checks.
- Verify offline, locked, permission, conflict, error and stale recovery states without hiding the official catalog.

## Rollout and rollback

1. Apply the additive schema/seed migration before deploying the API that accepts `official` rows.
2. Deploy API and generated contracts, then the web controller/view update.
3. Verify the catalog and installation flow against a non-owner account and a writable account.
4. Roll back the web/API code only if needed; keep the additive official rows because they are inert under the previous query. Removing the migration requires a separate approved data rollback and is not part of routine deployment.

## Open decisions resolved

- Catalog scope: global authenticated catalog.
- Initial size: two templates.
- Initial content: Daily Workbench + Research Project.
- Headless UI: reuse existing Radix adapters; no dependency change.
