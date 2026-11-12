'use strict';
/* Generates branded SVG artwork for categories and products. Run: node src/gen-images.js */
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { json } = require('./helpers');

const IMG = path.join(__dirname, '..', 'public', 'img');
['cat', 'catalog', 'brand'].forEach(d => fs.mkdirSync(path.join(IMG, d), { recursive: true }));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- glyphs: simple line art, drawn in a 200x200 box ---- */
const G = {
  spool: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <rect x="62" y="46" width="76" height="12" rx="4" fill="currentColor" opacity=".9"/>
    <rect x="62" y="142" width="76" height="12" rx="4" fill="currentColor" opacity=".9"/>
    <path d="M78 58v84M122 58v84"/>
    <path d="M78 72h44M78 88h44M78 104h44M78 120h44" opacity=".55"/>
    <path d="M122 80c16 4 24 12 24 22s-8 18-24 22" opacity=".7"/></g>`,
  gun: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M46 66h70l14 16h22"/><path d="M46 66v22h56"/>
    <path d="M74 88l-10 46h26l6-30"/><path d="M96 96c10 6 14 14 14 22"/>
    <path d="M152 82v10" opacity=".7"/><circle cx="60" cy="77" r="4" fill="currentColor"/></g>`,
  needle: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M58 150L142 58"/><path d="M142 58l8-8"/>
    <ellipse cx="70" cy="138" rx="9" ry="5" transform="rotate(-47 70 138)"/>
    <path d="M84 128L98 142M104 108L118 122" opacity=".5"/></g>`,
  barb: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M44 100h112"/><path d="M44 88v24M156 84v32"/>
    <path d="M70 100v-22M96 100v-22M122 100v-22" opacity=".8"/>
    <path d="M70 78h-8M96 78h-8M122 78h-8"/>
    <path d="M70 100v22M96 100v22M122 100v22" opacity=".4"/></g>`,
  tag: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">
    <path d="M112 46H70a10 10 0 00-10 10v88a10 10 0 0010 10h60a10 10 0 0010-10V74z"/>
    <path d="M112 46v28h28" opacity=".7"/>
    <circle cx="100" cy="92" r="7"/>
    <path d="M76 118h48M76 132h30" opacity=".6" stroke-linecap="round"/></g>`,
  label: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">
    <path d="M46 70h84l24 30-24 30H46z"/><circle cx="126" cy="100" r="7"/>
    <path d="M62 88h44M62 112h30" opacity=".6" stroke-linecap="round"/></g>`,
  roll: `<g stroke="currentColor" stroke-width="5" fill="none">
    <ellipse cx="100" cy="72" rx="46" ry="18"/>
    <path d="M54 72v56c0 10 21 18 46 18s46-8 46-18V72"/>
    <ellipse cx="100" cy="72" rx="16" ry="6" opacity=".6"/>
    <path d="M146 118l22 8-6 16" stroke-linecap="round" opacity=".8"/></g>`,
  pin: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M62 78c0-12 10-20 22-20h50a20 20 0 0120 20v8"/>
    <path d="M62 78v44a16 16 0 0016 16h70"/>
    <path d="M154 86v36a16 16 0 01-16 16"/>
    <circle cx="62" cy="100" r="12"/><path d="M148 130l14 8" opacity=".7"/></g>`,
  clip: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M76 54v70a24 24 0 0048 0V66a12 12 0 00-24 0v56"/>
    <path d="M124 96h22M124 112h22" opacity=".5"/></g>`,
  loop: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M100 58a34 34 0 100 68 34 34 0 100-68z" opacity=".85"/>
    <path d="M100 126v28"/><path d="M84 154h32"/>
    <path d="M78 92h44" opacity=".5"/></g>`,
  glue: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">
    <rect x="84" y="46" width="32" height="96" rx="8"/>
    <path d="M100 142l-10 20h20z"/><path d="M84 70h32M84 94h32M84 118h32" opacity=".45"/></g>`,
  cutter: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M56 62l62 62M144 62L82 124"/>
    <circle cx="72" cy="140" r="14"/><circle cx="128" cy="140" r="14"/>
    <path d="M100 106l8 8" opacity=".6"/></g>`,
  pouch: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">
    <path d="M66 82h68l10 62a12 12 0 01-12 14H68a12 12 0 01-12-14z"/>
    <path d="M72 82c0-16 12-28 28-28s28 12 28 28" opacity=".7"/>
    <path d="M78 100h44" opacity=".5"/></g>`,
  box: `<g stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round">
    <path d="M100 52l48 24v56l-48 24-48-24V76z"/><path d="M52 76l48 24 48-24M100 100v56" opacity=".65"/></g>`
};

function glyphFor(name, cat) {
  const s = (name + ' ' + cat).toLowerCase();
  if (/threading thread|eyebrow/.test(s)) return 'spool';
  if (/gun/.test(s) && !/glue/.test(s)) return 'gun';
  if (/needle/.test(s)) return 'needle';
  if (/barb|tag pin/.test(s)) return 'barb';
  if (/label roll|price label|taffeta|roll/.test(s)) return 'roll';
  if (/wash care|label/.test(s)) return 'label';
  if (/safety pin/.test(s)) return 'pin';
  if (/clip|shirt pin/.test(s)) return 'clip';
  if (/loop/.test(s)) return 'loop';
  if (/glue/.test(s)) return 'glue';
  if (/cutter/.test(s)) return 'cutter';
  if (/pouch|organza/.test(s)) return 'pouch';
  if (/tag/.test(s)) return 'tag';
  return 'box';
}

const PALETTE = [
  ['#EEF2FA', '#DCE5F5', '#2B3F66'], ['#FBF1E4', '#F4E2C9', '#8A5A19'],
  ['#EDF6F1', '#D8EBE1', '#1F5C43'], ['#F7EFF3', '#EFDDE6', '#7A3350'],
  ['#F1F0FA', '#E1DFF3', '#413A78'], ['#FAF2EF', '#F1DFD8', '#8C4A34'],
  ['#EFF5F8', '#DBE9F0', '#255266'], ['#F6F4EA', '#EAE6D2', '#6B6224']
];

function svg(title, sub, glyph, pi, w = 600, h = 600) {
  const [c1, c2, ink] = PALETTE[pi % PALETTE.length];
  const words = String(title).split(' ');
  const lines = []; let cur = '';
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > 26) { lines.push(cur.trim()); cur = wd; } else cur += ' ' + wd;
    if (lines.length === 2) break;
  }
  if (cur.trim() && lines.length < 3) lines.push(cur.trim());
  const label = lines.slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="${ink}" opacity=".13"/></pattern>
</defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<rect width="${w}" height="${h}" fill="url(#dots)"/>
<circle cx="${w / 2}" cy="${h * 0.42}" r="${w * 0.27}" fill="#fff" opacity=".72"/>
<g transform="translate(${w / 2 - 130} ${h * 0.42 - 130}) scale(1.3)" color="${ink}">${G[glyph] || G.box}</g>
<g font-family="ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" text-anchor="middle" fill="${ink}">
${label.map((l, i) => `<text x="${w / 2}" y="${h * 0.78 + i * 30}" font-size="23" font-weight="600">${esc(l)}</text>`).join('\n')}
${sub ? `<text x="${w / 2}" y="${h * 0.78 + label.length * 30 + 12}" font-size="17" opacity=".62">${esc(sub)}</text>` : ''}
</g>
<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="${ink}" stroke-opacity=".12" stroke-width="2" rx="14"/>
</svg>`;
}

function run() {
  const cats = db.prepare('SELECT * FROM categories').all();
  cats.forEach((c, i) => {
    fs.writeFileSync(path.join(IMG, 'cat', c.slug + '.svg'),
      svg(c.name, 'Sadarshop', glyphFor(c.name, ''), i, 480, 480));
  });
  const prods = db.prepare(`SELECT p.*, c.name AS cat FROM products p LEFT JOIN categories c ON c.id=p.category_id`).all();
  prods.forEach((p, i) => {
    fs.writeFileSync(path.join(IMG, 'catalog', p.slug + '.svg'),
      svg(p.name.split('—')[0].trim(), p.pack_size || p.cat, glyphFor(p.name, p.cat || ''), i + 2));
  });
  fs.writeFileSync(path.join(IMG, 'placeholder.svg'), svg('Sadarshop', 'Image coming soon', 'box', 0));
  fs.writeFileSync(path.join(IMG, 'brand', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 56" width="280" height="56">
  <rect x="2" y="10" width="36" height="36" rx="8" fill="#BE3144"/>
  <g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 20L7 14h22l-2 6z"/>
    <path d="M7 14v22a2 2 0 002 2h18a2 2 0 002-2V14"/>
    <path d="M23 20a4 4 0 01-8 0"/>
  </g>
  <text x="48" y="30" font-family="Georgia,'Times New Roman',serif" font-size="24" font-weight="700" fill="#1a1a2e" letter-spacing="0.3">Sadarshop</text>
  <text x="49" y="46" font-family="ui-sans-serif,-apple-system,'Segoe UI',Roboto,Arial,sans-serif" font-size="10" fill="#6B7791" letter-spacing="1.8">WHOLESALE FABRICS &amp; TEXTILES</text></svg>`);
  fs.writeFileSync(path.join(IMG, 'brand', 'logo-light.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 56" width="280" height="56">
  <rect x="2" y="10" width="36" height="36" rx="8" fill="#BE3144"/>
  <g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 20L7 14h22l-2 6z"/>
    <path d="M7 14v22a2 2 0 002 2h18a2 2 0 002-2V14"/>
    <path d="M23 20a4 4 0 01-8 0"/>
  </g>
  <text x="48" y="30" font-family="Georgia,'Times New Roman',serif" font-size="24" font-weight="700" fill="#ffffff" letter-spacing="0.3">Sadarshop</text>
  <text x="49" y="46" font-family="ui-sans-serif,-apple-system,'Segoe UI',Roboto,Arial,sans-serif" font-size="10" fill="rgba(255,255,255,0.6)" letter-spacing="1.8">WHOLESALE FABRICS &amp; TEXTILES</text></svg>`);
  fs.writeFileSync(path.join(IMG, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="42" fill="#BE3144"/><g stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(30, 20) scale(3.5)"><path d="M9 20L7 14h22l-2 6z"/><path d="M7 14v22a2 2 0 002 2h18a2 2 0 002-2V14"/><path d="M23 20a4 4 0 01-8 0"/></g></svg>`);

  // hero + promo artwork
  fs.writeFileSync(path.join(IMG, 'hero.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 560" width="760" height="560">
<defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1D3159"/><stop offset="1" stop-color="#0E1B33"/></linearGradient>
<pattern id="hd" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#E0A94A" opacity=".2"/></pattern></defs>
<rect width="760" height="560" rx="20" fill="url(#h)"/><rect width="760" height="560" rx="20" fill="url(#hd)"/>
<g color="#E0A94A" transform="translate(60 60) scale(1.15)">${G.spool}</g>
<g color="#8FA8D8" transform="translate(400 40) scale(1.05)">${G.gun}</g>
<g color="#E7EDF9" transform="translate(80 300) scale(1.05)">${G.tag}</g>
<g color="#C8892B" transform="translate(420 300) scale(1.05)">${G.barb}</g>
<rect x="26" y="26" width="708" height="508" rx="14" fill="none" stroke="#E0A94A" stroke-opacity=".28" stroke-width="2"/></svg>`);
  console.log(`Generated ${cats.length} category images, ${prods.length} product images, brand assets.`);
}

if (require.main === module) run();
module.exports = { run };
