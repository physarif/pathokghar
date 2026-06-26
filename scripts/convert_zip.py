import os
import json
import urllib.request
import re
import zipfile
import tempfile
import shutil
from bs4 import BeautifulSoup

os.makedirs('content', exist_ok=True)
os.makedirs('read', exist_ok=True)


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
                    images[fname]     = public_url   # original filename
                    images[safe_name] = public_url   # sanitized filename
                    rel = os.path.relpath(src_path, tmp_dir).replace('\\', '/')
                    images[rel]       = public_url   # relative path

        print(f'  🖼 {len(images)//2} image → assets/images/{slug}/')

        # HTML files খোঁজো ও numeric sort করো (1, 2, 3 ... 10, 11 ক্রমে)
        html_files = []
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                if fname.lower().endswith(('.html', '.htm', '.xhtml')):
                    html_files.append(os.path.join(root, fname))

        # ✅ FIX: natural/numeric sort — 1 → 2 → 3 → 10 (lexicographic নয়)
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

        return full_html, css_link_tag
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── HTML cleaner ──────────────────────────────────────────────────────────────

# রাখার যোগ্য tags — structure ও formatting উভয়ই preserve হবে
ALLOWED_TAGS = {
    # headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    # block
    'p', 'div', 'section', 'article', 'blockquote', 'pre', 'hr', 'br',
    # inline text
    'span', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
    'code', 'kbd', 'abbr',
    # list
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    # table
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    # media
    'img', 'figure', 'figcaption', 'picture', 'source',
    # link
    'a',
    # ruby (বাংলা / CJK annotation)
    'ruby', 'rt', 'rp',
}


def process_html_fragment(raw_html, images):
    soup = BeautifulSoup(raw_html, 'html.parser')

    # ── script / style / meta / link ইত্যাদি সম্পূর্ণ মুছে ফেলো ──
    for tag in soup.find_all(['script', 'style', 'meta', 'link',
                              'noscript', 'head', 'title', 'iframe',
                              'form', 'input', 'button', 'select', 'textarea']):
        tag.decompose()

    body = soup.find('body') or soup

    # ── img src → assets URL ──
    for img in body.find_all('img'):
        src = img.get('src', '')
        if not src:
            continue
        src_clean = src.split('?')[0]
        src_name  = src_clean.split('/')[-1]
        safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', src_name)

        new_src = (
            images.get(src_clean)    # exact relative path
            or images.get(src_name)  # original filename
            or images.get(safe_name) # sanitized filename
        )
        if new_src:
            img['src'] = new_src
        # alt না থাকলে খালি alt যোগ করো (accessibility)
        if not img.get('alt'):
            img['alt'] = ''

    # ── link fix ──
    for a_tag in body.find_all('a', href=True):
        href = a_tag.get('href', '')
        if href.startswith(('http://', 'https://')):
            a_tag['target'] = '_blank'
            a_tag['rel'] = 'noopener noreferrer'
        elif href.startswith('#'):
            pass   # internal anchor — ঠিক আছে
        elif href.lower().endswith(('.html', '.htm', '.xhtml')):
            a_tag.unwrap()   # internal HTML page link — unwrap
        else:
            a_tag.unwrap()

    # ── অপ্রয়োজনীয় tags unwrap (decompose নয়, content রাখো) ──
    # ✅ FIX: ALLOWED_TAGS এর বাইরের tag গুলো unwrap করো,
    #         কিন্তু list/table/inline tags ঠিক রাখো
    for tag in body.find_all(True):
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()

    # ── consecutive <br> → একটা <br> ──
    for br in body.find_all('br'):
        next_sib = br.next_sibling
        while next_sib:
            # whitespace-only text node skip করো
            if isinstance(next_sib, str) and not next_sib.strip():
                next_sib = next_sib.next_sibling
                continue
            # পরেরটাও <br> হলে সেটা মুছো, আবার check করো
            if getattr(next_sib, 'name', None) == 'br':
                to_remove = next_sib
                next_sib = next_sib.next_sibling
                to_remove.decompose()
            else:
                break

    # ── plain URL → <a> (শুধু text node এ, already-linked নয়) ──
    url_pattern = re.compile(r'(https?://[^\s<>"\']+)')
    for text_node in body.find_all(string=True):
        if text_node.parent and text_node.parent.name == 'a':
            continue   # already inside <a>
        if url_pattern.search(text_node):
            new_html = url_pattern.sub(
                r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>',
                str(text_node)
            )
            text_node.replace_with(BeautifulSoup(new_html, 'html.parser'))

    # body tag নিজে বাদ দিয়ে inner content নাও
    inner = body.decode_contents()
    return inner.strip() + '\n'


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

db_url = os.environ.get('FIREBASE_DATABASE_URL', '').rstrip('/')
if not db_url:
    raise RuntimeError('FIREBASE_DATABASE_URL environment variable set করা নেই')

print('🔥 Firebase থেকে data fetch করছি...')
with urllib.request.urlopen(f'{db_url}/books.json') as r:
    books_raw = json.load(r)
with urllib.request.urlopen(f'{db_url}/authors.json') as r:
    authors_raw = json.load(r) or {}
with urllib.request.urlopen(f'{db_url}/categories.json') as r:
    categories_raw = json.load(r) or {}

data = {'books': books_raw or {}, 'authors': authors_raw, 'categories': categories_raw}
books = data.get('books', {})

for uid, book in books.items():
    slug         = book.get('slug', '')
    file_url     = book.get('file', '')
    title        = book.get('title', slug)
    desc         = book.get('desc', '')
    cover        = book.get('img', '')
    content_path = f'content/{slug}.html'
    read_path    = f'read/{slug}.html'

    if not file_url:
        print(f'  ⏭ {slug} — file url নেই, skip')
        continue

    if not file_url.split('?')[0].lower().endswith('.zip'):
        print(f'  ⏭ {slug} — ZIP নয়, skip')
        continue

    # CSS link tag — already converted হলেও দরকার
    css_file = os.path.join('assets', 'css', f'{slug}.css')
    css_link_tag = f'<link rel="stylesheet" href="/assets/css/{slug}.css">' if os.path.exists(css_file) else ''

    if os.path.exists(content_path):
        print(f'  ⏭ {slug} — already converted, skip')
    else:
        local_file = f'/tmp/{slug}.zip'
        print(f'  📥 {slug} download করছি...')
        try:
            download_file(file_url, local_file)

            print(f'  🔄 {slug} HTML তৈরি করছি...')
            html_content, css_link_tag = zip_to_html(local_file, slug)

            with open(content_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            print(f'  ✓ content/{slug}.html')
            os.remove(local_file)

        except Exception as e:
            print(f'  ❌ {slug} error: {e}')
            continue

    # read page generate
    try:
        with open(content_path, 'r', encoding='utf-8') as f:
            book_content_html = f.read()

        authors = data.get('authors', {})
        author_key = book.get('author', '')
        author_data = authors.get(str(author_key), {})
        author_name = author_data.get('title', '')
        author_slug = author_data.get('slug', '')

        categories = data.get('categories', {})
        category_key = book.get('category', '')
        category_data = categories.get(str(category_key), {})
        category_name = category_data.get('title', '')
        category_slug = category_data.get('slug', '')

        full_page = render(read_template, {
            'book_title': title,
            'book_slug': slug,
            'book_description': desc[:160] if desc else '',
            'book_content': book_content_html,
            'book_css': css_link_tag,
            'book_author': author_name,
            'book_author_slug': author_slug,
            'book_cover': cover,
            'book_category': category_name,
            'book_category_slug': category_slug,
        })

        with open(read_path, 'w', encoding='utf-8') as f:
            f.write(full_page)
        print(f'  ✓ read/{slug}.html')
    except Exception as e:
        print(f'  ❌ {slug} read page error: {e}')

print('✅ ZIP convert ও read page generation সম্পন্ন!')
