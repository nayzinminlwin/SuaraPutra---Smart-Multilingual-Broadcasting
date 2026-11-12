# SuaraPutra: Operations Runbook

> **Status:** Phase 6 baseline
> **References:** [`docs/project-plan.md`](./project-plan.md) and [`docs/architecture.md`](./architecture.md)

## 1. Runtime and deployment

The service runs from `/opt/suaraputra` under `suaraputra.service`. Keep
`private/whatsapp-auth` mode `700`, keep `.env` outside Git, and use the
configured `NODE_OPTIONS=--max-old-space-size=512` and `MemoryMax=800M`
guardrails. The provisioning script creates the 2 GB swap file and caps
journald at 200 MB.

## 2. WhatsApp authentication and group verification

Set `WHATSAPP_ADAPTER_MODE=baileys`, start the service interactively for the
first pairing, and complete QR/pairing with the dedicated account. The adapter
stores multi-file credentials in `WHATSAPP_AUTH_DIR`; never copy those files
into logs or Git. Before enabling publishing, inspect every configured group
with `getGroupMetadata` and verify `botIsParticipant`, `botCanSend`, the
Community parent, and the trusted JID mapping.

Transient disconnects reconnect with bounded backoff. A `loggedOut` disconnect
halts reconnection and requires operator re-pairing.

## 3. Kill switch, recovery, and retention

Set `BROADCAST_KILL_SWITCH=true` and restart the service to stop new delivery
claims without deleting durable queue state. `uncertain` jobs must be checked
against WhatsApp delivery evidence before any manual reconciliation; they are
never automatically resent. On startup and every recovery interval, expired
`sending` leases become `uncertain`.

The health snapshot exposes safe connection and queue-state counts. The
retention task removes media older than `DATA_RETENTION_DAYS` and prunes
unreferenced source noise.

## 4. Google Cloud checks

On `suaraputra-server`, verify Ubuntu 24.04 x86_64, Node.js 22, SQLite,
`/swapfile`, journald limits, the systemd unit, and writable `data/media`.
The live SIM smoke test remains postponed until the physical redONE SIM is
available; synthetic E2E coverage is the release evidence available before
that event.
