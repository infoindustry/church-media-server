CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'audio', 'youtube')),
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ru',
  category TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  original_file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  add_to_plan INTEGER NOT NULL DEFAULT 0,
  plan_position TEXT NOT NULL DEFAULT 'end',
  status TEXT NOT NULL DEFAULT 'uploading',
  error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'portal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uploaded_at TEXT,
  download_started_at TEXT,
  synced_at TEXT,
  synced_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_items_status_created
  ON media_items(status, created_at);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_version TEXT NOT NULL DEFAULT '',
  last_ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen
  ON devices(last_seen_at);
