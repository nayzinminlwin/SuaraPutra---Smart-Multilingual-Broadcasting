File naming convention: `YYYY-MM-DD_<Phase>_<FeatureOrBug>_QA.md`

# QA Report: [Phase Number / Name] — [Feature or Module]

**Date:** YYYY-MM-DD
**Tester:** [Tester agent / model]
**Environment:** [OS, runtime, database, and relevant configuration]
**Build or commit under test:** `[commit hash or working tree]`
**Status:** [Passed / Failed / Conditionally Passed]

## 1. Scope

**Task or implementation tested:** [Brief description]

**Requirements tested:**

- [Requirement or behavior]
- [Requirement or behavior]

**References:**

- [Project plan section or document](../project-plan.md)
- [Development log](../development-logs/path-to-log.md)
- [Relevant specification or decision document]

**Out of scope:**

- [Item, if applicable]

## 2. Test Results

| ID | Test / Scenario | Expected Result | Status | Evidence / Notes |
|---|---|---|---|---|
| T-01 | [Scenario] | [Expected behavior] | [PASS / FAIL / BLOCKED] | [Evidence] |
| T-02 | [Scenario] | [Expected behavior] | [PASS / FAIL / BLOCKED] | [Evidence] |

## 3. Automated Testing

**Commands run:**

```text
[Command or test suite]
```

**Results:**

- **Passed:** [Count and summary]
- **Failed:** [Count and summary]
- **Skipped / blocked:** [Count and reason]
- **Coverage:** [If available]

## 4. Issues Found

### [BUG-01] [Short Title]

- **Severity:** [Critical / High / Medium / Low]
- **Category:** [Functional / Data / Integration / Reliability / Security / Localization / Dashboard / Other]
- **Location:** `[File, component, or feature]`

**Expected:**

[Expected behavior]

**Actual:**

[Actual behavior]

**Steps to reproduce:**

1. [Step]
2. [Step]
3. [Step]

**Evidence:**

[Error, failed test, sanitized log excerpt, or screenshot reference. Do not include secrets or operational data.]

## 5. Final Assessment

**Status:** [PASSED / FAILED / CONDITIONALLY PASSED]

**Summary:**

[Concise outcome supported by the test results.]

**Required action:**

[None / Fix listed issues and return for retesting]

**Remaining risks and limitations:**

- [Risk or limitation, or None]

---

# Retest History

## Retest — YYYY-MM-DD

**Build or commit under test:** `[commit hash or working tree]`
**Status:** [PASSED / FAILED / CONDITIONALLY PASSED]

**Issues retested:**

- [BUG-01] — [Resolved / Still failing]
- [BUG-02] — [Resolved / Still failing]

**New issues:**

- [None or issue references]

**Commands and evidence:** [Summary]

**Notes:**

[Brief retest summary]
