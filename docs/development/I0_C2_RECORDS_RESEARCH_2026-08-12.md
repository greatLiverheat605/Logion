# I0-C2 Records and Research Workbench

Date: 2026-08-12 (Asia/Shanghai)

Workspace: 正式 `v020-integration` 集成工作区

Branch: `codex/logion-redesign-i0`

Base reference: `e2b85987d816baf53a089007e674cd440e9ce64f`

## Delivered

- Added a shared `DeskSubviewNav` component with accessible active-route
  semantics and icon-labelled links.
- Added Knowledge Base navigation to Records: Sources/Records, Review/Graph,
  and Space management.
- Added Workbench navigation to Research: Self-study, Research, Exam, and
  Planning.
- Converted Records list entries into keyboard-accessible selectable rows.
- Records now presents the selected note or source index in a Reader panel;
  the previous editor is available through an explicit New Note action.
- Note Reader renders the existing Markdown preview and sync status.
- Source Reader renders the validated external URL (when safe) and indexed
  page metadata without copying source content into the product model.
- Added responsive, focus-visible, selected-state styling for the subview rail
  and Reader rows. The rail scrolls horizontally on narrow screens.

All existing `browserApiClient`, SessionBoundary, OfflineVault,
ProtectedOfflineRepository, and sync-v1 behavior remains unchanged. No API,
OpenAPI, database, migration, worker, permission, or production flag changes
were made.

## Verification

- `corepack pnpm --filter @logion/web lint`: passed.
- `corepack pnpm --filter @logion/web typecheck`: passed.
- `corepack pnpm --filter @logion/web test`: passed; 58 files / 435 tests.
- `corepack pnpm --filter @logion/web build`: passed; 36 routes generated.
- Prettier check for source, browser test, and this record: passed.
- `git diff --check`: passed.
- Final standalone Chromium public gate: 15 passed, including light/dark axe,
  keyboard reachability, 320px overflow, reduced-motion, theme bootstrap,
  manifest, and offline fallback.

## Pending acceptance

Authenticated Records/Research browser flows were not executed. The local
service at `127.0.0.1:8080` is currently the unrelated `sub2api` container;
the isolated fixture registration request returned HTTP 403. No account or
email was created. Authenticated selection, vault unlock, real source data,
and sync behavior must be rerun when the Logion API/Web stack is available on
the configured E2E endpoint or explicit test credentials are supplied.

No commit, push, merge, deploy, or production capability was performed.
