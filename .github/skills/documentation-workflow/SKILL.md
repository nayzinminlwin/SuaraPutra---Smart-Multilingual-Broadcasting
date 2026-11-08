---
name: documentation-workflow
description: "Guides project documentation for SuaraPutra, including phase development logs, QA reports, fix logs, decision records, operational notes, evidence, and completion criteria. Use when documenting implementation work, testing, incidents, fixes, or release readiness."
---

# Documentation Workflow

## Documentation ownership

Documentation records what was decided, what was implemented, what was
verified, and what remains unresolved. It must not become a competing source
of truth.

- The project plan defines what and when to implement.
- Architecture and API documents define approved system contracts.
- Skills define reusable procedures.
- Development logs record implementation activity and decisions.
- QA reports record independent verification and release evidence.
- Fix logs record defects, causes, changes, and retesting.
- The operations runbook records safe operational procedures.

Use the planned canonical locations under `docs/`. Do not create ad hoc root
documents when a structured document or approved template exists.

## Before documenting work

1. Confirm the authorized phase and acceptance criteria.
2. Inspect Git status and the complete relevant diff.
3. Identify the exact files, contracts, tests, and decisions affected.
4. Separate verified facts from assumptions, blockers, and future work.
5. Redact secrets, tokens, auth state, private media, real message contents,
   sensitive group identifiers, and unnecessary personal data.

## Development log

Create or update the phase development log before calling a phase complete.
Record:

- phase and objective;
- scope and acceptance criteria;
- changed files and ownership;
- implementation summary;
- decisions and rationale;
- tests, type checks, lint, build, and exact results;
- blockers, skipped checks, risks, and follow-up work;
- documentation paths;
- commit hash and status, when a commit is authorized.

Do not claim completion when required checks, documentation, or acceptance
criteria remain incomplete.

## QA report

The Tester owns independent QA reports. Include:

- build/commit under test and environment;
- test scope and coverage;
- commands actually executed;
- pass, fail, skipped, blocked, and flaky results;
- defects with severity, reproduction, expected/actual behavior, and evidence;
- limitations and remaining risks;
- release recommendation.

Never report a blocked or partial run as a pass. Do not copy production
payloads into reports.

## Fix log

For a QA-triggered fix, record:

1. defect identifier and severity;
2. affected phase and components;
3. reproducible symptoms and root cause;
4. minimal files changed;
5. behavior and contract impact;
6. verification and regression results;
7. remaining risk and commit reference.

The Tester independently retests the defect; the implementer does not close
the QA finding by assertion alone.

## Decision and operational records

Document consequential changes to architecture, dependencies, schemas, API
contracts, provider choices, privacy handling, thresholds, or retention in the
appropriate decision document. Record operational incidents and recovery
actions in the runbook or incident record without exposing sensitive data.

Prefer links to canonical documents over duplicated tables or copied schemas.
When a decision is provisional, label it provisional and record what evidence
is needed before finalization.

## Completion checklist

Before reporting a phase complete, verify:

- scope stayed within the authorized phase;
- all required files and contracts are documented;
- actual verification commands and results are recorded;
- failures and skipped checks are visible;
- QA ownership and independent retesting are respected;
- no secrets or operational data were added;
- the final diff and explicit commit scope were inspected.

## References

- [Project plan](../../../docs/project-plan.md)
- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Development log template](../../../docs/templates/dev_log_template.md)
- [Fix log template](../../../docs/templates/fix_log_template.md)
- [QA report template](../../../docs/templates/test_log_template.md)
- [Testing and QA](../testing-and-qa/SKILL.md)
- [Git scope and commits](../git-scope-and-commits/SKILL.md)
