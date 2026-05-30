const fs = require('fs');

const layout = fs.readFileSync('components/layout.html', 'utf8');

function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

if (!fs.existsSync('read')) fs.mkdirSync('read');

console.log('content/ folder exists:', fs.existsSync('content'));

if (!fs.existsSync('content')) {
  console.log('content/ folder নেই — skip');
  process.exit(0);
}

const contentFiles = fs.readdirSync('content').filter(f => f.endsWith('.html'));
console.log(`content/ এ ${contentFiles.length}টা file পাওয়া গেছে:`, contentFiles);

for (const file of contentFiles) {
  const slug = file.replace('.html', '');
  const bookContent = fs.readFileSync(`content/${file}`, 'utf8');

  // Read page content — book content inject হবে
  const readContent = `
  <div id="book-content" class="fs-md prose dark:prose-invert max-w-none">
    ${bookContent}
  </div>`;

  const fullPage = render(layout, {
    page_title: slug,
    page_description: '',
    content: readContent,
  });

  fs.writeFileSync(`read/${slug}.html`, fullPage, 'utf8');
  console.log(`  ✓ read/${slug}.html`);
}

console.log('✅ Read pages generate সম্পন্ন!');
