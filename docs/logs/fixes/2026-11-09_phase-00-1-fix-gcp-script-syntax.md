# Fix Log: Phase 0.1 — GCP Provisioning Script Syntax

**Date:** 2026-11-09
**Severity:** Medium
**Status:** Resolved

## 1. Defect

The new GCP provisioning script failed Bash syntax validation because its
here-document was not recognized correctly in the Windows working-tree
line-ending context.

## 2. Affected Components

- Phase 0.1 GCP provisioning script
- `scripts/setup-gcp-server.sh`

## 3. Root Cause

The script used a here-document for the journald configuration. The resulting
line-ending representation caused Bash to treat the subsequent service-user
conditional as part of an unterminated command.

## 4. Change

Replaced the here-document with a `printf` configuration write and normalized
the script to UTF-8 LF line endings. No provisioning behavior was removed.

## 5. Verification

```text
bash -n scripts/setup-gcp-server.sh
npm test
npm run typecheck
npm run build
npx tsx scripts/verify-environment.ts
git diff --check
```

All commands passed after the fix. Live execution on the GCP host remains an
operational follow-up.

## 6. Remaining Risk

The provisioning script has not been executed against the production VM from
the Windows development host.
