'use strict';
const { db } = require('../src/db');
const cats = db.prepare('SELECT id, slug FROM categories').all();
const upd = db.prepare('UPDATE categories SET image=? WHERE id=?');
let count = 0;
for (const c of cats) {
  upd.run(`/static/img/cat/${c.slug}.svg`, c.id);
  count++;
}
console.log(`Successfully updated ${count} categories with SVG images.`);
