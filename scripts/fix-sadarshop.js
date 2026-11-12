// STEP 1: Remove all Satnam Threads legacy products (IDs 340+) and their legacy categories
// STEP 2: Fix multi-image for existing Sadarshop products using disk files 
// STEP 3: Force price=0 and hide_prices=1 everywhere

const fs = require('fs');
const path = require('path');
const { db, setting } = require('../src/db');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'products');
const diskFiles = fs.readdirSync(IMG_DIR);

/* ───── Step 1: Remove Satnam Threads Products ───── */
console.log('--- Step 1: Removing Satnam Threads products & categories ---');

// The Sadarshop-original products have IDs: 64, 65, 134, 213-337
// The merged Satnam products have IDs >= 338 (they were added later by merge script)
// Also need to remove Satnam legacy categories added: threads, elastic, buttons, zippers-sliders, stationary, needles, interlings, cotton-niwars, dories, cutters-and-blades, accessories

const SATNAM_CAT_SLUGS = [
  'threads', 'elastic', 'buttons', 'zippers-sliders', 'stationary',
  'needles', 'interlings', 'cotton-niwars', 'dories', 'cutters-and-blades',
  'accessories'
];

// Find the min ID of the merged products (the ones we just added)
const minMergedId = db.prepare('SELECT MIN(id) as m FROM products WHERE id > 337').get()?.m;
console.log('Merged (Satnam) products start at ID:', minMergedId);

const before = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (minMergedId) {
  const deleted = db.prepare('DELETE FROM products WHERE id >= ?').run(minMergedId);
  console.log(`Deleted ${deleted.changes} Satnam Threads products (id >= ${minMergedId})`);
}

// Remove legacy categories
for (const slug of SATNAM_CAT_SLUGS) {
  const r = db.prepare('DELETE FROM categories WHERE slug=?').run(slug);
  if (r.changes > 0) console.log(`Deleted category: ${slug}`);
}

const after = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
console.log(`Products: ${before} -> ${after}`);

/* ───── Step 2: Multi-image fix for EXISTING products ───── */
console.log('\n--- Step 2: Fixing multi-image for existing Sadarshop products ---');

// Build file groups: strip trailing -N to get base key
const fileGroups = {}; 
for (const f of diskFiles) {
  const base = f.replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
  if (!fileGroups[base]) fileGroups[base] = [];
  fileGroups[base].push(f);
}

// Sort each group by number
for (const key of Object.keys(fileGroups)) {
  fileGroups[key].sort((a, b) => {
    const nA = parseInt((a.match(/-(\d+)\.[^.]+$/) || [,0])[1]) || 0;
    const nB = parseInt((b.match(/-(\d+)\.[^.]+$/) || [,0])[1]) || 0;
    return nA - nB;
  });
}

// Aliases for products whose image filenames don't match their slug exactly
const ALIASES = {
  'tc-spinners-5040-cotton-sewing-threads': ['5040-cotton-box', 'tc-spinners-5040-cotton-sewing-threads'],
  'tc-spinners-5040-denim-sewing-threads': ['5040-denim-box', 'tc-spinners-5040-denim-sewing-threads'],
  'tc-spinner-5000m-sewing-thread-cones': ['tc-spinner-5000m-cone-box', 'tc-spinner-5000m-sewing-thread-cones'],
  'threads-india-5000m-sewing-thread-cones': ['threads-india-5000mtr-cone-box', 'threads-india-5000m-sewing-thread-cones'],
  'tc-sewing-threads': ['tc-400m-reel-box', 'tc-sewing-threads'],
  'sapphire-sewing-threads': ['sapphire-400m-reel-box', 'sapphire-sewing-threads'],
  'microdot-fusible-interlining-7035-7055-611': ['7035-7055-611', 'microdot-fusible-interlining-7035-7055-611'],
  'heavy-duty-brown-packaging-tape-100m': ['brown-tape-100m', 'heavy-duty-brown-packaging-tape-100m'],
  'heavy-duty-transparent-packaging-tape-65m': ['transparent-tape-65m', 'heavy-duty-transparent-packaging-tape-65m'],
  'crown-measuring-tape': ['crown-measure-tape', 'crown-measuring-tape'],
  'jyoti-measuring-tape': ['measure-tape-jyoti', 'jyoti-measuring-tape'],
  'jyoti-fiberglass-multicolor-measuring-tape': ['jyoti-fiberclass-multicolor-tape-measure', 'jyoti-fiberglass-multicolor-measuring-tape'],
  'metal-bobbins': ['bobbin', 'metal-bobbins'],
  'bobbin-case': ['bobbin-case'],
  'thread-opener-seam-ripper-cutter-set': ['thread-opener-seam-ripper-cutter-set'],
  'strong-h-sharpening-belts-emery-bands': ['strong-h-belts', 'strong-h-sharpening-belts-emery-bands'],
  'yoke-steam-iron-press-boot-teflon-shoe': ['press-boot-yoke', 'yoke-steam-iron-press-boot-teflon-shoe'],
  'jyoti-thimble': ['jyoti-thimble'],
  'jyoti-nickel-tich-buttons-snap-fasteners': ['jyoti-nickel-tich-buttons-snap-fasteners', 'tich-button-snap-fasteners-nickel-jyoti'],
  'kangaro-hd-45-stapler': ['kangaro-hd-45-stapler'],
  'ambica-skein-embroidery-thread': ['ambica-skein-embroidery-thread'],
  'thread-cutter': ['thread-cutter-seam-rippers-toyo', 'thread-cutter'],
  '7mm-fine-tag-pin-pp10000-pcs-pins-white': ['7mm-fine-tag-pin-pp10000-pcs-pins-white'],
  '50mm-white-tagging-barb-for-standard-tag-gun-plastic-pins-set-of-5000': ['50mm-white-tagging-barb-for-standard-tag-gun-plastic-pins-set-of-5000'],
};

const products = db.prepare('SELECT id, name, slug, images FROM products').all();
let multiUpdated = 0;

for (const p of products) {
  let curImgs = [];
  try { curImgs = JSON.parse(p.images || '[]'); } catch { curImgs = []; }

  const candidates = new Set();

  // Add already stored valid images
  for (const imgPath of curImgs) {
    const fn = path.basename(imgPath);
    if (diskFiles.includes(fn)) candidates.add(fn);
  }

  // Check alias groups first
  const aliasList = ALIASES[p.slug] || [p.slug];
  for (const alias of aliasList) {
    if (fileGroups[alias]) {
      fileGroups[alias].forEach(f => candidates.add(f));
    }
    // Also match files that start with this alias
    diskFiles.filter(f => f.startsWith(alias + '-') || f.startsWith(alias + '.')).forEach(f => candidates.add(f));
  }

  // Also match via stored image base name
  if (curImgs.length > 0) {
    const firstFn = path.basename(curImgs[0]);
    const base = firstFn.replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
    if (fileGroups[base]) {
      fileGroups[base].forEach(f => candidates.add(f));
    }
  }

  if (candidates.size === 0) continue;

  // Sort files: base without number first (0), then 1, 2, 3...
  const sorted = [...candidates].sort((a, b) => {
    const nA = parseInt((a.match(/-(\d+)\.[^.]+$/) || [,999])[1]) || 0;
    const nB = parseInt((b.match(/-(\d+)\.[^.]+$/) || [,999])[1]) || 0;
    return nA - nB;
  });

  const newImgs = sorted.map(f => '/img/products/' + f);
  if (JSON.stringify(newImgs) !== JSON.stringify(curImgs)) {
    db.prepare('UPDATE products SET images=? WHERE id=?').run(JSON.stringify(newImgs), p.id);
    if (newImgs.length > 1) {
      multiUpdated++;
      console.log(`[${newImgs.length}x] (${p.id}) ${p.name.slice(0, 50)}`);
    }
  }
}

console.log(`\nUpdated ${multiUpdated} products to show multiple images.`);

/* ───── Step 3: Zero out ALL prices and enforce hide_prices ───── */
console.log('\n--- Step 3: Zeroing prices & enforcing hide_prices ---');
db.prepare('UPDATE products SET price=0, mrp=0').run();
setting.set('hide_prices', '1');

/* ───── Summary ───── */
const totalProds = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
const multiCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE json_array_length(images) > 1').get().c;
const cats = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
console.log(`\n========= DONE =========`);
console.log(`Total Sadarshop products: ${totalProds}`);
console.log(`Products with multiple images: ${multiCount}`);
console.log(`Total categories: ${cats}`);
console.log(`hide_prices: ${setting.get('hide_prices')}`);
