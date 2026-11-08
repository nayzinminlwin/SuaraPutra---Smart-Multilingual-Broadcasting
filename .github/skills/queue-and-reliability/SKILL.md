---
name: queue-and-reliability
description: "Guides persistent delivery queues, job lifecycles, retries, backoff, idempotency, duplicate prevention, uncertain outcomes, restart recovery, leases, rate handling, kill switches, and operational health for the WhatsApp automation system. Use when implementing or reviewing processing and delivery reliability."
---

# Queue and Reliability

## Scope and ownership

The queue owns durable work state and recovery. It does not classify messages,
generate translations, select destination JIDs, or bypass the WhatsApp
adapter. Routing comes from trusted application configuration; each language
destination is an independent delivery job.

The initial direction is a database-backed queue for a single-instance
TypeScript/Node.js service. Do not introduce Redis, a broker, or multiple
workers without measured need and an approved architecture decision.

## End-to-end job lifecycle

1. Persist the source event before long-running AI work.
2. Persist the accepted announcement, validated translations, and one job per
   configured language destination in a transaction.
3. Store the trusted target JID, validated content, idempotency key, and
   attempt metadata before sending.
4. Claim one eligible job using an explicit lease or equivalent ownership
   mechanism.
5. Mark it `sending` before calling the WhatsApp adapter.
6. Record `sent` and the outgoing message ID only after confirmed success.
7. Record retryable failures as `retry_wait` with a future eligibility time.
8. Record permanent failures, cancellations, and uncertain outcomes
   explicitly.

Recommended states:

```text
pending -> sending -> sent
pending -> retry_wait -> sending
sending -> failed_permanent
sending -> uncertain
```

A failure in one language destination must not roll back successful deliveries
to other destinations.

## Idempotency and duplicate prevention

Use multiple protections:

- unique source-message identity `(chat_jid, message_id)`;
- stable announcement identity derived from source message IDs;
- content fingerprint only as a secondary similarity signal;
- unique delivery key per announcement and language destination;
- outgoing message ID recording when available;
- self-message filtering at the WhatsApp adapter.

Never use a content fingerprint alone to suppress work. Identical wording can
represent separate announcements. Never create a new job merely because a
previous send result was uncertain.

The model must never provide or modify a destination JID, retry policy,
idempotency key, or queue state.

## Claiming, leases, and restart recovery

Claims must be atomic so two workers or overlapping ticks cannot send the same
job simultaneously. Store a lease owner and expiry, or use the repository's
equivalent mechanism.

On startup and recovery:

1. Find stale claims using bounded timestamps.
2. Do not reset jobs already marked `sent`.
3. Requeue only jobs whose failure class and lease policy permit it.
4. Keep `uncertain` jobs held for reconciliation rather than blind retry.
5. Resume eligible pending and retry-wait jobs.
6. Emit safe operational events for reclaimed or held work.

Recovery must be deterministic and testable without a live WhatsApp account.

## Retry policy

Retry only errors that are plausibly transient, such as temporary network,
provider availability, or rate-limit responses. Do not retry invalid payloads,
unauthorized destinations, rejected credentials, policy restrictions, or
permanent validation failures.

Use bounded exponential backoff with jitter only where justified by the
approved policy. Cap attempts and total retry time. Persist the next eligible
time and the safe failure category; do not rely on in-memory timers.

An adapter timeout can mean the remote service accepted the message. Mark the
job `uncertain` when delivery cannot be determined. Reconcile through an
available delivery identity or operational procedure before retrying.

## Rate, ordering, and concurrency

Bound concurrent sends and respect provider responses. Do not add randomized
anti-detection behavior, account rotation, proxy rotation, or enforcement
evasion. If the account or integration is restricted, pause delivery.

Preserve the intended announcement reference and part numbering when a
message must be split. Avoid assuming that four language jobs must be sent
atomically or in a fixed order unless the current contract requires it.

## Safety controls and observability

Provide an application-controlled kill switch that stops new processing and
delivery without deleting durable state. Health and operational status should
expose safe counts and states such as:

- WhatsApp connection state;
- AI/provider failures;
- pending, retrying, failed, and uncertain jobs;
- oldest pending job age;
- last successful delivery;
- repeated recovery or lease failures.

Do not expose message contents, auth state, credentials, private media, or
provider tokens in ordinary logs or dashboard responses.

## Verification

Test with a temporary database and mock adapters:

- duplicate source events;
- concurrent claims;
- one failed destination with three successful destinations;
- retryable and permanent errors;
- rate limiting and bounded backoff;
- process termination during classification, generation, and sending;
- stale lease recovery;
- uncertain send outcomes;
- restart recovery without resending `sent` jobs;
- kill-switch behavior and safe health reporting.

## References

- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Project plan](../../../docs/project-plan.md)
- [Database management](../database-management/SKILL.md)
- [WhatsApp and Baileys](../whatsapp-baileys/SKILL.md)
