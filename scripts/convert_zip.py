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

        print(f'  🖼 {len(images)} image → assets/images/{slug}/')

        # HTML files খোঁজো ও sort করো
        html_files = []
        for root, _, files in os.walk(tmp_dir):
            for fname in sorted(files):
                if fname.lower().endswith(('.html', '.htm', '.xhtml')):
                    html_files.append(os.path.join(root, fname))
        html_files.sort()

        if not html_files:
            raise ValueError('ZIP এ কোনো HTML file নেই')

        full_html = ''
        for fpath in html_files:
            with open(fpath, 'rb') as f:
                raw = f.read()
            full_html += process_html_fragment(raw, images)

        return full_html, css_link_tag
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── HTML cleaner ──────────────────────────────────────────────────────────────
def process_html_fragment(raw_html, images):
    soup = BeautifulSoup(raw_html, 'html.parser')
    body = soup.find('body') or soup

    # img src → assets URL
    for img in body.find_all('img'):
        src = img.get('src', '')
        src_name = src.split('/')[-1]
        if src_name in images:
            img['src'] = images[src_name]
        elif src in images:
            img['src'] = images[src]

    # div → p
    for div in body.find_all('div'):
        div.name = 'p'

    # link fix
    for a_tag in body.find_all('a', href=True):
        href = a_tag.get('href', '')
        if href.startswith('http://') or href.startswith('https://'):
            a_tag['target'] = '_blank'
            a_tag['rel'] = 'noopener'
        elif href.startswith('#'):
            pass
        else:
            a_tag.unwrap()

    # অপ্রয়োজনীয় tags unwrap
    for tag in body.find_all(True):
        if tag.name not in ['h1', 'h2', 'h3', 'p', 'br', 'img', 'a']:
            tag.unwrap()

    # plain URL → <a>
    url_pattern = re.compile(r'(https?://[^\s<>"\']+)')
    for p_tag in body.find_all(['p', 'h1', 'h2', 'h3']):
        for text_node in p_tag.find_all(string=True):
            if url_pattern.search(text_node):
                new_html = url_pattern.sub(
                    r'<a href="\1" target="_blank" rel="noopener">\1</a>',
                    str(text_node)
                )
                text_node.replace_with(BeautifulSoup(new_html, 'html.parser'))

    inner = str(body)
    inner = re.sub(r'^<(?:body)[^>]*>', '', inner, count=1).rstrip()
    if inner.endswith('</body>'):
        inner = inner[:-7]
    return inner


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

books = data.get('books', {})

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

        full_page = render(read_template, {
            'book_title': title,
            'book_slug': slug,
            'book_description': desc[:160] if desc else '',
            'book_content': book_content_html,
            'book_css': css_link_tag,
        })

        with open(read_path, 'w', encoding='utf-8') as f:
            f.write(full_page)
        print(f'  ✓ read/{slug}.html')
    except Exception as e:
        print(f'  ❌ {slug} read page error: {e}')

print('✅ ZIP convert ও read page generation সম্পন্ন!')
