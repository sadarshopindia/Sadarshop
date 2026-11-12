'use strict';
/**
 * sadarshop-scraper.js
 * Scrapes all products and categories from sadarshop.com
 * and imports them into the local satnam.db SQLite database.
 *
 * Run:  node sadarshop-scraper.js
 *
 * Features:
 *  - Discovers all category URLs from the nav menu
 *  - Paginates each category to get every product URL
 *  - Scrapes full product detail: name, slug, description, images, SKU, variants
 *  - Downloads product images into public/img/products/
 *  - Polite rate-limiting (300ms delay between requests)
 *  - Resumes from where it left off (ON CONFLICT DO UPDATE)
 */

const fs   = require('fs');
const path = require('path');
const http  = require('https');
const { DatabaseSync } = require('node:sqlite');
const cheerio = require('cheerio');

/* ── Config ────────────────────────────────────────────────── */
const BASE        = 'https://sadarshop.com';
const DELAY_MS    = 350;          // ms between requests – be polite
const IMG_DIR     = path.join(__dirname, 'public', 'img', 'products');
const DB_PATH     = process.env.DB_FILE || path.join(__dirname, 'data', 'satnam.db');

/* ── Setup ─────────────────────────────────────────────────── */
fs.mkdirSync(IMG_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

/* ── Helpers ────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; product-importer/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Download an image from srcUrl, save to IMG_DIR, return local /img/products/filename path or null */
async function downloadImage(srcUrl, localName) {
  if (!srcUrl || !srcUrl.startsWith('http')) return null;
  const ext  = (srcUrl.split('?')[0].split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
  const file = path.join(IMG_DIR, localName + '.' + ext);
  if (fs.existsSync(file)) return `/img/products/${localName}.${ext}`;

  try {
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    return `/img/products/${localName}.${ext}`;
  } catch {
    return null;
  }
}

/* ── Step 1: Extract all category slugs from the nav ──────── */
async function scrapeCategories() {
  console.log('\n📂 Scraping categories from nav…');
  const html = await get(BASE + '/products');
  const $    = cheerio.load(html);

  const categories = [];  // { name, slug, image, parentSlug? }

  // From the category dropdown nav
  $('a[href*="/product-categories/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const slug = href.split('/product-categories/')[1]?.split('?')[0]?.trim();
    if (!slug) return;
    const name  = $(el).text().trim().replace(/\s+/g, ' ');
    const img   = $(el).find('img').attr('src') || '';
    if (name && slug && !categories.find(c => c.slug === slug)) {
      categories.push({ name, slug, image: img });
    }
  });

  // Also from the search dropdown <select>
  $('select.product-category-select option').each((_, el) => {
    const val  = $(el).attr('value');
    const name = $(el).text().trim();
    if (!val || val === '') return;
    const slug = slugify(name);
    if (!categories.find(c => c.name === name)) {
      categories.push({ name, slug, image: '' });
    }
  });

  console.log(`  Found ${categories.length} categories`);
  return categories;
}

/* ── Step 2: Get all product URLs from a category (paginated) ─ */
async function getProductUrlsForCategory(catSlug) {
  const urls = new Set();
  let   page = 1;

  while (true) {
    const url = `${BASE}/product-categories/${catSlug}?page=${page}`;
    let html;
    try {
      html = await get(url);
    } catch (e) {
      console.warn(`    ⚠ ${e.message}`);
      break;
    }
    const $ = cheerio.load(html);
    const links = $('a.product-title-link, h2.product-title a, .product-item-inner a.woocommerce-LoopProduct-link, a[href*="/products/"]');
    let found = 0;
    links.each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('/products/') && !href.includes('?')) {
        urls.add(href);
        found++;
      }
    });
    if (found === 0) break;
    page++;
    await sleep(DELAY_MS);
  }
  return [...urls];
}

/* ── Step 3: Scrape a single product page ──────────────────── */
async function scrapeProduct(url) {
  const html = await get(url);
  const $    = cheerio.load(html);

  // Name
  const name = $('h1.product-title, .product-detail h1, h1').first().text().trim() || 'Unnamed Product';

  // Slug from URL
  const slug = url.split('/products/')[1]?.split('?')[0]?.replace(/\/$/, '') || slugify(name) + '-' + Date.now();

  // SKU
  const sku  = $('.product-sku').text().replace(/SKU:/i, '').trim()
            || $('[class*="sku"]').text().replace(/SKU:/i, '').trim()
            || 'SS-' + slug.slice(0, 20);

  // Description
  const desc = $('.product-description').html()
            || $('#tab-description').html()
            || $('[class*="description"]').first().html()
            || '';

  // Short description
  const shortDesc = $('div.short-description, .product-short-description').text().trim()
                 || $('meta[name="description"]').attr('content')?.trim()
                 || '';

  // Category from breadcrumb
  const breadcrumbs = [];
  $('nav.woocommerce-breadcrumb span, .breadcrumb .breadcrumb-item, nav[aria-label="breadcrumb"] li').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.toLowerCase() !== 'home') breadcrumbs.push(t);
  });
  const catName = breadcrumbs[breadcrumbs.length - 2] // second-to-last = category
               || $('a[href*="/product-categories/"]').last().text().trim()
               || 'Other Products';

  // Images – collect all gallery images
  const imgSrcs = [];
  // Gallery thumbnails
  $('img.product-image-photo, .gallery-items img, .product-images img, img[class*="product"]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && src.includes('sadarshop.com') && !imgSrcs.includes(src)) {
      imgSrcs.push(src);
    }
  });
  // og:image fallback
  const ogImg = $('meta[property="og:image"]').attr('content');
  if (ogImg && !imgSrcs.includes(ogImg)) imgSrcs.push(ogImg);

  // Weight from attributes table
  let weightG = 0;
  $('table.product-info tr, table.variations-table tr, .product-attribute-table tr').each((_, el) => {
    const label = $(el).find('th, td:first-child').text().toLowerCase();
    const val   = $(el).find('td:last-child, .product-attribute-value').text().trim();
    if (label.includes('weight')) {
      const m = val.match(/([\d.]+)\s*(kg|g|gram)/i);
      if (m) weightG = m[2].toLowerCase() === 'kg' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
    }
  });

  // MOQ from description/title hint
  let moq = 1;
  const moqMatch = (shortDesc + desc + name).match(/\b(?:pack\s+of|qty|quantity|min(?:imum)?\s*order)[:\s]+(\d+)/i)
               || name.match(/\((?:pack of|set of|qty)[:\s]*(\d+)\)/i);
  if (moqMatch) moq = parseInt(moqMatch[1]) || 1;

  // Pack size from name
  const packMatch = name.match(/\b(\d+)\s*(pieces?|pcs?|pack|spools?|rolls?|dozen)\b/i);
  const packSize  = packMatch ? packMatch[0] : '';

  return { name, slug, sku, catName, desc, shortDesc, imgSrcs, weightG, moq, packSize };
}

/* ── Step 4: Upsert category into DB ───────────────────────── */
function upsertCategory(name, slug, image = '') {
  const existing = db.prepare('SELECT id FROM categories WHERE slug=?').get(slug);
  if (existing) return existing.id;
  db.prepare('INSERT INTO categories(name,slug,image,is_active) VALUES(?,?,?,1)').run(name, slug, image);
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

/* ── Step 5: Upsert product into DB ────────────────────────── */
function upsertProduct({ name, slug, sku, catId, desc, shortDesc, images, weightG, moq, packSize }) {
  db.prepare(`
    INSERT INTO products(sku,name,slug,category_id,short_desc,description,images,weight_g,moq,pack_size,is_active,stock)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,0)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, category_id=excluded.category_id,
      short_desc=excluded.short_desc, description=excluded.description,
      images=excluded.images, weight_g=excluded.weight_g,
      moq=excluded.moq, pack_size=excluded.pack_size
  `).run(sku, name, slug, catId, shortDesc, desc, JSON.stringify(images), weightG, moq, packSize);
}

/* ── Main ───────────────────────────────────────────────────── */
async function main() {
  console.log('🚀 Sadar Shop importer started\n');

  /* ─ 1. Categories ─ */
  const categories = await scrapeCategories();
  await sleep(DELAY_MS);

  /* ─ 2. Collect all product URLs per category ─ */
  const allProductUrls = new Set();
  const catSlugToMeta  = {};

  for (const cat of categories) {
    process.stdout.write(`  📁 ${cat.name} … `);
    const urls = await getProductUrlsForCategory(cat.slug);
    urls.forEach(u => allProductUrls.add(u));
    catSlugToMeta[cat.slug] = cat;
    console.log(`${urls.length} products`);
    await sleep(DELAY_MS);
  }

  console.log(`\n🛍  Total unique product URLs: ${allProductUrls.size}`);

  /* ─ 3. Scrape & import each product ─ */
  let done = 0, failed = 0;
  for (const url of allProductUrls) {
    await sleep(DELAY_MS);
    try {
      const p = await scrapeProduct(url);

      // Ensure category exists
      const catSlug = slugify(p.catName);
      const catId   = upsertCategory(p.catName, catSlug);

      // Download images
      const localImages = [];
      for (let i = 0; i < Math.min(p.imgSrcs.length, 5); i++) {
        const localName = p.slug + (i > 0 ? `-${i}` : '');
        const localPath = await downloadImage(p.imgSrcs[i], localName);
        if (localPath) localImages.push(localPath);
        await sleep(80);
      }

      upsertProduct({
        name:      p.name,
        slug:      p.slug,
        sku:       p.sku,
        catId,
        desc:      p.desc,
        shortDesc: p.shortDesc,
        images:    localImages,
        weightG:   p.weightG,
        moq:       p.moq,
        packSize:  p.packSize,
      });

      done++;
      process.stdout.write(`  ✔ [${done}/${allProductUrls.size}] ${p.name.slice(0,60)}\n`);
    } catch (e) {
      failed++;
      console.error(`  ✘ ${url} — ${e.message}`);
    }
  }

  console.log(`\n✅ Done! Imported ${done} products. ${failed} failed.`);
  console.log('   Restart the server to see the new data: node server.js\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
