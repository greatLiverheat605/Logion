# Attachment upload threat model

Scope: first-release direct upload for small screenshots, PDF/text/CSV/JSON experiment results and
their offline queue. The filesystem adapter is behind the attachment service boundary and may later
be replaced by private object storage without changing authorization or verification semantics.

## Invariants

- `init -> content -> complete` is required. Only `verified` content can be downloaded.
- Every request is scoped by authenticated user, Workspace and Space. Upload/complete are restricted
  to the user who initiated the record; readers still require live access to the target Space and
  target object.
- Client filename is metadata only. Storage paths contain generated keys/UUIDs and never use the
  filename.
- The configured default is 20 MB per file and 500 MB reserved bytes per user. Streaming stops at
  the declared size; unknown fields, unsupported MIME/extension pairs and invalid hashes fail closed.
- `complete` independently recomputes byte count, SHA-256 and an allowlisted content signature. It is
  idempotent only after the exact record is verified; an ID replay with changed metadata is rejected.
- Responses and audit metadata exclude staging/storage keys, file names, hashes and body content.
  Downloads use `private, no-store`, `nosniff`, binary media type and an encoded attachment filename.

## Abuse cases and controls

| Threat                                     | Control                                                                                                                                    | Evidence                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Cross-tenant ID/key guessing               | Workspace/Space/creator predicates and opaque 404; storage keys never enter API responses                                                  | Integration test uses the same attachment UUID across two Workspaces and attempts foreign upload |
| Path traversal or header injection         | Filename rejects separators/control bytes; generated storage path is allowlist-validated; download uses RFC 5987 percent encoding          | Schema and storage unit tests                                                                    |
| MIME spoofing/polyglot delivery            | Extension and declared MIME must agree; complete sniffs PNG/JPEG/WebP/PDF or validates UTF-8/JSON; download is never inline                | Unit and integration tests include a PDF declared as PNG                                         |
| Oversized/chunked body or quota exhaustion | Stream is bounded by declared size and configured maximum; reserved-byte quota includes pending/failed records; dedicated write rate limit | Storage unit test and API policy                                                                 |
| Partial/replayed upload                    | Temporary file is atomically replaced; complete locks the row and checks version; verified complete replay returns the same version        | Integration and offline queue tests                                                              |
| DB commit failure after file promotion     | Finalization copies atomically while retaining staging; post-commit cleanup is retryable through complete replay                           | Storage/service implementation                                                                   |
| Offline retry leaks errors/content         | IndexedDB stores the bounded Blob and hash; transport error details are normalized to stable codes                                         | Offline queue test                                                                               |
| Backup restores file without metadata      | RC fixture binds an actual verified attachment row to the restored file and compares DB/file SHA-256                                       | `scripts/release/rc_recovery.sh`                                                                 |
| Account deletion leaves personal files     | Deletion enumerates the user's attachment storage keys before deleting attachment rows/user data                                           | Account deletion service                                                                         |

## Residual risk

The filesystem adapter is a single-server implementation, not off-host disaster recovery or a cloud
object-store durability claim. Antivirus/CDR is not provided; allowlisted files are downloaded as
attachments and are never rendered or executed by the API. Production object storage, malware policy,
retention and off-host restore remain operator/human release decisions.
