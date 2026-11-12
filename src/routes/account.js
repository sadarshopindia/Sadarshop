'use strict';
const { db } = require('../db');
const H = require('../helpers');

module.exports = function (r) {

  r.get('/login', (req, res) => {
    if (res.locals.user) return res.redirect('/account');
    res.render('account/login', { title: 'Sign in' });
  });

  r.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE LOWER(email)=?').get(email);
    if (!u || !H.verifyPassword(req.body.password, u.password_hash)) {
      req.flash('error', 'Email or password is incorrect.');
      let loginUrl = '/login?email=' + encodeURIComponent(email);
      if (req.body.next) loginUrl += '&next=' + encodeURIComponent(req.body.next);
      return res.redirect(loginUrl);
    }
    if (u.status === 'blocked') { return res.render('account/blocked', { title: 'Account Blocked' }); }
    req.session.uid = u.id;
    req.regenerate();
    req.saveSession();
    req.flash('ok', 'Welcome back, ' + u.name.split(' ')[0] + '.');
    const next = req.body.next && String(req.body.next).startsWith('/') ? req.body.next : (u.role === 'admin' ? '/admin' : '/account');
    res.redirect(next);
  });

  r.post('/logout', (req, res) => {
    delete req.session.uid; req.saveSession();
    req.flash('ok', 'Signed out.');
    res.redirect('/');
  });
  r.get('/logout', (req, res) => { delete req.session.uid; req.saveSession(); res.redirect('/'); });

  r.get('/register', (req, res) => {
    if (res.locals.user) return res.redirect('/account');
    res.render('account/register', { title: 'Create an account' });
  });

  r.post('/register', (req, res) => {
    const b = req.body;
    const email = String(b.email || '').trim().toLowerCase();
    const type = 'retail';
    if (!b.name || !email || !b.password) { req.flash('error', 'Please complete all required fields.'); return res.redirect('/register'); }
    if (String(b.password).length < 8) { req.flash('error', 'Password must be at least 8 characters.'); return res.redirect('/register'); }
    if (b.password !== b.password2) { req.flash('error', 'The two passwords do not match.'); return res.redirect('/register'); }

    if (db.prepare('SELECT id FROM users WHERE LOWER(email)=?').get(email)) {
      req.flash('error', 'An account with that email already exists. Try signing in.'); return res.redirect('/login');
    }
    const info = db.prepare(`INSERT INTO users(name,email,phone,password_hash,role,account_type,company,gstin,city,status)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.name, email, b.phone || '', H.hashPassword(b.password), 'customer',
      type, b.company || '', b.gstin || '', b.city || '', 'active');
    req.session.uid = Number(info.lastInsertRowid);
    
    // (Orders linking removed)

    req.regenerate(); req.saveSession();
    req.flash('ok', 'Account created. Welcome to Sadarshop.');
    res.redirect('/account');
  });

  function requireLogin(req, res) {
    if (!res.locals.user) { res.redirect('/login?next=' + encodeURIComponent(req.pathname)); return true; }
    return false;
  }

  r.get('/account', (req, res) => {
    if (requireLogin(req, res)) return;
    const u = res.locals.user;
    res.render('account/dashboard', {
      title: 'My account',
      enquiries: db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM enquiry_items WHERE enquiry_id=e.id) n
        FROM enquiries e WHERE e.user_id=? ORDER BY e.id DESC`).all(u.id)
    });
  });

  r.post('/account', (req, res) => {
    if (requireLogin(req, res)) return;
    const u = res.locals.user; const b = req.body;
    db.prepare('UPDATE users SET name=?,phone=?,company=?,gstin=?,city=? WHERE id=?')
      .run(b.name || u.name, b.phone || '', b.company || '', b.gstin || '', b.city || '', u.id);
    if (b.password && String(b.password).length >= 8)
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(H.hashPassword(b.password), u.id);
    req.flash('ok', 'Your details have been saved.');
    res.redirect('/account');
  });
  r.get('/forgot', (req, res) => {
    if (res.locals.user) return res.redirect('/account');
    res.render('account/forgot', { title: 'Reset password' });
  });

  r.post('/forgot', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT id, name FROM users WHERE LOWER(email)=? AND status!=?').get(email, 'blocked');
    
    if (u) {
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 3600000; // 1 hour
      db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?').run(token, expires, u.id);
      
      const resetLink = req.protocol + '://' + req.get('host') + '/reset?token=' + token;
      
      try {
        const nodemailer = require('nodemailer');
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        const info = await transporter.sendMail({
          from: '"' + S.site_name + '" <noreply@' + new URL(SITE_URL).hostname + '>',
          to: email,
          subject: "Password Reset Request",
          text: `Hi ${u.name.split(' ')[0]},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request this, please ignore this email.`,
        });
        console.log("-----------------------------------------");
        console.log("PASSWORD RESET EMAIL SENT!");
        console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
        console.log("-----------------------------------------");
      } catch (err) {
        console.error("Failed to send reset email:", err);
      }
    }
    
    req.flash('ok', 'If that email address is in our system, we have sent a password reset link to it.');
    res.redirect('/login');
  });

  r.get('/reset', (req, res) => {
    if (res.locals.user) return res.redirect('/account');
    const token = req.query.token;
    if (!token) return res.redirect('/login');
    const u = db.prepare('SELECT id FROM users WHERE reset_token=? AND reset_expires>?').get(token, Date.now());
    if (!u) {
      req.flash('error', 'Password reset link is invalid or has expired.');
      return res.redirect('/forgot');
    }
    res.render('account/reset', { title: 'Set new password' });
  });

  r.post('/reset', (req, res) => {
    const token = req.body.token;
    const pwd = req.body.password;
    if (!token || !pwd || String(pwd).length < 8 || pwd !== req.body.password_confirm) {
      req.flash('error', 'Passwords must match and be at least 8 characters.');
      return res.redirect('/reset?token=' + encodeURIComponent(token||''));
    }
    
    const u = db.prepare('SELECT id FROM users WHERE reset_token=? AND reset_expires>?').get(token, Date.now());
    if (!u) {
      req.flash('error', 'Password reset link is invalid or has expired.');
      return res.redirect('/forgot');
    }
    
    db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?')
      .run(H.hashPassword(pwd), u.id);
      
    req.flash('ok', 'Your password has been reset successfully. Please sign in.');
    res.redirect('/login');
  });
};
