---
name: database-management
description: "Guides SQLite database design and management for the SuaraPutra WhatsApp automation system, including migrations, repositories, transactions, constraints, indexes, persistence state, retention, recovery, and safe test data. Use when implementing or reviewing schemas, migrations, database clients, repositories, or durable processing state."
---

# Database Management

## Scope and initial direction

SQLite is the initial database for a local-first, single-instance,
low-volume deployment. Use migrations and transactions from the beginning.
Reconsider PostgreSQL only when measured concurrency, worker count, database
size, or operational requirements justify it.

Keep database records separate from domain contracts. Repositories map
validated persistence records to internal DTOs; application services should not
depend on raw SQLite rows or SQL-specific details.

## Persistence invariants

Persist enough state to resume safely after a restart:

- source message identity and normalized content metadata;
- announcement classification and processing state;
- links between announcements and one or more source messages;
- canonical facts and generated translations;
- per-language delivery jobs and outcomes;
- retry/lease timestamps and safe error details;
- prompt/model version metadata required for reproducibility;
- operational events needed for diagnosis.

Do not use in-memory arrays, timers, or process state as the only record of
pending work.

## Core entities

The approved design identifies these logical entities:

- `group_config`: trusted source/destination JIDs, role, language, Community,
  and enabled state;
- `source_messages`: chat/message identity, sender, timestamp, text or media
  reference, content hash, and quoted-message relation;
- `announcements`: classification, canonical facts, status, and timestamps;
- `announcement_sources`: many-to-many announcement/source-message links;
- `translations`: announcement, language, content, coverage strategy, and
  validation status;
- `delivery_jobs`: announcement, language, trusted target JID, state,
  attempts, idempotency key, outgoing ID, and timestamps;
- `glossary_terms`: approved language-specific vocabulary;
- `prompt_versions`: prompt identity, version, and content hash;
- `event_logs`: safe operational event type, level, related ID, and details.

The exact columns and types belong in migrations and the authoritative
architecture/database documentation. Do not copy an illustrative schema into
this skill and treat it as final.

## Migration workflow

1. Inspect the current migration and database-client conventions.
2. Create one focused, ordered migration for a schema change.
3. Make constraints and indexes explicit.
4. Ensure the migration is safe to run once and is recorded as applied.
5. Test applying it to an empty database and upgrading a representative
   existing database.
6. Add repository tests for valid, invalid, duplicate, and recovery cases.
7. Never edit an applied migration to change production history; add a new
   migration instead.

Migration failures must be visible and stop startup when the database cannot
be trusted. Do not silently recreate or delete the database.

## Constraints and idempotency

Enforce source deduplication with a unique constraint on
`(chat_jid, message_id)`. Use a stable announcement identity derived from
source-message IDs, with a content fingerprint only as a secondary similarity
signal.

Create one durable delivery idempotency key per announcement and destination.
Enforce its uniqueness. Store the target JID from trusted configuration and
never accept it from model output or untrusted dashboard input.

A duplicate insert should produce an explicit, distinguishable outcome so the
caller can safely treat an already-recorded event as a duplicate rather than
as an unexplained database failure.

## Transactions and state transitions

Use a transaction when creating or changing related records that must agree.
In particular, announcement creation, source links, translations, and
delivery jobs must not leave a partially committed workflow.

Persist a delivery job before attempting to send. Model states explicitly,
for example:

```text
pending -> sending -> sent
pending -> retry_wait -> sending
sending -> uncertain
sending -> failed_permanent
```

Do not reset `sent` jobs during restart recovery. Reclaim stale `sending` jobs
only with a lease/timeout policy that accounts for uncertain remote outcomes.
Never turn an uncertain send into a blind duplicate send.

## Repository and query rules

- Parameterize every value; never interpolate message text or dashboard input
  into SQL.
- Select the columns needed by the contract rather than leaking whole rows.
- Keep ordering and pagination deterministic.
- Bound queries that read source context or pending work.
- Use UTC timestamps for storage and convert only at presentation boundaries.
- Treat JSON columns as untrusted on read; validate before use.
- Keep secrets, auth-state paths, and private media out of database logs and
  ordinary operational records.

Repositories should expose intent-based methods such as “record source
message”, “claim pending delivery”, and “mark delivery sent”, rather than
letting callers assemble arbitrary SQL.

## Recovery, retention, and privacy

Persist source events before long-running AI calls. Store model errors
separately from transport and delivery errors. Reclaim stale work after
restart using explicit timestamps or leases, and bound retry counts.

Define retention for source text, context, translations, media references, and
logs before production. Delete or anonymize only through explicit, tested
retention procedures; do not silently discard records needed for delivery
reconciliation or audit.

Use separate development fixtures and synthetic data. Never commit production
messages, real group identifiers when sensitive, credentials, session keys,
private media, or API tokens.

## Testing and verification

Verify:

- clean migration from an empty database;
- upgrade from the previous schema;
- unique source-message and delivery-idempotency constraints;
- transaction rollback with no orphaned records;
- one failed language delivery not changing other destinations;
- restart recovery and stale-lease reclamation;
- uncertain-send preservation;
- UTC timestamp handling;
- retention behavior on synthetic data;
- repository parameterization and malformed JSON rejection.

Use a temporary database for tests and clean it up after execution. Do not run
destructive migration or retention tests against operational data.

## References

- [Architecture](../../../docs/architecture.md)
- [Project plan](../../../docs/project-plan.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Backend architecture](../backend-architecture/SKILL.md)
- [TypeScript and Node.js](../typescript-node/SKILL.md)
