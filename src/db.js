'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');

/* Open the database. Some cloud-synced or network folders (Dropbox, OneDrive,
   network drives) cannot host a SQLite file. If that happens, fall back to a
   local folder and say so loudly rather than crashing. */
function open() {
  const preferred = process.env.DB_FILE || (fs.existsSync(path.join(DIR, 'sadarshop.db')) ? path.join(DIR, 'sadarshop.db') : path.join(DIR, 'satnam.db'));
  const attempts = [preferred, path.join(os.tmpdir(), 'sadarshop', path.basename(preferred))];
  let lastErr;
  for (const file of attempts) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (file !== preferred && fs.existsSync(preferred)) {
        const pStat = fs.statSync(preferred);
        const fStat = fs.existsSync(file) ? fs.statSync(file) : null;
        if (!fStat || pStat.mtimeMs > fStat.mtimeMs || pStat.size !== fStat.size) {
          fs.copyFileSync(preferred, file);
          if (fs.existsSync(preferred + '-wal')) fs.copyFileSync(preferred + '-wal', file + '-wal');
          if (fs.existsSync(preferred + '-shm')) fs.copyFileSync(preferred + '-shm', file + '-shm');
        }
      }
      const d = new DatabaseSync(file);
      d.exec('CREATE TABLE IF NOT EXISTS __probe(x INTEGER)');
      d.exec('DROP TABLE __probe');
      if (file !== preferred) {
        console.warn('\n  ⚠  This folder cannot store a database (often the case on');
        console.warn('     network drives or cloud-synced folders like Dropbox).');
        console.warn('     Using ' + file + ' instead.');
        console.warn('     Move the site to a normal folder on your hard drive,');
        console.warn('     or set DB_FILE to a writable path, to keep your data safe.\n');
      }
      return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const db = open();

try { db.exec('PRAGMA journal_mode = WAL;'); }
catch { try { db.exec('PRAGMA journal_mode = DELETE;'); } catch { /* keep the default */ } }
try { db.exec('PRAGMA foreign_keys = ON;'); db.exec('PRAGMA busy_timeout = 5000;'); } catch { /* ignore */ }

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  short_desc TEXT DEFAULT '',
  description TEXT DEFAULT '',
  mrp REAL DEFAULT 0,
  price REAL DEFAULT 0,
  tiers TEXT DEFAULT '[]',
  moq INTEGER DEFAULT 1,
  unit TEXT DEFAULT 'pack',
  pack_size TEXT DEFAULT '',
  weight_g INTEGER DEFAULT 0,
  stock INTEGER DEFAULT 0,
  images TEXT DEFAULT '[]',
  hsn TEXT DEFAULT '',
  gst_rate REAL DEFAULT 18,
  is_active INTEGER DEFAULT 1,
  is_featured INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'customer',
  account_type TEXT DEFAULT 'retail',
  company TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  city TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  reset_token TEXT,
  reset_expires INTEGER
);



CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home', name TEXT, phone TEXT,
  line1 TEXT, line2 TEXT DEFAULT '', city TEXT, state TEXT, pincode TEXT,
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, data TEXT DEFAULT '{}', expires INTEGER
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'cart',
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  UNIQUE(token, kind, product_id)
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(token, product_id)
);


CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_no TEXT UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT, email TEXT, phone TEXT, company TEXT DEFAULT '', gstin TEXT DEFAULT '',
  city TEXT DEFAULT '', message TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  quoted_total REAL DEFAULT 0, quote_notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enquiry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE CASCADE,
  product_id INTEGER, sku TEXT, name TEXT,
  qty INTEGER, list_price REAL DEFAULT 0, quoted_price REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE, title TEXT, body TEXT, is_active INTEGER DEFAULT 1
);


CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT, phone TEXT, subject TEXT, body TEXT,
  is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now'))
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT;'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_expires INTEGER;'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN parent_id INTEGER REFERENCES products(id) ON DELETE SET NULL;'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN opts TEXT DEFAULT "{}";'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN meta_title TEXT DEFAULT "";'); } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN meta_desc TEXT DEFAULT "";'); } catch {}

const setting = {
  get(key, fallback = '') {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r ? r.value : fallback;
  },
  set(key, value) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, String(value));
  },
  all() {
    const out = {};
    for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
    return out;
  }
};

module.exports = { db, setting };
