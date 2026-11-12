// Better approach: group ALL files by their "base name without trailing -N"
// So  bobbin-case-1.jpg and bobbin-case-2.jpg both group under "bobbin-case"
// Then match products whose stored image path shares the same base group

const path = require('path');
const fs = require('fs');
const { db } = require('../src/db');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'products');
const IMG_PREFIX = '/img/products/';

// Build groups: strip trailing -N suffix to get the base key
const allFiles = fs.readdirSync(IMG_DIR);

// group[baseKey] = [sorted list of filenames]
const groups = {};
for (const f of allFiles) {
  const base = f.replace(/\.[^.]+$/, ''); // strip extension
  const groupKey = base.replace(/-\d+$/, ''); // strip trailing -N
  if (!groups[groupKey]) groups[groupKey] = [];
  groups[groupKey].push(f);
}

// Sort each group numerically
for (const key of Object.keys(groups)) {
  groups[key].sort((a, b) => {
    const nA = parseInt((a.match(/-(\d+)\.[^.]+$/) || [0,0])[1]) || 0;
    const nB = parseInt((b.match(/-(\d+)\.[^.]+$/) || [0,0])[1]) || 0;
    return nA - nB;
  });
}

// For each product, figure out its stored image basename (without -N and extension)
const products = db.prepare('SELECT id, slug, name, images FROM products').all();
let updated = 0;
let multiCount = 0;

for (const prod of products) {
  const currentImgs = parseJSON(prod.images);
  if (currentImgs.length === 0) continue;

  // Get the base key from the first stored image
  const firstFile = path.basename(currentImgs[0]); // e.g. "bobbin-case-1.jpg"
  const firstBase = firstFile.replace(/\.[^.]+$/, ''); // "bobbin-case-1"
  const groupKey = firstBase.replace(/-\d+$/, ''); // "bobbin-case"

  const group = groups[groupKey];
  if (!group || group.length <= 1) continue; // no extra images

  const newImgs = group.map(f => IMG_PREFIX + f);

  if (JSON.stringify(newImgs) !== JSON.stringify(currentImgs)) {
    db.prepare('UPDATE products SET images=? WHERE id=?').run(JSON.stringify(newImgs), prod.id);
    console.log(`  [${group.length} imgs] ID:${prod.id} | ${prod.name.substring(0,45)}`);
    updated++;
    multiCount++;
  }
}

console.log(`\n✓ Updated ${updated} products to have multiple images`);
const total2plus = db.prepare("SELECT COUNT(*) as c FROM products WHERE json_array_length(images)>=2").get();
console.log(`✓ Total products with 2+ images: ${total2plus.c} / ${products.length}`);

function parseJSON(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}
