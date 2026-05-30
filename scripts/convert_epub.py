import os
import json
import urllib.request
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

os.makedirs('content', exist_ok=True)

def epub_to_html(epub_path):
    book = epub.read_epub(epub_path)
    full_html = ''
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            body = soup.find('body')
            if body:
                for tag in body.find_all(True):
                    if tag.name not in ['h1', 'h2', 'h3', 'p', 'br']:
                        tag.unwrap()
                full_html += str(body)[6:-7]
    return full_html

# Firebase data পড়ো (generate.js আগেই চলেছে)
with open('firebase_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

books = data.get('books', {})
authors = data.get('authors', {})
categories = data.get('categories', {})

for uid, book in books.items():
    slug = book.get('slug', '')
    file_url = book.get('file', '')
    output_path = f'content/{slug}.html'

    if not file_url:
        print(f'  ⏭ {slug} — file url নেই, skip')
        continue

    if os.path.exists(output_path):
        print(f'  ⏭ {slug} — already converted, skip')
        continue

    print(f'  📥 {slug} download করছি...')
    local_epub = f'/tmp/{slug}.epub'

    try:
        req = urllib.request.Request(file_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with open(local_epub, 'wb') as f:
                f.write(response.read())
        print(f'  🔄 {slug} convert করছি...')
        html_content = epub_to_html(local_epub)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f'  ✓ content/{slug}.html')
        os.remove(local_epub)
    except Exception as e:
        print(f'  ❌ {slug} error: {e}')

print('✅ epub convert সম্পন্ন!')
