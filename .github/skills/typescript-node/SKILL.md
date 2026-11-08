---
name: typescript-node
description: "Guides TypeScript and Node.js work in this project, including module design, async control flow, runtime validation, error handling, configuration, dependency use, and testing. Use when implementing or reviewing TypeScript backend code, adapters, services, scripts, or APIs."
---

# TypeScript and Node.js

## Scope

Use this skill for implementation-level TypeScript and Node.js decisions. Keep
system boundaries, persistence rules, WhatsApp behavior, and API contracts in
their specialist skills or authoritative project documents.

## Before coding

1. Read the current phase and identify the exact acceptance criteria.
2. Inspect the repository structure, existing package manifests, compiler
   configuration, tests, and Git status.
3. Reuse established libraries, helpers, naming, formatting, and module
   boundaries. Do not introduce a dependency merely to avoid a small,
   well-understood helper.
4. Confirm the input and output contract before implementing a service.

Do not assume a framework, test runner, module system, or package script that
is not present in the repository. When the project is still being scaffolded,
record the chosen convention in the appropriate project documentation.

## Type and boundary rules

- Prefer explicit domain types for messages, announcements, facts, language
  outputs, jobs, and delivery outcomes.
- Use `unknown` at untrusted boundaries, then validate and narrow it.
- Keep provider SDK types at adapter boundaries; do not leak them through
  application services.
- Prefer discriminated unions for states and result variants.
- Keep language codes and destination mappings configuration-driven.
- Avoid `any`, unsafe assertions, and non-null assertions unless a validated
  invariant makes them necessary and the boundary is documented.
- Keep pure transformation and validation logic separate from I/O.

## Async and resource handling

- Use `async`/`await` for sequential workflows and make concurrency explicit.
- Do not use unbounded `Promise.all` for messages, model calls, media, or
  deliveries. Bound concurrency according to the current phase requirements.
- Preserve cancellation, timeout, and retry semantics at the owning boundary.
- Do not swallow rejected promises or convert failures into success-shaped
  defaults.
- Close database, file, network, and socket resources through the existing
  lifecycle abstraction.

## Validation and error handling

Validate external data at every boundary: configuration, HTTP input, WhatsApp
events, model responses, persisted records, and deserialized files.

Errors should:

1. Identify the operation and safe correlation identifiers.
2. Preserve the original cause where the project logging convention supports it.
3. Distinguish invalid input, transient failure, permanent failure, and
   uncertain outcome.
4. Be handled only where recovery or translation into the owning contract is
   intentional.
5. Avoid secrets, session data, private media, and full untrusted payloads in
   logs.

Never use a broad catch to hide a failure, silently skip malformed data, or
pretend an external operation succeeded.

## Configuration and dependencies

- Load configuration through one typed boundary.
- Fail clearly for missing required configuration; do not silently invent
  production defaults.
- Keep secrets in environment or approved secret storage and out of source,
  fixtures, logs, and reports.
- Pin and review dependency changes through the project workflow.
- Wrap external providers behind replaceable interfaces where the architecture
  requires it.

## Implementation workflow

1. Define or locate the domain contract.
2. Add the smallest typed implementation that satisfies it.
3. Add deterministic validation for malformed and boundary inputs.
4. Add or update focused tests for success, failure, and recovery behavior.
5. Run formatting, type checking, linting, and targeted tests using the
   repository's actual scripts.
6. Inspect the diff and report files changed and checks performed.

## Common mistakes

- Treating TypeScript compile-time types as runtime validation.
- Passing raw SDK objects into business logic.
- Starting unbounded asynchronous work for every incoming message.
- Logging complete WhatsApp messages, model prompts, tokens, or media.
- Returning `null`, empty arrays, or fabricated values to hide an error.
- Mixing transport, persistence, AI, and routing concerns in one function.
- Updating package configuration without checking all affected scripts.
