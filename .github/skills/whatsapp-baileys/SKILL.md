---
name: whatsapp-baileys
description: "Guides WhatsApp integration using Baileys, including connection lifecycle, authentication, group discovery, message events, JIDs, message normalization, media handling, sending, reconnection, and delivery errors. Use when implementing or debugging WhatsApp transport and session behavior."
---

# WhatsApp and Baileys

## Scope and boundary

Baileys is a transport adapter, not the application's domain model. Keep
Baileys SDK types, socket instances, authentication state, and provider errors
inside `src/whatsapp/`. Expose provider-independent interfaces and normalized
DTOs to ingestion, AI, routing, and delivery modules.

The initial integration is an unofficial linked-device client. It must not
attempt to evade WhatsApp enforcement, rate limits, or platform restrictions.
If the integration becomes restricted or unsupported, pause safely rather than
adding detection-evasion, account-rotation, proxy-rotation, or similar logic.

## Connection and session lifecycle

1. Load configuration through the typed environment boundary.
2. Load authentication state from the protected path configured for the
   environment; never commit or log it.
3. Create one socket for the automation account.
4. Subscribe to connection, credential-update, message, and relevant group
   metadata events.
5. Persist credential updates using the approved auth-state mechanism.
6. On transient disconnects, reconnect with bounded backoff.
7. Prevent concurrent sockets for the same account.
8. After reconnecting, verify required group membership and send permissions.
9. Expose connection health without exposing QR payloads, tokens, or secrets.

Classify disconnects before deciding to reconnect. Authentication failure,
logout, invalid credentials, and policy-related restrictions must not be
treated as endless transient retries.

## Message event handling

Process realtime notifications only when the current phase requires live
events. History synchronization or appended events must not be accidentally
replayed as new announcements.

For each event:

1. Ignore messages without a usable message key or content.
2. Ignore messages sent by the automation account to prevent echo loops.
3. Require a group JID and restrict processing to the configured source group.
4. Unwrap ephemeral, view-once, or other supported wrappers with the Baileys
   normalization helper.
5. Extract text, caption, metadata, quoted-message references, and media
   references into an internal DTO.
6. Persist or hand off the normalized event according to the ingestion
   contract; do not invoke translation directly from the socket callback.

Use the message key's stable ID and remote JID for identity. Treat
`participant` as optional and support the JID forms emitted by the tested
Baileys version, including phone-based JIDs and LIDs where applicable.

## Group and JID rules

- Use full group JIDs as routing identifiers; never use display names as
  identity.
- Keep the source group and language destination mapping in trusted
  application configuration.
- Do not allow message content or model output to create or modify JIDs.
- Resolve group metadata during the proof of concept and record only the
  minimum operational data required.
- Verify that configured destination JIDs belong to the intended Community
  before enabling automatic publishing.

## Text and media normalization

Support the message forms approved by the current phase, including plain text,
extended text, and image captions when image handling is authorized. The
normalized DTO should not expose the entire raw `WAMessage` to downstream
modules.

When image support is authorized:

1. Identify the image and associated caption.
2. Download decrypted bytes through Baileys' media helper.
3. Use the supported re-upload callback when the media URL has expired.
4. Validate size, MIME type, and download completion.
5. Persist original bytes through the media-storage boundary.
6. Pass caption text to AI processing; do not add OCR or vision implicitly.
7. Reuse the stored original bytes for outgoing image messages.

Never depend on temporary WhatsApp CDN URLs as durable media storage. Do not
fetch arbitrary URLs found in message text.

## Sending and delivery

The adapter accepts a validated delivery command from the delivery module. It
does not decide whether content is an announcement or select destinations.

- Send only to a trusted configured target JID.
- Use text or image-with-caption payloads supported by the current phase.
- Preserve URLs, protected values, and approved formatting.
- Return the outgoing WhatsApp message ID when available.
- Distinguish rejected input, transient transport failure, permanent failure,
  and uncertain timeout outcomes.
- Never report success before the adapter has a successful result.

Persist a delivery job before attempting a send. A timeout after a request may
have reached WhatsApp is an uncertain outcome; do not blindly retry it.

## Testing and verification

Use synthetic fixtures and mocked adapter behavior before connecting a real
account. Verify:

- source-group filtering and non-group rejection;
- self-message loop prevention;
- wrapper unwrapping and text/caption extraction;
- duplicate event handling;
- group/JID configuration validation;
- reconnect and credential-update behavior;
- media download failure and expired-media re-upload behavior;
- independent per-destination send outcomes;
- uncertain-send handling without automatic duplicate sends.

The live proof of concept must be completed before treating Baileys
compatibility with the existing Community as established.

## Security and operations

Keep auth directories, QR/pairing data, private media, real message content,
and operational credentials outside Git. Redact sensitive values from logs.
Follow the operational kill switch and stop publishing immediately when the
integration or account is not safe to operate.

## References

- [Baileys integration specification](../../../docs/BAILEYS_INTEGRATION_SPEC.md)
- [Architecture](../../../docs/architecture.md)
- [Project plan](../../../docs/project-plan.md)
- [Operations runbook](../../../docs/operations-runbook.md)
- [Backend architecture](../backend-architecture/SKILL.md)
