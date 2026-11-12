const { db } = require('./src/db');
const { hashPassword } = require('./src/helpers');

const email = 'admin@example.com';
const newPassword = 'admin123';

console.log(`Resetting password for ${email}...`);
const user = db.prepare('SELECT id FROM users WHERE email=? AND role=?').get(email, 'admin');

if (!user) {
  console.log('Admin user not found. Checking if any admin exists...');
  const anyAdmin = db.prepare('SELECT email FROM users WHERE role=?').get('admin');
  if (anyAdmin) {
    console.log(`Found admin with email: ${anyAdmin.email}. Resetting...`);
    db.prepare('UPDATE users SET password_hash=? WHERE role=?').run(hashPassword(newPassword), 'admin');
    console.log(`\nSUCCESS: Password reset for ${anyAdmin.email} to: ${newPassword}`);
  } else {
    console.log('No admin user found at all! Creating one...');
    db.prepare('INSERT INTO users(name,email,phone,password_hash,role,account_type,company,status) VALUES(?,?,?,?,?,?,?,?)')
      .run('Store Administrator', email, '9876543210', hashPassword(newPassword), 'admin', 'wholesale', 'Sadarshop', 'active');
    console.log(`\nSUCCESS: Created new admin: ${email} with password: ${newPassword}`);
  }
} else {
  db.prepare('UPDATE users SET password_hash=?, company=? WHERE id=?').run(hashPassword(newPassword), 'Sadarshop', user.id);
  console.log(`\nSUCCESS: Successfully reset password for ${email} to: ${newPassword}`);
}

console.log('Done! You can now log in.');
