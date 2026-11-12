const { db } = require('../src/db');

// Check products with multiple images
const products = db.prepare(`SELECT id, name, images FROM products WHERE images IS NOT NULL AND images != '[]' AND images != '' LIMIT 10`).all();
for (const p of products) {
  let imgs = [];
  try { imgs = JSON.parse(p.images); } catch(e) {}
  console.log(`ID:${p.id} | imgs:${imgs.length} | name: ${p.name.substring(0,40)}`);
  if (imgs.length > 0) console.log('  first:', imgs[0]);
  if (imgs.length > 1) console.log('  second:', imgs[1]);
}

// Check a product with multiple images explicitly
const multi = db.prepare(`SELECT id,name,images FROM products WHERE json_array_length(images) > 1 LIMIT 5`).all();
console.log('\n--- Products with multiple images ---');
for (const p of multi) {
  const imgs = JSON.parse(p.images);
  console.log(`ID:${p.id} | ${imgs.length} imgs | ${p.name.substring(0,40)}`);
}
