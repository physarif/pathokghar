const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Firebase init
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
});

const db = admin.database();

// Template load
const layout = fs.readFileSync('components/layout.html', 'utf8');
const bookTemplate = fs.readFileSync('templates/book.html', 'utf8');

// Placeholder replace helper
function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

// Folder তৈরি
if (!fs.existsSync('books')) fs.mkdirSync('books');

async function generateBookPages() {
  console.log('📚 Firebase থেকে book data fetch করছি...');
  
  const snapshot = await db.ref('/books').once('value');
  const books = snapshot.val();
  
  if (!books) {
    console.log('কোনো book data পাওয়া যায়নি।');
    return [];
  }

  const bookList = Object.values(books);
  console.log(`✅ ${bookList.length}টা বই পাওয়া গেছে।`);

  // প্রতিটা বইয়ের জন্য HTML page generate
  for (const book of bookList) {
    const bookContent = render(bookTemplate, {
      book_title: book.title,
      book_author: book.author_name,
      book_author_slug: book.author_slug,
      book_cover: book.cover,
      book_category: book.category_name,
      book_category_slug: book.category_slug,
      book_language: book.language,
      book_description: book.description,
      book_slug: book.slug,
    });

    const fullPage = render(layout, {
      page_title: `${book.title} - ${book.author_name}`,
      page_description: book.description?.slice(0, 160) || '',
      content: bookContent,
    });

    const outputPath = `books/${book.slug}.html`;
    fs.writeFileSync(outputPath, fullPage, 'utf8');
    console.log(`  ✓ ${outputPath}`);
  }

  return bookList;
}

async function generateHomepage(bookList) {
  console.log('\n🏠 Homepage generate করছি...');

  // সর্বশেষ ১২টা বই (created_at দিয়ে sort)
  const latest = [...bookList]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 12);

  // Category অনুযায়ী group করা
  const byCategory = {};
  for (const book of bookList) {
    const cat = book.category_slug;
    if (!byCategory[cat]) byCategory[cat] = { name: book.category_name, books: [] };
    byCategory[cat].books.push(book);
  }

  // Book card HTML generate helper
  function bookCard(book) {
    return `
    <a href="books/${book.slug}.html" class="book-card shrink-0 w-28 md:w-32 group">
      <div class="rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2d2d2d] group-hover:shadow-md transition-shadow">
        <img src="${book.cover}" alt="${book.title}" class="w-full aspect-[2/3] object-cover">
      </div>
      <p class="mt-1.5 text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2 leading-snug">${book.title}</p>
      <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${book.author_name}</p>
    </a>`;
  }

  // Latest section
  let sectionsHTML = `
  <section class="mb-8">
    <div class="flex items-center justify-between mb-3 px-4 md:px-6">
      <h2 class="text-base font-bold text-gray-800 dark:text-gray-100">সর্বশেষ বই</h2>
      <a href="new.html" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">সব দেখুন →</a>
    </div>
    <div class="book-scroll flex gap-3 overflow-x-auto pb-2 px-4 md:px-6">
      ${latest.map(bookCard).join('')}
    </div>
  </section>`;

  // Category sections
  for (const [slug, data] of Object.entries(byCategory)) {
    const catBooks = data.books.slice(0, 12);
    sectionsHTML += `
  <section class="mb-8">
    <div class="flex items-center justify-between mb-3 px-4 md:px-6">
      <h2 class="text-base font-bold text-gray-800 dark:text-gray-100">${data.name}</h2>
      <a href="category/${slug}/1/" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">সব দেখুন →</a>
    </div>
    <div class="book-scroll flex gap-3 overflow-x-auto pb-2 px-4 md:px-6">
      ${catBooks.map(bookCard).join('')}
    </div>
  </section>`;
  }

  const fullPage = render(layout, {
    page_title: 'পাঠক ঘর - বাংলা বইয়ের ডিজিটাল পাঠাগার',
    page_description: 'বাংলা ও ইংরেজি বইয়ের ডিজিটাল পাঠাগার - পড়ুন, ডাউনলোড করুন',
    content: `<main class="flex-1 py-4 md:py-6 min-h-[calc(100vh-3.5rem)] overflow-hidden">${sectionsHTML}</main>`,
  });

  fs.writeFileSync('index.html', fullPage, 'utf8');
  console.log('  ✓ index.html');
}

// Main
(async () => {
  try {
    const bookList = await generateBookPages();
    await generateHomepage(bookList);
    console.log('\n🎉 সব pages generate হয়েছে!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();
