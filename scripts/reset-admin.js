// Reset admin credentials and update site_logo to Sadarshop SVG
const { db } = require('../src/db');
const crypto = require('crypto');

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// 1. Update site_logo to the new SVG brand logo
const logoExists = db.prepare("SELECT 1 FROM settings WHERE key='site_logo'").get();
if (logoExists) {
  db.prepare("UPDATE settings SET value=? WHERE key='site_logo'").run('/static/img/brand/logo.svg');
} else {
  db.prepare("INSERT INTO settings(key,value) VALUES('site_logo',?)").run('/static/img/brand/logo.svg');
}
console.log('Updated site_logo → /static/img/brand/logo.svg');

// 2. Reset admin password to admin123
const newPassword = 'admin123';
const newHash = hashPassword(newPassword);
const result = db.prepare("UPDATE users SET password_hash=? WHERE role='admin'").run(newHash);
console.log(`Reset ${result.changes} admin user(s) password → admin123`);

// 3. Confirm admin email
const admin = db.prepare("SELECT email, role FROM users WHERE role='admin'").get();
console.log('\n=== Admin Credentials ===');
console.log('Email:   ', admin ? admin.email : 'NOT FOUND');
console.log('Password: admin123');
console.log('URL:      http://localhost:3000/admin/login');
console.log('=========================');
