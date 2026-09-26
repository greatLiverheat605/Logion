# ADR-0034: Encrypted Form Drafts

- Status: Accepted
- Date: 2026-09-26
- Scope: keep long, unsubmitted input of allowlisted forms across a reload, a full-page re-login or a Vault expiry
- Related: ADR-0002 (browser authentication and session boundary), ADR-0003 (offline sync), `packages/offline/src/vault.ts`
- Approval: the owner approved the proposed draft on 2026-09-26, including the initial allowlist and the 7-day expiry.

## Context

- The Vault locks 30 minutes after unlock and drops its in-memory key. An open form keeps its React state, so a re-unlock loses nothing.
- Input is lost when the page reloads, or when a session failure sends the user through "重新登录并返回". Only the pathname is restored.
- Long free-text fields suffer most. Short fields are cheap to retype.

## Decision

- **Allowlist of forms and fields.** Nothing else is drafted: search boxes, passwords, passphrases, TOTP codes and every authentication form are excluded.

  | Form                    | Kind                    | Drafted fields     |
  | ----------------------- | ----------------------- | ------------------ |
  | Planning "新建目标"     | `goal_create`           | 背景说明, 验收标准 |
  | Review "创建周期审查"   | `audit_review_summary`  | 总结草稿           |
  | Review "新建主动回忆题" | `quiz_item_explanation` | 解析               |
  | Research "建立声明"     | `research_claim`        | 研究声明           |

- **Storage and encryption**
  - A draft is sealed with `OfflineVault.seal()` (AES-GCM, additional data `workspaceId:recordId`) and stored as a regular Vault record.
  - The record ID is derived from the user, form kind, Workspace, Space and target, using a UUIDv5 hash rewritten to version 8 with the fixed first group `f0d4af75`.
    - Existing Vault records use UUID versions 4, 5 and 7, so drafts can be found and deleted without the key.
    - The ID reveals neither the form nor its content.
  - This replaces the dedicated `formDrafts` table in the proposal. A new table would bump the IndexedDB schema, and an older web build then refuses to open the upgraded database (`OFFLINE_SCHEMA_UPGRADE_REQUIRED`), which would lock users out of their local data after a rollback. Vault records need no schema change.
- **Key handling unchanged.**
  - Nothing is written or read while the Vault is locked. The key stays memory-only, and nothing extends the 30-minute lock.
  - Drafts written before a lock remain ciphertext until the next unlock.
- **Write cadence**
  - A draft is written about 2 seconds after typing stops, when the page becomes hidden, and when the form closes without submitting.
  - Clearing every drafted field removes the draft.
- **Restore**
  - When the same form opens for the same context after an unlock, the form shows "恢复未提交内容？" with 恢复 and 丢弃.
  - Drafts are never restored silently and never submitted automatically.
- **Deletion**
  - Successful submit and 丢弃 delete the draft.
  - Explicit logout deletes every draft in this user's database; this needs no key and never blocks logout.
  - Clearing local data (`wipeLocalData`) removes all Vault records.
  - Drafts older than 7 days are removed when a drafted form opens, and are never offered.
  - A draft for a Space or object the user can no longer open is never loaded, and expires unread.
- **No sync.** Drafts never enter the Outbox or reach the server. There is no feature flag: the behaviour is device-local and adds no server surface.

## Security cost

- **New data at rest**: ciphertext of text the user has not submitted, with the same protection as existing Vault records.
- **Shared devices**: logout clears drafts. Closing the browser without logging out leaves ciphertext, like existing encrypted notes.
- **Rejected**:
  - plaintext drafts in localStorage or sessionStorage;
  - persisting or wrapping the Vault key;
  - extending the Vault lifetime;
  - syncing drafts.

## Rollback

Revert the web build. Older builds never read draft records, and their "clear local data" still removes them. Draft records left behind stay ciphertext until the next wipe; the IndexedDB schema is unchanged.
