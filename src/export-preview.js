'use strict';
/* Exports a click-through static preview of the whole site.
   Run the server, then: node src/export-preview.js   */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.PORT || 3000);
const OUT = process.env.PREVIEW_DIR || path.join(__dirname, '..', '..', 'sadarshop-preview');

const req = (method, url, opts = {}) => new Promise((resolve) => {
  const body = opts.body || null;
  const headers = {};
  if (opts.jar && opts.jar.v) headers.cookie = 'sid=' + opts.jar.v;
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['content-length'] = Buffer.byteLength(body);
  }
  Object.assign(headers, opts.headers || {});
  const r = http.request({ host: 'localhost', port: PORT, path: url, method, headers }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const sc = res.headers['set-cookie'];
      if (sc && opts.jar) { const m = /sid=([^;]+)/.exec(sc.join(';')); if (m) opts.jar.v = m[1]; }
      resolve({ code: res.statusCode, body: b, location: res.headers.location });
    });
  });
  if (body) r.write(body);
  r.end();
});

const fileFor = u => {
  const p = u.split('?')[0].replace(/\/$/, '');
  if (p === '' || p === '/') return 'index.html';
  return p.replace(/^\//, '').replace(/\//g, '-') + '.html';
};

function rewrite(html, known) {
  return html
    .replace(/(href|src)="\/static\/([^"]*)"/g, (m, a, rel) => `${a}="static/${rel}"`)
    .replace(/(href|action)="(\/[^"]*)"/g, (m, a, u) => {
      if (/^\/static\//.test(u)) return m;
      const f = fileFor(u);
      if (known.has(f)) return `${a}="${f}"`;
      if (a === 'action') return `${a}="#"`;
      return `${a}="#"`;
    })
    .replace(/<form([^>]*)>/g, '<form$1 onsubmit="return false">');
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'public'), path.join(OUT, 'static'), { recursive: true });

  const guest = { v: null }, trade = { v: null }, admin = { v: null };

  await req('GET', '/', { jar: guest });
  for (const [id, q] of [[1, 3], [6, 1], [22, 2]]) await req('POST', '/cart/add', { jar: guest, body: `id=${id}&qty=${q}` });
  for (const [id, q] of [[10, 50], [11, 25], [14, 100]]) await req('POST', '/enquiry/add', { jar: guest, body: `id=${id}&qty=${q}` });
  await req('POST', '/wishlist/toggle', { jar: guest, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 3 }) });

  await req('GET', '/', { jar: trade });
  await req('POST', '/login', { jar: trade, body: 'email=buyer@example.com&password=demo1234' });
  await req('GET', '/', { jar: admin });
  await req('POST', '/admin/login', { jar: admin, body: 'email=admin@example.com&password=' + encodeURIComponent(process.env.ADMIN_PASSWORD || 'admin123') });

  const prods = ['griffin-eyebrow-threading-thread-pack-of-15-spools',
    'standard-tagging-gun-heavy-duty-steel-needle', 'standard-barbs-25-mm-5-000-pcs',
    'transparent-plastic-shirt-clips-1-000-pcs', 'adjustable-security-loop-pins-1-000-pcs',
    'organza-drawstring-pouches-10-12-cm-100-pcs'];

  const jobs = [
    ['/', guest], ['/products', guest], ['/products?sort=price_asc&per=24', guest],
    ['/products?q=barb', guest], ['/wholesale', guest], ['/contact', guest],
    ['/track', guest], ['/wishlist', guest], ['/cart', guest], ['/enquiry', guest],
    ['/checkout', guest], ['/login', guest], ['/register', guest],
    ['/c/eyebrow-threading-thread', guest], ['/c/tags-labels', guest], ['/c/tag-guns', guest],
    ['/c/pins-fasteners', guest], ['/c/packing-finishing', guest], ['/c/tag-guns-accessories', guest],
    ['/pages/about-us', guest], ['/pages/shipping-delivery', guest], ['/pages/returns-exchanges', guest],
    ['/pages/terms-conditions', guest], ['/pages/privacy-policy', guest],
    ...prods.map(s => ['/p/' + s, guest]),
    ['/account', trade],
    ['/admin', admin], ['/admin/products', admin], ['/admin/products/1', admin], ['/admin/products/new', admin],
    ['/admin/categories', admin], ['/admin/orders', admin], ['/admin/orders/1', admin],
    ['/admin/orders/1/invoice', admin], ['/admin/enquiries', admin], ['/admin/enquiries/1', admin],
    ['/admin/customers', admin], ['/admin/coupons', admin], ['/admin/pages', admin],
    ['/admin/messages', admin], ['/admin/subscribers', admin], ['/admin/settings', admin]
  ];

  const known = new Set(jobs.map(j => fileFor(j[0])));
  known.add('index.html');

  let n = 0, failed = [];
  for (const [url, jar] of jobs) {
    const r = await req('GET', url, { jar });
    if (r.code !== 200) { failed.push(url + ' -> ' + r.code); continue; }
    fs.writeFileSync(path.join(OUT, fileFor(url)), rewrite(r.body, known));
    n++;
  }
  console.log('Exported ' + n + ' pages to ' + OUT);
  if (failed.length) console.log('Failed: ' + failed.join(', '));
})();
