import os
import json
import urllib.request
import base64
import re
import zipfile
import tempfile
import shutil
import subprocess
from pathlib import Path
from bs4 import BeautifulSoup

try:
    from ebooklib import epub as ebooklib_epub
    EBOOKLIB_AVAILABLE = True
except ImportError:
    EBOOKLIB_AVAILABLE = False

os.makedirs('content', exist_ok=True)
os.makedirs('read', exist_ok=True)

GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_REPO  = os.environ.get('GITHUB_REPOSITORY', '')  # "owner/repo"
RELEASE_TAG  = 'books-epub'


# ─── GitHub Release helper ─────────────────────────────────────────────────────
def ensure_release():
    """books-epub release না থাকলে তৈরি করো"""
    result = subprocess.run(
        ['gh', 'release', 'view', RELEASE_TAG],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f'  📦 Release "{RELEASE_TAG}" তৈরি করছি...')
        subprocess.run([
            'gh', 'release', 'create', RELEASE_TAG,
            '--title', 'Pathok Ghar — epub Files',
            '--notes', 'Auto-generated epub files from ZIP source',
            '--latest=false'
        ], check=True)
        print(f'  ✓ Release তৈরি হয়েছে')


def upload_epub_to_release(epub_path, slug):
    """epub file টি GitHub Release এ upload করো, আগে থাকলে replace করো"""
    fname = f'{slug}.epub'

    # আগে থাকলে delete করো
    subprocess.run(
        ['gh', 'release', 'delete-asset', RELEASE_TAG, fname, '--yes'],
        capture_output=True
    )

    # Upload
    result = subprocess.run(
        ['gh', 'release', 'upload', RELEASE_TAG, epub_path, '--clobber'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f'Upload failed: {result.stderr}')

    url = f'https://github.com/{GITHUB_REPO}/releases/download/{RELEASE_TAG}/{fname}'
    print(f'  ✓ epub uploaded → {url}')
    return url


# ─── ZIP → epub converter ──────────────────────────────────────────────────────
def zip_to_epub(zip_path, slug, title, author='অজানা', desc=''):
    """ZIP এর HTML files থেকে epub তৈরি করো"""
    if not EBOOKLIB_AVAILABLE:
        raise ImportError('ebooklib install করা নেই')

    tmp_dir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmp_dir)

        # Image map তৈরি করো
        images = {}
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                ext = fname.lower().rsplit('.', 1)[-1]
                if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp'):
                    fpath = os.path.join(root, fname)
                    with open(fpath, 'rb') as f:
                        raw = f.read()
                    mime = {
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                        'png': 'image/png', 'gif': 'image/gif',
                        'webp': 'image/webp'
                    }.get(ext, 'image/jpeg')
                    images[fname] = (raw, mime)
                    rel = os.path.relpath(fpath, tmp_dir).replace('\\', '/')
                    images[rel] = (raw, mime)

        # HTML files sort করো
        html_files = []
        for root, _, files in os.walk(tmp_dir):
            for fname in sorted(files):
                if fname.lower().endswith(('.html', '.htm', '.xhtml')):
                    html_files.append(os.path.join(root, fname))
        html_files.sort()

        if not html_files:
            raise ValueError('ZIP এ কোনো HTML file নেই')

        # epub তৈরি
        book = ebooklib_epub.EpubBook()
        book.set_identifier(slug)
        book.set_title(title)
        book.set_language('bn')
        book.add_author(author)
        if desc:
            book.add_metadata('DC', 'description', desc)

        # Image গুলো epub এ add করো
        epub_images = {}
        for img_name, (raw, mime) in images.items():
            safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(img_name))
            if safe_name in epub_images:
                continue
            img_item = ebooklib_epub.EpubImage()
            img_item.file_name = f'images/{safe_name}'
            img_item.media_type = mime
            img_item.content = raw
            book.add_item(img_item)
            epub_images[img_name] = f'images/{safe_name}'
            epub_images[os.path.basename(img_name)] = f'images/{safe_name}'

        # Chapter গুলো add করো
        chapters = []
        spine = ['nav']
        for i, fpath in enumerate(html_files):
            with open(fpath, 'rb') as f:
                raw = f.read()

            soup = BeautifulSoup(raw, 'html.parser')
            body = soup.find('body') or soup

            # img src → epub path
            for img in body.find_all('img'):
                src = img.get('src', '')
                src_name = src.split('/')[-1]
                if src_name in epub_images:
                    img['src'] = f'../images/{os.path.basename(epub_images[src_name])}'

            chapter_num = i + 1
            fname_base = Path(fpath).stem
            chapter_title = fname_base.replace('_', ' ').replace('-', ' ')

            chapter = ebooklib_epub.EpubHtml(
                title=chapter_title,
                file_name=f'chap_{chapter_num:03d}.xhtml',
                lang='bn'
            )
            chapter.content = f'<html><body>{body}</body></html>'.encode('utf-8')
            book.add_item(chapter)
            chapters.append(chapter)
            spine.append(chapter)

        # TOC ও spine
        book.toc = chapters
        book.spine = spine
        book.add_item(ebooklib_epub.EpubNcx())
        book.add_item(ebooklib_epub.EpubNav())

        # Save
        epub_out = f'/tmp/{slug}.epub'
        ebooklib_epub.write_epub(epub_out, book)
        print(f'  ✓ epub তৈরি: {epub_out}')
        return epub_out

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── HTML content extractor (read page এর জন্য) ───────────────────────────────
def zip_to_html(zip_path):
    """ZIP → merged HTML string (read page এর জন্য)"""
    tmp_dir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmp_dir)

        images = {}
        for root, _, files in os.walk(tmp_dir):
            for fname in files:
                ext = fname.lower().rsplit('.', 1)[-1]
                if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'):
                    fpath = os.path.join(root, fname)
                    with open(fpath, 'rb') as f:
                        raw = f.read()
                    mime = {
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                        'png': 'image/png', 'gif': 'image/gif',
                        'webp': 'image/webp', 'svg': 'image/svg+xml'
                    }.get(ext, 'image/jpeg')
                    b64 = base64.b64encode(raw).decode('utf-8')
                    uri = f"data:{mime};base64,{b64}"
                    images[fname] = uri
                    rel = os.path.relpath(fpath, tmp_dir).replace('\\', '/')
                    images[rel] = uri

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

        return full_html
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── shared HTML cleaner ───────────────────────────────────────────────────────
def process_html_fragment(raw_html, images):
    soup = BeautifulSoup(raw_html, 'html.parser')
    body = soup.find('body') or soup

    for img in body.find_all('img'):
        src = img.get('src', '')
        src_name = src.split('/')[-1]
        if src_name in images:
            img['src'] = images[src_name]
        elif src in images:
            img['src'] = images[src]

    for div in body.find_all('div'):
        div.name = 'p'

    for a_tag in body.find_all('a', href=True):
        href = a_tag.get('href', '')
        if href.startswith('http://') or href.startswith('https://'):
            a_tag['target'] = '_blank'
            a_tag['rel'] = 'noopener'
        elif href.startswith('#'):
            pass
        else:
            a_tag.unwrap()

    for tag in body.find_all(True):
        if tag.name not in ['h1', 'h2', 'h3', 'p', 'br', 'img', 'a']:
            tag.unwrap()

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

# GitHub Release নিশ্চিত করো (GITHUB_TOKEN থাকলে)
if GITHUB_TOKEN and GITHUB_REPO:
    ensure_release()

for uid, book in books.items():
    slug     = book.get('slug', '')
    file_url = book.get('file', '')
    title    = book.get('title', slug)
    author   = book.get('author', 'অজানা')
    desc     = book.get('desc', '')
    content_path = f'content/{slug}.html'
    read_path    = f'read/{slug}.html'

    if not file_url:
        print(f'  ⏭ {slug} — file url নেই, skip')
        continue

    # ZIP file কিনা চেক করো
    is_zip = file_url.split('?')[0].lower().endswith('.zip')

    if os.path.exists(content_path):
        print(f'  ⏭ {slug} — already converted, skip')
    else:
        ext = 'zip' if is_zip else 'epub'
        local_file = f'/tmp/{slug}.{ext}'

        print(f'  📥 {slug} ({ext}) download করছি...')
        try:
            download_file(file_url, local_file)

            if is_zip:
                # ১. read page এর জন্য HTML content
                print(f'  🔄 {slug} HTML content তৈরি করছি...')
                html_content = zip_to_html(local_file)
                with open(content_path, 'w', encoding='utf-8') as f:
                    f.write(html_content)
                print(f'  ✓ content/{slug}.html')

                # ২. epub তৈরি করো ও Release এ upload করো
                if GITHUB_TOKEN and GITHUB_REPO:
                    print(f'  📖 {slug} epub তৈরি করছি...')
                    epub_path = zip_to_epub(local_file, slug, title, author, desc)
                    epub_url = upload_epub_to_release(epub_path, slug)
                    os.remove(epub_path)
                    # Firebase এ epub URL save করার জন্য log করো
                    print(f'  🔗 epub URL: {epub_url}')
                else:
                    print(f'  ⚠ GITHUB_TOKEN নেই — epub upload skip')
            else:
                # পুরনো epub flow
                from ebooklib import epub as ebooklib_epub2
                import ebooklib

                def epub_to_html_legacy(epub_path):
                    book = ebooklib_epub2.read_epub(epub_path)
                    imgs = {}
                    for item in book.get_items():
                        if item.get_type() == ebooklib.ITEM_IMAGE:
                            img_data = base64.b64encode(item.get_content()).decode('utf-8')
                            mime = item.media_type or 'image/jpeg'
                            imgs[item.get_name()] = f"data:{mime};base64,{img_data}"
                            imgs[item.get_name().split('/')[-1]] = f"data:{mime};base64,{img_data}"
                    full = ''
                    for item in book.get_items():
                        if item.get_type() == ebooklib.ITEM_DOCUMENT:
                            full += process_html_fragment(item.get_content(), imgs)
                    return full

                print(f'  🔄 {slug} epub convert করছি...')
                html_content = epub_to_html_legacy(local_file)
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
        })

        with open(read_path, 'w', encoding='utf-8') as f:
            f.write(full_page)
        print(f'  ✓ read/{slug}.html')
    except Exception as e:
        print(f'  ❌ {slug} read page error: {e}')

print('✅ convert ও read page generation সম্পন্ন!')
