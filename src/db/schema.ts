import type { Database } from "better-sqlite3";

export function migrate(database: Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS list_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      handle_normalized TEXT,
      source_file TEXT,
      line_number INTEGER,
      is_empty INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      imported_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_list_entries_kind
      ON list_entries(kind, is_deleted, id);

    CREATE INDEX IF NOT EXISTS idx_list_entries_source
      ON list_entries(source_file, line_number);

    CREATE INDEX IF NOT EXISTS idx_list_entries_kind_line_number
      ON list_entries(kind, line_number);

    CREATE INDEX IF NOT EXISTS idx_list_entries_normalized
      ON list_entries(kind, normalized_value);

    CREATE TABLE IF NOT EXISTS legacy_import_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      kind TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      total_lines INTEGER NOT NULL,
      imported_lines INTEGER NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      stopped_at TEXT,
      stats_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_keywords (
      run_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, position),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_keywords_run_keyword
      ON run_keywords(run_id, keyword);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS timeline_tweets (
      tweet_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      author_handle TEXT,
      author_name TEXT,
      author_avatar_url TEXT,
      tweet_url TEXT,
      lang TEXT,
      tweet_created_at TEXT,
      retweet_count INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      media_json TEXT NOT NULL DEFAULT '[]',
      urls_json TEXT NOT NULL DEFAULT '[]',
      source_keyword TEXT,
      accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
      liked_at TEXT,
      retweeted_at TEXT,
      like_error TEXT,
      retweet_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_timeline_tweets_accepted_at
      ON timeline_tweets(accepted_at DESC);

    CREATE TABLE IF NOT EXISTS raw_timeline_tweets (
      run_id TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      source_keyword TEXT NOT NULL,
      text TEXT NOT NULL,
      author_handle TEXT,
      author_name TEXT,
      tweet_url TEXT,
      tweet_created_at TEXT,
      retweet_count INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      media_count INTEGER NOT NULL DEFAULT 0,
      url_count INTEGER NOT NULL DEFAULT 0,
      decision_status TEXT NOT NULL DEFAULT 'pending',
      rejection_stage TEXT,
      score INTEGER,
      rejection_reasons_json TEXT NOT NULL DEFAULT '[]',
      decision_at TEXT,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, tweet_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_raw_timeline_tweets_captured
      ON raw_timeline_tweets(captured_at DESC, run_id);

    CREATE TABLE IF NOT EXISTS media_cache_entries (
      cache_id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL UNIQUE,
      local_path TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      cached_at TEXT,
      expires_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_cache_entries_expires
      ON media_cache_entries(expires_at);

    CREATE INDEX IF NOT EXISTS idx_media_cache_entries_cached_at
      ON media_cache_entries(cached_at);

    CREATE TABLE IF NOT EXISTS x_budget_usage (
      usage_date TEXT PRIMARY KEY,
      search_calls INTEGER NOT NULL DEFAULT 0,
      count_calls INTEGER NOT NULL DEFAULT 0,
      post_reads INTEGER NOT NULL DEFAULT 0,
      user_reads INTEGER NOT NULL DEFAULT 0,
      media_reads INTEGER NOT NULL DEFAULT 0,
      user_interactions INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS x_run_budget_usage (
      run_id TEXT PRIMARY KEY,
      search_calls INTEGER NOT NULL DEFAULT 0,
      count_calls INTEGER NOT NULL DEFAULT 0,
      post_reads INTEGER NOT NULL DEFAULT 0,
      user_reads INTEGER NOT NULL DEFAULT 0,
      media_reads INTEGER NOT NULL DEFAULT 0,
      user_interactions INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS x_browser_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vpn_profile_path TEXT NOT NULL UNIQUE,
      x_identifier TEXT NOT NULL,
      storage_state_path TEXT NOT NULL UNIQUE,
      browser_profile_dir TEXT NOT NULL,
      session_status TEXT NOT NULL DEFAULT 'missing_session',
      last_login_at TEXT,
      last_login_public_ipv4 TEXT,
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_x_browser_accounts_status
      ON x_browser_accounts(session_status, updated_at);

    CREATE TABLE IF NOT EXISTS x_browser_account_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      vpn_profile_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES x_browser_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_x_browser_account_profiles_account
      ON x_browser_account_profiles(account_id, vpn_profile_path);

    CREATE TABLE IF NOT EXISTS x_session_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      x_identifier TEXT NOT NULL,
      vpn_profile_path TEXT NOT NULL,
      public_ipv4 TEXT,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by_note TEXT,
      FOREIGN KEY (account_id) REFERENCES x_browser_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_x_session_alerts_status_account
      ON x_session_alerts(status, account_id, detected_at DESC);

    CREATE INDEX IF NOT EXISTS idx_x_session_alerts_profile_status
      ON x_session_alerts(vpn_profile_path, status, detected_at DESC);

    INSERT OR IGNORE INTO x_browser_account_profiles (account_id, vpn_profile_path, created_at)
      SELECT id, vpn_profile_path, created_at
      FROM x_browser_accounts;
  `);

  ensureRawTimelineDecisionColumns(database);
  ensureXSessionAlertDetailColumns(database);
}

function ensureRawTimelineDecisionColumns(database: Database): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(raw_timeline_tweets)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const addColumn = (name: string, sql: string) => {
    if (!columns.has(name)) {
      database.exec(sql);
      columns.add(name);
    }
  };

  addColumn("decision_status", "ALTER TABLE raw_timeline_tweets ADD COLUMN decision_status TEXT NOT NULL DEFAULT 'pending'");
  addColumn("rejection_stage", "ALTER TABLE raw_timeline_tweets ADD COLUMN rejection_stage TEXT");
  addColumn("score", "ALTER TABLE raw_timeline_tweets ADD COLUMN score INTEGER");
  addColumn("rejection_reasons_json", "ALTER TABLE raw_timeline_tweets ADD COLUMN rejection_reasons_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("decision_at", "ALTER TABLE raw_timeline_tweets ADD COLUMN decision_at TEXT");
}

function ensureXSessionAlertDetailColumns(database: Database): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(x_session_alerts)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has("details_json")) {
    database.exec("ALTER TABLE x_session_alerts ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'");
  }
}
