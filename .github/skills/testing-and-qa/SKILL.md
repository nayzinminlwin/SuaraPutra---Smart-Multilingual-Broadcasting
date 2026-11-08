---
name: testing-and-qa
description: "Guides independent testing and QA for the SuaraPutra WhatsApp automation system, including unit, integration, regression, negative-path, fixture, model-evaluation, persistence, delivery, dashboard, and release-readiness testing. Use when planning or executing verification and reporting defects."
---

# Testing and QA

## Independence and scope

QA verifies the current authorized phase against its acceptance criteria. The
Tester owns evidence, defect reports, regression verification, and release
readiness—not production implementation. Do not close a defect based only on
the Developer's claim that it was fixed.

Read the phase plan, architecture, API contracts, relevant skills, existing
tests, and Git status before testing. Identify pre-existing changes and do not
overwrite them.

## Test layers

Use the smallest layer that proves the requirement, then expand when results
justify it:

- **Unit:** pure normalization, validation, classification decisions,
  protected-value checks, retry calculations, and state transitions.
- **Integration:** repositories, migrations, queue claims, adapter contracts,
  API handlers, and service boundaries with controlled dependencies.
- **End-to-end/proof of concept:** only when the authorized phase permits a
  real or dedicated test account and controlled WhatsApp groups.
- **Evaluation:** labeled multilingual fixtures for classification and
  translation quality.
- **Regression:** previously fixed defects and neighboring behavior after
  changes.

Prefer deterministic mocks and synthetic data when a real WhatsApp session,
model provider, or external service is not required.

## Required coverage

Cover success, invalid input, failure, timeout, restart, duplicate, and
uncertain-outcome paths where applicable. Verify:

- source-group scope and self-message loop prevention;
- normalized text, caption, metadata, and source-message identity;
- mixed-language context and bounded multi-message assembly;
- announcement, non-announcement, and uncertain classification;
- complete `ms`, `en`, `zh-CN`, and `ta` outputs;
- protected dates, times, names, amounts, links, identifiers, and facts;
- malformed or prompt-injection model output;
- source-message and delivery idempotency;
- independent per-language delivery outcomes;
- retry classification, bounded backoff, leases, and uncertain sends;
- migration, transaction rollback, restart recovery, and retention;
- dashboard authorization, safe rendering, and API error states.

Critical factual errors, accidental broadcasts, duplicate publications, secret
exposure, and unsafe recovery behavior are release-blocking until resolved or
explicitly accepted by project stakeholders.

## Fixtures and privacy

Keep fixtures minimal, synthetic, and representative. Include mixed-language
announcements, ordinary conversation, partial coverage, conflicting facts,
long messages, malformed schemas, duplicate events, provider failures, and
safe HTML-like payloads.

Never place real WhatsApp messages, private media, session/auth files, API
keys, production databases, or sensitive group identifiers in Git or test
reports. Keep evaluation data separate from operational data and redact
identifiers in failure output.

## Execution workflow

1. Define the requirement and observable expected result.
2. Select the narrowest test layer and fixture.
3. Execute the actual repository command; do not infer results.
4. Record command, environment assumptions, pass/fail, skipped checks, and
   limitations.
5. Investigate failures to a reproducible cause without silently changing
   production code.
6. Report defects with severity, evidence, reproduction steps, expected and
   actual behavior, and affected scope.
7. After a fix, independently retest the defect and relevant regression set.
8. Inspect the final diff and update the approved QA report.

Do not report a blocked, skipped, flaky, or partial run as a pass.

## Model and translation evaluation

Maintain a labeled evaluation set for:

- announcement precision and recall;
- short contextual announcements;
- facts distributed across languages or messages;
- language completeness and naturalness;
- protected-value preservation;
- unsupported-fact rate;
- uncertainty and conflict handling;
- latency and provider cost where relevant.

Evaluate the complete pipeline, not only isolated translation quality.
Thresholds must come from measured evidence and approved release criteria.

## Operational and live verification

For live WhatsApp proof-of-concept checks, use a dedicated account and
controlled groups only after the plan authorizes it. Verify membership,
receiving, sending, reconnecting, credential persistence, group/JID routing,
and kill-switch behavior. Stop immediately if policy, account, privacy, or
credential safety is uncertain.

## Reporting

QA reports should include scope, build/commit under test, environment,
commands, coverage, results, defects, severity, reproduction steps, skipped
checks, limitations, and release recommendation. Keep reports factual and
avoid sensitive payloads.

## References

- [Project plan](../../../docs/project-plan.md)
- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [QA report template](../../../docs/templates/test_log_template.md)
- [Fix log template](../../../docs/templates/fix_log_template.md)
- [Backend architecture](../backend-architecture/SKILL.md)
- [Queue and reliability](../queue-and-reliability/SKILL.md)
- [Database management](../database-management/SKILL.md)
- [WhatsApp and Baileys](../whatsapp-baileys/SKILL.md)
