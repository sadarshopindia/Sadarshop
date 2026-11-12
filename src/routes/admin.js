'use strict';
const fs = require('fs');
const path = require('path');
const { db, setting } = require('../db');
const H = require('../helpers');
const ST = require('../store');

const UPLOADS = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const OK_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'];

function saveUpload(file) {
  if (!file || !file.data || !file.data.length) return null;
  const ext = path.extname(file.filename).toLowerCase();
  if (!OK_EXT.includes(ext)) return null;
  const name = H.token(8) + ext;
  fs.writeFileSync(path.join(UPLOADS, name), file.data);
  return '/static/uploads/' + name;
}
const arr = v => v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]);

module.exports = function (r) {

  /* ---------- auth gate ---------- */
  function gate(req, res) {
    const u = res.locals.user;
    if (!u || u.role !== 'admin') {
      res.render('admin/login', { title: 'Admin sign in', flash: res.locals.flash });
      return true;
    }
    return false;
  }

  function chrome(res) {
    return {
      newEnq: db.prepare("SELECT COUNT(*) n FROM enquiries WHERE status='new'").get().n,
      unread: db.prepare('SELECT COUNT(*) n FROM messages WHERE is_read=0').get().n,
      pendingUsers: db.prepare("SELECT COUNT(*) n FROM users WHERE status='pending'").get().n
    };
  }
  const view = (res, tpl, data) => res.render(tpl, Object.assign(chrome(res), data));

  r.get('/admin/login', (req, res) => {
    if (res.locals.user && res.locals.user.role === 'admin') return res.redirect('/admin');
    res.render('admin/login', { title: 'Admin sign in' });
  });

  r.post('/admin/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE LOWER(email)=?').get(email);
    if (!u || u.role !== 'admin' || !H.verifyPassword(req.body.password, u.password_hash)) {
      req.flash('error', 'Those admin credentials are not correct.');
      return res.redirect('/admin/login');
    }
    req.session.uid = u.id; req.regenerate(); req.saveSession();
    res.redirect('/admin');
  });

  /* ---------- dashboard ---------- */
  r.get('/admin', (req, res) => {
    if (gate(req, res)) return;
    const g = (sql, ...a) => db.prepare(sql).get(...a);
    view(res, 'admin/dashboard', {
      title: 'Dashboard', nav: 'dash',
      today: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      stats: {
        enquiries: g('SELECT COUNT(*) n FROM enquiries').n,
        newEnq: g("SELECT COUNT(*) n FROM enquiries WHERE status='new'").n,
        customers: g("SELECT COUNT(*) n FROM users WHERE role='customer'").n,
        pendingUsers: g("SELECT COUNT(*) n FROM users WHERE status='pending'").n
      },
      recentEnq: db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM enquiry_items WHERE enquiry_id=e.id) n
        FROM enquiries e ORDER BY e.id DESC LIMIT 6`).all(),
      lowStock: db.prepare('SELECT * FROM products WHERE is_active=1 AND stock < 50 ORDER BY stock ASC LIMIT 6').all()
    });
  });

  /* ---------- products ---------- */
  r.get('/admin/api/products/search', (req, res) => {
    if (!res.locals.user || res.locals.user.role !== 'admin') return res.status(403).json([]);
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const matches = db.prepare(`SELECT id, sku, name, price FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 20`).all('%' + q + '%', '%' + q + '%');
    res.json(matches);
  });

  r.get('/admin/products', (req, res) => {
    if (gate(req, res)) return;
    const q = req.query;
    const where = ['1=1']; const args = [];
    if (q.q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); args.push('%' + q.q + '%', '%' + q.q + '%'); }
    if (q.cat) { const ids = ST.catIds(Number(q.cat)); where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
    if (q.status === '0' || q.status === '1') { where.push('p.is_active=?'); args.push(Number(q.status)); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM products p ${w}`).get(...args).n;
    const pg = H.paginate(total, parseInt(q.page || '1', 10) || 1, 25);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) as variants,
        SUM(CASE WHEN parent_id IS NULL AND id IN (SELECT parent_id FROM products WHERE parent_id IS NOT NULL) THEN 1 ELSE 0 END) as parents,
        SUM(CASE WHEN parent_id IS NULL AND id NOT IN (SELECT parent_id FROM products WHERE parent_id IS NOT NULL) THEN 1 ELSE 0 END) as independent
      FROM products
    `).get();

    view(res, 'admin/products', {
      title: 'Products', nav: 'prod', pg, stats,
      products: db.prepare(`SELECT p.*,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
        ${w} ORDER BY COALESCE(p.parent_id, p.id) DESC, p.parent_id IS NOT NULL ASC, p.id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset),
      cats: db.prepare('SELECT * FROM categories ORDER BY COALESCE(parent_id,id), parent_id IS NOT NULL, name').all(),
      pageUrl: n => '/admin/products?' + new URLSearchParams(Object.assign({}, q, { page: n })).toString()
    });
  });

  const blank = { id: 0, unit: 'pack', moq: 1, gst_rate: 18, is_active: 1, stock: 0, images: '[]', tiers: '[]' };

  r.get('/admin/products/new', (req, res) => {
    if (gate(req, res)) return;
    const parents = db.prepare('SELECT id, name, sku, opts FROM products WHERE parent_id IS NULL ORDER BY name').all();
    view(res, 'admin/product-form', {
      title: 'New product', nav: 'prod', p: blank, tiers: [], images: [],
      parentOpts: '{}',
      cats: db.prepare('SELECT * FROM categories ORDER BY COALESCE(parent_id,id), parent_id IS NOT NULL, name').all(), parents
    });
  });

  r.get('/admin/products/:id', (req, res) => {
    if (gate(req, res)) return;
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));
    if (!p) return res.redirect('/admin/products');
    const parents = db.prepare('SELECT id, name, sku, opts FROM products WHERE parent_id IS NULL AND id != ? ORDER BY name').all(p.id);
    const parentOpts = p.parent_id ? (db.prepare('SELECT opts FROM products WHERE id=?').get(p.parent_id)?.opts || '{}') : '{}';
    view(res, 'admin/product-form', {
      title: 'Edit product', nav: 'prod', p, tiers: ST.tiersOf(p),
      parentOpts,
      images: H.json(p.images, []) || [],
      cats: db.prepare('SELECT * FROM categories ORDER BY COALESCE(parent_id,id), parent_id IS NOT NULL, name').all(), parents
    });
  });

  function productPayload(req, existing) {
    const b = req.body;
    const qtys = arr(b.tier_qty), prices = arr(b.tier_price);
    const tiers = qtys.map((q, i) => ({ min_qty: Number(q), price: Number(prices[i]) }))
      .filter(t => t.min_qty > 0 && t.price > 0).sort((a, c) => a.min_qty - c.min_qty);

    let images = existing ? (H.json(existing.images, []) || []) : [];
    const rm = arr(b.remove_img);
    if (rm.length) images = images.filter(i => !rm.includes(i));
    for (const f of arr(req.files.image ? [req.files.image] : [])) {
      const u = saveUpload(f); if (u) images.push(u);
    }
    if (b.image_url && /^https?:\/\//i.test(b.image_url)) images.push(b.image_url.trim());

    let slug = H.slugify(b.slug || b.name);
    const clash = db.prepare('SELECT id FROM products WHERE slug=? AND id<>?').get(slug, existing ? existing.id : 0);
    if (clash) slug = slug + '-' + Date.now().toString(36).slice(-4);
    let sku = String(b.sku || '').trim() || 'ST-' + Date.now().toString(36).toUpperCase().slice(-6);
    if (db.prepare('SELECT id FROM products WHERE sku=? AND id<>?').get(sku, existing ? existing.id : 0))
      sku = sku + '-' + Date.now().toString(36).slice(-3).toUpperCase();

    const dimensions = b.opt_dimensions ? b.opt_dimensions.split(',').map(s => s.trim()).filter(Boolean) : [];
    let opts = {};
    if (!b.parent_id) {
      opts = { dimensions };
    } else {
      opts = { values: {} };
      for (const key of Object.keys(b)) {
        if (key.startsWith('opt_val_')) {
          opts.values[key.replace('opt_val_', '')] = String(b[key]).trim();
        }
      }
    }

    return {
      sku, slug, name: String(b.name || '').trim(),
      category_id: b.category_id ? Number(b.category_id) : null,
      parent_id: b.parent_id ? Number(b.parent_id) : null,
      short_desc: b.short_desc || '', description: b.description || '',
      mrp: Number(b.mrp) || 0, price: Number(b.price) || 0, tiers: JSON.stringify(tiers),
      moq: Math.max(1, Number(b.moq) || 1), unit: b.unit || 'pack', pack_size: b.pack_size || '',
      weight_g: Number(b.weight_g) || 0, stock: Number(b.stock) || 0,
      images: JSON.stringify(images), hsn: b.hsn || '', gst_rate: Number(b.gst_rate) || 0,
      is_active: b.is_active ? 1 : 0, is_featured: b.is_featured ? 1 : 0, is_new: b.is_new ? 1 : 0,
      opts: JSON.stringify(opts),
      meta_title: b.meta_title || '', meta_desc: b.meta_desc || '',
      rating: Number(b.rating) || 0, review_count: Number(b.review_count) || 0
    };
  }

  r.post('/admin/products/new', (req, res) => {
    if (gate(req, res)) return;
    const d = productPayload(req, null);
    if (!d.name) { req.flash('error', 'Product name is required.'); return res.redirect('/admin/products/new'); }
    const info = db.prepare(`INSERT INTO products
      (sku,slug,name,category_id,parent_id,short_desc,description,mrp,price,tiers,moq,unit,pack_size,weight_g,stock,images,hsn,gst_rate,is_active,is_featured,is_new,opts,meta_title,meta_desc,rating,review_count)
      VALUES(@sku,@slug,@name,@category_id,@parent_id,@short_desc,@description,@mrp,@price,@tiers,@moq,@unit,@pack_size,@weight_g,@stock,@images,@hsn,@gst_rate,@is_active,@is_featured,@is_new,@opts,@meta_title,@meta_desc,@rating,@review_count)`).run(d);
    req.flash('ok', 'Product created.');
    res.redirect('/admin/products/' + Number(info.lastInsertRowid));
  });

  r.post('/admin/products/:id', (req, res) => {
    if (gate(req, res)) return;
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!existing) return res.redirect('/admin/products');
    const d = Object.assign(productPayload(req, existing), { id });
    db.prepare(`UPDATE products SET sku=@sku,slug=@slug,name=@name,category_id=@category_id,parent_id=@parent_id,short_desc=@short_desc,
      description=@description,mrp=@mrp,price=@price,tiers=@tiers,moq=@moq,unit=@unit,pack_size=@pack_size,
      weight_g=@weight_g,stock=@stock,images=@images,hsn=@hsn,gst_rate=@gst_rate,is_active=@is_active,
      is_featured=@is_featured,is_new=@is_new,opts=@opts,meta_title=@meta_title,meta_desc=@meta_desc,rating=@rating,review_count=@review_count WHERE id=@id`).run(d);

    if (req.body.bulk_variants && !d.parent_id) {
      const lines = req.body.bulk_variants.split('\n').map(l => l.trim()).filter(Boolean);
      const dims = d.opts ? JSON.parse(d.opts).dimensions || [] : [];
      for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          const sku = parts[0] || ('ST-' + Date.now().toString(36).toUpperCase().slice(-6));
          const valStrs = parts[1].split(',').map(v => v.trim());
          const price = parts[2] ? Number(parts[2]) : d.price;
          const stock = parts[3] ? Number(parts[3]) : 0;
          
          let valObj = {};
          dims.forEach((dim, i) => { valObj[dim] = valStrs[i] || ''; });
          
          const childOpts = JSON.stringify({ values: valObj });
          const cName = `${d.name} - ${valStrs.join(', ')}`;
          let cSlug = H.slugify(cName);
          const existChild = db.prepare('SELECT id FROM products WHERE sku=?').get(sku);
          if (existChild) {
            db.prepare('UPDATE products SET name=?, opts=?, price=?, stock=? WHERE id=?').run(cName, childOpts, price, stock, existChild.id);
          } else {
            if (db.prepare('SELECT id FROM products WHERE slug=?').get(cSlug)) cSlug += '-' + Date.now().toString(36).slice(-4);
            db.prepare(`INSERT INTO products
              (sku,slug,name,category_id,parent_id,short_desc,description,mrp,price,tiers,moq,unit,pack_size,weight_g,stock,images,hsn,gst_rate,is_active,is_featured,is_new,opts,meta_title,meta_desc,rating,review_count)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                sku, cSlug, cName, d.category_id, id, d.short_desc, d.description, d.mrp, price, '[]', d.moq, d.unit, d.pack_size, d.weight_g, stock, '[]', d.hsn, d.gst_rate, 1, 0, 0, childOpts, d.meta_title, d.meta_desc, d.rating, d.review_count
              );
          }
        }
      }
    }

    req.flash('ok', 'Changes saved.');
    res.redirect('/admin/products/' + id);
  });

  r.get('/admin/products/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));
    req.flash('ok', 'Product deleted.');
    res.redirect('/admin/products');
  });

  /* ---------- categories ---------- */
  r.get('/admin/categories', (req, res) => {
    if (gate(req, res)) return;
    const counts = {};
    for (const x of db.prepare('SELECT category_id id, COUNT(*) n FROM products GROUP BY category_id').all()) counts[x.id] = x.n;
    const all = db.prepare(`
      SELECT c.* 
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      ORDER BY 
        COALESCE(p.sort, c.sort), 
        COALESCE(p.name, c.name), 
        c.parent_id IS NOT NULL, 
        c.sort, 
        c.name
    `).all()
      .map(c => Object.assign({}, c, { n: counts[c.id] || 0 }));
    view(res, 'admin/categories', {
      title: 'Categories', nav: 'cat', cats: all,
      editing: req.query.edit ? all.find(c => c.id === Number(req.query.edit)) : null
    });
  });

  function catPayload(req, existing) {
    const b = req.body;
    let slug = H.slugify(b.slug || b.name);
    if (db.prepare('SELECT id FROM categories WHERE slug=? AND id<>?').get(slug, existing ? existing.id : 0))
      slug += '-' + Date.now().toString(36).slice(-4);
    const img = req.files && req.files.image ? saveUpload(req.files.image) : null;
    return {
      name: String(b.name || '').trim(), slug,
      parent_id: b.parent_id ? Number(b.parent_id) : null,
      description: b.description || '', sort: Number(b.sort) || 0,
      image: img || (existing ? existing.image : ''), is_active: b.is_active ? 1 : 0
    };
  }

  r.post('/admin/categories/new', (req, res) => {
    if (gate(req, res)) return;
    const d = catPayload(req, null);
    if (!d.name) { req.flash('error', 'Category name is required.'); return res.redirect('/admin/categories'); }
    db.prepare(`INSERT INTO categories(name,slug,parent_id,description,sort,image,is_active)
      VALUES(@name,@slug,@parent_id,@description,@sort,@image,@is_active)`).run(d);
    req.flash('ok', 'Category created.');
    res.redirect('/admin/categories');
  });

  r.post('/admin/categories/:id', (req, res) => {
    if (gate(req, res)) return;
    const id = Number(req.params.id);
    const ex = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
    if (!ex) return res.redirect('/admin/categories');
    const d = Object.assign(catPayload(req, ex), { id });
    db.prepare(`UPDATE categories SET name=@name,slug=@slug,parent_id=@parent_id,description=@description,
      sort=@sort,image=@image,is_active=@is_active WHERE id=@id`).run(d);
    req.flash('ok', 'Category updated.');
    res.redirect('/admin/categories');
  });

  r.get('/admin/categories/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM categories WHERE id=?').run(Number(req.params.id));
    req.flash('ok', 'Category deleted.');
    res.redirect('/admin/categories');
  });


  /* ---------- enquiries ---------- */
  r.get('/admin/enquiries', (req, res) => {
    if (gate(req, res)) return;
    const q = req.query; const where = ['1=1']; const args = [];
    if (q.q) {
      where.push('(e.enquiry_no LIKE ? OR e.name LIKE ? OR e.company LIKE ? OR e.phone LIKE ?)');
      const l = '%' + q.q + '%'; args.push(l, l, l, l);
    }
    if (q.status) { where.push('e.status=?'); args.push(q.status); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM enquiries e ${w}`).get(...args).n;
    const pg = H.paginate(total, parseInt(q.page || '1', 10) || 1, 25);
    view(res, 'admin/enquiries', {
      title: 'Enquiries', nav: 'enq', pg,
      newCount: db.prepare("SELECT COUNT(*) n FROM enquiries WHERE status='new'").get().n,
      enquiries: db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM enquiry_items WHERE enquiry_id=e.id) n,
        (SELECT COALESCE(SUM(qty*list_price),0) FROM enquiry_items WHERE enquiry_id=e.id) indicative
        FROM enquiries e ${w} ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset),
      pageUrl: n => '/admin/enquiries?' + new URLSearchParams(Object.assign({}, q, { page: n })).toString()
    });
  });

  r.get('/admin/enquiries/:id', (req, res) => {
    if (gate(req, res)) return;
    const e = db.prepare('SELECT * FROM enquiries WHERE id=?').get(Number(req.params.id));
    if (!e) return res.redirect('/admin/enquiries');
    const items = db.prepare('SELECT * FROM enquiry_items WHERE enquiry_id=?').all(e.id);
    view(res, 'admin/enquiry', {
      title: e.enquiry_no, nav: 'enq', e, items,
      totalQty: items.reduce((s, i) => s + i.qty, 0),
      indicative: items.reduce((s, i) => s + i.qty * i.list_price, 0)
    });
  });

  r.post('/admin/enquiries/:id', (req, res) => {
    if (gate(req, res)) return;
    const id = Number(req.params.id); const b = req.body;
    const ids = arr(b.item_id), prices = arr(b.quoted_price);
    const upd = db.prepare('UPDATE enquiry_items SET quoted_price=? WHERE id=? AND enquiry_id=?');
    ids.forEach((iid, i) => upd.run(Number(prices[i]) || 0, Number(iid), id));
    let total = Number(b.quoted_total);
    if (!total) {
      total = db.prepare('SELECT COALESCE(SUM(qty*quoted_price),0) n FROM enquiry_items WHERE enquiry_id=?').get(id).n;
    }
    db.prepare('UPDATE enquiries SET status=?,quoted_total=?,quote_notes=? WHERE id=?')
      .run(b.status || 'quoted', total, b.quote_notes || '', id);
    req.flash('ok', 'Quote saved. The customer can see it on their account page.');
    res.redirect('/admin/enquiries/' + id);
  });

  r.get('/admin/enquiries/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM enquiries WHERE id=?').run(Number(req.params.id));
    req.flash('ok', 'Enquiry deleted.');
    res.redirect('/admin/enquiries');
  });

  /* ---------- customers ---------- */
  r.get('/admin/customers', (req, res) => {
    if (gate(req, res)) return;
    const q = req.query; const where = ['1=1']; const args = [];
    if (q.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR u.phone LIKE ?)');
      const l = '%' + q.q + '%'; args.push(l, l, l, l);
    }
    if (q.type) { where.push('u.account_type=?'); args.push(q.type); }
    if (q.status) { where.push('u.status=?'); args.push(q.status); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM users u ${w}`).get(...args).n;
    const pg = H.paginate(total, parseInt(q.page || '1', 10) || 1, 25);
    view(res, 'admin/customers', {
      title: 'Customers', nav: 'cust', pg,
      users: db.prepare(`SELECT u.* FROM users u ${w} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset),
      pageUrl: n => '/admin/customers?' + new URLSearchParams(Object.assign({}, q, { page: n })).toString()
    });
  });

  r.get('/admin/customers/:id', (req, res) => {
    if (gate(req, res)) return;
    const c = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!c) return res.redirect('/admin/customers');
    view(res, 'admin/customer', { title: c.name, nav: 'cust', c });
  });

  r.post('/admin/customers/:id', (req, res) => {
    if (gate(req, res)) return;
    const b = req.body;
    const id = Number(req.params.id);
    const email = String(b.email || '').trim().toLowerCase();
    
    const clash = db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, id);
    if (clash) {
      req.flash('error', 'That email is already in use by another account.');
      return res.redirect('/admin/customers/' + id);
    }
    
    db.prepare(`UPDATE users SET name=?, email=?, phone=?, company=?, gstin=?, city=?, account_type=?, status=? WHERE id=?`)
      .run(b.name, email, b.phone || '', b.company || '', b.gstin || '', b.city || '', b.account_type || 'retail', b.status || 'active', id);
      
    if (b.new_password && String(b.new_password).length >= 8) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(H.hashPassword(b.new_password), id);
    }
    
    req.flash('ok', 'Customer details saved.');
    res.redirect('/admin/customers/' + id);
  });

  r.get('/admin/customers/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    const id = Number(req.params.id);
    const c = db.prepare('SELECT role FROM users WHERE id=?').get(id);
    if (c && c.role !== 'admin') {
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      req.flash('ok', 'Customer deleted.');
    } else if (c) {
      req.flash('error', 'Cannot delete an admin account from here.');
    }
    res.redirect('/admin/customers');
  });

  r.get('/admin/customers/:id/status/:status', (req, res) => {
    if (gate(req, res)) return;
    const s = ['active', 'pending', 'blocked'].includes(req.params.status) ? req.params.status : 'active';
    db.prepare('UPDATE users SET status=? WHERE id=? AND role<>?').run(s, Number(req.params.id), 'admin');
    req.flash('ok', 'Customer status set to ' + s + '.');
    res.redirect(req.headers.referer || '/admin/customers');
  });

  r.get('/admin/customers/:id/type/:type', (req, res) => {
    if (gate(req, res)) return;
    const t = 'retail';
    db.prepare('UPDATE users SET account_type=?, status=? WHERE id=?').run(t, 'active', Number(req.params.id));
    req.flash('ok', 'Account converted to ' + t + ' with slab pricing active.');
    res.redirect(req.headers.referer || '/admin/customers');
  });

  /* ---------- messages, subscribers, coupons ---------- */
  r.get('/admin/messages', (req, res) => {
    if (gate(req, res)) return;
    view(res, 'admin/messages', {
      title: 'Messages', nav: 'msg',
      msgs: db.prepare('SELECT * FROM messages ORDER BY is_read ASC, id DESC').all()
    });
  });
  r.get('/admin/messages/:id/read', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('UPDATE messages SET is_read=1 WHERE id=?').run(Number(req.params.id));
    res.redirect('/admin/messages');
  });
  r.get('/admin/messages/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id));
    res.redirect('/admin/messages');
  });

  r.get('/admin/subscribers', (req, res) => {
    if (gate(req, res)) return;
    view(res, 'admin/subscribers', {
      title: 'Subscribers', nav: 'subs',
      subs: db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all()
    });
  });
  r.get('/admin/subscribers/export', (req, res) => {
    if (gate(req, res)) return;
    const rows = db.prepare('SELECT email,created_at FROM subscribers ORDER BY id DESC').all();
    res.set('Content-Disposition', 'attachment; filename="subscribers.csv"')
      .send('email,subscribed_at\n' + rows.map(r2 => `${r2.email},${r2.created_at}`).join('\n'), 'text/csv; charset=utf-8');
  });
  r.get('/admin/subscribers/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM subscribers WHERE id=?').run(Number(req.params.id));
    res.redirect('/admin/subscribers');
  });

  r.get('/admin/subscribers/blast', (req, res) => {
    if (gate(req, res)) return;
    const subCount = db.prepare('SELECT COUNT(*) n FROM subscribers').get().n;
    view(res, 'admin/blast', { title: 'Email Blast', nav: 'subs', subCount });
  });

  r.post('/admin/subscribers/blast', async (req, res) => {
    if (gate(req, res)) return;
    const { subject, message } = req.body;
    if (!subject || !message) {
      req.flash('error', 'Subject and message are required.');
      return res.redirect('/admin/subscribers/blast');
    }

    const subs = db.prepare('SELECT email FROM subscribers').all();
    if (!subs.length) {
      req.flash('error', 'No subscribers found.');
      return res.redirect('/admin/subscribers/blast');
    }
    const bccList = subs.map(s => s.email).join(',');

    try {
      const nodemailer = require('nodemailer');
      let transporter;

      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
      } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
      }

      const info = await transporter.sendMail({
        from: '"' + S.site_name + '" <noreply@' + new URL(SITE_URL).hostname + '>',
        bcc: bccList,
        subject: subject,
        html: message,
      });

      if (!process.env.SMTP_HOST) {
        console.log("-----------------------------------------");
        console.log("EMAIL BLAST SENT VIA ETHEREAL (TEST MODE)");
        console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
        console.log("-----------------------------------------");
      }

      req.flash('ok', `Email successfully dispatched to ${subs.length} subscribers.`);
      res.redirect('/admin/subscribers');
    } catch (err) {
      console.error("Failed to send email blast:", err);
      req.flash('error', 'Failed to send email: ' + err.message);
      res.redirect('/admin/subscribers/blast');
    }
  });


  /* ---------- pages ---------- */
  r.get('/admin/pages', (req, res) => {
    if (gate(req, res)) return;
    const pages = db.prepare('SELECT * FROM pages ORDER BY id').all();
    view(res, 'admin/pages', {
      title: 'Pages', nav: 'pages', pages,
      editing: req.query.edit ? pages.find(p => p.id === Number(req.query.edit)) : null
    });
  });
  r.post('/admin/pages/new', (req, res) => {
    if (gate(req, res)) return;
    const b = req.body;
    let slug = H.slugify(b.slug || b.title);
    if (db.prepare('SELECT id FROM pages WHERE slug=?').get(slug)) slug += '-' + Date.now().toString(36).slice(-4);
    const info = db.prepare('INSERT INTO pages(slug,title,body,is_active) VALUES(?,?,?,?)')
      .run(slug, b.title || 'Untitled', b.body || '', b.is_active ? 1 : 0);
    req.flash('ok', 'Page created.');
    res.redirect('/admin/pages?edit=' + Number(info.lastInsertRowid));
  });
  r.post('/admin/pages/:id', (req, res) => {
    if (gate(req, res)) return;
    const b = req.body; const id = Number(req.params.id);
    db.prepare('UPDATE pages SET slug=?,title=?,body=?,is_active=? WHERE id=?')
      .run(H.slugify(b.slug || b.title), b.title, b.body || '', b.is_active ? 1 : 0, id);
    req.flash('ok', 'Page saved.');
    res.redirect('/admin/pages?edit=' + id);
  });
  r.get('/admin/pages/:id/delete', (req, res) => {
    if (gate(req, res)) return;
    db.prepare('DELETE FROM pages WHERE id=?').run(Number(req.params.id));
    req.flash('ok', 'Page deleted.');
    res.redirect('/admin/pages');
  });

  /* ---------- appearance ---------- */
  r.get('/admin/appearance', (req, res) => {
    if (gate(req, res)) return;
    view(res, 'admin/appearance', { title: 'Appearance', nav: 'app' });
  });

  r.post('/admin/appearance', (req, res) => {
    if (gate(req, res)) return;
    const b = req.body;
    const keys = ['theme_logo_height', 'theme_font_sans', 'theme_font_serif', 'theme_color_primary', 'theme_color_secondary', 'theme_custom_css'];
    keys.forEach(k => { if (b[k] !== undefined) setting.set(k, b[k]); });

    if (req.files && req.files.logo_image) {
      const u = saveUpload(req.files.logo_image);
      if (u) setting.set('theme_logo_url', u);
    }

    req.flash('ok', 'Appearance settings saved.');
    res.redirect('/admin/appearance');
  });

  /* ---------- settings ---------- */
  r.get('/admin/settings', (req, res) => {
    if (gate(req, res)) return;
    view(res, 'admin/settings', { title: 'Settings', nav: 'set', admin: res.locals.user });
  });

  r.post('/admin/settings', (req, res) => {
    if (gate(req, res)) return;
    const b = req.body;
    const keys = ['site_name', 'tagline', 'announcement', 'phone', 'whatsapp', 'email', 'address', 'hours',
      'gstin', 'home_hero_title', 'home_hero_sub', 'home_hero_kicker', 'home_stat1_title', 'home_stat1_text', 'home_stat2_title', 'home_stat2_text',
      'theme_color_primary', 'theme_color_secondary', 'menu_header', 'menu_footer_company', 'social_instagram', 'social_facebook', 'social_linkedin'];
    keys.forEach(k => { if (b[k] !== undefined) setting.set(k, b[k]); });

    if (req.files && req.files.site_logo) {
      const u = saveUpload(req.files.site_logo);
      if (u) setting.set('site_logo', u);
    }
    const u = res.locals.user;
    if (b.admin_email && b.admin_email !== u.email) {
      try { db.prepare('UPDATE users SET email=? WHERE id=?').run(String(b.admin_email).trim().toLowerCase(), u.id); }
      catch { req.flash('error', 'That email is already used by another account.'); }
    }
    if (b.admin_password && String(b.admin_password).length >= 8)
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(H.hashPassword(b.admin_password), u.id);
    req.flash('ok', 'Settings saved.');
    res.redirect('/admin/settings');
  });
};
