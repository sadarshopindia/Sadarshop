'use strict';
/* Satnam Threads — storefront + admin. Zero external dependencies. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/* minimal .env loader */
(() => {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
})();

const { db, setting } = require('./src/db');
const H = require('./src/helpers');
const ST = require('./src/store');
const session = require('./src/session');
const { Router, parseCookies, parseQuery, decorate, serveStatic, bodyParser } = require('./src/http');

/* seed on first run */
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  require('./src/seed').run();
  try { require('./src/gen-images').run(); } catch (e) { console.warn('Image generation skipped:', e.message); }
}

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || 'https://satnamthreads.com').replace(/\/$/, '');

const router = new Router();

/* ---------- global middleware ---------- */
router.use(async (req, res) => {
  decorate(req, res);
  const u = new URL(req.url, 'http://x');
  req.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  req.query = parseQuery(u.search.slice(1));
  req.cookies = parseCookies(req.headers.cookie);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (serveStatic(req, res) === false) return false;
  await bodyParser(req);
  session.attach(req, res);

  const user = req.session.uid
    ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.uid) : null;
  const token = user ? 'u' + user.id : req.sid;

  /* merge a guest basket into the account basket on login */
  if (user && req.session.mergedFrom !== req.sid) {
    for (const kind of ['enquiry']) {
      const guest = db.prepare('SELECT * FROM cart_items WHERE token=? AND kind=?').all(req.sid, kind);
      for (const g of guest) {
        const has = db.prepare('SELECT id,qty FROM cart_items WHERE token=? AND kind=? AND product_id=?').get(token, kind, g.product_id);
        if (has) db.prepare('UPDATE cart_items SET qty=? WHERE id=?').run(has.qty + g.qty, has.id);
        else db.prepare('INSERT INTO cart_items(token,kind,product_id,qty) VALUES(?,?,?,?)').run(token, kind, g.product_id, g.qty);
      }
      db.prepare('DELETE FROM cart_items WHERE token=? AND kind=?').run(req.sid, kind);
    }
    db.prepare('UPDATE wishlist SET token=? WHERE token=?').run(token, req.sid);
    req.session.mergedFrom = req.sid; req.saveSession();
  }

  const flash = req.session.flash || [];
  if (flash.length) { req.session.flash = []; req.saveSession(); }

  const tree = ST.categoryTree();
  const S = setting.all();
  res.locals = {
    S, SITE_URL, path: req.pathname, query: req.query, user, token, flash,
    tree: tree.roots,
    isWholesale: !!(user && user.account_type === 'wholesale' && user.status === 'active'),
    counts: {
      enq: ST.cartCount(token, 'enquiry'),
      wish: db.prepare('SELECT COUNT(*) n FROM wishlist WHERE token=?').get(token).n
    },
    wishIds: ST.wishIdsFor(token),
    money: H.money, moneyShort: H.moneyShort, fmtDate: H.fmtDate, timeAgo: H.timeAgo,
    firstImage: H.firstImage, discountPct: H.discountPct, priceFor: H.priceFor,
    tiersOf: ST.tiersOf, json: H.json, title: '', highlightText: H.highlightText
  };
});

require('./src/routes/shop')(router);

require('./src/routes/account')(router);
require('./src/routes/admin')(router);

const server = http.createServer((req, res) => {
  router.handle(req, res).catch(err => {
    console.error('Request error:', req.method, req.url, err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      try { res.render('shop/404', { title: 'Something went wrong' }); }
      catch { res.end('Internal server error'); }
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │  Satnam Threads is running                   │');
  console.log('  ├──────────────────────────────────────────────┤');
  console.log(`  │  Storefront   http://localhost:${PORT}          │`);
  console.log(`  │  Admin panel  http://localhost:${PORT}/admin    │`);
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  console.log('  Admin login:  admin@satnamthreads.com / satnam@2026');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
