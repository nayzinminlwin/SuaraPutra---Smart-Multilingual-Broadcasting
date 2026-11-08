---
name: git-scope-and-commits
description: "Guides safe Git work for the SuaraPutra project, including scope protection, status and diff inspection, explicit staging, Conventional Commits, phase commits, conflict handling, and secret prevention. Use when changing, reviewing, staging, or committing project files."
---

# Git Scope and Commits

## Protect the worktree

The repository may contain untracked files or changes from other work. Before
editing, run `git status --short` and inspect relevant diffs. Treat every
pre-existing change as protected.

Never:

- use `git reset --hard`, `git checkout --`, or another destructive restore
  without explicit approval;
- delete, move, rename, or overwrite unrelated files;
- use `git add .` or `git add -A`;
- stage secrets, auth state, private media, local databases, `.env`, real
  messages, or operational data;
- amend commits unless explicitly requested;
- rewrite shared history or bypass required review.

When an unexpected change conflicts with the requested work, stop and ask.
Otherwise integrate around it without reverting it.

## Scope workflow

1. Read the authorized phase and identify allowed files and ownership.
2. Inspect status, relevant source, tests, and contracts.
3. Make the smallest complete change for the requirement.
4. Run targeted verification and record actual results.
5. Inspect `git diff` and `git diff --check`.
6. Stage only explicit current-phase paths.
7. Review the staged diff with `git diff --cached`.
8. Commit only when the phase is verified and documented.

For this project, agent files belong under `.github/agents/`, skills under
`.github/skills/`, application code under `src/`, tests under `tests/`, and
canonical project documentation under `docs/`. Root Markdown files currently
serve as temporary working documents; do not move or edit them unless the user
explicitly authorizes it.

## Ownership and cross-boundary changes

The Developer owns backend and shared backend contracts. The Web Developer owns
dashboard code. The Tester owns independent QA evidence and reports. Do not
silently take over another agent's files or commit production fixes as QA
work.

If a contract must change, update the owning documentation and all affected
implementations/tests in one clearly scoped change, or stop and request a
decision when the change is consequential.

## Commit policy

Make one focused Conventional Commit per completed phase, after:

- implementation is complete for the authorized scope;
- required tests and checks have run;
- phase documentation is updated;
- the full diff has been reviewed;
- only current-phase files are staged.

Use a concise type and scope, for example:

```text
feat(ingestion): normalize source WhatsApp messages
fix(delivery): preserve uncertain send outcomes
test(ai): add multilingual evaluation fixtures
docs(phase-1): record backend foundation verification
```

Do not combine unrelated refactors, dependency upgrades, formatting churn, or
future-phase work into the phase commit.

## Staging and verification commands

Use explicit paths, for example:

```powershell
git add -- .github/skills/example/SKILL.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "docs(skills): add example workflow"
```

Before a commit, check for accidental secrets and operational data in the
staged diff. Verify the commit result with `git status --short` and the commit
summary. Do not claim a commit exists unless the command succeeded.

## Conflicts and blocked work

Do not resolve conflicts by deleting another contributor's changes. Preserve
both sides where possible, inspect the owning contract, and ask when the
correct behavior is not established. If verification fails or scope is
ambiguous, report the phase as incomplete and do not create a success-shaped
commit.

## References

- [Project plan](../../../docs/project-plan.md)
- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Documentation workflow](../documentation-workflow/SKILL.md)
- [Project context](../project-context/SKILL.md)
