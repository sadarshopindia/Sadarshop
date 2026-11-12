// Audit: list all file groups with more than 1 image and show which products match
const path = require('path');
const fs = require('fs');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'products');

const allFiles = fs.readdirSync(IMG_DIR);

// group by base name without trailing -N
const groups = {};
for (const f of allFiles) {
  const base = f.replace(/\.[^.]+$/, '');
  const groupKey = base.replace(/-\d+$/, '');
  if (!groups[groupKey]) groups[groupKey] = [];
  groups[groupKey].push(f);
}

const multiGroups = Object.entries(groups).filter(([k, v]) => v.length > 1);
console.log(`Groups with multiple images: ${multiGroups.length}`);
for (const [key, files] of multiGroups) {
  console.log(`\n[${files.length}] ${key}`);
  for (const f of files) console.log('  ', f);
}
