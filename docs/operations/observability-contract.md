# Aggregate observability contract

Logion rollout decisions consume aggregate operational windows, never learning content. A monitoring adapter may emit only the fields in `logion-rollout-samples-v1`: UTC observation time, request/error counts, p95 latency, boolean health, queue lag, and sync attempt/failure counts. Unknown fields fail closed.

The adapter must not include user IDs, email, IP address, workspace/object IDs, URLs with query strings, note/task/research text, attachment names, AI prompts or responses, tokens, cookies, credentials, recovery material, or raw exception payloads. Logs follow the same boundary and use request IDs only for bounded operational correlation.

## Required signals

- Web/API health and dependency readiness;
- request volume, server error rate and non-AI p95 latency;
- Worker queue depth/oldest-job lag and failed job class counts;
- sync attempts/failures, conflict volume and bootstrap-required counts;
- PostgreSQL connection/saturation, storage capacity and backup age;
- authentication abuse counters without credential or account values.

The versioned rollout policy in `config/release/rollout-policy.json` is the release gate. Provider dashboards may be stricter but cannot silently weaken it. Missing telemetry, insufficient duration/volume, unordered windows, an unknown schema, or candidate mismatch produces `hold` or rejection—not promotion.

## Alerts and retention

P0 alerts cover tenant isolation, data loss, secret exposure and unrecoverable backup. P1 alerts cover sustained health failure, error/latency threshold breach, queue saturation, sync regression and expired backup. Recipients, escalation timing, retention and data region must be configured in the selected cloud platform before Production. Alert payloads contain aggregate values and the immutable candidate identity only.
