# AI Provider credential threat model

Status: L5-001 configuration baseline; no outbound Provider calls yet

| Threat                                              | Control                                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key enters browser response or offline database | Create/update use write-only `SecretStr`; responses expose only a boolean; Provider types are absent from sync and Vault schemas                                |
| Database disclosure reveals API key                 | Per-record AES-256-GCM data key plus versioned KEK envelope encryption and Workspace/Provider AAD                                                               |
| Ciphertext copied to another Workspace/row          | AAD mismatch fails closed with `AI_PROVIDER_KEY_UNAVAILABLE`                                                                                                    |
| Owner of Workspace A guesses Provider B UUID        | Every query includes authenticated Workspace and `ai.configure`; cross-tenant IDs return not found                                                              |
| Editor/Reviewer/Viewer configures Provider          | Only Owner/Admin receive `ai.configure`; REST integration tests cover denial                                                                                    |
| CSRF changes a credential                           | Trusted Origin, double-submit CSRF, recent authentication and a dedicated authenticated rate limit protect every write                                          |
| URL targets loopback/private/metadata service       | Static validation requires public HTTPS and blocks non-global IP literals, local/internal suffixes, credentials, query/fragment, traversal and unapproved ports |
| DNS rebinding or redirect reaches private network   | No network call exists in L5-001; L5-002 must resolve and classify every address immediately before connecting and after every redirect                         |
| Secret leaks through audit/error/log                | Audit metadata is empty, validation returns stable generic errors, integration tests scan audit/response text, and CI secret scanning remains mandatory         |
| Deletion leaves decryptable secret                  | Soft deletion atomically nulls ciphertext, nonce, wrapped key and key ID while retaining minimal audited metadata                                               |
| AI outage blocks learning                           | Provider config is an optional server-only module; no planning, execution, memory, exam, self-study, research or collaboration path depends on it               |

Residual risk: a compromised application process with access to the active KEK can decrypt
configured credentials. Production deployment must restrict environment-secret access, rotate
keys, monitor decrypt operations when outbound calls are added, and keep keys separate from
database backups where infrastructure permits.
