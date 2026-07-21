# Note and resource sync adapter

Status: L3-003B implementation baseline

- `note` and `resource` support idempotent create and version-aware full-projection update operations.
- Zero-base offline updates require a processed causal predecessor for the same Workspace, device,
  entity type and entity ID; otherwise they are rejected.
- Stale updates return an explicit content conflict. The remote payload is encrypted into the local
  vault before the conflict row is committed.
- Pull and Bootstrap include only objects in visible Shared Spaces or Private Spaces owned by the
  current user. Hidden sequence gaps advance the cursor without exposing content.
- Note and resource payloads are protected types: entity, Outbox, Bootstrap and conflict tables hold
  only `encrypted_payload_ref`; plaintext exists transiently in the unlocked vault boundary.
- The Records UI renders Markdown inside a React text node (`pre`), never as HTML. External links
  open with `noopener`/`noreferrer`; the server stores but does not fetch them.
- PDF support remains metadata and page indexes only. No PDF body, extracted full text or attachment
  is stored by this slice.
