const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Firebase env var validation
const REQUIRED_ENV = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_DATABASE_URL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error('GitHub Secrets সঠিকভাবে set করা আছে কিনা চেক করুন।');
    process.exit(1);
  }
}

// Firebase init (firebase-admin v12+ এ admin.credential.cert → admin.cert)
admin.initializeApp({
  credential: admin.cert({
    projectId: process.env.FIREBASE_PROJECT_ID.trim(),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim(),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL.trim(),
});

const db = admin.database();


// Template load
const layout = fs.readFileSync('components/layout.html', 'utf8');
const bookTemplate = fs.readFileSync('components/book.html', 'utf8');

// Placeholder replace helper
function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

// Folder তৈরি
if (!fs.existsSync('books')) fs.mkdirSync('books');

async function generateBookPages() {
  console.log('📚 Firebase থেকে data fetch করছি...');

  const [booksSnap, authorsSnap, categoriesSnap] = await Promise.all([
    db.ref('/books').once('value'),
    db.ref('/authors').once('value'),
    db.ref('/categories').once('value'),
  ]);

  const booksRaw = booksSnap.val();
  const authorsRaw = authorsSnap.val() || {};
  const categoriesRaw = categoriesSnap.val() || {};

  // Python script এর জন্য raw data save করো
  fs.writeFileSync('firebase_data.json', JSON.stringify({
    books: booksRaw || {},
    authors: authorsRaw,
    categories: categoriesRaw,
  }, null, 2), 'utf8');
  console.log('  ✓ firebase_data.json saved');

  if (!booksRaw) {
    console.log('কোনো book data পাওয়া যায়নি।');
    return { bookList: [], authorsRaw: {} };
  }

  const bookList = Object.values(booksRaw).map(book => {
    const author = authorsRaw[book.author] || {};
    const category = categoriesRaw[book.category] || {};
    return {
      slug: book.slug,
      title: book.title,
      description: book.desc || '',
      cover: book.img || '',
      download_url: book.file || '',
      language: 'বাংলা',
      created_at: book.createdAt || 0,
      author_name: author.title || '',
      author_slug: author.slug || '',
      author_img: author.img || '',
      category_name: category.title || '',
      category_slug: category.slug || '',
    };
  });

  console.log(`✅ ${bookList.length}টা বই পাওয়া গেছে।`);

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

  return { bookList, authorsRaw };
}

async function generateHomepage(bookList) {
  console.log('\n🏠 Homepage generate করছি...');

  const indexTemplate = fs.readFileSync('components/index.html', 'utf8');

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

  // Book card — styling সব components/index.html এ
  let cardIndex = 0;
  function bookCard(book) {
    cardIndex++;
    return `<a href="books/${book.slug}.html" class="bc-card">
      <div class="bc-img-wrap">
        <img src="${book.cover}" alt="${book.title}" class="bc-img" loading="lazy">
        <div class="bc-author-overlay">${book.author_name}</div>
        <span class="bc-num">${cardIndex}</span>
      </div>
      <span class="bc-meta">${book.title}</span>
    </a>`;
  }

  // Category section HTML — structure সব components/index.html এ
  let categorySectionsHTML = '';
  for (const [slug, data] of Object.entries(byCategory)) {
    const catBooks = data.books.slice(0, 12);
    cardIndex = 0; // প্রতি section এ নতুন করে নম্বর শুরু
    categorySectionsHTML += `
  <section class="book-section">
    <div class="bc-section-header">
      <h2 class="bc-section-title">${data.name}</h2>
      <a href="category/${slug}/1/" class="bc-section-link">সব দেখুন →</a>
    </div>
    <div class="bc-scroll">${catBooks.map(bookCard).join('')}</div>
  </section>`;
  }

  cardIndex = 0;
  const indexContent = render(indexTemplate, {
    latest_books: latest.map(bookCard).join(''),
    category_sections: categorySectionsHTML,
  });

  const fullPage = render(layout, {
    page_title: 'পাঠক ঘর - বাংলা বইয়ের ডিজিটাল পাঠাগার',
    page_description: 'বাংলা ও ইংরেজি বইয়ের ডিজিটাল পাঠাগার - পড়ুন, ডাউনলোড করুন',
    content: indexContent,
  });

  fs.writeFileSync('index.html', fullPage, 'utf8');
  console.log('  ✓ index.html');
}

async function generateAuthorPages(bookList, authorsRaw) {
  console.log('\n👤 Author pages generate করছি...');
  const authorTemplate = fs.readFileSync('components/author.html', 'utf8');
  if (!fs.existsSync('author')) fs.mkdirSync('author');

  // author অনুযায়ী group
  const byAuthor = {};
  for (const book of bookList) {
    if (!byAuthor[book.author_slug]) {
      // Firebase থেকে সরাসরি author data নাও
      const authorData = Object.values(authorsRaw).find(a => a.slug === book.author_slug) || {};
      byAuthor[book.author_slug] = {
        name: book.author_name,
        img: book.author_img || '',
        desc: authorData.desc || '',
        books: [],
      };
    }
    byAuthor[book.author_slug].books.push(book);
  }

  for (const [slug, data] of Object.entries(byAuthor)) {
    const booksGrid = data.books.map(book => `
    <a href="/books/${book.slug}.html" class="group">
      <div class="rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2d2d2d] group-hover:shadow-md transition-shadow">
        <img src="${book.cover}" alt="${book.title}" class="w-full aspect-[2/3] object-cover">
      </div>
      <p class="mt-1.5 text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2 leading-snug">${book.title}</p>
      <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${book.category_name}</p>
    </a>`).join('');

    const authorContent = render(authorTemplate, {
      author_name: data.name,
      author_img: data.img,
      author_desc: data.desc,
      author_book_count: data.books.length,
      author_books_grid: booksGrid,
    });
    const fullPage = render(layout, {
      page_title: data.name,
      page_description: '',
      content: authorContent,
    });

    fs.writeFileSync(`author/${slug}.html`, fullPage, 'utf8');
    console.log(`  ✓ author/${slug}.html`);
  }
}

async function generateDownloadPages(bookList) {
  console.log('\n📥 Download pages generate করছি...');
  const downloadTemplate = fs.readFileSync('components/download.html', 'utf8');
  if (!fs.existsSync('download')) fs.mkdirSync('download');

  for (const book of bookList) {
    const downloadContent = render(downloadTemplate, {
      book_title: book.title,
      book_author: book.author_name,
      book_cover: book.cover,
      book_category: book.category_name,
      book_download_url: book.download_url || '',
      book_slug: book.slug,
      book_author_slug: book.author_slug,
      book_category_slug: book.category_slug,
    });
    const fullPage = render(layout, {
      page_title: book.title,
      page_description: '',
      content: downloadContent,
    });

    fs.writeFileSync(`download/${book.slug}.html`, fullPage, 'utf8');
    console.log(`  ✓ download/${book.slug}.html`);
  }
}

async function generateCategoryPages(bookList) {
  console.log('\n📂 Category pages generate করছি...');
  const categoryTemplate = fs.readFileSync('components/category.html', 'utf8');

  const byCategory = {};
  for (const book of bookList) {
    if (!byCategory[book.category_slug]) {
      byCategory[book.category_slug] = { name: book.category_name, books: [] };
    }
    byCategory[book.category_slug].books.push(book);
  }

  for (const [slug, data] of Object.entries(byCategory)) {
    const BOOKS_PER_PAGE = 24;
    const totalPages = Math.ceil(data.books.length / BOOKS_PER_PAGE);
    const dir = `category/${slug}`;
    if (!fs.existsSync('category')) fs.mkdirSync('category');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    for (let page = 1; page <= totalPages; page++) {
      const pageBooks = data.books.slice((page - 1) * BOOKS_PER_PAGE, page * BOOKS_PER_PAGE);

      const booksGrid = pageBooks.map(book => `
      <a href="/books/${book.slug}.html" class="group">
        <div class="rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2d2d2d] group-hover:shadow-md transition-shadow">
          <img src="${book.cover}" alt="${book.title}" class="w-full aspect-[2/3] object-cover">
        </div>
        <p class="mt-1.5 text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2 leading-snug">${book.title}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${book.author_name}</p>
      </a>`).join('');

      // Pagination HTML
      let paginationHTML = '<div class="px-4 md:px-6 flex items-center justify-center gap-1 flex-wrap">';
      if (page > 1) paginationHTML += `<a href="/category/${slug}/${page - 1}/" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><i class="fas fa-chevron-left text-xs"></i> আগের</a>`;
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) paginationHTML += `<span class="w-9 h-9 flex items-center justify-center rounded-lg text-sm bg-[#0056b3] text-white font-semibold">${i}</span>`;
        else paginationHTML += `<a href="/category/${slug}/${i}/" class="w-9 h-9 flex items-center justify-center rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">${i}</a>`;
      }
      if (page < totalPages) paginationHTML += `<a href="/category/${slug}/${page + 1}/" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">পরের <i class="fas fa-chevron-right text-xs"></i></a>`;
      paginationHTML += '</div>';

      const categoryContent = render(categoryTemplate, {
        category_name: data.name,
        category_book_count: data.books.length,
        category_books_grid: booksGrid,
        category_pagination: paginationHTML,
      });
      const fullPage = render(layout, {
        page_title: data.name,
        page_description: '',
        content: categoryContent,
      });

      const pageDir = `${dir}/${page}`;
      if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });
      fs.writeFileSync(`${pageDir}/index.html`, fullPage, 'utf8');
      console.log(`  ✓ category/${slug}/${page}/index.html`);
    }
  }
}


// Main
(async () => {
  try {
    console.log('🚀 Script শুরু হয়েছে...');
    const { bookList, authorsRaw } = await generateBookPages();
    await generateHomepage(bookList);
    await generateAuthorPages(bookList, authorsRaw);
    await generateDownloadPages(bookList);
    await generateCategoryPages(bookList);
    console.log('\n🎉 সব pages generate হয়েছে!');
    await admin.app().delete();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    await admin.app().delete().catch(() => {});
    process.exit(1);
  }
})();
