# Baileys Backend Integration Specification

This document specifies the exact data types, structures, and schemas for integrating a backend service with Baileys to ingest, translate, and re-broadcast messages across language-dedicated WhatsApp groups.

---

## 1. Architecture Overview

- **Wire Level**: WhatsApp communicates over encrypted WebSockets using Noise protocol and binary Protocol Buffers (`WAProto`).
- **Application Level**: Baileys decodes and decrypts stanzas internally, emitting plain JavaScript/TypeScript objects (`WAMessage` / `proto.IWebMessageInfo`).
- **Data Format**: In-memory JavaScript Objects (or JSON payloads when serialized over HTTP/WebSockets to an external backend service).

---

## 2. Inbound Data Structure (Fetching from WhatsApp)

Messages are received via the `messages.upsert` event:

```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
    // type: 'notify' (realtime) | 'append' (history sync)
})
```

### 2.1 Envelope Structure (`WAMessage` / `proto.IWebMessageInfo`)

When serialized to JSON, each message object has the following structure:

```json
{
  "key": {
    "remoteJid": "120363028391823901@g.us",
    "fromMe": false,
    "id": "3EB0C7291A82C94F8E",
    "participant": "60123456789@s.whatsapp.net"
  },
  "pushName": "John Doe",
  "messageTimestamp": 1709901234,
  "message": { ... }
}
```

#### Key Fields:
| Field | Type | Description |
|---|---|---|
| `key.remoteJid` | `string` | The chat identifier. For groups: `<groupId>@g.us` |
| `key.participant` | `string` (optional) | Sender's individual JID inside a group (`<phone>@s.whatsapp.net` or LID) |
| `key.fromMe` | `boolean` | `true` if sent by your connected account. **Filter these out to prevent translation echo loops.** |
| `key.id` | `string` | Unique WhatsApp message ID |
| `pushName` | `string` | Sender's WhatsApp display profile name |
| `messageTimestamp`| `number` | Unix epoch in seconds |
| `message` | `object` | The protobuf message payload container |

> **Important**: In groups with disappearing messages or view-once enabled, `msg.message` is wrapped inside `ephemeralMessage.message` or `viewOnceMessage.message`. Always unwrap using Baileys' helper:
> ```typescript
> import { normalizeMessageContent } from '@whiskeysockets/baileys'
> const messageContent = normalizeMessageContent(msg.message)
> ```

---

### 2.2 Inbound Message Scopes & Inner Structures

#### Scope A: Plain Text Message (`conversation`)

```json
{
  "message": {
    "conversation": "Hello everyone, welcome to the group!"
  }
}
```

- Extract text: `msg.message?.conversation`

#### Scope B: Extended Text Message (`extendedTextMessage`)
*Used when formatting (bold, italic), link previews, mentions, or quotes are present.*

```json
{
  "message": {
    "extendedTextMessage": {
      "text": "Hello *everyone*, check this out!",
      "contextInfo": {
        "mentionedJid": ["60123456789@s.whatsapp.net"],
        "stanzaId": "3EB099...",
        "participant": "60111111111@s.whatsapp.net",
        "quotedMessage": { ... }
      }
    }
  }
}
```

- Extract text: `msg.message?.extendedTextMessage?.text`

#### Scope C: Image Message without Caption (`imageMessage`)

```json
{
  "message": {
    "imageMessage": {
      "mimetype": "image/jpeg",
      "fileSha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      "fileLength": 1048576,
      "height": 1080,
      "width": 1920,
      "mediaKey": "sO3...",
      "directPath": "/v/t62.7118-24/...",
      "url": "https://mmg.whatsapp.net/...",
      "caption": null
    }
  }
}
```

- Condition: `msg.message?.imageMessage && !msg.message?.imageMessage?.caption`

#### Scope D: Image Message with Caption (`imageMessage` + Text)

```json
{
  "message": {
    "imageMessage": {
      "mimetype": "image/jpeg",
      "caption": "Product specifications and announcement details",
      "fileLength": 1048576,
      "height": 1080,
      "width": 1920,
      "directPath": "/v/t62.7118-24/...",
      "mediaKey": "sO3...",
      "url": "https://mmg.whatsapp.net/..."
    }
  }
}
```

- Extract text: `msg.message?.imageMessage?.caption`

---

### 2.3 Downloading the Image Binary

Image files are stored encrypted on WhatsApp CDN servers. To pass the raw image to the media store or re-send it, download the decrypted buffer using Baileys:

```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys'

const buffer: Buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    {
        logger: sock.logger,
        reuploadRequest: sock.updateMediaMessage
    }
)
```

---

## 3. Outbound Data Structure (Sending to Dedicated Groups)

To send messages, call:
```typescript
await sock.sendMessage(jid, content, options)
```

- **`jid`**: Target group JID formatted as `"<groupId>@g.us"` (e.g., `'120363028391823901@g.us'`).
- **`content`**: Object adhering to `AnyMessageContent`.

### 3.1 Content Payloads

#### 1. Translated Text Message
```typescript
const content = {
    text: "Translated text goes here."
}

await sock.sendMessage(targetGroupJid, content)
```

#### 2. Image Message (No Caption)
```typescript
const content = {
    image: imageBuffer, // Node.js Buffer, OR { url: 'https://...' }, OR { url: './path/to/file.jpg' }
    mimetype: 'image/jpeg' // Optional, auto-detected if Buffer
}

await sock.sendMessage(targetGroupJid, content)
```

#### 3. Image Message with Translated Caption
```typescript
const content = {
    image: imageBuffer, // Node.js Buffer, OR { url: 'https://...' }, OR { url: './path/to/file.jpg' }
    caption: "Translated caption goes here.",
    mimetype: 'image/jpeg' // Optional
}

await sock.sendMessage(targetGroupJid, content)
```

### 3.2 Optional Send Options (`MiscMessageGenerationOptions`)

```typescript
await sock.sendMessage(targetGroupJid, content, {
    quoted: originalWAMessage // Quotes the original message as context
})
```

---

## 4. Application Boundary

The initial implementation is a TypeScript modular monolith. Baileys is used
only by the WhatsApp adapter; ingestion, AI processing, persistence, routing,
and delivery depend on internal interfaces and normalized DTOs rather than
Baileys payloads.

The adapter normalizes `messages.upsert` events, persists accepted source
messages, and passes them to the sequential FIFO ingestion runner. The runner
applies scope, self-echo, supported-kind, deduplication, and media-size gates.
`TEXT` and `IMAGE_CAPTION` messages use one Gemini 3.8 Flash call; `IMAGE_ONLY`
messages bypass AI and are forwarded directly. Validated outputs become
independent SQLite delivery jobs ordered by source timestamp, announcement
sequence, and language order. The dispatcher sends through the adapter and
records each delivery outcome.

There is no REST or microservice bridge in the approved architecture. Any
future external service requires an explicit architecture decision and must
implement the same normalized contracts and queue boundaries.

---

## 5. Adapter-Aware Extraction & Dispatch Example

```typescript
import { 
    normalizeMessageContent, 
    isJidGroup
} from '@whiskeysockets/baileys'

const adapter = new BaileysWhatsAppAdapter(sock)

sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
        if (!msg.message || msg.key.fromMe || !isJidGroup(msg.key.remoteJid ?? '')) {
            continue
        }

        const content = normalizeMessageContent(msg.message)
        if (!content) continue

        // The adapter normalizes and enqueues; it does not translate or send inline.
        void adapter.enqueueNormalizedMessage({
            message: msg,
            content
        })
    }
})
```

`enqueueNormalizedMessage` represents the adapter boundary. The application
runner performs persistence, FIFO ordering, AI processing, validation, and
delivery-queue creation. Outbound sends are performed later by the dispatcher
through the adapter, never directly from the event callback.
