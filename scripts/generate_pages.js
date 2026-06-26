const { initializeApp, cert, getApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
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

// Firebase init (firebase-admin v12+ modular import)
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID.trim(),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim(),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL.trim(),
});

const db = getDatabase();

// Template load
const layout = fs.readFileSync('components/layout.html', 'utf8');
const bookTemplate = fs.readFileSync('components/book.html', 'utf8');

// Placeholder replace helper
function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

// Folder তৈরি
if (!fs.existsSync('books')) fs.mkdirSync('books');

// Sidebar HTML builder
function buildSidebarHTML(bookList, authorsRaw, categoriesRaw) {
  // Categories — Firebase numeric key অনুসারে sort করে প্রথম ১০টা
  const catItems = Object.entries(categoriesRaw)
    .map(([id, cat]) => ({ id, cat, num: parseInt(id, 10) }))
    .filter(({ cat }) => cat && cat.slug && cat.title)
    .sort((a, b) => {
      if (!isNaN(a.num) && !isNaN(b.num)) return a.num - b.num;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 10)
    .map(({ cat }) => `<li><a href="/category/${cat.slug}/1/">${cat.title}</a></li>`);

  // Authors — count per author
  const authorMap = {};
  const authorCount = {};
  for (const book of bookList) {
    if (book.author_slug) {
      if (!authorMap[book.author_slug]) authorMap[book.author_slug] = book.author_name;
      authorCount[book.author_slug] = (authorCount[book.author_slug] || 0) + 1;
    }
  }
  const authorItems = Object.entries(authorMap)
    .sort(([,a],[,b]) => a.localeCompare(b, 'bn'))
    .map(([slug, name]) => `<li><a href="/author/${slug}.html" class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-[#fff5f5] dark:hover:bg-[#2d1a0e] hover:text-[#c0392b] dark:hover:text-[#e57373] transition-colors"><i class="fas fa-user text-[9px] text-[#c0392b] opacity-60"></i><span class="flex-1">${name}</span><span class="text-[11px] text-gray-400 dark:text-gray-500">${authorCount[slug] || 0}</span></a></li>`);

  return {
    hero_categories: catItems.join('\n                '),
    sidebar_authors: authorItems.join('\n                '),
  };
}

async function generateBookPages() {
  console.log('📚 Firebase থেকে data fetch করছি...');

  const [booksSnap, authorsSnap, categoriesSnap] = await Promise.all([
    db.ref('/books').orderByKey().once('value'),
    db.ref('/authors').once('value'),
    db.ref('/categories').once('value'),
  ]);

  const booksRaw = booksSnap.val();
  const authorsRaw = authorsSnap.val() || {};
  const categoriesRaw = categoriesSnap.val() || {};

  if (!booksRaw) {
    console.log('কোনো book data পাওয়া যায়নি।');
    return { bookList: [], authorsRaw: {} };
  }

  const bookList = Object.entries(booksRaw)
    .sort(([keyA], [keyB]) => {
      const numA = parseInt(keyA, 10);
      const numB = parseInt(keyB, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return keyA.localeCompare(keyB);
    })
    .map(([firebaseKey, book]) => {
    const author = authorsRaw[book.author] || {};
    const category = categoriesRaw[book.category] || {};
    return {
      id: parseInt(firebaseKey, 10) || firebaseKey,
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

    const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
    const fullPage = render(layout, {
      page_title: `${book.title} - ${book.author_name}`,
      page_description: book.description?.slice(0, 160) || '',
      content: bookContent,
      hero_categories,
      sidebar_authors,
    });

    const outputPath = `books/${book.slug}.html`;
    fs.writeFileSync(outputPath, fullPage, 'utf8');
    console.log(`  ✓ ${outputPath}`);
  }

  return { bookList, authorsRaw, categoriesRaw };
}

async function generateHomepage(bookList, authorsRaw, categoriesRaw) {
  console.log('\n🏠 Homepage generate করছি...');

  const indexTemplate = fs.readFileSync('components/index.html', 'utf8');

  // সর্বশেষ ১২টা বই (created_at দিয়ে sort)
  const latest = [...bookList]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 12);

  // Category অনুযায়ী group করা — id অনুসারে sort
  const byCategory = {};
  for (const book of bookList) {
    const cat = book.category_slug;
    if (!byCategory[cat]) byCategory[cat] = { name: book.category_name, books: [] };
    byCategory[cat].books.push(book);
  }
  // প্রতিটি category-র books id অনুসারে ascending sort
  for (const cat of Object.values(byCategory)) {
    cat.books.sort((a, b) => {
      if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  // Book card — styling সব components/index.html এ
  function bookCard(book) {
    return `<a href="books/${book.slug}.html" class="bc-card">
      <div class="bc-img-wrap">
        <img src="${book.cover}" alt="${book.title}" class="bc-img" loading="lazy">
      </div>
      <span class="bc-meta">${book.title}</span>
      <span class="bc-author">${book.author_name}</span>
    </a>`;
  }

  // Category section HTML — structure সব components/index.html এ
  let categorySectionsHTML = '';
  for (const [slug, data] of Object.entries(byCategory)) {
    const catBooks = data.books.slice(0, 12);
    categorySectionsHTML += `
  <section class="book-section">
    <div class="bc-section-header">
      <h2 class="bc-section-title">${data.name}</h2>
      <a href="category/${slug}/1/" class="bc-section-link">সব দেখুন →</a>
    </div>
    <div class="bc-scroll">${catBooks.map(bookCard).join('')}</div>
  </section>`;
  }

  const indexContent = render(indexTemplate, {
    latest_books: latest.map(bookCard).join(''),
    category_sections: categorySectionsHTML,
  });

  const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
  const fullPage = render(layout, {
    page_title: 'পাঠক ঘর - বাংলা বইয়ের ডিজিটাল পাঠাগার',
    page_description: 'বাংলা ও ইংরেজি বইয়ের ডিজিটাল পাঠাগার - পড়ুন, ডাউনলোড করুন',
    content: indexContent,
    hero_categories,
    sidebar_authors,
  });

  fs.writeFileSync('index.html', fullPage, 'utf8');
  console.log('  ✓ index.html');
}

async function generateAuthorPages(bookList, authorsRaw, categoriesRaw) {
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
    const booksData = JSON.stringify(data.books.map(b => ({
      slug: b.slug,
      title: b.title,
      cover: b.cover,
      category_name: b.category_name,
    })));

    const authorContent = render(authorTemplate, {
      author_name: data.name,
      author_img: data.img,
      author_desc: data.desc,
      author_book_count: data.books.length,
      author_books_data: booksData,
    });
    const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
    const fullPage = render(layout, {
      page_title: data.name,
      page_description: '',
      content: authorContent,
      hero_categories,
      sidebar_authors,
    });

    fs.writeFileSync(`author/${slug}.html`, fullPage, 'utf8');
    console.log(`  ✓ author/${slug}.html`);
  }
}

async function generateDownloadPages(bookList, authorsRaw, categoriesRaw) {
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
    const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
    const fullPage = render(layout, {
      page_title: book.title,
      page_description: '',
      content: downloadContent,
      hero_categories,
      sidebar_authors,
    });

    fs.writeFileSync(`download/${book.slug}.html`, fullPage, 'utf8');
    console.log(`  ✓ download/${book.slug}.html`);
  }
}

async function generateCategoryPages(bookList, authorsRaw, categoriesRaw) {
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
    // id অনুসারে ascending sort
    data.books.sort((a, b) => {
      if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
      return String(a.id).localeCompare(String(b.id));
    });
    const BOOKS_PER_PAGE = 24;
    const totalPages = Math.ceil(data.books.length / BOOKS_PER_PAGE);
    const dir = `category/${slug}`;
    if (!fs.existsSync('category')) fs.mkdirSync('category');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    for (let page = 1; page <= totalPages; page++) {
      const pageBooks = data.books.slice((page - 1) * BOOKS_PER_PAGE, page * BOOKS_PER_PAGE);

      const booksGrid = pageBooks.map(book => `
      <a href="/books/${book.slug}.html" class="cat-card">
        <div class="cat-img-wrap">
          <img src="${book.cover}" alt="${book.title}" class="cat-img" loading="lazy">
        </div>
        <p class="cat-title">${book.title}</p>
        <p class="cat-author">${book.author_name}</p>
      </a>`).join('');

      // Pagination HTML
      let paginationHTML = '<div class="cat-pagination">';
      if (page > 1) paginationHTML += `<a href="/category/${slug}/${page - 1}/" class="cat-page-nav"><i class="fas fa-chevron-left text-xs"></i> আগের</a>`;
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) paginationHTML += `<span class="cat-page-btn active">${i}</span>`;
        else paginationHTML += `<a href="/category/${slug}/${i}/" class="cat-page-btn">${i}</a>`;
      }
      if (page < totalPages) paginationHTML += `<a href="/category/${slug}/${page + 1}/" class="cat-page-nav">পরের <i class="fas fa-chevron-right text-xs"></i></a>`;
      paginationHTML += '</div>';

      const categoryContent = render(categoryTemplate, {
        category_name: data.name,
        category_book_count: data.books.length,
        category_books_grid: booksGrid,
        category_pagination: paginationHTML,
      });
      const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
      const fullPage = render(layout, {
        page_title: data.name,
        page_description: '',
        content: categoryContent,
        hero_categories,
        sidebar_authors,
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
    const { bookList, authorsRaw, categoriesRaw } = await generateBookPages();
    await generateHomepage(bookList, authorsRaw, categoriesRaw);
    await generateAuthorPages(bookList, authorsRaw, categoriesRaw);
    await generateDownloadPages(bookList, authorsRaw, categoriesRaw);
    await generateCategoryPages(bookList, authorsRaw, categoriesRaw);
    console.log('\n🎉 সব pages generate হয়েছে!');
    await getApp().delete();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    await getApp().delete().catch(() => {});
    process.exit(1);
  }
})();
