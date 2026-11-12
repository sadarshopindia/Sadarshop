'use strict';
const { db, setting } = require('./db');
const H = require('./helpers');

const tiersOf = p => (H.json(p.tiers, []) || []).slice().sort((a, b) => a.min_qty - b.min_qty);

function categoryTree() {
  const counts = {};
  for (const r of db.prepare(`SELECT category_id id, COUNT(*) n FROM products WHERE is_active=1 AND parent_id IS NULL GROUP BY category_id`).all())
    counts[r.id] = r.n;
  const all = db.prepare('SELECT * FROM categories WHERE is_active=1 ORDER BY sort, name').all();
  const byId = {};
  all.forEach(c => { byId[c.id] = Object.assign({}, c, { children: [], n: counts[c.id] || 0 }); });
  const roots = [];
  all.forEach(c => {
    const node = byId[c.id];
    if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].children.push(node);
    else roots.push(node);
  });
  roots.forEach(r => { r.n = r.children.reduce((s, c) => s + c.n, r.n); });
  return { roots, byId, all };
}

/* All descendant category ids (self + children) */
function catIds(id) {
  const kids = db.prepare('SELECT id FROM categories WHERE parent_id=?').all(id).map(r => r.id);
  return [id, ...kids];
}

function cartRows(token, kind, user) {
  const rows = db.prepare(`SELECT ci.qty, p.* FROM cart_items ci JOIN products p ON p.id=ci.product_id
    WHERE ci.token=? AND ci.kind=? ORDER BY ci.id`).all(token, kind);
  return rows.map(p => {
    return Object.assign({}, p);
  });
}

function cartCount(token, kind) {
  const r = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM cart_items WHERE token=? AND kind=?').get(token, kind);
  return Number(r.n) || 0;
}


function wishIdsFor(token) {
  return db.prepare('SELECT product_id FROM wishlist WHERE token=?').all(token).map(r => r.product_id);
}

function productsQuery(opts) {
  const { q, catId, instock, isNew, wt, sort, limit, offset } = opts;
  const where = ['p.is_active=1', 'p.parent_id IS NULL']; const args = [];
  if (catId) { const ids = catIds(catId); where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  
  if (instock) where.push('p.stock > 0');
  if (isNew) where.push('p.is_new = 1');
  if (wt) { const [a, b] = String(wt).split('-').map(Number);
    if (!isNaN(a) && !isNaN(b)) { where.push('p.weight_g >= ? AND p.weight_g <= ?'); args.push(a, b); } }

  const ORDER = {
    newest: 'p.created_at DESC, p.id DESC',
    name_asc: 'p.name ASC', popular: 'p.is_featured DESC, p.review_count DESC',
    relevance: 'p.is_featured DESC, p.is_new DESC, p.id DESC'
  };

  const w = 'WHERE ' + where.join(' AND ');

  if (!q) {
    const total = db.prepare(`SELECT COUNT(*) n FROM products p ${w}`).get(...args).n;
    const rows = db.prepare(`SELECT p.*, c.name AS cat,
      (SELECT images FROM products WHERE parent_id=p.id AND images!='[]' AND images!='' AND images IS NOT NULL LIMIT 1) as child_images
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      ${w} ORDER BY ${ORDER[sort] || ORDER.relevance} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    rows.forEach(r => { if (!r.images || r.images === '[]' || r.images === '') r.images = r.child_images || '[]'; });
    return { total, rows };
  }

  // Exact search engine from threads-catalogue
  const escapeRegExp = string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeSize = text => {
    if (!text) return '';
    let norm = String(text).toLowerCase();
    norm = norm.replace(/\bone\b/g, '1');
    norm = norm.replace(/[-_]/g, ' ');
    norm = norm.replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2');
    norm = norm.replace(/(\d+(?:\.\d+)?)\s*(['"’`]+|inch(?:es)?\b|in\b)/g, '$1inch');
    return norm;
  };

  const cleanQuery = normalizeSize(String(q).toLowerCase().trim());
  const terms = cleanQuery.split(/\s+/).filter(t => t.length > 0).map(escapeRegExp);
  const searchRegexes = terms.map(term => new RegExp('(^|\\W)' + term, 'i'));

  let allRows = db.prepare(`SELECT p.*, c.name AS cat,
    (SELECT images FROM products WHERE parent_id=p.id AND images!='[]' AND images!='' AND images IS NOT NULL LIMIT 1) as child_images,
    (SELECT GROUP_CONCAT(name, ' ') FROM products WHERE parent_id=p.id) as child_names,
    (SELECT GROUP_CONCAT(sku, ' ') FROM products WHERE parent_id=p.id) as child_skus
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ${w}`).all(...args);
  allRows.forEach(r => { if (!r.images || r.images === '[]' || r.images === '') r.images = r.child_images || '[]'; });

  allRows = allRows.filter(p => {
    const searchableText = [p.name, p.sku, p.short_desc, p.description, p.cat, p.child_names, p.child_skus].map(normalizeSize).join(' ');
    return searchRegexes.every(regex => regex.test(searchableText));
  });

  if (sort === 'relevance' || !sort) {
    allRows.sort((a, b) => {
      const aTitleScore = searchRegexes.filter(regex => regex.test(a.name)).length;
      const bTitleScore = searchRegexes.filter(regex => regex.test(b.name)).length;
      if (aTitleScore !== bTitleScore) return bTitleScore - aTitleScore;
      if (a.is_featured !== b.is_featured) return b.is_featured - a.is_featured;
      return a.name.localeCompare(b.name);
    });
  } else {
    allRows.sort((a, b) => {
      if (sort === 'newest') return b.id - a.id;
      if (sort === 'name_asc') return a.name.localeCompare(b.name);
      if (sort === 'popular') return (b.is_featured - a.is_featured) || (b.review_count - a.review_count);
      return 0;
    });
  }

  const total = allRows.length;
  const rows = allRows.slice(offset, offset + limit);
  return { total, rows };
}

module.exports = { tiersOf, categoryTree, catIds, cartRows, cartCount, wishIdsFor, productsQuery };
