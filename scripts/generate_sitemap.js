const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://pathokghar.pages.dev';
const today = new Date().toISOString().split('T')[0];

// { loc, changefreq, priority }
let urls = [];

function addUrl(loc, changefreq, priority) {
  urls.push({ loc, changefreq, priority });
}

// ── Homepage ──
addUrl(`${BASE_URL}/`, 'daily', '1.0');

// ── Book listing pages (books/2/, books/3/, ... ) ──
if (fs.existsSync('books')) {
  const pageDirs = fs.readdirSync('books').filter(f =>
    fs.statSync(path.join('books', f)).isDirectory()
  );
  pageDirs.forEach(p => addUrl(`${BASE_URL}/books/${p}/`, 'daily', '0.7'));
}

// ── Individual book pages ──
if (fs.existsSync('book')) {
  const bookFiles = fs.readdirSync('book').filter(f => f.endsWith('.html'));
  bookFiles.forEach(f => addUrl(`${BASE_URL}/book/${f}`, 'weekly', '0.8'));
}

// ── Read pages ──
if (fs.existsSync('read')) {
  const readFiles = fs.readdirSync('read').filter(f => f.endsWith('.html'));
  readFiles.forEach(f => addUrl(`${BASE_URL}/read/${f}`, 'weekly', '0.9'));
}

// ── Download pages ──
if (fs.existsSync('download')) {
  const downloadFiles = fs.readdirSync('download').filter(f => f.endsWith('.html'));
  downloadFiles.forEach(f => addUrl(`${BASE_URL}/download/${f}`, 'monthly', '0.6'));
}

// ── Author listing page ──
if (fs.existsSync('authors')) {
  addUrl(`${BASE_URL}/authors/`, 'weekly', '0.6');
}

// ── Individual author pages ──
if (fs.existsSync('author')) {
  const authorFiles = fs.readdirSync('author').filter(f => f.endsWith('.html'));
  authorFiles.forEach(f => addUrl(`${BASE_URL}/author/${f}`, 'weekly', '0.7'));
}

// ── Category listing page ──
if (fs.existsSync('categories')) {
  addUrl(`${BASE_URL}/categories/`, 'weekly', '0.6');
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
    pageDirs.forEach(p => addUrl(`${BASE_URL}/category/${slug}/${p}/`, 'weekly', '0.7'));
  });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, changefreq, priority }) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync('sitemap.xml', sitemap, 'utf8');
console.log(`✅ sitemap.xml generate হয়েছে — ${urls.length}টা URL`);
