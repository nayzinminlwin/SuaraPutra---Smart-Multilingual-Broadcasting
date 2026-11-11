CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_job_id TEXT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('started', 'sent', 'failed', 'uncertain')),
  failure_kind TEXT CHECK (failure_kind IN ('transient', 'ambiguous', 'permanent', 'invalid') OR failure_kind IS NULL),
  error_code TEXT,
  error_message TEXT,
  outgoing_message_id TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (delivery_job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_job
  ON delivery_attempts (delivery_job_id, attempt_number ASC);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_status_time
  ON delivery_attempts (status, started_at DESC);
