const fs = require('fs');

function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

if (!fs.existsSync('read')) fs.mkdirSync('read');

console.log('content/ folder exists:', fs.existsSync('content'));

if (!fs.existsSync('content')) {
  console.log('content/ folder নেই — skip');
  process.exit(0);
}

// read.html template load
const readTemplate = fs.readFileSync('templates/read.html', 'utf8');

// Firebase data থেকে book info নাও
const firebaseData = JSON.parse(fs.readFileSync('firebase_data.json', 'utf8'));
const books = firebaseData.books || {};
const authors = firebaseData.authors || {};

// slug → title map
const slugToTitle = {};
Object.values(books).forEach(book => {
  const author = authors[book.author] || {};
  slugToTitle[book.slug] = {
    title: book.title || '',
    author: author.title || '',
  };
});

const contentFiles = fs.readdirSync('content').filter(f => f.endsWith('.html'));
console.log(`content/ এ ${contentFiles.length}টা file পাওয়া গেছে:`, contentFiles);

for (const file of contentFiles) {
  const slug = file.replace('.html', '');
  const bookContent = fs.readFileSync(`content/${file}`, 'utf8');
  const bookInfo = slugToTitle[slug] || { title: slug, author: '' };

  const fullPage = render(readTemplate, {
    book_title: bookInfo.title,
    book_content: bookContent,
  });

  fs.writeFileSync(`read/${slug}.html`, fullPage, 'utf8');
  console.log(`  ✓ read/${slug}.html`);
}

console.log('✅ Read pages generate সম্পন্ন!');
