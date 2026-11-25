# Baileys Backend Integration Specification

This document defines the current Baileys transport boundary for the SuaraPutra
TypeScript modular monolith. It describes the provider-specific behavior inside
`src/whatsapp/` and the provider-independent contracts used by the rest of the
application.

The package is pinned exactly to `@whiskeysockets/baileys` `7.0.0-rc14`.

## 1. Architecture Boundary

Baileys is a transport adapter, not the application domain model.

At the WhatsApp wire level, encrypted WebSocket Noise-protocol traffic carries
binary Protocol Buffer (`WAProto`) messages. Baileys decrypts and decodes those
frames and emits JavaScript/TypeScript objects such as `WAMessage` internally.
Only provider-independent normalized DTOs cross the application boundary.

- `src/whatsapp/baileys-client.ts` owns the live socket, authentication state,
  connection lifecycle, inbound event handling, group metadata lookup, and
  outbound sends.
- `src/whatsapp/event-normalizer.ts` converts provider events into normalized
  application messages.
- `src/whatsapp/adapter.ts` defines provider-independent adapter types.
- `src/whatsapp/mock-adapter.ts` implements the same contract for tests and
  file-backed live simulation.
- Ingestion, AI processing, persistence, routing, and delivery must not import
  `WAMessage`, `WASocket`, or other Baileys SDK types.

The composition root selects the adapter from `WHATSAPP_ADAPTER_MODE`:

```typescript
const adapter = config.WHATSAPP_ADAPTER_MODE === 'baileys'
  ? new BaileysWhatsAppAdapter(config)
  : new MockWhatsAppAdapter({
      maxMediaBytes: config.MAX_MEDIA_BYTES
    });
```

The application calls `adapter.connect()` during startup and
`adapter.disconnect()` during shutdown. Ingestion attaches to the adapter using
`onMessage()` and connection monitoring uses `onConnectionChange()`.

There is no REST or microservice bridge. Domain modules exchange
`NormalizedInboundMessage`, `OutboundMessagePayload`, `SendMessageResult`, and
`GroupMetadataSummary` contracts with the adapter.

## 2. Authentication and Socket Lifecycle

### 2.1 Configuration and authentication

The live adapter:

1. Reads typed environment configuration, including `WHATSAPP_AUTH_DIR`,
   `MAX_MEDIA_BYTES`, `LOG_LEVEL`, and `NODE_ENV`.
2. Loads native Baileys multi-file authentication state with
   `useMultiFileAuthState(WHATSAPP_AUTH_DIR)`.
3. Resolves the current WhatsApp Web version with
   `fetchLatestWaWebVersion({})`.
4. Creates one socket using `makeWASocket()` with:
   - `auth: state`
   - `version: waWebVersion.version`
   - `markOnlineOnConnect: false`
   - `syncFullHistory: false`

The adapter subscribes to:

- `creds.update` to persist credential updates with `saveCreds`
- `messages.upsert` for inbound message events
- `connection.update` for connection state, QR, and reconnect decisions

Errors are isolated where possible. A media-download or normalization failure
on one inbound message is logged and that message is skipped; subsequent
messages in the same upsert batch continue to be processed.

Credential files and QR payloads are sensitive and must remain outside Git,
logs, and media storage.

### 2.2 QR and connection states

When `connection.update.qr` is present, the adapter renders the QR payload
using `qrcode-terminal`. It does not emit a QR payload or authentication token
through application logs.

The adapter exposes these connection states:

```typescript
type ConnectionStatus = 'connecting' | 'open' | 'close' | 'logged_out';
```

- `open` resets the reconnect counter and is the only state in which sends and
  real-time inbound processing are accepted.
- `close` schedules a bounded reconnect after a random jittered delay.
- `logged_out` is terminal for the adapter instance and halts reconnection.
- Manual `disconnect()` stops reconnection and closes the socket.

Reconnect delay is capped at 60 seconds. Concurrent socket creation and
reconnect loops are prevented.

### 2.3 Disconnect classification

A `DisconnectReason.loggedOut` result transitions the adapter to
`logged_out`, logs the operational failure, and does not reconnect.

Other close events schedule a bounded backoff reconnect in the current
implementation. It does not classify arbitrary restriction codes as logged out
unless Baileys reports `DisconnectReason.loggedOut`. The application reports
connection state through `onConnectionChange()` without exposing credentials
or QR data.

## 3. Bot Identity and JID Handling

Baileys v7 can expose both phone-number JIDs and linked-device LIDs.

The adapter obtains bot identities from:

- `sock.user.id`
- `sock.user.lid`

Both values are normalized and exposed through:

```typescript
getBotJid(): string | null;
getBotIdentities(): string[];
```

`getBotJid()` retains backward compatibility and selects a primary normalized
identity. `getBotIdentities()` supplies all normalized identities for
self-echo protection and group participation checks.

The JID normalizer:

- preserves `@s.whatsapp.net` and `@lid`
- removes device suffixes such as `:3`
- rejects unrelated or malformed JID forms

For example:

- `60123456789:0@s.whatsapp.net` becomes `60123456789@s.whatsapp.net`
- `1029384756:3@lid` becomes `1029384756@lid`

Inbound identity matching compares both the primary sender JID and optional
alternate sender JID against the bot identities.

## 4. Inbound Events

### 4.1 Event routing

The live adapter registers `messages.upsert` and:

- ignores upserts unless the connection is `open`
- processes only `type === 'notify'`
- ignores history-append events
- ignores messages without a usable key or content
- ignores `key.fromMe === true`
- requires `key.remoteJid` to be a group JID ending in `@g.us`
- never chooses the source or destination groups from message content

The configured source group JIDs are trusted application configuration.
Downstream ingestion requires the normalized chat JID to match a configured
source group.

### 4.2 Envelope fields

The provider event contains a `WAMessage` with fields such as:

```json
{
  "key": {
    "remoteJid": "120363028391823901@g.us",
    "remoteJidAlt": "60123456789@s.whatsapp.net",
    "fromMe": false,
    "id": "3EB0C7291A82C94F8E",
    "participant": "1029384756:3@lid",
    "participantAlt": "60123456789:0@s.whatsapp.net"
  },
  "pushName": "John Doe",
  "messageTimestamp": 1709901234,
  "message": {}
}
```

The normalizer derives:

| Normalized field | Source |
|---|---|
| `chatJid` | `key.remoteJid`, validated as `@g.us` |
| `messageId` | `key.id` |
| `senderJid` | `key.participant`, then `key.participantAlt`, then chat JID fallback |
| `senderAltJid` | `key.participantAlt`, then `key.remoteJidAlt`, when distinct |
| `senderPushName` | `pushName` |
| `fromMe` | `key.fromMe === true` |
| `timestampMs` | `messageTimestamp` converted from seconds to milliseconds |
| `quotedMessageId` | `contextInfo.stanzaId` |
| `quotedParticipantJid` | `contextInfo.participant` |
| `quotedText` | Text or image caption from `contextInfo.quotedMessage` |
| `rawPayloadJson` | Safely serialized raw event data via `BufferJSON.replacer` |

The live adapter already filters `fromMe`; normalization also preserves
`fromMe` for defense in depth, and ingestion rejects either `fromMe` or a
sender identity matching the automation account.

Inbound deduplication uses the pair of `chatJid` and `messageId`; the persisted
source identity is deterministic from that pair. Push names and alternate JIDs
are not routing or deduplication identities.

### 4.3 Supported content wrappers

Baileys normalizes provider wrappers before application extraction. The
normalizer supports:

- `conversation`
- `extendedTextMessage.text`
- `imageMessage.caption`
- `ephemeralMessage`
- `documentWithCaptionMessage`

View-once message wrappers are unsupported and are rejected.

The provider shapes represented by the supported forms are:

```typescript
// Plain text
{ conversation: 'Announcement text' }

// Extended text, including formatting, links, and quotes
{
  extendedTextMessage: {
    text: 'Formatted announcement text',
    contextInfo: {
      stanzaId: 'quoted-message-id',
      participant: '60111111111@s.whatsapp.net',
      quotedMessage: { conversation: 'Quoted text' }
    }
  }
}

// Image with an optional caption
{
  imageMessage: {
    mimetype: 'image/jpeg',
    caption: 'Optional announcement caption',
    fileLength: 1048576,
    fileSha256: '<base64 sha256>',
    directPath: '/v/t62.7118-24/...'
  }
}
```

Supported image and text kinds are:

| Kind | Meaning |
|---|---|
| `TEXT` | Plain or extended text without an image |
| `IMAGE_CAPTION` | Image plus a usable caption |
| `IMAGE_ONLY` | Image without a usable caption |
| `UNSUPPORTED` | No supported normalized content |

For quoted text, the normalizer reads `contextInfo` from extended text or image
messages. It retains `stanzaId`, `participant`, and the quoted text for context
assembly. It does not fetch or execute URLs found in message content.

Quoted messages and recent messages are used only as bounded AI context.
They are not used to change source/destination routing or to attach a quote
option to an outbound send.

## 5. Media Handling

When a normalized image is detected, the live adapter downloads decrypted bytes:

```typescript
const buffer = await downloadMediaMessage(
  message,
  'buffer',
  {},
  {
    logger: socket.logger,
    reuploadRequest: socket.updateMediaMessage
  }
);
```

The adapter passes the downloaded buffer to `normalizeUpsert()`. The normalizer:

- validates declared and downloaded size against `MAX_MEDIA_BYTES`
- records MIME type and SHA-256 hash when available
- produces `IMAGE_CAPTION` or `IMAGE_ONLY`
- rejects images larger than the configured limit

`event-normalizer.ts` stores binary-safe raw event JSON using
`JSON.stringify(rawMessage, BufferJSON.replacer)`. This preserves the
`Buffer`/base64 representation without serializing binary objects directly.

For accepted messages, ingestion persists the original image through
`MediaStore` and releases the in-memory buffer. The media path and MIME type are
stored with the source or delivery job:

- `TEXT` uses no media.
- `IMAGE_CAPTION` sends the caption through AI while preserving original bytes.
- `IMAGE_ONLY` bypasses AI and creates independent jobs carrying the original
  image bytes.

Temporary WhatsApp CDN URLs are not durable media storage. Outbound delivery
reopens the locally stored original buffer rather than relying on the source
message URL.

## 6. Ingestion and Processing Boundary

The adapter hands normalized messages to `MessageIngestor` as they arrive.
Adapters do not translate, route, or send messages inline.

Ingestion applies the following gates in order:

1. Source JID is one of the configured source groups.
2. The message is not from the automation account or an alternate bot identity.
3. The message kind is supported.
4. The message is not a duplicate.
5. Image media, if present, is successfully persisted within the configured limit.

Then processing:

- assembles bounded source and quote context within `CONTEXT_MAX_MESSAGES`
  and `CONTEXT_WINDOW_SECONDS`
- uses one configured Gemini 3.8 Flash call or mock provider call for `TEXT` and
  `IMAGE_CAPTION`
- does not add vision or OCR behavior
- validates provider output
- persists accepted announcements and independent per-language delivery jobs

The configured languages and groups are fixed application routing data:

| Language | Configuration |
|---|---|
| Malay | `WHATSAPP_MALAY_GROUP_JID` |
| English | `WHATSAPP_ENGLISH_GROUP_JID` |
| Simplified Chinese | `WHATSAPP_MANDARIN_GROUP_JID` |
| Tamil | `WHATSAPP_TAMIL_GROUP_JID` |

Model output and message content cannot change JIDs or create destinations.

## 7. Outbound Adapter Contract

The delivery layer supplies one validated command:

```typescript
interface SendMessageResult {
  outgoingMessageId: string;
  acknowledgedAtIso: string;
}

type OutboundMessagePayload =
  | { type: 'TEXT'; text: string }
  | {
      type: 'IMAGE';
      imageBuffer: Buffer;
      mimeType: string;
      caption?: string;
    };
```

Supported Baileys payloads are:

```typescript
{ text: payload.text }

{
  image: payload.imageBuffer,
  mimetype: payload.mimeType,
  caption: payload.caption
}
```

The live adapter validates that `targetGroupJid` is a full `@g.us` JID and that
the socket is open. It must send only to an already validated, configured
destination JID.

It does not decide whether content is an announcement and it does not select
language groups.

Current outbound sends do not use the Baileys `quoted` generation option.
Each text or image payload is sent directly to the trusted target JID.

The live adapter applies a 30-second default `sendMessage()` timeout
through `sendTimeoutMs`. `DELIVERY_SEND_TIMEOUT_MS` is the separate configured
limit used when draining active dispatch during application shutdown. If the
adapter timeout wins the race, the result is classified as ambiguous rather
than successful or permanently failed.

### 7.1 Send acknowledgement semantics

`acknowledgedAtIso` is the UTC timestamp at which `socket.sendMessage()` resolved.
It represents provider request acceptance, not a WhatsApp client-emitted
delivery or read acknowledgement.

The result is accepted only when Baileys returns an outgoing message ID. A
timeout is ambiguous because the request may have reached WhatsApp.

Send failures are classified as:

- `invalid` for rejected JIDs or payload input
- `transient` for an unavailable socket or retryable transport failure
- `permanent` for explicit provider rejection
- `ambiguous` for timeout after send began

Ambiguous outcomes are persisted as uncertain and are not blindly retried.
Successful destination jobs are also not resent after restart.

If Baileys has sent successfully but SQLite persistence of the send outcome
fails, the delivery dispatcher also marks the operation uncertain. That
post-send persistence branch must not be converted into a normal send failure.

### 7.2 Delivery queue behavior

Outbound delivery happens later through `DeliveryDispatcher`, never from the
`messages.upsert` callback. The dispatcher:

1. claims one persisted SQLite delivery job
2. reconstructs text or original-image payload data
3. enforces delivery pacing
4. calls `adapter.sendMessage()`
5. persists the independent delivery outcome
6. marks timeouts or post-send persistence failures as uncertain

Jobs are ordered by source timestamp, announcement sequence, language order,
and independent idempotency data.

## 8. Group Metadata and Publishing Permissions

The adapter's `getGroupMetadata(groupJid)` calls
`socket.groupMetadata(groupJid)` and returns:

```typescript
interface GroupMetadataSummary {
  groupJid: string;
  subject: string;
  isCommunity: boolean;
  isCommunityAnnounce: boolean;
  linkedParentJid: string | null;
  botIsParticipant: boolean;
  botCanSend: boolean;
}
```

`isCommunity` is a boolean result in the implementation; the
`isCommunityAnnounce` field indicates whether the returned metadata marks the
group as a community announcement group.

Metadata matching tries typed participant fields:

- `id`
- `lid`
- `phoneNumber`

The bot is considered present only if one of these fields matches a normalized
bot identity.

Publishing permissions:

| Group announcement setting | Bot participant state | `botCanSend` |
|---|---|---|
| `announce !== true` | Participant | `true` |
| `announce === true` | Regular member | `false` |
| `announce === true` | `admin` or `superadmin` | `true` |
| Not a participant | Any | `false` |

The application must verify every configured source and destination against
the intended Community before enabling publishing. Display names are never
routing identities; full `@g.us` JIDs are authoritative.

Group metadata is inspected explicitly; the current transport adapter does not
call `getGroupMetadata()` before every `sendMessage()` and the send method
does not enforce `botCanSend` itself. Publishing authorization and kill-switch
operational controls remain application/operations responsibilities.

## 9. Operational Safety

- Only one application socket should exist for the automation account.
- Source and destination JIDs remain trusted configuration.
- The broadcast kill switch is checked before dispatch.
- Private auth state, private media, real message content, and secrets must
  stay outside Git and normal logs.
- A logged-out or restricted account must be paused and re-paired explicitly.
- Send retries must follow the persisted queue policy.
- Uncertain sends must not be automatically retried solely because a timeout
  occurred.
- Live Community permissions and real account behavior remain operational
  verification tasks, not conclusions derived from synthetic tests.
