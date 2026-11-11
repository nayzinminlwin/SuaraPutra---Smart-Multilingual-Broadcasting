CREATE TABLE IF NOT EXISTS group_config (
  group_jid TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('source', 'destination')),
  language_code TEXT CHECK (language_code IN ('ms', 'en', 'zh-CN', 'ta') OR language_code IS NULL),
  display_name TEXT,
  community_jid TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS source_messages (
  ingestion_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  sender_push_name TEXT,
  timestamp_ms INTEGER NOT NULL,
  message_kind TEXT NOT NULL CHECK (message_kind IN ('TEXT', 'IMAGE_CAPTION', 'IMAGE_ONLY')),
  text_content TEXT,
  content_hash TEXT NOT NULL,
  quoted_message_id TEXT,
  quoted_participant_jid TEXT,
  quoted_text TEXT,
  media_local_path TEXT,
  media_mime_type TEXT,
  media_sha256_hex TEXT,
  raw_payload_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (chat_jid, message_id)
);
CREATE INDEX IF NOT EXISTS idx_source_messages_chat_time ON source_messages (chat_jid, timestamp_ms ASC, ingestion_seq ASC);
CREATE INDEX IF NOT EXISTS idx_source_messages_content_hash ON source_messages (content_hash);

CREATE TABLE IF NOT EXISTS announcements (
  announcement_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  primary_source_message_id TEXT NOT NULL REFERENCES source_messages(id) ON DELETE RESTRICT,
  source_timestamp_ms INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('announcement', 'not_announcement')),
  evaluation_score REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ignored', 'held_validation_failed', 'queued', 'completed', 'partial_failure')),
  payload_type TEXT NOT NULL CHECK (payload_type IN ('TEXT', 'IMAGE_CAPTION', 'IMAGE_ONLY')),
  media_local_path TEXT,
  media_mime_type TEXT,
  raw_ai_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements (status, source_timestamp_ms ASC, announcement_seq ASC);

CREATE TABLE IF NOT EXISTS announcement_sources (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  source_message_id TEXT NOT NULL REFERENCES source_messages(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('primary', 'quoted', 'window_context')),
  PRIMARY KEY (announcement_id, source_message_id)
);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL CHECK (language_code IN ('ms', 'en', 'zh-CN', 'ta')),
  content TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'failed')),
  validation_errors_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (announcement_id, language_code)
);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  announcement_seq INTEGER NOT NULL,
  source_timestamp_ms INTEGER NOT NULL,
  language_code TEXT NOT NULL CHECK (language_code IN ('ms', 'en', 'zh-CN', 'ta')),
  language_order INTEGER NOT NULL CHECK (language_order IN (1, 2, 3, 4)),
  target_group_jid TEXT NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('TEXT', 'IMAGE_CAPTION', 'IMAGE_ONLY')),
  text_content TEXT,
  media_local_path TEXT,
  media_mime_type TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'retry_wait', 'uncertain', 'failed_permanent', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  outgoing_message_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (announcement_id, target_group_jid)
);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_fifo_poll ON delivery_jobs (status, next_attempt_at ASC, source_timestamp_ms ASC, announcement_seq ASC, language_order ASC);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_lease ON delivery_jobs (status, lease_expires_at ASC);

CREATE TABLE IF NOT EXISTS event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_event_logs_entity ON event_logs (related_entity_type, related_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs (created_at DESC);
