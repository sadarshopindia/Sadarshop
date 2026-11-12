'use strict';
/* Tiny HTTP framework: routing, cookies, body parsing, static files. No dependencies. */
const fs = require('fs');
const path = require('path');
const { render } = require('./template');

const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

class Router {
  constructor() { this.routes = []; this.middleware = []; }
  use(fn) { this.middleware.push(fn); return this; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\.\\\*/g, '.*')
      .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, rx, keys, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }

  async handle(req, res) {
    for (const mw of this.middleware) {
      const done = await mw(req, res);
      if (res.writableEnded || done === false) return;
    }
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.rx.exec(req.pathname);
      if (!m) continue;
      req.params = {};
      r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
      for (const h of r.handlers) {
        await h(req, res);
        if (res.writableEnded) return;
      }
      return;
    }
    res.status(404).render('shop/404', { title: 'Page not found' });
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
  }
  return out;
}

function parseQuery(str) {
  const out = {};
  if (!str) return out;
  for (const [k, v] of new URLSearchParams(str)) {
    if (k.endsWith('[]')) { const key = k.slice(0, -2); (out[key] ||= []).push(v); }
    else if (k in out) { out[k] = [].concat(out[k], v); }
    else out[k] = v;
  }
  return out;
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Multipart/form-data parser — returns { fields, files } */
function parseMultipart(buf, boundary) {
  const fields = {}; const files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  if (pos < 0) return { fields, files };
  pos += delim.length;
  while (pos < buf.length) {
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing --
    pos += 2; // CRLF
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const head = buf.slice(pos, headEnd).toString('utf8');
    const next = buf.indexOf(delim, headEnd);
    const body = buf.slice(headEnd + 4, next < 0 ? buf.length : next - 2);
    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    const name = nameM ? nameM[1] : null;
    if (name) {
      if (fileM && fileM[1]) {
        files[name] = { filename: fileM[1], type: typeM ? typeM[1].trim() : 'application/octet-stream', data: body };
      } else if (!fileM) {
        const val = body.toString('utf8');
        const key = name.endsWith('[]') ? name.slice(0, -2) : name;
        if (name.endsWith('[]')) (fields[key] ||= []).push(val);
        else if (key in fields) fields[key] = [].concat(fields[key], val);
        else fields[key] = val;
      }
    }
    if (next < 0) break;
    pos = next + delim.length;
  }
  return { fields, files };
}

function decorate(req, res) {
  res.status = function (c) { this.statusCode = c; return this; };
  res.set = function (k, v) { this.setHeader(k, v); return this; };
  res.send = function (body, type = 'text/html; charset=utf-8') {
    if (!this.headersSent) this.setHeader('Content-Type', type);
    this.end(body);
  };
  res.json = function (obj) { this.send(JSON.stringify(obj), 'application/json; charset=utf-8'); };
  res.redirect = function (url, code = 302) {
    this.statusCode = code; this.setHeader('Location', url); this.end();
  };
  res.cookie = function (name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=' + (opts.path || '/'), 'SameSite=Lax'];
    if (opts.maxAge) parts.push('Max-Age=' + opts.maxAge);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    const prev = this.getHeader('Set-Cookie');
    this.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : [parts.join('; ')]);
    return this;
  };
  res.clearCookie = function (name) { return this.cookie(name, '', { maxAge: 0 }); };
  res.render = function (view, data = {}) {
    try {
      this.send(render(view, Object.assign({}, res.locals, data)));
    } catch (e) {
      console.error('Render error in ' + view + ':', e);
      this.status(500).send('<h1>Template error</h1><pre>' + String(e.message) + '</pre>');
    }
  };
  res.locals = {};
}

function serveStatic(req, res) {
  if (req.method !== 'GET') return;
  let rel = null;
  if (req.pathname.startsWith('/static/')) {
    rel = decodeURIComponent(req.pathname.slice('/static/'.length));
  } else if (
    req.pathname.startsWith('/img/') ||
    req.pathname.startsWith('/uploads/') ||
    req.pathname.startsWith('/css/') ||
    req.pathname.startsWith('/js/')
  ) {
    rel = decodeURIComponent(req.pathname.slice(1));
  }
  if (!rel) return;
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(file).pipe(res);
  return false;
}

async function bodyParser(req) {
  if (req.method !== 'POST') { req.body = {}; req.files = {}; return; }
  const ct = req.headers['content-type'] || '';
  const raw = await readBody(req);
  if (ct.includes('multipart/form-data')) {
    const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const { fields, files } = parseMultipart(raw, (b && (b[1] || b[2]) || '').trim());
    req.body = fields; req.files = files;
  } else if (ct.includes('application/json')) {
    try { req.body = JSON.parse(raw.toString('utf8') || '{}'); } catch { req.body = {}; }
    req.files = {};
  } else {
    req.body = parseQuery(raw.toString('utf8')); req.files = {};
  }
}

module.exports = { Router, parseCookies, parseQuery, decorate, serveStatic, bodyParser, MIME };
