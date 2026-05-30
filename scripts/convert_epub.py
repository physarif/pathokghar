import os
import json
import urllib.request
import base64
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

os.makedirs('content', exist_ok=True)

def epub_to_html(epub_path):
    book = epub.read_epub(epub_path)
    
    # Image গুলো base64 করো
    images = {}
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_IMAGE:
            img_data = base64.b64encode(item.get_content()).decode('utf-8')
            media_type = item.media_type or 'image/jpeg'
            images[item.get_name()] = f"data:{media_type};base64,{img_data}"
            # শুধু file name দিয়েও match করো
            images[item.get_name().split('/')[-1]] = f"data:{media_type};base64,{img_data}"

    full_html = ''
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            body = soup.find('body')
            if body:
                # img src গুলো base64 দিয়ে replace করো
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
