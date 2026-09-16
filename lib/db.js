let binding = null;
let schemaReadyFor = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS model_backtest_predictions (
    event_id TEXT NOT NULL,
    match_ts INTEGER NOT NULL,
    home_id TEXT NOT NULL,
    away_id TEXT NOT NULL,
    home_goals INTEGER NOT NULL,
    away_goals INTEGER NOT NULL,
    p_home REAL NOT NULL,
    p_draw REAL NOT NULL,
    p_away REAL NOT NULL,
    p_over25 REAL NOT NULL,
    p_btts REAL NOT NULL,
    data_quality INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    model_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, model_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backtest_model_ts ON model_backtest_predictions (model_version, match_ts)`,
  `CREATE TABLE IF NOT EXISTS model_calibration (
    model_version TEXT NOT NULL,
    market TEXT NOT NULL,
    bucket INTEGER NOT NULL,
    predicted_avg REAL NOT NULL,
    observed_rate REAL NOT NULL,
    sample_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_version, market, bucket)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calibration_model ON model_calibration (model_version)`,
  `CREATE TABLE IF NOT EXISTS iddaa_odds_history (
    event_id INTEGER NOT NULL,
    market_id INTEGER NOT NULL,
    outcome_name TEXT NOT NULL,
    first_odd REAL NOT NULL,
    last_odd REAL NOT NULL,
    min_odd REAL NOT NULL,
    max_odd REAL NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    change_count INTEGER NOT NULL DEFAULT 0,
    match_name TEXT,
    match_ts INTEGER,
    market_name TEXT,
    market_key TEXT,
    market_group TEXT,
    model_probability REAL,
    fair_probability REAL,
    risk INTEGER,
    PRIMARY KEY (event_id, market_id, outcome_name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_iddaa_odds_history_event ON iddaa_odds_history(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_iddaa_odds_history_match_ts ON iddaa_odds_history(match_ts)`,
  `CREATE INDEX IF NOT EXISTS idx_iddaa_odds_history_last_seen ON iddaa_odds_history(last_seen_at)`,
  `CREATE TABLE IF NOT EXISTS market_prediction_history (
    event_id TEXT NOT NULL,
    market_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    match_ts INTEGER NOT NULL,
    market_group TEXT NOT NULL,
    family TEXT,
    label TEXT,
    probability REAL NOT NULL,
    risk INTEGER,
    market_confidence INTEGER,
    data_quality INTEGER,
    analysis_confidence INTEGER,
    iddaa_open INTEGER NOT NULL DEFAULT 0,
    decimal_odd REAL,
    metadata TEXT NOT NULL DEFAULT '{}',
    result INTEGER,
    graded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, market_key, model_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_perf_pending ON market_prediction_history (match_ts) WHERE result IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_market_perf_group ON market_prediction_history (model_version, market_group, match_ts)`,
  `CREATE TABLE IF NOT EXISTS match_analysis_snapshots (
    event_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    snapshot_kind TEXT NOT NULL,
    lineup_hash TEXT NOT NULL,
    match_ts INTEGER NOT NULL,
    home_confirmed INTEGER NOT NULL DEFAULT 0,
    away_confirmed INTEGER NOT NULL DEFAULT 0,
    p_home REAL,
    p_draw REAL,
    p_away REAL,
    p_over25 REAL,
    p_btts REAL,
    xg_home REAL,
    xg_away REAL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, model_version, snapshot_kind, lineup_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_match_analysis_snapshots_event ON match_analysis_snapshots(event_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS global_team_elo (
    team_id TEXT PRIMARY KEY,
    team_name TEXT,
    rating REAL NOT NULL DEFAULT 1500,
    matches INTEGER NOT NULL DEFAULT 0,
    last_ts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS global_elo_matches (
    event_id TEXT PRIMARY KEY,
    match_ts INTEGER NOT NULL,
    home_id TEXT NOT NULL,
    away_id TEXT NOT NULL,
    home_name TEXT,
    away_name TEXT,
    competition TEXT,
    home_goals INTEGER NOT NULL,
    away_goals INTEGER NOT NULL,
    pre_home_rating REAL NOT NULL,
    pre_away_rating REAL NOT NULL,
    post_home_rating REAL NOT NULL,
    post_away_rating REAL NOT NULL,
    home_matches_after INTEGER NOT NULL,
    away_matches_after INTEGER NOT NULL,
    processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_global_elo_match_ts ON global_elo_matches(match_ts)`,
  `CREATE INDEX IF NOT EXISTS idx_global_elo_home_ts ON global_elo_matches(home_id,match_ts)`,
  `CREATE INDEX IF NOT EXISTS idx_global_elo_away_ts ON global_elo_matches(away_id,match_ts)`,
  `CREATE TABLE IF NOT EXISTS app_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_cache_expiry ON app_cache(expires_at)`
];

function normalizeValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function normalizeSql(sql, params = []) {
  const bound = [];
  let text = String(sql)
    .replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/::(?:jsonb|text|int|integer|bigint|numeric|double\s+precision|boolean)(?:\[\])?/gi, '');
  text = text.replace(/\$(\d+)/g, (_, n) => {
    bound.push(normalizeValue(params[Number(n) - 1]));
    return '?';
  });
  return { text, bound };
}

function parseRows(rows) {
  return (rows || []).map(row => {
    const out = { ...row };
    for (const key of ['payload', 'metadata']) {
      const value = out[key];
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try { out[key] = JSON.parse(value); } catch {}
      }
    }
    return out;
  });
}

export function bindDatabase(next) {
  binding = next || null;
}

export function hasDatabase() {
  return !!binding;
}

export async function ensureSchema() {
  if (!binding || schemaReadyFor === binding) return !!binding;
  const statements = SCHEMA.map(sql => binding.prepare(sql));
  for (let i = 0; i < statements.length; i += 20) {
    await binding.batch(statements.slice(i, i + 20));
  }
  schemaReadyFor = binding;
  return true;
}

async function query(sql, params = []) {
  if (!binding) return { rows: [], rowCount: 0, missingBinding: true };
  const { text, bound } = normalizeSql(sql, params);
  if (bound.length > 100) throw new Error(`D1 parameter limit exceeded: ${bound.length}`);
  const stmt = binding.prepare(text).bind(...bound);
  const result = await stmt.run();
  return {
    rows: parseRows(result.results || []),
    rowCount: Number(result.meta?.changes || 0),
    meta: result.meta || {}
  };
}

async function transaction(ops = []) {
  if (!binding || !ops.length) return [];
  const statements = ops.map(op => {
    const { text, bound } = normalizeSql(op.sql, op.params || []);
    if (bound.length > 100) throw new Error(`D1 parameter limit exceeded: ${bound.length}`);
    return binding.prepare(text).bind(...bound);
  });
  const out = [];
  for (let i = 0; i < statements.length; i += 45) {
    const results = await binding.batch(statements.slice(i, i + 45));
    out.push(...results);
  }
  return out.map(result => ({
    rows: parseRows(result.results || []),
    rowCount: Number(result.meta?.changes || 0),
    meta: result.meta || {}
  }));
}

export const db = { query, transaction };
