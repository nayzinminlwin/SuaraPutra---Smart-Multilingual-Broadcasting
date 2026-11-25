# Development Log: CI/CD Auto-Deploy — VM Setup

**Date and time:** 2026-11-25 19:50 +08:00
**Agent:** AI assistant using Copilot SDK in VS Code
**Moderator:** Not specified
**Status:** Completed

## 1. Objective

Complete the VM-side Git remote and cron setup for [the CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md).

## 2. Scope and Acceptance Criteria

**Authorized phase:** CI/CD auto-deploy plan, Steps 3 and 4, including the prerequisite limited restart permission.
**Acceptance criteria:**

- Confirm the VM's origin remote uses HTTPS.
- Permit `suaraputra` to restart only the `suaraputra` systemd service.
- Install and enable cron with the two-minute polling entry.
- Verify the merged deploy script runs on the VM and the service remains active.

**Explicitly out of scope:**

- Dependency upgrades or remediation of npm audit findings.
- Optional deploy notifications, rollback, health checks, and log rotation.

## 3. References

- [CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md)
- [CI/CD setup guide](../../cicd-setup-guide.md)
- [Operations runbook](../../operations-runbook.md)
- [Step 1 development log](./2026-11-25_phase-01-cicd-auto-deploy.md)

## 4. Changes Made

**Files created:**

- `docs/logs/dev/2026-11-25_phase-01-cicd-auto-deploy-vm-setup.md`

**Files modified:** None

**Files deleted:** None

**VM changes:**

- Confirmed `origin` already used HTTPS.
- Installed the validated `/etc/sudoers.d/suaraputra-deploy` rule for only `/usr/bin/systemctl restart suaraputra`.
- Assigned tracked repository files, Git metadata, `dist`, and `node_modules` to the deploy user so its cron job can update and build the application. Left `data`, `private`, and the existing untracked shell dotfiles out of this ownership change.
- Fast-forwarded the VM from `618e1a1` to `7d67bdf`, installed dependencies, built with `--noEmitOnError`, pruned dev dependencies, and restarted the service.
- Installed/enabled cron and added `*/2 * * * * /opt/suaraputra/deploy/auto-deploy.sh`.

## 5. Technical Decisions and Deviations

- **Decision:** Preserve the existing HTTPS remote.
  **Rationale:** Step 3 was already configured correctly.
- **Decision:** Adjust ownership of code and build paths for `suaraputra`.
  **Rationale:** The VM repository was owned by the SSH account, which prevented the planned cron user from fetching and building. Operational data and credentials directories were excluded.
- **Deviation:** The VM was behind `master`, so the merged revision was built and restarted before enabling the recurring schedule.
  **Rationale:** Pulling the revision before starting cron without building it would make the polling script consider the source current and skip that revision.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| VM HTTPS Git remote | Complete | Existing HTTPS remote confirmed. |
| Limited restart permission | Complete | Sudoers syntax validated; rule is restricted to the service restart command. |
| Polling schedule | Complete | Cron is enabled and active; exact two-minute entry verified. |
| Initial VM deployment | Complete | VM at `7d67bdf`; build succeeded and service is active. |

## 7. Verification

**Commands run:**

```text
gcloud compute ssh ... --command "git pull --ff-only origin master"
npm install --include=dev
npm run build -- --noEmitOnError
npm prune --omit=dev
sudo visudo -c
sudo apt-get install -y cron
sudo crontab -l -u suaraputra
systemctl is-active cron
systemctl is-enabled cron
systemctl is-active suaraputra
journalctl -u cron --since '4 minutes ago' --no-pager
```

**Results:**

- **Passed:** VM fast-forwarded to `7d67bdf`; build and service restart succeeded; cron is active/enabled; the exact entry is installed; journal confirmed execution at `11:50:01 UTC`; service is active; deploy error count is zero.
- **Failed:** The first ownership-preparation attempt stopped because Git rejected the mixed repository ownership. No tracked files were changed by that attempt; the retry used a command-scoped `safe.directory` setting and completed.
- **Skipped / blocked:** The verified scheduled invocation found the VM current and exited without deploying.

## 8. Risks, Known Issues, and Follow-up

- `npm install` reported one high-severity audit finding. No dependency changes were made to address it.
- Running npm as `suaraputra` created an untracked `/opt/suaraputra/.npm/` cache directory; it was preserved.
- The VM's existing untracked shell dotfiles were preserved.
- **Tester focus:** Verify a later approved `master` update is fetched, built, and restarted, and inspect `data/deploy.log` for failures.

## 9. Commit and Documentation

**Commit:** See the phase documentation commit reported in the completion summary.
**Related documentation:** [CI/CD auto-deploy plan](../../cicd-auto-deploy-plan.md), [CI/CD setup guide](../../cicd-setup-guide.md)
