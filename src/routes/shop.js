'use strict';
const { db, setting } = require('../db');
const H = require('../helpers');
const ST = require('../store');

module.exports = function (r) {

  /* ---------------- home ---------------- */
  r.get('/', (req, res) => {
    const tree = res.locals.tree;
    const topCats = [];
    for (const g of tree) { topCats.push(g); for (const c of g.children) topCats.push(c); }
    res.render('shop/home', {
      title: '', topCats: topCats.slice(0, 12),
      featured: db.prepare(`SELECT p.*,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.is_active=1 AND p.parent_id IS NULL AND p.is_featured=1 ORDER BY p.review_count DESC LIMIT 4`).all(),
      latest: db.prepare(`SELECT p.*,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.is_active=1 AND p.parent_id IS NULL ORDER BY p.is_new DESC, p.id DESC LIMIT 4`).all()
    });
  });

  /* ---------------- catalogue ---------------- */
  function listing(req, res, cat) {
    const q = req.query;
    const per = [12, 24, 48].includes(Number(q.per)) ? Number(q.per) : 12;
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const first = ST.productsQuery({
      q: q.q, catId: cat ? cat.id : null, instock: q.instock,
      isNew: q.new, wt: q.wt, sort: q.sort, limit: per, offset: (page - 1) * per
    });
    const pg = H.paginate(first.total, page, per);
    const result = pg.offset === (page - 1) * per ? first
      : ST.productsQuery({ q: q.q, catId: cat ? cat.id : null, instock: q.instock,
          isNew: q.new, wt: q.wt, sort: q.sort, limit: per, offset: pg.offset });

    const base = cat ? '/c/' + cat.slug : '/products';
    const pageUrl = n => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (k !== 'page' && v) p.set(k, v);
      p.set('page', n);
      return base + '?' + p.toString();
    };
    let parent = null;
    if (cat && cat.parent_id) parent = db.prepare('SELECT * FROM categories WHERE id=?').get(cat.parent_id);

    res.render('shop/products', {
      title: cat ? cat.name : (q.q ? 'Search: ' + q.q : 'All products'),
      metaDesc: cat ? cat.description : 'Browse the full catalogue.',
      cat: cat ? Object.assign({}, cat, { parent }) : null,
      heading: cat ? cat.name : (q.q ? `Results for “${q.q}”` : 'The full catalogue'),
      subheading: cat ? (cat.description || '') : (q.q ? 'Matching products from across the catalogue.' : 'Everything we stock, from tagging guns to organza pouches.'),
      products: result.rows, pg, pageUrl,
      totalAll: db.prepare('SELECT COUNT(*) n FROM products WHERE is_active=1 AND parent_id IS NULL').get().n,
      jsonld: {
        '@context': 'https://schema.org', '@type': 'ItemList',
        itemListElement: result.rows.slice(0, 12).map((p, i) => ({
          '@type': 'ListItem', position: i + 1, url: res.locals.SITE_URL + '/p/' + p.slug, name: p.name
        }))
      }
    });
  }

  r.get('/products', (req, res) => listing(req, res, null));
  r.get('/api/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.json({ results: [] });
    const catSlug = req.query.c || '';
    let catId = null;
    if (catSlug) {
      const cat = db.prepare('SELECT id FROM categories WHERE slug=? AND is_active=1').get(catSlug);
      if (cat) catId = cat.id;
    }
    const result = ST.productsQuery({ q, catId, limit: 12, offset: 0 });
    const suggestions = result.rows.map(p => {
      let img = '/static/img/placeholder.svg';
      try { const imgs = JSON.parse(p.images); if(imgs.length) img = imgs[0]; } catch(e){}
      return {
        id: p.id,
        title: p.name,
        slug: p.slug,
        category: p.cat || '',
        image: img
      };
    });
    res.json({ results: suggestions });
  });
  r.get('/c/:slug', (req, res) => {
    const cat = db.prepare('SELECT * FROM categories WHERE slug=? AND is_active=1').get(req.params.slug);
    if (!cat) return res.status(404).render('shop/404', { title: 'Not found' });
    listing(req, res, cat);
  });

  /* ---------------- product ---------------- */
  r.get('/debug-db', async (req, res) => {
    const count = db.prepare('SELECT count(*) as c FROM products').get().c;
    res.send(`DB Products: ${count} | DB Path: ${process.env.DB_FILE || 'default or fallback'}`);
  });

  r.get('/force-import', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const preferred = process.env.DB_FILE || (fs.existsSync(path.join(__dirname, '..', 'data', 'sadarshop.db')) ? path.join(__dirname, '..', 'data', 'sadarshop.db') : path.join(__dirname, '..', 'data', 'satnam.db'));
    const fallback = path.join(os.tmpdir(), 'sadarshop', path.basename(preferred));
    try {
      if (fs.existsSync(preferred)) {
        fs.copyFileSync(preferred, fallback);
        res.send('Database forcefully imported from Git! Go back to the homepage.');
      } else {
        res.send('Git database not found!');
      }
    } catch(e) {
      res.send('Error: ' + e.message);
    }
  });
  r.get('/p/:slug', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE slug=? AND is_active=1').get(req.params.slug);
    if (!p) return res.status(404).render('shop/404', { title: 'Not found' });
    const parentId = p.parent_id ? p.parent_id : p.id;
    const parent = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(parentId);
    const children = db.prepare('SELECT * FROM products WHERE parent_id=? AND is_active=1 ORDER BY id').all(parentId);
    let variants = [];
    if (parent) variants.push(parent);
    variants = variants.concat(children);
    if (variants.length <= 1) variants = [];
    let cat = p.category_id ? db.prepare('SELECT * FROM categories WHERE id=?').get(p.category_id) : null;
    if (cat && cat.parent_id) cat = Object.assign({}, cat, { parent: db.prepare('SELECT * FROM categories WHERE id=?').get(cat.parent_id) });
    const related = p.category_id
      ? db.prepare(`SELECT p.*,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
          WHERE p.is_active=1 AND p.parent_id IS NULL AND p.category_id=? AND p.id<>? ORDER BY RANDOM() LIMIT 4`).all(p.category_id, p.id)
      : [];
    const extra = related.length < 4
      ? db.prepare(`SELECT p.*,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
          WHERE p.is_active=1 AND p.parent_id IS NULL AND p.id<>? ORDER BY p.is_featured DESC, RANDOM() LIMIT ?`).all(p.id, 4 - related.length)
      : [];
    const images = H.json(p.images, []) || [];
    if (variants.length) {
      variants.forEach(v => {
        const vImgs = H.json(v.images, []) || [];
        vImgs.forEach(img => { if (!images.includes(img)) images.push(img); });
      });
    }
    res.render('shop/product', {
      title: p.meta_title || p.name, metaDesc: p.meta_desc || p.short_desc, p, cat, variants,
      images: images.length ? images : ['/static/img/placeholder.svg'],
      tiers: ST.tiersOf(p), unitPrice: H.priceFor(p, p.moq || 1, res.locals.user),
      related: related.concat(extra.filter(e => !related.find(r2 => r2.id === e.id))).slice(0, 4),
      jsonld: {
        '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku,
        description: p.short_desc, image: res.locals.SITE_URL + (images[0] || ''),
        brand: { '@type': 'Brand', name: res.locals.S.site_name || 'Sadarshop' },
        aggregateRating: p.review_count ? { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.review_count } : undefined
      }
    });
  });

  /* ---------------- enquiry ---------------- */
  r.get('/enquiry', (req, res) => {
    const items = ST.cartRows(res.locals.token, 'enquiry', res.locals.user);
    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
    res.render('shop/enquiry', { title: 'Enquiry list', items, totalQty });
  });

  r.post('/enquiry/add', (req, res) => {
    const id = Number(req.body.id);
    const qty = Math.max(1, Number(req.body.qty) || 1);
    const tk = res.locals.token;
    if (id) {
      const has = db.prepare('SELECT id, qty FROM cart_items WHERE token=? AND kind=? AND product_id=?').get(tk, 'enquiry', id);
      if (has) db.prepare('UPDATE cart_items SET qty=? WHERE id=?').run(has.qty + qty, has.id);
      else try { db.prepare('INSERT INTO cart_items(token,kind,product_id,qty) VALUES(?,?,?,?)').run(tk, 'enquiry', id, qty); } catch(e) { console.error(e); }
    }
    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
    if (isAjax) {
      const count = db.prepare('SELECT SUM(qty) s FROM cart_items WHERE token=? AND kind=?').get(tk, 'enquiry').s || 0;
      return res.json({ ok: true, count });
    }
    req.flash('ok', 'Item added to enquiry list.');
    res.redirect('back');
  });

  r.post('/enquiry/update', (req, res) => {
    const id = Number(req.body.id);
    const qty = Math.max(1, Number(req.body.qty) || 1);
    const tk = res.locals.token;
    const has = db.prepare('SELECT id FROM cart_items WHERE token=? AND kind=? AND product_id=?').get(tk, 'enquiry', id);
    if (has) db.prepare('UPDATE cart_items SET qty=? WHERE id=?').run(qty, has.id);
    res.redirect('/enquiry');
  });

  r.post('/enquiry/remove', (req, res) => {
    const id = Number(req.body.id);
    const tk = res.locals.token;
    const has = db.prepare('SELECT id FROM cart_items WHERE token=? AND kind=? AND product_id=?').get(tk, 'enquiry', id);
    if (has) db.prepare('DELETE FROM cart_items WHERE id=?').run(has.id);
    req.flash('ok', 'Item removed.');
    res.redirect('/enquiry');
  });

  r.post('/enquiry/submit', (req, res) => {
    const b = req.body;
    const tk = res.locals.token;
    const items = ST.cartRows(tk, 'enquiry');
    if (!items.length) return res.redirect('/enquiry');

    const eNo = 'ENQ-' + Date.now().toString().slice(-6) + Math.floor(Math.random()*100);
    const uId = res.locals.user ? res.locals.user.id : null;
    
    db.prepare(`INSERT INTO enquiries(enquiry_no, user_id, name, email, phone, company, gstin, city, message)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(eNo, uId, b.name, b.email, b.phone, b.company||'', b.gstin||'', b.city, b.message||'');
    const eId = db.prepare('SELECT last_insert_rowid() id').get().id;
    
    const ins = db.prepare('INSERT INTO enquiry_items(enquiry_id, product_id, sku, name, qty, list_price) VALUES(?,?,?,?,?,?)');
    for (const it of items) ins.run(eId, it.id, it.sku, it.name, it.qty, it.price);
    
    db.prepare('DELETE FROM cart_items WHERE token=? AND kind=?').run(tk, 'enquiry');
    req.flash('ok', 'Enquiry submitted! Your reference is ' + eNo);
    res.redirect('/');
  });

  /* ---------------- static content ---------------- */
  r.get('/pages/:slug', (req, res) => {
    const pg = db.prepare('SELECT * FROM pages WHERE slug=? AND is_active=1').get(req.params.slug);
    if (!pg) return res.status(404).render('shop/404', { title: 'Not found' });
    res.render('shop/page', { title: pg.title, pg, metaDesc: String(pg.body).replace(/<[^>]+>/g, ' ').slice(0, 155) });
  });



  r.get('/contact', (req, res) => res.render('shop/contact', {
    title: 'Contact us', metaDesc: 'Call or WhatsApp us. We reply within one business day.'
  }));

  r.post('/contact', (req, res) => {
    const b = req.body;
    if (!b.name || !b.email || !b.body) { req.flash('error', 'Please fill in the required fields.'); return res.redirect('/contact'); }
    db.prepare('INSERT INTO messages(name,email,phone,subject,body) VALUES(?,?,?,?,?)')
      .run(b.name, b.email, b.phone || '', b.subject || '', b.body);
    req.flash('ok', 'Thanks — your message is with us. We reply within one business day.');
    res.redirect('/contact');
  });

  r.post('/subscribe', (req, res) => {
    const e = String(req.body.email || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      try { db.prepare('INSERT INTO subscribers(email) VALUES(?)').run(e); req.flash('ok', 'Subscribed. Trade updates roughly once a month.'); }
      catch { req.flash('warn', "You're already on the list."); }
    } else req.flash('error', 'That email address does not look right.');
    res.redirect(req.headers.referer || '/');
  });


  /* ---------------- wishlist ---------------- */
  r.get('/wishlist', (req, res) => {
    const products = db.prepare(`SELECT p.*,c.name cat FROM wishlist w JOIN products p ON p.id=w.product_id
      LEFT JOIN categories c ON c.id=p.category_id WHERE w.token=? AND p.is_active=1`).all(res.locals.token);
    res.render('shop/wishlist', { title: 'Wishlist', products });
  });

  r.post('/wishlist/toggle', (req, res) => {
    const id = Number(req.body.id);
    const tk = res.locals.token;
    const has = db.prepare('SELECT id FROM wishlist WHERE token=? AND product_id=?').get(tk, id);
    if (has) db.prepare('DELETE FROM wishlist WHERE id=?').run(has.id);
    else { try { db.prepare('INSERT INTO wishlist(token,product_id) VALUES(?,?)').run(tk, id); } catch {} }
    const n = db.prepare('SELECT COUNT(*) n FROM wishlist WHERE token=?').get(tk).n;
    res.json({ saved: !has, count: n });
  });

  /* ---------------- robots / sitemap ---------------- */
  r.get('/robots.txt', (req, res) => res.send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nSitemap: ${res.locals.SITE_URL}/sitemap.xml\n`,
    'text/plain; charset=utf-8'));

  r.get('/sitemap.xml', (req, res) => {
    const base = res.locals.SITE_URL;
    const urls = ['/', '/products', '/contact'];
    db.prepare('SELECT slug FROM categories WHERE is_active=1').all().forEach(c => urls.push('/c/' + c.slug));
    db.prepare('SELECT slug FROM products WHERE is_active=1').all().forEach(p => urls.push('/p/' + p.slug));
    db.prepare('SELECT slug FROM pages WHERE is_active=1').all().forEach(p => urls.push('/pages/' + p.slug));
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + urls.map(u => `<url><loc>${base}${u}</loc></url>`).join('\n') + '\n</urlset>', 'application/xml; charset=utf-8');
  });
};
