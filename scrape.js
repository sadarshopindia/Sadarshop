const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const cheerio = require('cheerio');

const db = new DatabaseSync('./data/satnam.db');

async function scrapeProducts() {
  console.log("Scraping sadarshop.com sitemaps...");
  const sitemapRes = await fetch('https://sadarshop.com/sitemap.xml');
  const sitemapXml = await sitemapRes.text();
  
  const sitemaps = [...sitemapXml.matchAll(/<loc>(https:\/\/sadarshop\.com\/products-[^<]+)<\/loc>/g)].map(m => m[1]);
  
  const productUrls = new Set();
  for (const sm of sitemaps) {
    const res = await fetch(sm);
    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>(https:\/\/sadarshop\.com\/products\/[^<]+)<\/loc>/g)].map(m => m[1]);
    urls.forEach(u => productUrls.add(u));
  }
  
  console.log(`Found ${productUrls.size} product URLs`);
  
  for (const url of Array.from(productUrls)) {
    try {
      const res = await fetch(url);
      const html = await res.text();
      const $ = cheerio.load(html);
      
      const titleTag = $('title').text().trim();
      // Remove "| Sadar Shop" or similar suffixes if any
      const name = titleTag.split('|')[0].trim() || 'Untitled Product';
      
      const sku = $('span.sku').text().trim() || 'SKU-' + Date.now() + Math.floor(Math.random() * 1000);
      const description = $('.description').html() || $('.product-info').html() || '';
      
      let priceText = $('.product-price .text-brand').text().trim() || $('.price').text().trim() || '0';
      let price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
      
      let moq = 1;
      let slug = url.split('/').pop();
      
      let catName = $('.breadcrumb-item').eq(2).text().trim() || 'Other Products';
      let catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      let catId = null;
      let catRow = db.prepare('SELECT id FROM categories WHERE name = ?').get(catName);
      if (catRow) {
        catId = catRow.id;
      } else {
        db.prepare('INSERT INTO categories(name, slug) VALUES(?, ?)').run(catName, catSlug);
        catId = db.prepare('SELECT last_insert_rowid() id').get().id;
      }
      
      const insert = db.prepare(`
        INSERT INTO products(sku, name, slug, category_id, description, mrp, price, moq, is_active)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET 
          description=excluded.description,
          price=excluded.price,
          name=excluded.name,
          category_id=excluded.category_id
      `);
      insert.run(sku, name, slug, catId, description, price, price, moq);
      
      console.log(`-> Saved: ${name}`);
    } catch(e) {
      console.error(`Error scraping ${url}:`, e);
    }
  }
  console.log("Done scraping.");
}

scrapeProducts();
