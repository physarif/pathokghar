const { initializeApp, cert, getApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// ক্লায়েন্ট-সাইড marked.js (book.html/author.html-এ ব্যবহৃত) এর মতোই
// options — output identical থাকার জন্য
marked.setOptions({ breaks: true, gfm: true });

// Author bio/description-এর ভেতরে কেউ যদি "# হেডিং" টাইপ markdown লেখে,
// সেটা যেন আসল <h1>/<h2> ট্যাগ তৈরি না করে (পেজে ইতিমধ্যে একটা H1 আছে —
// লেখকের নাম)। heading level ২ ধাপ নামিয়ে দেওয়া হচ্ছে যাতে সেগুলো h3+ হয়।
const headingSafeRenderer = new marked.Renderer();
headingSafeRenderer.heading = function ({ tokens, depth }) {
  const newDepth = Math.min(depth + 2, 6);
  const text = this.parser.parseInline(tokens);
  return `<h${newDepth}>${text}</h${newDepth}>\n`;
};
marked.use({ renderer: headingSafeRenderer });

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

// Social sharing defaults
const SITE_URL = 'https://pathokghar.pages.dev';
const DEFAULT_OG_IMAGE = `${SITE_URL}/assets/photos/og-banner.webp`;

// HTML escape (XSS-safe ground truth)
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// meta/og attribute-এর জন্য quote-safe escape। ইনপুট আগে থেকেই escapeHtml
// (stripMarkdownDesc) হয়ে থাকে বলে এখানে শুধু quote escape করা হয়, যাতে
// & দুইবার escape (&amp;amp;) না হয়ে যায়।
function escapeAttr(str) {
  return (str || '')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Card preview description: escape first, then apply ONLY inline markdown
// (bold **text**, italic *text*/_text_). Headings, lists, links, blockquotes,
// code blocks ইত্যাদি block-level markdown card preview-এ ignore করা হয় —
// কারণ line-clamp এর সাথে block elements ভেঙে দেখায়।
function inlineMarkdownDesc(str) {
  let escaped = escapeHtml(str);
  // bold: **text** or __text__
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // italic: *text* or _text_ (single, not matching already-replaced strong tags)
  escaped = escaped.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1<em>$2</em>$3');
  escaped = escaped.replace(/(^|[^_])_([^_\n]+?)_([^_]|$)/g, '$1<em>$2</em>$3');
  return escaped;
}

// Homepage card preview description: markdown ব্যবহার না করে শুধু plain text
// দেখানো হয় — markdown sign (** __ * _) সরিয়ে ফেলা হয়, HTML tag হিসেবে
// render করা হয় না।
function stripMarkdownDesc(str) {
  let escaped = escapeHtml(str);
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '$1');
  escaped = escaped.replace(/__(.+?)__/g, '$1');
  escaped = escaped.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1$2$3');
  escaped = escaped.replace(/(^|[^_])_([^_\n]+?)_([^_]|$)/g, '$1$2$3');
  return escaped;
}

// JSON-LD / meta description-এর জন্য plain-text markdown-strip (HTML-escape
// ছাড়া, কারণ JSON.stringify নিজেই quote/special char সামলে নেয়)
function stripMarkdownPlain(str) {
  let out = String(str || '');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/__(.+?)__/g, '$1');
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1$2$3');
  out = out.replace(/(^|[^_])_([^_\n]+?)_([^_]|$)/g, '$1$2$3');
  out = out.replace(/^#{1,6}\s*/gm, '');
  out = out.replace(/^>\s?/gm, '');
  out = out.replace(/^[-*+]\s+/gm, '');
  return out.trim();
}

// Author পেজের বই-কার্ড — আগে client-side JS দিয়ে বানানো হতো (JSON blob
// থেকে), এখন build time-এ সরাসরি HTML হিসেবে বসানো হয় যাতে crawler
// প্রথম লোডেই পুরো বইয়ের লিস্ট (এই পেজের মূল content) দেখতে পায়।
function renderAuthorBookCard(book) {
  const title = escapeHtml(book.title || '');
  return (
    `<a href="/book/${book.slug}.html" class="bc-card">` +
    `<div class="bc-img-wrap"><img src="${book.cover}" alt="${title} বই কভার" class="bc-img" loading="lazy"></div>` +
    `<div class="bc-body">` +
    `<p class="bc-headline"><span class="bc-title">${title}</span></p>` +
    (book.category_name ? `<p class="bc-meta">${escapeHtml(book.category_name)}</p>` : '') +
    (book.desc ? `<p class="bc-desc">${book.desc}</p>` : '') +
    `</div></a>`
  );
}

// Template load
const layout = fs.readFileSync('components/layout.html', 'utf8');
const bookTemplate = fs.readFileSync('components/book.html', 'utf8');

// Common book-card design — index/books/author/category/search সবগুলো পেজেই
// একই কার্ড ডিজাইন ব্যবহার হয়, তাই CSS একবারই এখানে লোড হয় এবং প্রতিটা
// টেমপ্লেটে {{book_card_styles}} placeholder এর জায়গায় বসে। ডিজাইন পরিবর্তন
// করতে চাইলে শুধু components/book-card1.html এডিট করলেই সব জায়গায় reflect হবে।
const bookCardStyles = fs.readFileSync('components/book-card1.html', 'utf8');
function injectBookCardStyles(html) {
  return html.split('{{book_card_styles}}').join(bookCardStyles);
}

// Placeholder replace helper
// hero_tag / page_type এর জন্য site-wide default দেওয়া হয়েছে, যাতে প্রতিটা
// render(layout, ...) কলে আলাদা করে না দিলেও ভুল/ফাঁকা মার্কআপ তৈরি না হয়।
// হোমপেজ ছাড়া বাকি সব পেজে হিরো ব্র্যান্ড-নাম H1 না হয়ে div হবে — কারণ
// প্রতিটা পেজের নিজস্ব মূল বিষয় (বইয়ের নাম, লেখকের নাম ইত্যাদি) H1 হওয়া উচিত।
const DEFAULT_RENDER_DATA = {
  hero_tag: 'div',
  page_type: 'website',
  robots_meta: 'index, follow',
};

function render(template, data) {
  const merged = Object.assign({}, DEFAULT_RENDER_DATA, data);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = merged[key] != null ? String(merged[key]) : '';
    return val.replace(/\$/g, '$$$$');
  });
}

// Folder তৈরি
if (!fs.existsSync('book')) fs.mkdirSync('book');

// Sidebar HTML builder
function buildSidebarHTML(bookList, authorsRaw, categoriesRaw) {
  // Categories — বর্ণমালা অনুসারে (Bengali locale) sort করে সবগুলো
  const catItems = Object.entries(categoriesRaw)
    .map(([id, cat]) => ({ id, cat }))
    .filter(({ cat }) => cat && cat.slug && cat.title)
    .sort((a, b) => a.cat.title.localeCompare(b.cat.title, 'bn'))
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
      description: book.description || book.desc || '',
      cover: book.img || '',
      download_url: book.file || '',
      zip_url: book.zip || '',
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
      book_title_json: JSON.stringify(book.title || ''),
      book_author: book.author_name,
      book_author_json: JSON.stringify(book.author_name || ''),
      book_author_slug: book.author_slug,
      book_cover: book.cover,
      book_category: book.category_name,
      book_category_json: JSON.stringify(book.category_name || ''),
      book_category_slug: book.category_slug,
      book_language: book.language,
      book_description: book.description,
      book_description_json: JSON.stringify(book.description || ""),
      // JSON-LD structured data-এর জন্য markdown-strip করা প্লেইন টেক্সট
      book_schema_description_json: JSON.stringify(stripMarkdownPlain(book.description || '').slice(0, 300)),
      book_url: `${SITE_URL}/book/${book.slug}.html`,
      book_url_json: JSON.stringify(`${SITE_URL}/book/${book.slug}.html`),
      book_cover_json: JSON.stringify(book.cover || ''),
      book_slug: book.slug,
      book_read_href: book.zip_url ? `/read/${book.slug}.html` : 'javascript:void(0)',
      book_read_disabled: book.zip_url ? '' : 'btn-unclick',
      book_read_aria_disabled: book.zip_url ? 'false' : 'true',
      book_download_href: `/download/${book.slug}.html`,
      book_download_disabled: '',
      book_download_aria_disabled: 'false',
    });

    const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
    const fullPage = render(layout, {
      page_title: `${book.title} – ${book.author_name}`,
      // সোশ্যাল শেয়ার প্রিভিউতে (WhatsApp/FB) ডোমেইন এমনিতেই আলাদাভাবে দেখায়,
      // তাই title-এর ভেতর "পাঠক ঘর" আর দরকার নেই — og:site_name ট্যাগেই
      // ব্র্যান্ডিং থেকে যাচ্ছে
      full_title: escapeAttr(`${book.title} – ${book.author_name}`),
      // heading/list/blockquote markdown চিহ্নসহ পুরোপুরি strip করে, নতুন
      // লাইনগুলো স্পেস দিয়ে একলাইন করা হচ্ছে — যাতে meta/og description
      // ঝকঝকে এক-লাইন প্লেইন টেক্সট হয়
      page_description: escapeAttr(
        escapeHtml(stripMarkdownPlain(book.description || ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160)
      ),
      page_image: book.cover || DEFAULT_OG_IMAGE,
      page_url: `${SITE_URL}/book/${book.slug}.html`,
      page_type: 'book',
      content: bookContent,
      hero_categories,
      sidebar_authors,
    });

    const outputPath = `book/${book.slug}.html`;
    fs.writeFileSync(outputPath, fullPage, 'utf8');
    console.log(`  ✓ ${outputPath}`);
  }

  return { bookList, authorsRaw, categoriesRaw };
}

function toBanglaNum(n) {
  return String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
}

async function generateHomepage(bookList, authorsRaw, categoriesRaw) {
  console.log('\n🏠 Homepage generate করছি...');

  const indexTemplate = injectBookCardStyles(fs.readFileSync('components/index.html', 'utf8'));
  const booksTemplate = injectBookCardStyles(fs.readFileSync('components/books.html', 'utf8'));

  // Book card template — সরাসরি define, index.html comment এর উপর নির্ভর নয়
  const cardTemplate = [
    '<a href="/book/{{book_slug}}.html" class="bc-card">',
    '  <div class="bc-img-wrap">',
    '    <img src="{{book_cover}}" alt="{{book_title}}" class="bc-img" loading="lazy">',
    '  </div>',
    '  <div class="bc-body">',
    '    <p class="bc-headline"><span class="bc-title">{{book_title}}</span></p>',
    '    {{book_meta_html}}',
    '    <p class="bc-desc">{{book_desc}}</p>',
    '  </div>',
    '</a>',
  ].join('\n');

  // created_at দিয়ে sort (নতুন আগে)
  const sorted = [...bookList].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const BOOKS_PER_PAGE = 12;
  const totalPages = Math.ceil(sorted.length / BOOKS_PER_PAGE);

  // Book card render helper
  function bookCard(book) {
    const desc = stripMarkdownDesc(book.description || '').slice(0, 200);
    const meta = [book.author_name, book.category_name].filter(Boolean).join(' · ');
    return render(cardTemplate, {
      book_slug: book.slug,
      book_cover: book.cover,
      book_title: book.title,
      book_meta_html: meta ? `<p class="bc-meta">${meta}</p>` : '',
      book_desc: desc,
    });
  }

  const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);

  // বিভাগসমূহ — বই সংখ্যা অনুসারে সর্বোচ্চ ৯টি বিভাগ (হোমপেজে সংখ্যা দেখানো হবে না)
  const catCountHome = {};
  for (const book of bookList) {
    if (book.category_slug) {
      catCountHome[book.category_slug] = (catCountHome[book.category_slug] || 0) + 1;
    }
  }
  const topCategoriesHtml = Object.entries(categoriesRaw)
    .filter(([, cat]) => cat && cat.slug && cat.title)
    .map(([, cat]) => ({ slug: cat.slug, name: cat.title, count: catCountHome[cat.slug] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 9)
    .map(cat => `<a href="/category/${cat.slug}/1/" class="idx-cat-card"><span class="idx-cat-card-name">${cat.name}</span></a>`)
    .join('');

  for (let page = 1; page <= totalPages; page++) {
    const pageBooks = sorted.slice((page - 1) * BOOKS_PER_PAGE, page * BOOKS_PER_PAGE);

    const template = page === 1 ? indexTemplate : booksTemplate;

    // JS ছাড়া বা crawler-এর জন্য fallback — সরাসরি HTML-এ থাকা <a> লিঙ্ক,
    // যাতে infinite-scroll (IntersectionObserver) না চললেও পরের পাতা খুঁজে
    // পাওয়া যায়। JS চালু থাকলে scroll করলেই auto-load হয়ে যাবে; ততক্ষণ এই
    // লিঙ্কটাই দেখা যাবে।
    const loadMoreLinkHtml = page < totalPages
      ? `<a href="/books/${page + 1}/" id="bc-fallback-link" style="display:inline-flex;align-items:center;gap:0.5rem;background:#c0392b;color:#fff;font-weight:600;font-size:0.95rem;padding:0.6rem 1.5rem;border-radius:5px;text-decoration:none;">আরও বই দেখুন <i class="fa-solid fa-angles-down"></i></a>`
      : '';

    const indexContent = render(template, {
      latest_books: pageBooks.map(bookCard).join(''),
      current_page: page,
      total_pages: totalPages,
      current_page_bn: toBanglaNum(page),
      total_pages_bn: toBanglaNum(totalPages),
      total_books_bn: toBanglaNum(sorted.length),
      load_more_link: loadMoreLinkHtml,
      top_categories: topCategoriesHtml,
    });

    const fullPage = render(layout, {
      page_title: page === 1
        ? 'পাঠক ঘর – বাংলা বইয়ের ডিজিটাল পাঠাগার'
        : `পাতা ${page}`,
      full_title: page === 1
        ? 'পাঠক ঘর – বাংলা বইয়ের ডিজিটাল পাঠাগার'
        : `পাতা ${page} - পাঠক ঘর`,
      page_description: 'উপন্যাস, গল্প, কবিতাসহ অসংখ্য বই পড়ুন বা ডাউনলোড করুন – সম্পূর্ণ ফ্রিতে!',
      page_image: DEFAULT_OG_IMAGE,
      page_url: page === 1 ? SITE_URL : `${SITE_URL}/books/${page}/`,
      // শুধু আসল হোমপেজে (page 1) ব্র্যান্ড-নাম H1 হবে। বাকি সব পেজে (book,
      // author, category, /books/2/... ইত্যাদি) এটা div — কারণ সেসব পেজের
      // নিজস্ব বিষয় (বইয়ের নাম ইত্যাদি) H1 হওয়া উচিত, ব্র্যান্ড-নাম নয়।
      hero_tag: page === 1 ? 'h1' : 'div',
      content: indexContent,
      hero_categories,
      sidebar_authors,
    });

    if (page === 1) {
      fs.writeFileSync('index.html', fullPage, 'utf8');
      console.log('  ✓ index.html');
    } else {
      const dir = `books/${page}`;
      if (!fs.existsSync('books')) fs.mkdirSync('books');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/index.html`, fullPage, 'utf8');
      console.log(`  ✓ books/${page}/index.html`);
    }
  }
}

async function generateAuthorPages(bookList, authorsRaw, categoriesRaw) {
  console.log('\n👤 Author pages generate করছি...');
  const authorTemplate = injectBookCardStyles(fs.readFileSync('components/author.html', 'utf8'));
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
    const booksForCards = data.books.map(b => ({
      slug: b.slug,
      title: b.title,
      cover: b.cover,
      category_name: b.category_name,
      desc: stripMarkdownDesc(b.description || '').slice(0, 200),
    }));
    // বইয়ের লিস্ট এখন build time-এই আসল HTML হিসেবে বসছে — client-side
    // JS এর উপর নির্ভর করছে না, তাই crawler প্রথম লোডেই পুরো লিস্ট পাবে
    const authorBooksHtml = booksForCards.map(renderAuthorBookCard).join('\n');

    // author bio markdown build time-এই HTML-এ convert — client-side
    // marked.parse() এর উপর নির্ভরতা বাদ
    const authorDescHtml = data.desc ? marked.parse(data.desc) : '';

    // meta description: bio থাকলে সেটার plain-text সামারি, না থাকলে
    // book-count দিয়ে auto-generate
    const authorMetaDesc = data.desc
      ? escapeAttr(escapeHtml(stripMarkdownPlain(data.desc)).replace(/\s+/g, ' ').trim().slice(0, 160))
      : escapeAttr(`লেখক ${data.name}-এর ${data.books.length}টি বই পড়ুন ও ডাউনলোড করুন পাঠক ঘরে।`);

    const authorContent = render(authorTemplate, {
      author_name: data.name,
      author_name_json: JSON.stringify(data.name || ''),
      author_img: data.img,
      author_img_json: JSON.stringify(data.img || ''),
      author_desc_html: authorDescHtml,
      author_desc_json: JSON.stringify(stripMarkdownPlain(data.desc || '').slice(0, 300)),
      author_book_count: toBanglaNum(data.books.length),
      author_books_html: authorBooksHtml,
      author_url_json: JSON.stringify(`${SITE_URL}/author/${slug}.html`),
    });
    const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
    const fullPage = render(layout, {
      page_title: data.name,
      // সাইটের নাম বাদ — বই পেজের মতোই শুধু মূল entity-র নাম
      full_title: escapeAttr(data.name),
      page_description: authorMetaDesc,
      page_image: data.img || DEFAULT_OG_IMAGE,
      page_url: `${SITE_URL}/author/${slug}.html`,
      // ব্যক্তি/লেখক পেজের জন্য "profile" বেশি প্রাসঙ্গিক og:type "website" এর চেয়ে
      page_type: 'profile',
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
      full_title: `${book.title} - পাঠক ঘর`,
      page_description: '',
      page_image: book.cover || DEFAULT_OG_IMAGE,
      // thin/duplicate content — index না করে canonical বই পেজের দিকে
      // পাঠানো হচ্ছে, যাতে ranking signal ভাগ না হয়
      page_url: `${SITE_URL}/book/${book.slug}.html`,
      robots_meta: 'noindex, follow',
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
  const categoryTemplate = injectBookCardStyles(fs.readFileSync('components/category.html', 'utf8'));

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

      const desc = book => inlineMarkdownDesc((book.description || '').slice(0, 200));
      const booksGrid = pageBooks.map(book => `
      <a href="/book/${book.slug}.html" class="bc-card">
        <div class="bc-img-wrap">
          <img src="${book.cover}" alt="${book.title}" class="bc-img" loading="lazy">
        </div>
        <div class="bc-body">
          <p class="bc-headline"><span class="bc-title">${book.title}</span></p>
          ${book.author_name ? `<p class="bc-meta">${book.author_name}</p>` : ''}
          <p class="bc-desc">${desc(book)}</p>
        </div>
      </a>`).join('');

      // Pagination HTML (books.html এর bc-pagination style অনুসরণ করা হচ্ছে)
      let paginationHTML = '<div class="bc-pagination">';
      if (page > 1) paginationHTML += `<a href="/category/${slug}/${page - 1}/" class="bc-page-nav"><i class="fas fa-chevron-left text-xs"></i> পূর্ববর্তী</a>`;
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) paginationHTML += `<span class="bc-page-btn active">${toBanglaNum(i)}</span>`;
        else paginationHTML += `<a href="/category/${slug}/${i}/" class="bc-page-btn">${toBanglaNum(i)}</a>`;
      }
      if (page < totalPages) paginationHTML += `<a href="/category/${slug}/${page + 1}/" class="bc-page-nav">পরবর্তী <i class="fas fa-chevron-right text-xs"></i></a>`;
      paginationHTML += '</div>';

      const categoryContent = render(categoryTemplate, {
        category_name: data.name,
        category_book_count: data.books.length,
        category_book_count_bn: toBanglaNum(data.books.length),
        category_books_grid: booksGrid,
        category_pagination: paginationHTML,
      });
      const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
      const fullPage = render(layout, {
        page_title: data.name,
        full_title: `${data.name} - পাঠক ঘর`,
        page_description: '',
        page_image: pageBooks[0]?.cover || DEFAULT_OG_IMAGE,
        page_url: `${SITE_URL}/category/${slug}/${page}/`,
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


async function generateCategoriesIndexPage(bookList, authorsRaw, categoriesRaw) {
  console.log('\n\u{1F4C2} Categories index page generate \u0995\u09B0\u099B\u09BF...');

  const categoriesTemplate = fs.readFileSync('components/categories.html', 'utf8');

  // category → book count
  const catCount = {};
  for (const book of bookList) {
    if (book.category_slug) {
      catCount[book.category_slug] = (catCount[book.category_slug] || 0) + 1;
    }
  }

  // Firebase key order অনুসারে sort (numeric key = original order)
  const cats = Object.entries(categoriesRaw)
    .map(([id, cat]) => ({ id, cat, num: parseInt(id, 10) }))
    .filter(({ cat }) => cat && cat.slug && cat.title)
    .sort((a, b) => {
      if (!isNaN(a.num) && !isNaN(b.num)) return a.num - b.num;
      return a.id.localeCompare(b.id);
    })
    .map(({ cat }) => ({
      slug: cat.slug,
      name: cat.title,
      count: catCount[cat.slug] || 0,
    }));

  const categoriesJson = JSON.stringify(cats);

  const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
  const content = render(categoriesTemplate, { categories_json: categoriesJson });
  const fullPage = render(layout, {
    page_title: '\u09AC\u09BF\u09AD\u09BE\u0997\u09B8\u09AE\u09C2\u09B9',
    full_title: '\u09AC\u09BF\u09AD\u09BE\u0997\u09B8\u09AE\u09C2\u09B9 - \u09AA\u09BE\u09A0\u0995 \u0998\u09B0',
    page_description: '\u09AA\u09BE\u09A0\u0995 \u0998\u09B0\u09C7\u09B0 \u09B8\u0995\u09B2 \u09AC\u09BF\u09AD\u09BE\u0997\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE',
    page_image: DEFAULT_OG_IMAGE,
    page_url: `${SITE_URL}/categories/`,
    content,
    hero_categories,
    sidebar_authors,
  });

  if (!fs.existsSync('categories')) fs.mkdirSync('categories');
  fs.writeFileSync('categories/index.html', fullPage, 'utf8');
  console.log('  \u2713 categories/index.html');
}

async function generateAuthorsIndexPage(bookList, authorsRaw, categoriesRaw) {
  console.log('\n\u{1F465} Authors index page generate \u0995\u09B0\u099B\u09BF...');

  const authorsTemplate = fs.readFileSync('components/authors.html', 'utf8');

  const authorCount = {};
  for (const book of bookList) {
    if (book.author_slug) {
      authorCount[book.author_slug] = (authorCount[book.author_slug] || 0) + 1;
    }
  }

  const authorMap = {};
  for (const book of bookList) {
    if (book.author_slug && !authorMap[book.author_slug]) {
      authorMap[book.author_slug] = {
        slug: book.author_slug,
        name: book.author_name,
        img: book.author_img || '',
      };
    }
  }

  const authorsJson = JSON.stringify(
    Object.values(authorMap).map(a => ({
      slug: a.slug,
      name: a.name,
      img: a.img,
      count: authorCount[a.slug] || 0,
    }))
  );

  const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
  const content = render(authorsTemplate, { authors_json: authorsJson });
  const fullPage = render(layout, {
    page_title: '\u09B2\u09C7\u0996\u0995\u0997\u09A3',
    full_title: '\u09B2\u09C7\u0996\u0995\u0997\u09A3 - \u09AA\u09BE\u09A0\u0995 \u0998\u09B0',
    page_description: '\u09AA\u09BE\u09A0\u0995 \u0998\u09B0\u09C7\u09B0 \u09B8\u0995\u09B2 \u09B2\u09C7\u0996\u0995\u09A6\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE',
    page_image: DEFAULT_OG_IMAGE,
    page_url: `${SITE_URL}/authors/`,
    content,
    hero_categories,
    sidebar_authors,
  });

  if (!fs.existsSync('authors')) fs.mkdirSync('authors');
  fs.writeFileSync('authors/index.html', fullPage, 'utf8');
  console.log('  \u2713 authors/index.html');
}


async function generateSearchPage(bookList, authorsRaw, categoriesRaw) {
  console.log('\n🔍 Search page generate করছি...');

  const searchTemplate = injectBookCardStyles(fs.readFileSync('components/search.html', 'utf8'));

  // Lightweight search index — build-time এ Firebase data থেকে বানানো, client-side
  // এ Fuse.js দিয়ে filter করা হয় (কোনো runtime Firebase call নেই)
  const searchIndex = bookList.map(book => ({
    slug: book.slug,
    title: book.title,
    author: book.author_name,
    category: book.category_name,
    cover: book.cover,
    desc: stripMarkdownDesc(book.description || '').slice(0, 200),
  }));

  const content = render(searchTemplate, {
    search_index_json: JSON.stringify(searchIndex),
  });

  const { hero_categories, sidebar_authors } = buildSidebarHTML(bookList, authorsRaw, categoriesRaw);
  const fullPage = render(layout, {
    page_title: 'অনুসন্ধান',
    full_title: 'অনুসন্ধান - পাঠক ঘর',
    page_description: 'পাঠক ঘরে বই, লেখক বা বিভাগের নাম দিয়ে খুঁজুন।',
    page_image: DEFAULT_OG_IMAGE,
    page_url: `${SITE_URL}/search.html`,
    content,
    hero_categories,
    sidebar_authors,
  });

  fs.writeFileSync('search.html', fullPage, 'utf8');
  console.log('  ✓ search.html');
}


// হেডার সার্চ বক্সের Google-স্টাইল অটোসাজেশনের জন্য lightweight static JSON —
// search.html এর মতোই ডেটা, কিন্তু description বাদ দিয়ে ছোট রাখা হয়েছে যাতে
// প্রতিটা পেজে fetch করলেও দ্রুত লোড হয়। layout.html এর JS এটা fetch করে।
function generateSearchSuggestIndex(bookList) {
  console.log('\n💡 Search suggestion index generate করছি...');
  const suggestIndex = bookList.map(book => ({
    slug: book.slug,
    title: book.title,
    author: book.author_name,
    category: book.category_name,
    cover: book.cover,
  }));
  fs.writeFileSync('search-index.json', JSON.stringify(suggestIndex), 'utf8');
  console.log('  ✓ search-index.json');
}


// Main
(async () => {
  try {
    console.log('🚀 Script শুরু হয়েছে...');
    const { bookList, authorsRaw, categoriesRaw } = await generateBookPages();
    await generateHomepage(bookList, authorsRaw, categoriesRaw);
    await generateAuthorPages(bookList, authorsRaw, categoriesRaw);
    await generateCategoriesIndexPage(bookList, authorsRaw, categoriesRaw);
    await generateAuthorsIndexPage(bookList, authorsRaw, categoriesRaw);
    await generateDownloadPages(bookList, authorsRaw, categoriesRaw);
    await generateCategoryPages(bookList, authorsRaw, categoriesRaw);
    await generateSearchPage(bookList, authorsRaw, categoriesRaw);
    generateSearchSuggestIndex(bookList);
    console.log('\n🎉 সব pages generate হয়েছে!');
    await getApp().delete();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    await getApp().delete().catch(() => {});
    process.exit(1);
  }
})();
