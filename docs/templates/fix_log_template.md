Save in: `docs/logs/fixes/`

File naming convention: `YYYY-MM-DD_FIX_<Phase>_<Module>_<ShortDescription>.md`

# Fix Log: [Phase Number / Name] — [Module or Defect]

**Date and time:** YYYY-MM-DD HH:MM
**Agent:** [Agent name / model]
**Moderator:** [Name]
**Status:** [Completed / Work in Progress / Blocked]
**Fix type:** [Bug Fix / Refactor / Architectural Correction]

## 1. Trigger

- **QA report:** `[../test/phase-0X-...-test.md]`
- **Defect ID:** [BUG-XX]
- **Severity:** [Critical / High / Medium / Low]
- **Error summary:** _One-line description of the reported behavior._

## 2. Affected Scope

**Phase:** [Phase number / name]
**Components:** [Components or modules]
**Contract impact:** [None / describe the changed contract]

## 3. Reproduction

**Expected behavior:**

[What should happen]

**Actual behavior:**

[What happened]

**Steps to reproduce:**

1. [Step]
2. [Step]
3. [Step]

## 4. Root Cause

_Explain the technical cause of the defect or why the refactor was necessary._

## 5. Changes Made

- [Change and how it resolves the root cause]
- [Related regression prevention, if applicable]

**Files modified:**

- `[path/to/file]`

**Files created:** [None or list]

**Files deleted:** [None or list]

## 6. Verification Before Retest

**Commands run:**

```text
[Command]
```

**Results:**

- **Passed:** [Checks and results]
- **Failed:** [Failures, or None]
- **Skipped / blocked:** [Checks not run and why, or None]

## 7. Ready for Independent Retest

- [ ] Yes — Tester should append the retest to `[../test/phase-0X-...-test.md]`.
- [ ] No — Reason: [Explain the remaining blocker.]

**Remaining risk:** [None or describe]

## 8. Commit and Follow-up

**Commit:** `[commit hash or Not committed]`
**Related documentation:** [Paths or links]

---

## Appended Follow-up Fixes

_Append additional corrections for this defect here. Do not create a new log for the same defect unless the scope changes._

### Follow-up Fix — YYYY-MM-DD

**Status:** [Completed / Blocked]
**Additional changes:** [Describe the correction]
**Verification:** [Command and result]
**Commit:** `[commit hash or Not committed]`
