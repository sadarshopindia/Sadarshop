// Script to update branding to "Sadarshop"
const { db } = require('../src/db');

const updates = [
  ['site_name',  'Sadarshop'],
  ['tagline',    'Premium Wholesale Fabrics & Textiles'],
  ['announcement', 'Welcome to Sadarshop — Premium Wholesale Fabrics & Textiles!'],
];

for (const [key, value] of updates) {
  const exists = db.prepare('SELECT 1 FROM settings WHERE key=?').get(key);
  if (exists) {
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(value, key);
    console.log(`Updated [${key}] → ${value}`);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run(key, value);
    console.log(`Inserted [${key}] → ${value}`);
  }
}

console.log('\nDone. Final branding values:');
const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('site_name','tagline','announcement')").all();
for (const r of rows) console.log(`  ${r.key}: ${r.value}`);
