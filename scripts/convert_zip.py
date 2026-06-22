import os
import json
import uuid
import urllib.request
import re
import zipfile
import tempfile
import shutil
from datetime import datetime
from bs4 import BeautifulSoup
from ebooklib import epub

os.makedirs('content', exist_ok=True)
os.makedirs('read', exist_ok=True)
os.makedirs(os.path.join('assets', 'epub'), exist_ok=True)


# ─── numeric sort helper ───────────────────────────────────────────────────────
def natural_sort_key(path):
    """1.html → 1, 2.html → 2, 10.html → 10 (lexicographic নয়, numeric sort)"""
    fname = os.path.basename(path)
    parts = re.split(r'(\d+)', fname)
    return [int(p) if p.isdigit() else p.lower() for p in parts]


# ─── ZIP → HTML (read page এর জন্য) ───────────────────────────────────────────
def zip_to_html(zip_path, slug):
    """ZIP এর HTML files merge করে একটা HTML string বানাও।
    Images → assets/images/{slug}/ এ copy করো।"""
    tmp_dir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmp_dir)

        # assets folder তৈরি করো
        img_out_dir = os.path.join('assets', 'images', slug)
        os.makedirs(img_out_dir, exist_ok=True)
        os.makedirs(os.path.join('assets', 'css'), exist_ok=True)

        # CSS files merge করে assets/css/{slug}.css এ save করো
        css_parts = []
        for root, _, files in os.walk(tmp_dir):
            for fname in sorted(files):
                if fname.lower().endswith('.css'):
                    fpath = os.path.join(root, fname)
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                        css_parts.append('/* ' + fname + ' */\n' + f.read())

        css_link_tag = ''
        if css_parts:
            css_out = os.path.join('assets', 'css', f'{slug}.css')
            with open(css_out, 'w', encoding='utf-8') as f:
                f.write('\n\n'.join(css_parts))
            css_link_tag = f'<link rel="stylesheet" href="/assets/css/{slug}.css">'
            print(f'  🎨 {len(css_parts)} CSS file → assets/css/{slug}.css')

        # Image গুলো copy করো ও URL map তৈরি করো
        images = {}
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                ext = fname.lower().rsplit('.', 1)[-1]
                if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'):
                    src_path = os.path.join(root, fname)
                    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', fname)
                    dest_path = os.path.join(img_out_dir, safe_name)
                    shutil.copy2(src_path, dest_path)
                    public_url = f'/assets/images/{slug}/{safe_name}'
                    images[fname] = public_url
                    rel = os.path.relpath(src_path, tmp_dir).replace('\\', '/')
                    images[rel] = public_url

        print(f'  🖼 {len(images)//2} image → assets/images/{slug}/')

        # HTML files খোঁজো ও numeric sort করো (1, 2, 3 ... 10, 11 ক্রমে)
        html_files = []
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                if fname.lower().endswith(('.html', '.htm', '.xhtml')):
                    html_files.append(os.path.join(root, fname))

        html_files.sort(key=natural_sort_key)

        if not html_files:
            raise ValueError('ZIP এ কোনো HTML file নেই')

        print(f'  📄 {len(html_files)} HTML file পাওয়া গেছে: '
              f'{[os.path.basename(p) for p in html_files[:5]]}{"..." if len(html_files) > 5 else ""}')

        full_html = ''
        for fpath in html_files:
            with open(fpath, 'rb') as f:
                raw = f.read()
            full_html += process_html_fragment(raw, images)

        return full_html, css_link_tag, tmp_dir, html_files, images
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


# ─── ZIP → EPUB (পূর্ণাঙ্গ) ──────────────────────────────────────────────────
def zip_to_epub(zip_path, slug, book_meta):
    """
    ZIP থেকে পূর্ণাঙ্গ EPUB তৈরি করো।
    book_meta = { title, author, desc, cover_url, language, category, created_at }
    Output: assets/epub/{slug}.epub
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmp_dir)

        # ── EPUB object তৈরি ──
        book = epub.EpubBook()

        # ── Metadata ──
        book_uid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'pathokghar/{slug}'))
        book.set_identifier(book_uid)
        book.set_title(book_meta.get('title', slug))
        book.set_language('bn')  # Bengali

        author = book_meta.get('author', '')
        if author:
            book.add_author(author)

        desc = book_meta.get('desc', '')
        if desc:
            book.add_metadata('DC', 'description', desc)

        category = book_meta.get('category', '')
        if category:
            book.add_metadata('DC', 'subject', category)

        book.add_metadata('DC', 'publisher', 'পাঠক ঘর')
        book.add_metadata('DC', 'rights', 'All rights reserved')

        created_at = book_meta.get('created_at', 0)
        if created_at:
            try:
                dt = datetime.fromtimestamp(created_at / 1000).strftime('%Y-%m-%d')
                book.add_metadata('DC', 'date', dt)
            except Exception:
                pass

        print(f'  📋 Metadata set: "{book_meta.get("title", slug)}" — {author}')

        # ── Images ZIP থেকে collect ──
        epub_images = {}   # fname → EpubImage object
        img_map = {}       # original path → epub internal path

        IMAGE_EXTS = ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg')
        MIME_MAP = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'png': 'image/png',  'gif': 'image/gif',
            'webp': 'image/webp', 'svg': 'image/svg+xml',
        }

        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                ext = fname.lower().rsplit('.', 1)[-1]
                if ext in IMAGE_EXTS:
                    src_path = os.path.join(root, fname)
                    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', fname)
                    epub_img_path = f'images/{safe_name}'
                    mime = MIME_MAP.get(ext, 'image/jpeg')

                    with open(src_path, 'rb') as f:
                        img_data = f.read()

                    img_item = epub.EpubImage()
                    img_item.file_name = epub_img_path
                    img_item.media_type = mime
                    img_item.content = img_data
                    book.add_item(img_item)

                    epub_images[fname] = epub_img_path
                    rel = os.path.relpath(src_path, tmp_dir).replace('\\', '/')
                    img_map[fname] = epub_img_path
                    img_map[rel]   = epub_img_path

        print(f'  🖼 {len(epub_images)} image EPUB এ embed হয়েছে')

        # ── Cover image ──
        cover_url = book_meta.get('cover_url', '')
        if cover_url:
            try:
                req = urllib.request.Request(cover_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    cover_data = resp.read()
                ext = cover_url.split('?')[0].rsplit('.', 1)[-1].lower()
                cover_mime = MIME_MAP.get(ext, 'image/jpeg')
                book.set_cover('cover.' + (ext if ext in IMAGE_EXTS else 'jpg'), cover_data)
                print(f'  🖼 Cover image download ও set হয়েছে')
            except Exception as e:
                print(f'  ⚠ Cover download ব্যর্থ: {e}')

        # ── CSS collect ──
        css_content = ''
        for root, _, files in os.walk(tmp_dir):
            for fname in sorted(files):
                if fname.lower().endswith('.css'):
                    fpath = os.path.join(root, fname)
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                        css_content += f'/* {fname} */\n' + f.read() + '\n\n'

        # বাংলা font ও base styling যোগ করো
        base_css = """
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;700&display=swap');

body {
    font-family: 'Noto Serif Bengali', 'SolaimanLipi', serif;
    font-size: 1em;
    line-height: 1.8;
    color: #1a1a1a;
    margin: 1em 1.5em;
}
h1, h2, h3, h4, h5, h6 {
    font-weight: 700;
    line-height: 1.4;
    margin: 1em 0 0.5em;
}
p { margin: 0.5em 0; text-align: justify; }
img { max-width: 100%; height: auto; display: block; margin: 0.5em auto; }
"""
        full_css = base_css + css_content

        epub_css = epub.EpubItem(
            uid='book-style',
            file_name='style/book.css',
            media_type='text/css',
            content=full_css.encode('utf-8'),
        )
        book.add_item(epub_css)

        # ── HTML files → EPUB chapters ──
        html_files = []
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                if fname.lower().endswith(('.html', '.htm', '.xhtml')):
                    html_files.append(os.path.join(root, fname))
        html_files.sort(key=natural_sort_key)

        if not html_files:
            raise ValueError('ZIP এ কোনো HTML file নেই')

        chapters = []
        toc = []

        for idx, fpath in enumerate(html_files):
            with open(fpath, 'rb') as f:
                raw = f.read()

            chapter_html = process_epub_fragment(raw, img_map)

            fname_base = os.path.splitext(os.path.basename(fpath))[0]
            chapter_title = f'অধ্যায় {idx + 1}'

            # h1 বা h2 থেকে title নেওয়ার চেষ্টা
            soup_check = BeautifulSoup(chapter_html, 'html.parser')
            heading = soup_check.find(['h1', 'h2'])
            if heading and heading.get_text(strip=True):
                chapter_title = heading.get_text(strip=True)[:80]

            chapter_file = f'chap_{idx + 1:03d}.xhtml'

            full_chapter = f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="bn" lang="bn">
<head>
  <meta charset="utf-8"/>
  <title>{chapter_title}</title>
  <link rel="stylesheet" type="text/css" href="../style/book.css"/>
</head>
<body>
{chapter_html}
</body>
</html>'''

            chap = epub.EpubHtml(
                title=chapter_title,
                file_name=chapter_file,
                lang='bn',
            )
            chap.content = full_chapter.encode('utf-8')
            chap.add_item(epub_css)
            book.add_item(chap)
            chapters.append(chap)
            toc.append(epub.Link(chapter_file, chapter_title, f'chap-{idx + 1}'))

        print(f'  📑 {len(chapters)} chapter EPUB এ যোগ হয়েছে')

        # ── TOC ও Spine ──
        book.toc = toc
        book.add_item(epub.EpubNcx())
        book.add_item(epub.EpubNav())
        book.spine = ['nav'] + chapters

        # ── EPUB লেখো ──
        epub_out = os.path.join('assets', 'epub', f'{slug}.epub')
        epub.write_epub(epub_out, book, {})
        size_mb = os.path.getsize(epub_out) / (1024 * 1024)
        print(f'  ✅ EPUB → {epub_out} ({size_mb:.1f} MB)')

        return epub_out

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── HTML cleaner (read page এর জন্য) ────────────────────────────────────────
ALLOWED_TAGS = {
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'section', 'article', 'blockquote', 'pre', 'hr', 'br',
    'span', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
    'code', 'kbd', 'abbr',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'img', 'figure', 'figcaption', 'picture', 'source',
    'a',
    'ruby', 'rt', 'rp',
}


def process_html_fragment(raw_html, images):
    """Read page এর জন্য HTML clean করো — img src → assets URL।"""
    soup = BeautifulSoup(raw_html, 'html.parser')

    for tag in soup.find_all(['script', 'style', 'meta', 'link',
                              'noscript', 'head', 'title', 'iframe',
                              'form', 'input', 'button', 'select', 'textarea']):
        tag.decompose()

    body = soup.find('body') or soup

    for img in body.find_all('img'):
        src = img.get('src', '')
        src_name = src.split('/')[-1].split('?')[0]
        if src_name in images:
            img['src'] = images[src_name]
        elif src in images:
            img['src'] = images[src]
        if not img.get('alt'):
            img['alt'] = ''

    for a_tag in body.find_all('a', href=True):
        href = a_tag.get('href', '')
        if href.startswith(('http://', 'https://')):
            a_tag['target'] = '_blank'
            a_tag['rel'] = 'noopener noreferrer'
        elif href.startswith('#'):
            pass
        elif href.lower().endswith(('.html', '.htm', '.xhtml')):
            a_tag.unwrap()
        else:
            a_tag.unwrap()

    for tag in body.find_all(True):
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()

    url_pattern = re.compile(r'(https?://[^\s<>"\']+)')
    for text_node in body.find_all(string=True):
        if text_node.parent and text_node.parent.name == 'a':
            continue
        if url_pattern.search(text_node):
            new_html = url_pattern.sub(
                r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>',
                str(text_node)
            )
            text_node.replace_with(BeautifulSoup(new_html, 'html.parser'))

    inner = body.decode_contents()
    return inner.strip() + '\n'


def process_epub_fragment(raw_html, img_map):
    """EPUB chapter এর জন্য HTML clean করো — img src → EPUB internal path।"""
    soup = BeautifulSoup(raw_html, 'html.parser')

    for tag in soup.find_all(['script', 'style', 'meta', 'link',
                              'noscript', 'head', 'title', 'iframe',
                              'form', 'input', 'button', 'select', 'textarea']):
        tag.decompose()

    body = soup.find('body') or soup

    # img src → EPUB internal path (relative to chapter file)
    for img in body.find_all('img'):
        src = img.get('src', '')
        src_name = src.split('/')[-1].split('?')[0]
        epub_path = img_map.get(src_name) or img_map.get(src)
        if epub_path:
            # chapter file থেকে images/ folder relative path
            img['src'] = '../' + epub_path
        if not img.get('alt'):
            img['alt'] = ''

    # external link এ target blank যোগ করো
    for a_tag in body.find_all('a', href=True):
        href = a_tag.get('href', '')
        if href.startswith(('http://', 'https://')):
            pass   # EPUB এ target blank support নেই, তবে href রাখো
        elif href.lower().endswith(('.html', '.htm', '.xhtml')):
            a_tag.unwrap()
        else:
            a_tag.unwrap()

    # অপ্রয়োজনীয় tags unwrap
    for tag in body.find_all(True):
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()

    return body.decode_contents().strip()


# ─── helpers ───────────────────────────────────────────────────────────────────
def render(template, data):
    return re.sub(r'\{\{(\w+)\}\}', lambda m: data.get(m.group(1), ''), template)


def download_file(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        with open(dest, 'wb') as f:
            f.write(response.read())


# ─── main ──────────────────────────────────────────────────────────────────────
with open('components/read.html', 'r', encoding='utf-8') as f:
    read_template = f.read()

with open('firebase_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

books     = data.get('books', {})
authors   = data.get('authors', {})
categories = data.get('categories', {})

# EPUB URL map — generate_pages.js এর পরে download page আপডেটের জন্য
epub_urls = {}

for uid, book in books.items():
    slug         = book.get('slug', '')
    file_url     = book.get('file', '')
    title        = book.get('title', slug)
    desc         = book.get('desc', '')
    content_path = f'content/{slug}.html'
    read_path    = f'read/{slug}.html'

    if not file_url:
        print(f'  ⏭ {slug} — file url নেই, skip')
        continue

    if not file_url.split('?')[0].lower().endswith('.zip'):
        print(f'  ⏭ {slug} — ZIP নয়, skip')
        continue

    # author ও category resolve
    author_data   = authors.get(str(book.get('author', '')), {})
    category_data = categories.get(str(book.get('category', '')), {})

    book_meta = {
        'title'      : title,
        'author'     : author_data.get('title', ''),
        'desc'       : desc,
        'cover_url'  : book.get('img', ''),
        'category'   : category_data.get('title', ''),
        'created_at' : book.get('createdAt', 0),
    }

    # CSS link tag — already converted হলেও দরকার
    css_file = os.path.join('assets', 'css', f'{slug}.css')
    css_link_tag = f'<link rel="stylesheet" href="/assets/css/{slug}.css">' if os.path.exists(css_file) else ''

    epub_path = os.path.join('assets', 'epub', f'{slug}.epub')
    epub_public_url = f'/assets/epub/{slug}.epub'

    # ── HTML content (read page) ──
    if os.path.exists(content_path):
        print(f'  ⏭ {slug} — HTML already converted, skip')
    else:
        local_file = f'/tmp/{slug}.zip'
        print(f'\n📥 {slug} download করছি...')
        try:
            download_file(file_url, local_file)
            print(f'  🔄 {slug} HTML তৈরি করছি...')
            html_content, css_link_tag, _, _, _ = zip_to_html(local_file, slug)

            with open(content_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            print(f'  ✓ content/{slug}.html')
        except Exception as e:
            print(f'  ❌ {slug} HTML error: {e}')
            if os.path.exists(f'/tmp/{slug}.zip'):
                os.remove(f'/tmp/{slug}.zip')
            continue

        # ── EPUB ──
        if os.path.exists(epub_path):
            print(f'  ⏭ {slug} — EPUB already exists, skip')
        else:
            try:
                print(f'  📚 {slug} EPUB তৈরি করছি...')
                # ZIP আবার download করতে হবে না — local_file এখনো আছে
                zip_to_epub(local_file, slug, book_meta)
            except Exception as e:
                print(f'  ❌ {slug} EPUB error: {e}')

        if os.path.exists(f'/tmp/{slug}.zip'):
            os.remove(f'/tmp/{slug}.zip')

    # EPUB আলাদা করে skip হলেও URL track করো
    if os.path.exists(epub_path):
        epub_urls[slug] = epub_public_url
    else:
        # EPUB নেই — original ZIP URL fallback
        epub_urls[slug] = file_url

    # ── read page generate ──
    try:
        with open(content_path, 'r', encoding='utf-8') as f:
            book_content_html = f.read()

        full_page = render(read_template, {
            'book_title'      : title,
            'book_slug'       : slug,
            'book_description': desc[:160] if desc else '',
            'book_content'    : book_content_html,
            'book_css'        : css_link_tag,
        })

        with open(read_path, 'w', encoding='utf-8') as f:
            f.write(full_page)
        print(f'  ✓ read/{slug}.html')
    except Exception as e:
        print(f'  ❌ {slug} read page error: {e}')

# ── EPUB URL map save করো (generate_pages.js পড়বে) ──
with open('epub_urls.json', 'w', encoding='utf-8') as f:
    json.dump(epub_urls, f, ensure_ascii=False, indent=2)
print(f'\n✓ epub_urls.json saved ({len(epub_urls)} entries)')

print('\n✅ ZIP convert, EPUB তৈরি ও read page generation সম্পন্ন!')
