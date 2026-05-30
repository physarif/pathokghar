import os
import json
import urllib.request
import base64
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

os.makedirs('content', exist_ok=True)
os.makedirs('read', exist_ok=True)

def epub_to_html(epub_path):
    book = epub.read_epub(epub_path)
    
    # Image গুলো base64 করো
    images = {}
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_IMAGE:
            img_data = base64.b64encode(item.get_content()).decode('utf-8')
            media_type = item.media_type or 'image/jpeg'
            images[item.get_name()] = f"data:{media_type};base64,{img_data}"
            images[item.get_name().split('/')[-1]] = f"data:{media_type};base64,{img_data}"

    full_html = ''
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            body = soup.find('body')
            if body:
                for img in body.find_all('img'):
                    src = img.get('src', '')
                    src_name = src.split('/')[-1]
                    if src_name in images:
                        img['src'] = images[src_name]
                    elif src in images:
                        img['src'] = images[src]

                for tag in body.find_all(True):
                    if tag.name not in ['h1', 'h2', 'h3', 'p', 'br', 'img']:
                        tag.unwrap()
                full_html += str(body)[6:-7]
    return full_html


def render(template, data):
    import re
    return re.sub(r'\{\{(\w+)\}\}', lambda m: data.get(m.group(1), ''), template)


# Layout ও read template পড়ো
with open('components/layout.html', 'r', encoding='utf-8') as f:
    layout = f.read()

with open('components/read.html', 'r', encoding='utf-8') as f:
    read_template = f.read()

# Firebase data পড়ো (generate_pages.js আগেই চলেছে)
with open('firebase_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

books = data.get('books', {})

for uid, book in books.items():
    slug = book.get('slug', '')
    file_url = book.get('file', '')
    title = book.get('title', slug)
    desc = book.get('desc', '')
    content_path = f'content/{slug}.html'
    read_path = f'read/{slug}.html'

    if not file_url:
        print(f'  ⏭ {slug} — file url নেই, skip')
        continue

    if os.path.exists(content_path):
        print(f'  ⏭ {slug} — already converted, skip')
    else:
        print(f'  📥 {slug} download করছি...')
        local_epub = f'/tmp/{slug}.epub'

        try:
            req = urllib.request.Request(file_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                with open(local_epub, 'wb') as f:
                    f.write(response.read())
            print(f'  🔄 {slug} convert করছি...')
            html_content = epub_to_html(local_epub)
            with open(content_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            print(f'  ✓ content/{slug}.html')
            os.remove(local_epub)
        except Exception as e:
            print(f'  ❌ {slug} epub error: {e}')
            continue

    # content থেকে read page generate করো
    try:
        with open(content_path, 'r', encoding='utf-8') as f:
            book_content_html = f.read()

        read_content = render(read_template, {
            'book_title': title,
            'book_slug': slug,
            'book_content': book_content_html,
        })

        full_page = render(layout, {
            'page_title': f'{title} - পড়ুন',
            'page_description': desc[:160] if desc else '',
            'content': read_content,
        })

        with open(read_path, 'w', encoding='utf-8') as f:
            f.write(full_page)
        print(f'  ✓ read/{slug}.html')
    except Exception as e:
        print(f'  ❌ {slug} read page error: {e}')

print('✅ epub convert ও read page generation সম্পন্ন!')
