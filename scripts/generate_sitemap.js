const fs = require('fs');

const BASE_URL = 'https://pathokghar.pages.dev';
const today = new Date().toISOString().split('T')[0];

let urls = [];

// Static pages
urls.push(`${BASE_URL}/`);

// Book pages
if (fs.existsSync('books')) {
  const bookFiles = fs.readdirSync('books').filter(f => f.endsWith('.html'));
  bookFiles.forEach(f => urls.push(`${BASE_URL}/book/${f}`));
}

// Read pages
if (fs.existsSync('read')) {
  const readFiles = fs.readdirSync('read').filter(f => f.endsWith('.html'));
  readFiles.forEach(f => urls.push(`${BASE_URL}/read/${f}`));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${url === BASE_URL + '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync('sitemap.xml', sitemap, 'utf8');
console.log(`✅ sitemap.xml generate হয়েছে — ${urls.length}টা URL`);
