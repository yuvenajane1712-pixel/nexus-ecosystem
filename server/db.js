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

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  name TEXT,
  spec TEXT,           -- size/color/variant/material etc, free text
  unit_price REAL DEFAULT 0,
  qty INTEGER DEFAULT 1,
  cbm REAL DEFAULT 0,   -- total CBM for this line (already qty-adjusted)
  photo_data TEXT,      -- base64 data URL, optional
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

-- Track B: Indonesian product catalog (coffee, spices, bird's nest, etc.)
CREATE TABLE IF NOT EXISTS catalog_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  name TEXT,
  grade TEXT,
  ready_stock INTEGER DEFAULT 1,
  fob_price REAL,
  cif_price REAL,
  futures_price REAL,
  certificate_docs TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Track B: orders (Indonesian sourcing for Chinese buyers)
CREATE TABLE IF NOT EXISTS track_b_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_name TEXT,
  product_summary TEXT,
  profit_model TEXT,
  fee_rate REAL,
  cost_price REAL,
  selling_price REAL,
  freight REAL,
  insurance REAL,
  vat REAL,
  misc_fees REAL,
  profit REAL,
  margin_pct REAL,
  payment_method TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Versioned recipe database ("Menu Blockchain")
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_group TEXT,
  name TEXT,
  category TEXT,
  ingredients_json TEXT,
  unit_cost REAL,
  total_cost REAL,
  instructions TEXT,
  prep_time TEXT,
  shelf_life TEXT,
  storage_method TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Grocery price comparison log
CREATE TABLE IF NOT EXISTS grocery_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT,
  channel TEXT,
  unit_price REAL,
  delivery_fee REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Blockchain startup learning log
CREATE TABLE IF NOT EXISTS blockchain_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT,
  title TEXT,
  content TEXT,
  progress_pct REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Social media content calendar + generated scripts
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT,
  post_date TEXT,
  topic TEXT,
  script TEXT,
  equipment TEXT,
  video_length TEXT,
  best_time TEXT,
  platforms TEXT,
  status TEXT DEFAULT 'planned',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tour itinerary generator outputs
CREATE TABLE IF NOT EXISTS itineraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destinations TEXT,
  days INTEGER,
  schedule_json TEXT,
  ticket_cost_total REAL,
  fee_total REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

try { db.exec("ALTER TABLE clients ADD COLUMN trust_rating TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN order_count INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN order_value_total REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN certificates TEXT"); } catch (e) {}

// Nadylan Track A redesign: line-item based orders with a 7-stage status pipeline
try { db.exec("ALTER TABLE orders ADD COLUMN pipeline_status TEXT DEFAULT 'lagi_dicari'"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN tracking_code TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN cbm_total REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN logistics_rate_per_cbm REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN logistics_supplier_to_cn REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN logistics_id_to_buyer REAL DEFAULT 0"); } catch (e) {}

// Track B: detailed spec fields (esp. coffee) + certificates
try { db.exec("ALTER TABLE catalog_products ADD COLUMN process TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN altitude TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN defect_pct REAL"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN moisture_pct REAL"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN variety TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN moq_kg REAL"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN packaging_kg_per_jute REAL"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN price_idr_per_kg REAL"); } catch (e) {}
try { db.exec("ALTER TABLE catalog_products ADD COLUMN price_rmb_per_kg REAL"); } catch (e) {}

// Guangzhou Mate: booking fee
try { db.exec("ALTER TABLE tours ADD COLUMN booking_fee REAL DEFAULT 0"); } catch (e) {}

// Health logs: macro breakdown
try { db.exec("ALTER TABLE health_logs ADD COLUMN protein REAL"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN fat REAL"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN carbs REAL"); } catch (e) {}

// Pet logs: structured fields for distinct forms
try { db.exec("ALTER TABLE pet_logs ADD COLUMN weight_kg REAL"); } catch (e) {}
try { db.exec("ALTER TABLE pet_logs ADD COLUMN stool_type TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE pet_logs ADD COLUMN urination_count INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE pet_logs ADD COLUMN heart_rate INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE pet_logs ADD COLUMN food_grams REAL"); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS pet_feeding_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_name TEXT,
  log_date TEXT,
  meal TEXT,          -- 'AM' | 'PM'
  fed INTEGER DEFAULT 0,
  UNIQUE(pet_name, log_date, meal)
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
