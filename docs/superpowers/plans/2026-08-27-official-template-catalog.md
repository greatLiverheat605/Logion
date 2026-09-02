# Official Template Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Add a real, global authenticated catalog containing the official `每日工作台 · 7 天执行循环` and `研究项目 · 问题到证据` templates, while preserving tenant isolation, permissions, immutable versions, and independent installation.

**Architecture:** Extend `TemplatePackage` with an `official` visibility scope. Official rows are global (`workspace_id` and `created_by` nullable), seeded idempotently with fixed UUIDs and immutable object graphs. The existing authenticated Workspace catalog query returns official rows plus the caller's authorized tenant rows; the existing installation service accepts either source and always writes a new goal/plan/phase graph into a permission-checked target Space. The existing Templates Workbench adds official filtering, source labeling, and official-specific action availability without introducing a new shell or mock store.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, PostgreSQL JSONB, Pydantic v2, OpenAPI TypeScript generation, Next 16 / React 19, existing Radix adapters, Vitest, pytest, Playwright and Axe.

---

## File Map

- Modify `apps/api/src/logion_api/growth/models.py`: make package ownership nullable for official rows and extend the database check semantics in the ORM model.
- Modify `apps/api/src/logion_api/growth/schemas.py`: expose nullable `workspace_id` and `official` visibility only on responses; keep user write payloads tenant-scoped.
- Create `apps/api/migrations/versions/0036_official_template_catalog.py`: alter constraints/columns and insert the two deterministic official packages idempotently.
- Modify `apps/api/src/logion_api/growth/service.py`: merge official rows into catalog reads, authorize official installation, and reject tenant mutation paths targeting official rows.
- Modify `apps/api/tests/test_growth_template.py` and `apps/api/tests/test_growth_integration.py`: contract, migration, isolation, permission, install and immutability coverage.
- Modify generated `packages/contracts/openapi/openapi.json` and `packages/contracts/src/openapi.d.ts`: reflect the response schema and visibility union.
- Modify `apps/web/src/features/growth/use-templates-controller.ts`: type/filter official rows and derive capability restrictions without changing request payloads.
- Modify `apps/web/src/features/growth/templates-workbench.tsx` and `templates-workbench.module.css`: official filter/source marker/read-only action presentation and install summary.
- Modify `apps/web/src/features/growth/templates-workbench.test.tsx` and `use-templates-controller.test.ts`: render and controller contracts.
- Modify `tests/browser/templates-workbench.spec.ts`: real official catalog and installation workflow across roles and viewports.
- Update `reports/ui-refactor/templates-conformance.md` and `.codex/plans/current/2026-08-26_logion-glm-design-conformance-remediation/sub-012_templates-glm-conformance.md` after verification.

## Task 1: Lock the API and database contract with failing tests

**Files:**

- Test: `apps/api/tests/test_growth_template.py`
- Test: `apps/api/tests/test_growth_integration.py`
- Create: `apps/api/migrations/versions/0036_official_template_catalog.py`
- Modify: `apps/api/src/logion_api/growth/models.py`
- Modify: `apps/api/src/logion_api/growth/schemas.py`

- [ ] **Step 1: Add schema tests for official response rows and tenant write rejection.**

  Add tests with these assertions:

  ```python
  def test_official_response_allows_global_scope() -> None:
      payload = {
          "id": uuid4(), "workspace_id": None, "template_key": uuid4(),
          "version_number": 1, "name": "官方", "description": "",
          "schema_version": 1, "product_min_version": "0.1.0",
          "author_name": "Logion", "license": "CC-BY-4.0", "locale": "zh-CN",
          "target_personas": ["execution"], "changelog": "初版",
          "content_hash": "a" * 64, "risk_metadata": {}, "object_graph": {},
          "visibility": "official", "status": "active",
          "created_at": datetime.now(UTC),
      }
      assert TemplatePackageResponse.model_validate(payload).workspace_id is None

  def test_user_create_payload_rejects_official_visibility() -> None:
      with pytest.raises(ValidationError):
          TemplateFromGoalCreate.model_validate({**valid_create_payload(), "visibility": "official"})
  ```

- [ ] **Step 2: Run the focused tests and confirm they fail for the missing `official` union/nullability.**

  Run: `uv run --package logion-api pytest apps/api/tests/test_growth_template.py -q`

  Expected: FAIL with Pydantic validation errors for `workspace_id=None` or `visibility="official"`.

- [ ] **Step 3: Update the ORM and response schema.**

  Change only the ownership/visibility declarations:

  ```python
  workspace_id: Mapped[UUID | None] = mapped_column(
      Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
  )
  created_by: Mapped[UUID | None] = mapped_column(
      Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
  )
  ```

  Keep `TemplateFromGoalCreate.visibility` as `Literal["private", "workspace"]`; update only `TemplatePackageResponse.workspace_id` to `UUID | None` and its visibility union to `Literal["private", "workspace", "official"]`.

- [ ] **Step 4: Create the Alembic migration with explicit constraints and deterministic seed values.**

  The migration must:

  - Drop `ck_template_visibility` and recreate it as `visibility IN ('private','workspace','official')`.
  - Alter `template_packages.workspace_id` and `created_by` to nullable.
  - Add a check named `ck_template_scope_ownership` enforcing `(visibility = 'official' AND workspace_id IS NULL AND created_by IS NULL) OR (visibility IN ('private','workspace') AND workspace_id IS NOT NULL AND created_by IS NOT NULL)`.
  - Insert exactly two active version `1` rows with fixed UUIDs and JSON graphs containing contiguous phases/tasks, `target_day_offset`, `risk_metadata.source_scope = 'official_catalog'`, and no Workspace/user identifiers.
  - Use `INSERT ... ON CONFLICT (id) DO NOTHING` plus a post-insert content hash assertion so rerunning the migration cannot mutate an existing official row.
  - Downgrade by deleting only rows with the two fixed IDs, dropping the scope check, restoring non-null columns only after verifying no official rows remain, and restoring the original visibility check.

- [ ] **Step 5: Run migration and schema tests.**

  Run: `uv run --package logion-api pytest apps/api/tests/test_growth_template.py -q`

  Expected: PASS, including the new response/nullability and write rejection tests.

- [ ] **Step 6: Commit the contract and migration.**

  ```bash
  git add apps/api/src/logion_api/growth/models.py apps/api/src/logion_api/growth/schemas.py apps/api/migrations/versions/0036_official_template_catalog.py apps/api/tests/test_growth_template.py
  git commit -m "feat: add official template catalog schema"
  ```

## Task 2: Make official packages globally readable and installable through the real service

**Files:**

- Test: `apps/api/tests/test_growth_integration.py`
- Modify: `apps/api/src/logion_api/growth/service.py`

- [ ] **Step 1: Add failing integration tests for cross-Workspace listing and role behavior.**

  Cover two real Workspaces and these assertions:

  ```python
  first = (await owner_a.get(f"/api/v1/workspaces/{workspace_a}/templates")).json()["templates"]
  second = (await owner_b.get(f"/api/v1/workspaces/{workspace_b}/templates")).json()["templates"]
  assert {row["visibility"] for row in first} >= {"official"}
  assert {row["visibility"] for row in second} >= {"official"}
  assert not any(row["workspace_id"] == str(workspace_b) for row in first)
  assert (await viewer_a.post(install_url, headers=csrf, json=install_payload)).status_code == 403
  assert (await editor_a.post(install_url, headers=csrf, json=install_payload)).status_code == 201
  ```

  Also assert a private tenant template is absent from the other Workspace and that official rows are returned even when no tenant template exists.

- [ ] **Step 2: Run the focused integration test and confirm it fails because the service filters by `workspace_id`.**

  Run: `uv run --package logion-api pytest apps/api/tests/test_growth_integration.py -k official -q`

  Expected: FAIL with an empty official catalog or `404 Template` during install.

- [ ] **Step 3: Update `list_templates` with the authenticated union query.**

  Keep Workspace resolution first, then change the filter to:

  ```python
  .where(
      or_(
          TemplatePackage.visibility == "official",
          and_(
              TemplatePackage.workspace_id == workspace_id,
              or_(
                  TemplatePackage.visibility == "workspace",
                  TemplatePackage.created_by == context.user.id,
              ),
          ),
      )
  )
  ```

  Order official rows before tenant rows, then by `template_key` and descending version. Keep the 500-row cap.

- [ ] **Step 4: Update `install_template` to accept an active official row while retaining target Space authorization.**

  Keep `_authorize_template_write` as the first operation. Fetch the template by ID with:

  ```python
  or_(
      TemplatePackage.visibility == "official",
      and_(
          TemplatePackage.workspace_id == workspace_id,
          or_(
              TemplatePackage.visibility == "workspace",
              TemplatePackage.created_by == context.user.id,
          ),
      ),
  )
  ```

  Do not relax `status == "active"`. Preserve the existing object-ID generation, relative-date validation, `template_content_hash`, audit metadata and transaction behavior.

- [ ] **Step 5: Guard tenant mutation paths and add audit metadata.**

  Assert `create_template` and `import_template` only create `private`/`workspace` rows. In `create_share`, reject any source that resolves to an official template if a template ID is ever supplied by a future caller; current share payloads remain goal-based. Include `source_scope="official_catalog"` and the content hash in the install audit event.

- [ ] **Step 6: Run the focused API integration suite.**

  Run: `uv run --package logion-api pytest apps/api/tests/test_growth_integration.py -k "official or template" -q`

  Expected: PASS for official visibility, tenant isolation, Viewer/Reviewer denial, Editor installation, required start date, independent object IDs and unchanged private/workspace behavior.

- [ ] **Step 7: Commit the service and API tests.**

  ```bash
  git add apps/api/src/logion_api/growth/service.py apps/api/tests/test_growth_integration.py
  git commit -m "feat: expose and install official templates"
  ```

## Task 3: Regenerate contracts and update the Templates controller/view

**Files:**

- Modify: `packages/contracts/openapi/openapi.json`
- Modify: `packages/contracts/src/openapi.d.ts`
- Test: `apps/web/src/features/growth/use-templates-controller.test.ts`
- Test: `apps/web/src/features/growth/templates-workbench.test.tsx`
- Modify: `apps/web/src/features/growth/use-templates-controller.ts`
- Modify: `apps/web/src/features/growth/templates-workbench.tsx`
- Modify: `apps/web/src/features/growth/templates-workbench.module.css`

- [ ] **Step 1: Add failing controller/view tests for official filtering and action restrictions.**

  Assert that the controller exposes `official` scope and that a selected official template derives `canCreate=false`, `canShare=false`, `canRevoke=false` while preserving `canInstall` for a writable online context. Render tests must assert `Logion 官方`, `官方模板`, `安装独立副本`, and the absence/disabled state of tenant mutation actions.

- [ ] **Step 2: Run the focused web tests and confirm they fail before the union/type changes.**

  Run: `pnpm --filter @logion/web test -- --run src/features/growth/use-templates-controller.test.ts src/features/growth/templates-workbench.test.tsx`

  Expected: FAIL because `TemplateScope` has no `official` member and the current view treats every selected row as tenant-owned.

- [ ] **Step 3: Update controller types and capability derivation.**

  Change:

  ```ts
  export type TemplateScope = "all" | "official" | "private" | "workspace";
  ```

  Add `selectedTemplateIsOfficial = selectedTemplate?.visibility === "official"` to the derived context or compute it in the view. Keep `canInstall` based on role/online/context; derive `canCreate`, `canShare`, and `canRevoke` as false when official is selected. Do not alter any request payload builder for tenant operations.

- [ ] **Step 4: Add the official filter and source presentation.**

  Add an `官方` segment in Category Master, show a `Logion 官方` marker on official rows, and show source/version/license/risk details in Detail Main. Keep the existing selected row and filtered fallback behavior so switching scope cannot leave a stale selection.

- [ ] **Step 5: Make the official action surface read-only except install.**

  For official selection, keep the header primary as `安装独立副本`; hide or disable create/share/revoke controls with an accessible explanation. The Install Sheet must show phase/object count, target Space, required start date, and “不会覆盖现有内容”. Tenant templates retain their existing controls.

- [ ] **Step 6: Run focused web tests and typecheck.**

  Run: `pnpm --filter @logion/web test -- --run src/features/growth/use-templates-controller.test.ts src/features/growth/templates-workbench.test.tsx` and `pnpm --filter @logion/web typecheck`

  Expected: PASS with exactly one visible primary for both official and tenant selections.

- [ ] **Step 7: Regenerate and verify OpenAPI contracts.**

  Run: `pnpm contracts:generate` then `pnpm contracts:check`

  Expected: generated files contain nullable `workspace_id` and `visibility` union including `official`, with no unrelated contract drift.

- [ ] **Step 8: Commit web and generated contract changes.**

  ```bash
  git add apps/web/src/features/growth/use-templates-controller.ts apps/web/src/features/growth/templates-workbench.tsx apps/web/src/features/growth/templates-workbench.module.css apps/web/src/features/growth/use-templates-controller.test.ts apps/web/src/features/growth/templates-workbench.test.tsx packages/contracts/openapi/openapi.json packages/contracts/src/openapi.d.ts
  git commit -m "feat: present official templates in workbench"
  ```

## Task 4: Verify the real catalog and close evidence

**Files:**

- Test: `tests/browser/templates-workbench.spec.ts`
- Modify: `reports/ui-refactor/templates-conformance.md`
- Modify: `.codex/plans/current/2026-08-26_logion-glm-design-conformance-remediation/sub-012_templates-glm-conformance.md`

- [ ] **Step 1: Extend the real browser flow for official templates.**

  Before creating any tenant goal/template, assert two official rows are visible after login. Select each official row, verify source/action restrictions, install each into the real writable Space with a start date, and assert the resulting goals have IDs distinct from any template graph IDs. Keep the existing tenant create/import/share/revoke flow in the same test.

- [ ] **Step 2: Add role and isolation coverage using real API sessions.**

  Add API-backed checks for a Viewer/Reviewer session: official rows are readable, install returns the existing 403 error, and no tenant mutation action is enabled. Check a second Workspace sees the same two official IDs while not seeing the first Workspace’s private template.

- [ ] **Step 3: Run the full verification matrix.**

  Run:

  ```bash
  pnpm --filter @logion/web test -- --run
  pnpm --filter @logion/web typecheck
  pnpm --filter @logion/web lint
  uv run --package logion-api pytest apps/api/tests/test_growth_template.py apps/api/tests/test_growth_integration.py -q
  uv run --group dev ruff check apps/api/src apps/api/tests
  pnpm --filter @logion/web build
  pnpm exec playwright test tests/browser/templates-workbench.spec.ts --project=authenticated-chromium
  ```

  Expected: all focused and existing tests pass; Playwright reports one passing real-flow test with official catalog, tenant flows, 320/390/1024/1440, Axe, keyboard/focus, reduced-motion, overflow, unique primary and zero runtime console problems.

- [ ] **Step 4: Rebuild the no-mount Web image and record runtime evidence.**

  Rebuild/restart `logion-web:dev` and the reverse proxy without source mounts. Record Git SHA, Web/API image IDs and CreatedAt, container StartedAt, mounts and `/healthz=200` in the conformance report. Do not write test credentials.

- [ ] **Step 5: Update the conformance and sub-plan records.**

  Add the official catalog to Function Reachability, Before/Target/After evidence, deviations, and the real-flow sequence in `reports/ui-refactor/templates-conformance.md`. Update sub-012 with task results and leave its final status as “技术验收完成，等待 Product Owner 独立验收” until the explicit PO response.

- [ ] **Step 6: Commit verification evidence only after tests are green.**

  ```bash
  git add tests/browser/templates-workbench.spec.ts reports/ui-refactor/templates-conformance.md .codex/plans/current/2026-08-26_logion-glm-design-conformance-remediation/sub-012_templates-glm-conformance.md
  git commit -m "test: verify official template catalog"
  ```

## Final Acceptance Gate

- [ ] Two official templates are visible in every authenticated Workspace without tenant duplication.
- [ ] Official sources are immutable and cannot be created, edited, shared, revoked, or deleted through tenant paths.
- [ ] Installation requires a writable target Space and preserves independent object IDs/content hash.
- [ ] Existing private/workspace template behavior and permissions are unchanged.
- [ ] Contracts, API tests, Web tests, build, lint and real browser matrix pass.
- [ ] Product Owner completes the real Templates walk-through and replies `Templates 独立验收通过` before the parent plan proceeds to Step 10.
