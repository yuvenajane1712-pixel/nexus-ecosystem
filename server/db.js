const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "nexus.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,                 -- 'supplier' | 'buyer'
  name TEXT,
  contact TEXT,
  tier TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  category TEXT,
  unit_price REAL,
  cbm REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_name TEXT,
  product_summary TEXT,
  product_cost REAL,
  fee_pct REAL,
  logistics_cost REAL,
  service_fee REAL,
  total_payment REAL,
  net_profit REAL,
  fx_rate REAL,
  urgency INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open',   -- open | completed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_type TEXT,      -- 'bigbus' | 'private'
  tier_name TEXT,
  pax_or_days INTEGER,
  revenue REAL,
  cost REAL,
  margin REAL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT,        -- 'Nadine' | 'Yuvena'
  log_type TEXT,         -- 'diet' | 'workout' | 'metric' | 'supplement' | 'grocery'
  title TEXT,
  value TEXT,
  calories REAL,
  cost_rmb REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pet_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_name TEXT,
  log_type TEXT,         -- 'diet' | 'health' | 'supplement' | 'grocery'
  title TEXT,
  value TEXT,
  cost_rmb REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,              -- 'income' | 'expense'
  category TEXT,
  amount_rmb REAL,
  source TEXT,            -- 'manual' | 'business' | 'health' | 'pet'
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT,
  price_rmb REAL,
  priority INTEGER DEFAULT 0,
  saved_rmb REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// seed baseline config constants (only once)
const defaults = {
  fx_rate_idr_per_rmb: "2180",
  living_reserve_rmb: "125000",
  monthly_cap_rmb: "5000",
  rent_cap_rmb: "3000",
  grocery_cap_rmb: "1000",
  utilities_cap_rmb: "80",
  transport_cap_rmb: "200",
  revenue_goal_idr: "5000000000",
  revenue_goal_deadline: "2026-12-31"
};
const insertDefault = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(defaults)) insertDefault.run(k, v);

module.exports = db;
