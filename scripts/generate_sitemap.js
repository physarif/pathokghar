const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'https://pathokghar.pages.dev';
const today = new Date().toISOString().split('T')[0];

// lastmod state file — git এ commit থাকবে, content আসলে না বদলালে পুরনো তারিখ ধরে রাখে
const STATE_FILE = 'sitemap-lastmod.json';
let state = {};
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    state = {};
  }
}
const newState = {};

// { loc, changefreq, priority, lastmod }
let urls = [];

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

// content আসলে বদলেছে কিনা চেক করে lastmod ঠিক করে —
// বদলালে আজকের তারিখ, না বদলালে আগের lastmod-ই থাকে
function getLastmod(loc, filePath) {
  const hash = hashFile(filePath);
  const prev = state[loc];

  let lastmod;
  if (prev && prev.hash === hash) {
    lastmod = prev.lastmod; // content অপরিবর্তিত — পুরনো তারিখ রাখো
  } else {
    lastmod = today; // নতুন বা পরিবর্তিত content — আজকের তারিখ
  }

  newState[loc] = { hash, lastmod };
  return lastmod;
}

function addUrl(loc, changefreq, priority, filePath) {
  urls.push({ loc, changefreq, priority, lastmod: getLastmod(loc, filePath) });
}

// ── Homepage ──
addUrl(`${BASE_URL}/`, 'daily', '1.0', 'index.html');

// ── Book listing pages (books/2/, books/3/, ... ) ──
if (fs.existsSync('books')) {
  const pageDirs = fs.readdirSync('books').filter(f =>
    fs.statSync(path.join('books', f)).isDirectory()
  );
  pageDirs.forEach(p => {
    const filePath = path.join('books', p, 'index.html');
    addUrl(`${BASE_URL}/books/${p}/`, 'daily', '0.7', filePath);
  });
}

// ── Individual book pages ──
if (fs.existsSync('book')) {
  const bookFiles = fs.readdirSync('book').filter(f => f.endsWith('.html'));
  bookFiles.forEach(f => {
    const filePath = path.join('book', f);
    addUrl(`${BASE_URL}/book/${f}`, 'weekly', '0.8', filePath);
  });
}

// ── Read pages ──
if (fs.existsSync('read')) {
  const readFiles = fs.readdirSync('read').filter(f => f.endsWith('.html'));
  readFiles.forEach(f => {
    const filePath = path.join('read', f);
    addUrl(`${BASE_URL}/read/${f}`, 'weekly', '0.9', filePath);
  });
}

// ── Author listing page ──
if (fs.existsSync('authors')) {
  addUrl(`${BASE_URL}/authors/`, 'weekly', '0.6', path.join('authors', 'index.html'));
}

// ── Individual author pages ──
if (fs.existsSync('author')) {
  const authorFiles = fs.readdirSync('author').filter(f => f.endsWith('.html'));
  authorFiles.forEach(f => {
    const filePath = path.join('author', f);
    addUrl(`${BASE_URL}/author/${f}`, 'weekly', '0.7', filePath);
  });
}

// ── Category listing page ──
if (fs.existsSync('categories')) {
  addUrl(`${BASE_URL}/categories/`, 'weekly', '0.6', path.join('categories', 'index.html'));
}

// ── Category pages (category/{slug}/{page}/) ──
if (fs.existsSync('category')) {
  const catSlugs = fs.readdirSync('category').filter(f =>
    fs.statSync(path.join('category', f)).isDirectory()
  );
  catSlugs.forEach(slug => {
    const catDir = path.join('category', slug);
    const pageDirs = fs.readdirSync(catDir).filter(f =>
      fs.statSync(path.join(catDir, f)).isDirectory()
    );
    pageDirs.forEach(p => {
      const filePath = path.join(catDir, p, 'index.html');
      addUrl(`${BASE_URL}/category/${slug}/${p}/`, 'weekly', '0.7', filePath);
    });
  });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, changefreq, priority, lastmod }) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync('sitemap.xml', sitemap, 'utf8');
fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 0), 'utf8');
console.log(`✅ sitemap.xml generate হয়েছে — ${urls.length}টা URL`);
