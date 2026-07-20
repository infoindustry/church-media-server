CREATE TABLE IF NOT EXISTS sermon_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  fit TEXT NOT NULL DEFAULT 'contain',
  slides_json TEXT NOT NULL DEFAULT '[]',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  add_to_plan INTEGER NOT NULL DEFAULT 0,
  plan_position TEXT NOT NULL DEFAULT 'end',
  status TEXT NOT NULL DEFAULT 'uploading',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uploaded_at TEXT,
  download_started_at TEXT,
  synced_at TEXT,
  synced_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sermon_packages_status_created
  ON sermon_packages(status, created_at);
