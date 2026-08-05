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

// Business Tracker dual-currency support on line items
try { db.exec("ALTER TABLE order_items ADD COLUMN currency TEXT DEFAULT 'RMB'"); } catch (e) {}

// CRM restructure: separate structured contact fields
try { db.exec("ALTER TABLE clients ADD COLUMN company_name TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN person_name TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN whatsapp TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN wechat TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN phone TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN address TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN alibaba_link TEXT"); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS client_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  cert_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  height_cm REAL,
  weight_kg REAL,
  age INTEGER,
  gender TEXT,               -- 'male' | 'female'
  activity_level TEXT DEFAULT 'moderate',  -- sedentary | light | moderate | active | very_active
  no_red_meat INTEGER DEFAULT 0,
  gluten_free INTEGER DEFAULT 0,
  dairy_free INTEGER DEFAULT 0,
  soy_free INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  category TEXT,              -- protein | carb | veggie | fruit | fat | other
  calories_per100 REAL,
  protein_per100 REAL,
  fat_per100 REAL,
  carbs_per100 REAL,
  fiber_per100 REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  log_date TEXT,
  wake_time TEXT,
  sleep_time TEXT,
  breakfast_time TEXT,
  lunch_time TEXT,
  snack_time TEXT,
  dinner_time TEXT,
  workout_time TEXT,
  UNIQUE(person_id, log_date)
);
`);

// health_logs: add person_id, meal_slot, food_item_id, grams (for the new meal-based diet logging)
try { db.exec("ALTER TABLE health_logs ADD COLUMN person_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN meal_slot TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN food_item_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN grams REAL"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN fiber REAL"); } catch (e) {}

// Track B: unlimited cost line items per pricing model (FOB / CIF / Futures)
db.exec(`
CREATE TABLE IF NOT EXISTS track_b_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_product_id INTEGER,
  price_type TEXT,      -- 'FOB' | 'CIF' | 'Futures'
  label TEXT,
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Track B: new 12-stage status pipeline, and profit-mode support
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN pipeline_status TEXT DEFAULT 'buyer_asking'"); } catch (e) {}

// Track B: link to catalog product, per-field currency, own fx rate
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN catalog_product_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN fx_rate REAL"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN cost_currency TEXT DEFAULT 'RMB'"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN selling_currency TEXT DEFAULT 'RMB'"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN freight_currency TEXT DEFAULT 'RMB'"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN insurance_currency TEXT DEFAULT 'RMB'"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN vat_currency TEXT DEFAULT 'RMB'"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN misc_currency TEXT DEFAULT 'RMB'"); } catch (e) {}

// Nadylan A: category-adaptive product specs (different fields per category, stored as JSON)
try { db.exec("ALTER TABLE order_items ADD COLUMN category TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE order_items ADD COLUMN spec_json TEXT"); } catch (e) {}

// Health: poop/pee quick-tap event log, workout custom name, grocery grams
db.exec(`
CREATE TABLE IF NOT EXISTS bathroom_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_name TEXT,
  kind TEXT,          -- 'pee' | 'poop'
  logged_at TEXT DEFAULT (datetime('now'))
);
`);
try { db.exec("ALTER TABLE health_logs ADD COLUMN grocery_grams REAL"); } catch (e) {}
try { db.exec("ALTER TABLE food_items ADD COLUMN grams_per_piece REAL"); } catch (e) {}
try { db.exec("ALTER TABLE food_items ADD COLUMN grams_per_ml REAL"); } catch (e) {}
try { db.exec("ALTER TABLE recipes ADD COLUMN total_calories REAL"); } catch (e) {}
try { db.exec("ALTER TABLE menu_ingredients ADD COLUMN calories REAL"); } catch (e) {}
try { db.exec("ALTER TABLE menu_ingredients ADD COLUMN protein REAL"); } catch (e) {}
try { db.exec("ALTER TABLE menu_ingredients ADD COLUMN fat REAL"); } catch (e) {}
try { db.exec("ALTER TABLE menu_ingredients ADD COLUMN carbs REAL"); } catch (e) {}
try { db.exec("ALTER TABLE bathroom_log ADD COLUMN stool_type TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE bathroom_log ADD COLUMN pee_color TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE grocery_prices ADD COLUMN total_weight_g REAL"); } catch (e) {}
try { db.exec("ALTER TABLE grocery_prices ADD COLUMN total_price REAL"); } catch (e) {}

// Track A: product catalog with unlimited variant prices
db.exec(`
CREATE TABLE IF NOT EXISTS track_a_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS track_a_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  spec_label TEXT,
  price REAL,
  currency TEXT DEFAULT 'RMB',
  created_at TEXT DEFAULT (datetime('now'))
);
`);
try { db.exec("ALTER TABLE order_items ADD COLUMN track_a_variant_id INTEGER"); } catch (e) {}

// Guangzhou Mate: client + pax breakdown + cost/payment fields
try { db.exec("ALTER TABLE tours ADD COLUMN client_name TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN travel_date TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN pax_adults INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN pax_children INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN pax_infants INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN pax_elderly INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN amount_client_pays REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN tour_category TEXT DEFAULT 'bigbus'"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN date_from TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN date_to TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN days INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN destinations TEXT"); } catch (e) {}

// Health: per-person excluded foods (X out proteins/carbs they don't eat)
try { db.exec("ALTER TABLE people ADD COLUMN excluded_foods TEXT DEFAULT '[]'"); } catch (e) {}

// Weekly menu planner
db.exec(`
CREATE TABLE IF NOT EXISTS weekly_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT,          -- Monday's date, YYYY-MM-DD
  day_of_week INTEGER,      -- 0=Mon .. 6=Sun
  meal_slot TEXT,           -- breakfast | lunch | dinner
  menu_name TEXT,
  participants_json TEXT DEFAULT '[]',
  ingredients_json TEXT DEFAULT '[]',   -- [{name, grams}]
  created_at TEXT DEFAULT (datetime('now'))
);
`);
try { db.exec("ALTER TABLE people ADD COLUMN goal_type TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE supplement_checklist ADD COLUMN taken_time TEXT"); } catch (e) {}

// Nadylan Track A: markup/fee choice, invoice numbering, payment date, carrier tracking code
try { db.exec("ALTER TABLE orders ADD COLUMN markup_mode TEXT DEFAULT 'fee'"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN markup_pct REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN invoice_number TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_date TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN logistics_tracking_code TEXT"); } catch (e) {}

// Track B: invoice numbering, payment date
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN invoice_number TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN payment_date TEXT"); } catch (e) {}

// Tours: invoice numbering, payment date
try { db.exec("ALTER TABLE tours ADD COLUMN invoice_number TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN payment_date TEXT"); } catch (e) {}

// Saved bank accounts (selectable per invoice, not tied to one CRM contact)
db.exec(`
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT,
  account_name TEXT,
  account_number TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// CRM: bank fields on any contact (e.g. supplier's own bank info), and a dedicated "team_member" kind
try { db.exec("ALTER TABLE clients ADD COLUMN bank_name TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN bank_account_name TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN bank_account_number TEXT"); } catch (e) {}

// Orders: which saved bank account + which team member to show on the invoice
try { db.exec("ALTER TABLE orders ADD COLUMN bank_account_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN team_member_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN bank_account_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN team_member_id INTEGER"); } catch (e) {}

// Guangzhou Mate: itemized customer-facing cost list, food preferences, new 5-stage status
db.exec(`
CREATE TABLE IF NOT EXISTS tour_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id INTEGER,
  label TEXT,
  amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);
try { db.exec("ALTER TABLE tours ADD COLUMN food_wanted TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN food_avoid TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN tour_status TEXT DEFAULT 'just_order'"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN feedback_json TEXT"); } catch (e) {}

// Track A: richer product catalog (quality, photo, specs count, colors, supplier link, CBM logistics cost)
try { db.exec("ALTER TABLE track_a_products ADD COLUMN quality TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN photo_data TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN specs_count INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN colors TEXT DEFAULT '[]'"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN supplier_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN cost_per_cbm_intl REAL"); } catch (e) {}
try { db.exec("ALTER TABLE track_a_products ADD COLUMN markup_pct REAL DEFAULT 0"); } catch (e) {}

// Track B: per-kg pricing (IDR and RMB) as an alternative to total cost/selling price
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN price_per_kg_idr REAL"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN price_per_kg_rmb REAL"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN bank_account_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN team_member_id INTEGER"); } catch (e) {}

// Guangzhou Mate: cost items need currency + ownership (customer-facing IDR vs our-cost RMB)
try { db.exec("ALTER TABLE tour_cost_items ADD COLUMN currency TEXT DEFAULT 'IDR'"); } catch (e) {}
try { db.exec("ALTER TABLE tour_cost_items ADD COLUMN is_ours INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN invoice_lang TEXT DEFAULT 'en'"); } catch (e) {}
try { db.exec("ALTER TABLE tours ADD COLUMN price_per_unit_cache REAL DEFAULT 0"); } catch (e) {}

// Contact Info: email address
try { db.exec("ALTER TABLE clients ADD COLUMN email TEXT"); } catch (e) {}

// logistics provider selection for invoices (Track A and Track B)
try { db.exec("ALTER TABLE orders ADD COLUMN logistics_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE track_b_orders ADD COLUMN logistics_id INTEGER"); } catch (e) {}

// Health: body conditions + goal type, feeding into the recommendation engine
try { db.exec("ALTER TABLE people ADD COLUMN body_problems TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE people ADD COLUMN goal_type TEXT"); } catch (e) {}

// Daily menu planning: unlimited ingredients, per-person checklist, weekly grocery aggregation
db.exec(`
CREATE TABLE IF NOT EXISTS daily_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT,
  meal_slot TEXT,          -- breakfast | lunch | dinner | snack
  menu_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS menu_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER,
  person_name TEXT,
  eaten INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER,
  name TEXT,
  grams REAL DEFAULT 0
);
`);

// allow explicit log_date on health_logs (for backdating workouts etc.), defaults to now via app logic
try { db.exec("ALTER TABLE health_logs ADD COLUMN log_date TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE health_logs ADD COLUMN steps INTEGER"); } catch (e) {}

// People: weight goal + target date, water target
try { db.exec("ALTER TABLE people ADD COLUMN goal_weight_kg REAL"); } catch (e) {}
try { db.exec("ALTER TABLE people ADD COLUMN goal_date TEXT"); } catch (e) {}

// Supplements: per-person and per-pet, with daily tick checklist
db.exec(`
CREATE TABLE IF NOT EXISTS supplement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT,       -- 'person' | 'pet'
  owner_name TEXT,
  name TEXT,
  portion TEXT,          -- e.g. "500mg" or "1 tablet" or "5g"
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS supplement_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplement_id INTEGER,
  log_date TEXT,
  taken INTEGER DEFAULT 0,
  taken_time TEXT,
  UNIQUE(supplement_id, log_date)
);
`);

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
  revenue_goal_deadline: "2026-12-31",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  company_name: "Nadylan",
};
const insertDefault = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(defaults)) insertDefault.run(k, v);

module.exports = db;
