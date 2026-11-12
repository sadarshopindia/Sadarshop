'use strict';
const { db, setting } = require('./db');
const { hashPassword, slugify } = require('./helpers');

const CATS = [
  ['Sample Category', null, 'A sample category for your products.'],
  ['Another Category', null, 'Another sample category.']
];

/* name, category, mrp, price, tiers[[minqty,price]], pack, moq, unit, weight, stock, flags, short, long */
const PRODUCTS = [
  ['Sample Product 1', 'Sample Category', 100, 80, [[10, 75], [50, 70]], '1 unit', 1, 'piece', 100, 500, { featured: 1, new: 1 },
    'This is a short description of the sample product.',
    'This is a long description of the sample product. You can replace this data with your actual inventory in the admin panel.'],
  ['Sample Product 2', 'Another Category', 200, 150, [[10, 140]], '1 unit', 1, 'piece', 200, 300, { featured: 1 },
    'Short description for product 2.',
    'Long description for product 2. Replace with real content.']
];

const PAGES = [
  ['about-us', 'About Us', `<p class="lead">Welcome to our store.</p><p>We are a generic e-commerce store template ready for your content.</p>`],
  ['shipping-delivery', 'Shipping & Delivery', `<h2>Delivery time</h2><p>Standard delivery times apply.</p>`],
  ['returns-exchanges', 'Returns & Exchanges', `<h2>Returns</h2><p>Please contact us for returns.</p>`],
  ['terms-conditions', 'Terms & Conditions', `<h2>Terms</h2><p>Standard terms and conditions apply.</p>`],
  ['privacy-policy', 'Privacy Policy', `<h2>Privacy</h2><p>We respect your privacy.</p>`]
];

function run() {
  const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (catCount > 0) { console.log('Database already seeded. Use `npm run reset` to rebuild.'); return; }

  const insCat = db.prepare('INSERT INTO categories(parent_id,name,slug,description,image,sort) VALUES(?,?,?,?,?,?)');
  const ids = {};
  CATS.forEach(([name, parent, desc], i) => {
    const slug = slugify(name);
    const r = insCat.run(parent ? ids[parent] : null, name, slug, desc, '/static/img/cat/' + slug + '.svg', i);
    ids[name] = Number(r.lastInsertRowid);
  });

  const insProd = db.prepare('INSERT INTO products (sku,name,slug,category_id,short_desc,description,mrp,price,tiers,moq,unit,pack_size,weight_g,stock,images,hsn,gst_rate,is_featured,is_new,rating,review_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  PRODUCTS.forEach(([name, cat, mrp, price, tiers, pack, moq, unit, wt, stock, flags, short, long], i) => {
    const slug = slugify(name);
    insProd.run(
      'SKU-' + String(1001 + i), name, slug, ids[cat] || null, short, long,
      mrp, price, JSON.stringify(tiers.map(([min_qty, p]) => ({ min_qty, price: p }))),
      moq, unit, pack, wt, stock,
      JSON.stringify(['/static/img/catalog/' + slug + '.svg']),
      '0000', 18, flags.featured ? 1 : 0, flags.new ? 1 : 0,
      5, 1
    );
  });

  const insPage = db.prepare('INSERT INTO pages(slug,title,body) VALUES(?,?,?)');
  PAGES.forEach(([s, t, b]) => insPage.run(s, t, b));

  db.prepare('INSERT INTO users(name,email,phone,password_hash,role,account_type,company,status) VALUES(?,?,?,?,?,?,?,?)')
    .run('Store Administrator', 'admin@example.com', '0000000000',
      hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'admin', 'wholesale', 'Sadarshop', 'active');

  const S = {
    site_name: 'Sadarshop',
    tagline: 'Premium Wholesale Fabrics & Textiles',
    phone: '98210 08088',
    whatsapp: '919821008088',
    email: 'sadarshopindia@gmail.com',
    address: 'Your Address Here',
    hours: 'Mon – Sat, 10:00 AM – 6:00 PM',
    gstin: '00000000000000',
    free_shipping_over: '5000',
    shipping_flat: '150',
    currency: '₹',
    announcement: 'Welcome to Sadarshop — Premium Wholesale Fabrics & Textiles!',
    razorpay_key_id: '',
    razorpay_key_secret: '',
    payments_live: '0',
    bank_details: 'Bank details go here',
    theme_color_primary: '#BE3144',
    theme_color_secondary: '#95662D'
  };
  for (const [k, v] of Object.entries(S)) setting.set(k, v);

  console.log('Seeded ' + CATS.length + ' categories, ' + PRODUCTS.length + ' products, ' + PAGES.length + ' pages.');
  console.log('Admin login: admin@example.com / ' + (process.env.ADMIN_PASSWORD || 'admin123'));
}

if (require.main === module) run();
module.exports = { run };
