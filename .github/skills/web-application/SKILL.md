---
name: web-application
description: "Guides the SuaraPutra administrative dashboard, including safe backend API integration, monitoring processing and delivery history, language-aware status views, settings, authentication boundaries, state handling, and UI error states. Use when implementing or reviewing dashboard features and frontend-to-backend integration."
---

# Web Application

## Scope and ownership

The dashboard is an administrative view over documented backend APIs. It does
not send WhatsApp messages directly, call Baileys, access the database
directly, or bypass server-side delivery and authorization controls.

The Web Developer owns dashboard code and coordinates contract gaps with the
backend Developer. Do not invent endpoints, response fields, permissions, or
state transitions when the API contract is missing or inconsistent.

## Core views and responsibilities

The dashboard may provide authorized views for:

- WhatsApp connection and service health;
- source-message processing and announcement decisions;
- translation validation and per-language status;
- delivery history, attempts, failures, and uncertain outcomes;
- operational settings explicitly exposed by the backend.

Support the canonical language identifiers and labels:

- `ms` — Malay
- `en` — English
- `zh-CN` — Simplified Chinese
- `ta` — Tamil

Display per-language delivery independently. A failed Tamil delivery must not
be presented as if all four destinations failed when the other destinations
succeeded.

## API integration workflow

1. Read the approved API contract and current phase acceptance criteria.
2. Identify authentication, authorization, pagination, filtering, and error
   semantics before writing client code.
3. Define typed client models for the documented response shapes.
4. Treat every response as untrusted and validate it at the client boundary.
5. Keep server state, loading state, empty state, stale state, and error state
   distinct.
6. Handle retries and refreshes without duplicating mutations.
7. Render only fields permitted by the endpoint's authorization contract.

If a required endpoint or field is absent, document the contract gap and stop
at the boundary rather than creating a guessed backend behavior.

## Safe rendering and input handling

Backend responses, model-generated translations, message text, URLs, names,
and error details are untrusted data. Render them using the framework's safe
default escaping and sanitization mechanisms. Never inject raw HTML or execute
content from announcements.

URLs should be displayed and linked only according to the approved UI policy.
Do not automatically fetch or preview arbitrary announcement URLs. Avoid
exposing private media, source content, auth state, API keys, or sensitive
operational details unnecessarily.

Validate dashboard input on the server even when the UI validates it first.
Do not allow settings forms to modify system prompts, destination JIDs,
authorization, or protected configuration unless an explicit privileged API
contract permits that operation.

## State and mutation behavior

- Use stable identifiers from the backend, not display names, as keys.
- Make pagination, filters, sorting, and refresh behavior deterministic.
- Show stale or partially loaded data honestly.
- Disable or guard duplicate submissions.
- Confirm destructive, replay, cancel, or publish-related actions according
  to the backend contract.
- Never infer `sent` from a successful HTTP request if the API reports an
  uncertain delivery outcome.
- Preserve server-side state transitions; the UI must not fabricate status.

## Error and accessibility expectations

Provide actionable errors without leaking stack traces, secrets, raw model
prompts, or private message payloads. Distinguish authentication failure,
authorization failure, validation error, unavailable service, and uncertain
operation outcome when the API provides those categories.

Every important state should be usable without color alone. Provide readable
labels, keyboard access, focus handling, meaningful loading indicators, and
accessible status text. Language labels should remain clear even when the
translated content itself is unavailable.

## Security boundaries

- Use the repository's approved authentication and session mechanism.
- Enforce authorization on the backend; client-side route guards are not
  security controls.
- Avoid storing tokens or sensitive response data in browser storage unless
  explicitly approved.
- Apply least privilege to dashboard operations.
- Do not expose WhatsApp session/auth files, private media paths, provider
  credentials, or raw operational logs.

## Verification

Test with synthetic API responses and failure fixtures:

- loading, empty, stale, unauthorized, unavailable, and malformed responses;
- all four languages and independent delivery outcomes;
- pagination, filtering, refresh, and duplicate mutation prevention;
- safe rendering of HTML-like text, URLs, quotes, and model output;
- settings validation and authorization failures;
- uncertain delivery display;
- keyboard and screen-reader-relevant interaction states.

Use the backend contract and integration tests as the authority for data
semantics; do not replace them with snapshots alone.

## References

- [Architecture](../../../docs/architecture.md)
- [Project plan](../../../docs/project-plan.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Backend architecture](../backend-architecture/SKILL.md)
- [Queue and reliability](../queue-and-reliability/SKILL.md)
- [Project context](../project-context/SKILL.md)
