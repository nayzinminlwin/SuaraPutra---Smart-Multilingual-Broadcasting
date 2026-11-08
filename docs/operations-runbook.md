# SuaraPutra: Operations Runbook

> **Status:** Planned Phase 7 Deliverable  
> **Reference:** [`docs/project-plan.md`](./project-plan.md) (Phase 7) & [`docs/architecture.md`](./architecture.md)

This runbook will be authored and verified during **Phase 7 (End-to-End Composition Root, Full Synthetic QA & Live BaileysWhatsAppAdapter Integration)** upon physical redONE SIM delivery and Oracle Cloud deployment.

---

## Planned Contents (Phase 7 Scope)

1. **WhatsApp Transport & Authentication:**
   - Multi-file auth state setup (`private/whatsapp-auth`).
   - Pairing and QR code connection procedure via dedicated redONE SIM.
   - Reconnection policies, exponential backoff, and logout handling (`DisconnectReason.loggedOut`).
2. **Community & Group Topology Verification:**
   - WhatsApp Community group discovery and JID verification script.
   - Ensuring posting permissions and bot participant status.
3. **Operational Controls & Recovery:**
   - Emergency broadcast kill-switch operation (`BROADCAST_KILL_SWITCH=true`).
   - Reconciliation CLI / SQL queries for `uncertain` delivery jobs.
   - Startup crash recovery and orphaned lease handling.
   - Daily automated cleanup for cached media and retention pruning.
4. **Oracle Cloud Infrastructure Deployment:**
   - Ubuntu 24.04 LTS (ARM64) environment verification.
   - `systemd` service lifecycle (`suaraputra.service`).
   - Log rotation and monitoring with `pino`.
