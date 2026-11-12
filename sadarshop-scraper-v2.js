'use strict';
/**
 * sadarshop-scraper-v2.js
 *
 * Since sadarshop.com renders products via JavaScript, this scraper
 * uses Puppeteer (headless Chromium) to fully render each page,
 * then extracts product data from the rendered DOM.
 *
 * Run:  node sadarshop-scraper-v2.js
 *
 * First install puppeteer if not present:
 *   npm install puppeteer --save-dev
 */

const fs      = require('fs');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_FILE || path.join(__dirname, 'data', 'satnam.db');
const IMG_DIR = path.join(__dirname, 'public', 'img', 'products');
const DELAY   = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(IMG_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function downloadImage(url, slug, idx) {
  if (!url || !url.startsWith('http')) return null;
  const ext  = (url.split('?')[0].split('.').pop() || 'jpg').replace(/[^a-z]/gi, '').slice(0, 5) || 'jpg';
  const name = `${slug}${idx > 0 ? `-${idx}` : ''}.${ext}`;
  const dest = path.join(IMG_DIR, name);
  if (fs.existsSync(dest)) return `/img/products/${name}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return `/img/products/${name}`;
  } catch { return null; }
}

function upsertCategory(name) {
  const slug = slugify(name);
  const row  = db.prepare('SELECT id FROM categories WHERE slug=?').get(slug);
  if (row) return row.id;
  db.prepare('INSERT INTO categories(name,slug,is_active) VALUES(?,?,1)').run(name, slug);
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function upsertProduct({ name, slug, sku, catId, desc, shortDesc, images, moq, packSize }) {
  db.prepare(`
    INSERT INTO products(sku,name,slug,category_id,short_desc,description,images,moq,pack_size,is_active,stock)
    VALUES(?,?,?,?,?,?,?,?,?,1,0)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, category_id=excluded.category_id,
      short_desc=excluded.short_desc, description=excluded.description,
      images=excluded.images, moq=excluded.moq, pack_size=excluded.pack_size
  `).run(sku, name, slug, catId, shortDesc || '', desc || '', JSON.stringify(images), moq, packSize || '');
}

// ── Category data known from the nav (static) ────────────────
const CATEGORIES = [
  { name: 'Eyebrow Thread',                         slug: 'eyebrow-thread-1' },
  { name: 'Tag Gun and Accessories',                 slug: 'tag-gun-and-accessories' },
  { name: 'Tag Guns',                                slug: 'tag-guns' },
  { name: 'Tag Gun Needles',                         slug: 'tag-gun-needles' },
  { name: 'Standard Tag Gun Standard Barbs (Tag Pin)', slug: 'standard-tag-gun-standard-barbs-tag-pin' },
  { name: 'Paper Price Tags',                        slug: 'paper-price-tags' },
  { name: 'Fine Tag Gun Barbs (Tag Pin)',             slug: 'fine-tag-gun-barbs-tag-pin' },
  { name: 'Glue Sticks',                             slug: 'glue-sticks' },
  { name: 'Nylon Hang Tags',                         slug: 'nylon-hang-tags' },
  { name: 'Safety Pins',                             slug: 'safety-pins' },
  { name: 'Shirt Pins',                              slug: 'shirt-pins' },
  { name: 'Thread Cutters',                          slug: 'thread-cutters' },
  { name: 'Loop Pins',                               slug: 'loop-pins' },
  { name: 'Taffeta Roll',                            slug: 'taffeta-roll' },
  { name: 'Adjustable Security Loop pins',           slug: 'adjustable-security-loop-pins' },
  { name: 'Plastic PVC Tags',                        slug: 'plastic-pvc-tags' },
  { name: 'Thread String Tags',                      slug: 'thread-string-tags' },
  { name: 'Price Label Rolls',                       slug: 'price-label-rolls' },
  { name: 'Jewelry Organza Pouches',                 slug: 'jewelry-organza-pouches' },
];

async function scrapeWithPuppeteer() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.error('\n❌ Puppeteer not installed. Run: npm install puppeteer --save-dev\n');
    process.exit(1);
  }

  console.log('🚀 Launching headless browser…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
  page.setDefaultTimeout(30000);

  let totalImported = 0;

  for (const cat of CATEGORIES) {
    const catUrl = `https://sadarshop.com/product-categories/${cat.slug}`;
    console.log(`\n📁 ${cat.name}`);

    const catId = upsertCategory(cat.name);
    let page_n = 1;
    let hasMore = true;

    while (hasMore) {
      const url = page_n === 1 ? catUrl : `${catUrl}?page=${page_n}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await DELAY(1500);
      } catch (e) {
        console.warn(`  ⚠ Failed to load ${url}: ${e.message}`);
        break;
      }

      // Extract all product cards from rendered DOM
      const products = await page.evaluate(() => {
        const cards = [];
        // Try multiple possible card selectors
        const els = document.querySelectorAll(
          '.product-cart-wrap, .product-item-inner, article.product, .product-loop-item'
        );

        els.forEach(el => {
          // Name — try multiple selectors
          const nameEl = el.querySelector('h2.product-title, h3.product-title, .product-title a, h2 a, h3 a');
          const name   = nameEl ? nameEl.textContent.trim() : '';
          if (!name) return;

          // Image — get highest-res src
          const imgEl  = el.querySelector('img');
          const imgSrc = imgEl
            ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '')
            : '';

          // Short description
          const descEl  = el.querySelector('.product-description, .short-description, p.small');
          const shortDesc = descEl ? descEl.textContent.trim() : '';

          // Price (may not be shown, that's fine)
          const priceEl = el.querySelector('.price, .product-price');
          const price   = priceEl ? priceEl.textContent.replace(/[^0-9.]/g, '') : '0';

          // Product link / slug
          const linkEl  = el.querySelector('a[href*="/products/"]');
          const href    = linkEl ? linkEl.getAttribute('href') : '';
          const slug    = href ? href.split('/products/')[1]?.split('?')[0]?.replace(/\/$/, '') : '';

          cards.push({ name, imgSrc, shortDesc, price, slug });
        });

        // Pagination: check if there's a "next page" link
        const nextLink = document.querySelector('a[rel="next"], .pagination .next, a.next');
        const hasNext  = !!nextLink;

        return { cards, hasNext };
      });

      if (products.cards.length === 0) {
        if (page_n === 1) {
          console.log('  (no products found on this page — category may be empty or JS-blocked)');
        }
        break;
      }

      for (const p of products.cards) {
        const name   = p.name;
        const slug   = p.slug || slugify(name) + '-' + catId + '-' + Date.now();
        const sku    = 'SS-' + slug.slice(0, 20).replace(/-+$/, '') + '-' + Math.floor(Math.random() * 100000);

        // Pack size from name
        const packMatch  = name.match(/\b(\d+)\s*(pieces?|pcs?|pack|spools?|rolls?|dozen|gm|grams?)\b/i);
        const packSize   = packMatch ? packMatch[0] : '';
        const moqMatch   = name.match(/\((?:pack of|set of)[:\s]*(\d+)\)/i);
        const moq        = moqMatch ? parseInt(moqMatch[1]) : 1;

        // Download image
        const localImg = await downloadImage(p.imgSrc, slug, 0);
        const images   = localImg ? [localImg] : [];

        upsertProduct({ name, slug, sku, catId, desc: '', shortDesc: p.shortDesc, images, moq, packSize });
        totalImported++;
        process.stdout.write(`  ✔ ${name.slice(0, 65)}\n`);
        await DELAY(100);
      }

      hasMore = products.hasNext;
      page_n++;
      await DELAY(1200);
    }
  }

  await browser.close();
  console.log(`\n✅ Done! Imported ${totalImported} products total.`);
  console.log('   Restart the server: node server.js\n');
}

// First delete all "Unnamed Product" rows from previous failed run
const deleted = db.prepare(`DELETE FROM products WHERE name='Unnamed Product'`).run();
if (deleted.changes > 0) console.log(`🗑  Cleared ${deleted.changes} unnamed products from previous run.`);

scrapeWithPuppeteer().catch(e => { console.error('Fatal:', e); process.exit(1); });
