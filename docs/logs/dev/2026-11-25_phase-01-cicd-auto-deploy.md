# Development Log: CI/CD Auto-Deploy — Polling Script

**Date and time:** 2026-11-25 19:23 +08:00
**Agent:** AI assistant using Copilot SDK in VS Code
**Moderator:** Not specified
**Status:** Completed

## 1. Objective

Implement Step 1 of [the CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md) by adding the VM polling deploy script.

## 2. Scope and Acceptance Criteria

**Authorized phase:** CI/CD auto-deploy plan, Step 1
**Acceptance criteria:**

- Add `deploy/auto-deploy.sh` to fetch `master`, skip when already current, serialize concurrent runs, build the app, restart the service, and log deployment status.
- Preserve the existing running service until the new source has built successfully.

**Explicitly out of scope:**

- VM sudoers configuration, Git remote changes, cron installation, and end-to-end VM deployment.
- Changes to the existing untracked CI/CD plan and setup guide.

## 3. References

- [CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md)
- [CI/CD setup guide](../../cicd-setup-guide.md)
- [Service unit](../../deploy/suaraputra.service)
- [Development log template](../../templates/dev_log_template.md)

## 4. Changes Made

**Files created:**

- `deploy/auto-deploy.sh`
- `docs/logs/dev/2026-11-25_phase-01-cicd-auto-deploy.md`

**Files modified:** None

**Files deleted:** None

**Implementation summary:**

- Added a locked, log-backed polling script with a fast-forward-only pull, build, production dependency pruning, and service restart.
- Disabled TypeScript output on compilation errors so a failed compile does not overwrite the currently deployed build.
- The script installs build dependencies before building because TypeScript is a dev dependency in `package.json`.

## 5. Technical Decisions and Deviations

- **Decision:** Install dependencies including dev dependencies, build, then prune dev dependencies.
  **Rationale:** The plan's production-only install occurs before `npm run build`, but the repository declares the TypeScript compiler as a dev dependency. The planned order can therefore fail on a clean production install.
- **Deviation:** Use `git pull --ff-only`.
  **Rationale:** Avoid creating a merge commit or silently reconciling divergent local history on the VM.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| VM polling deploy script | Complete | Added and locally syntax/build checked. |

## 7. Verification

**Commands run:**

```text
bash -n deploy/auto-deploy.sh
npm run build -- --noEmitOnError
```

**Results:**

- **Passed:** `bash -n deploy/auto-deploy.sh`; `npm run build -- --noEmitOnError`.
- **Failed:** None.
- **Skipped / blocked:** VM deployment and runtime behavior were not exercised because no VM test environment was available. ShellCheck was unavailable.

## 8. Risks, Known Issues, and Follow-up

- The VM must have `flock`, `sudo`, Node.js/npm, the service unit, and a writable `/opt/suaraputra/data` directory.
- This step does not configure cron, sudoers, or deploy to a VM; those are later plan steps.
- **Tester focus:** Verify lock contention, no-change behavior, failed-command logging, and successful deployment using a non-production test environment.

## 9. Commit and Documentation

**Commit:** See the phase commit reported in the completion summary.
**Related documentation:** [CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md), [CI/CD setup guide](../../cicd-setup-guide.md)
