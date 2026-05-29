import os
import json
import boto3
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

# R2 config (S3-compatible)
r2 = boto3.client(
    's3',
    endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ['R2_ACCESS_KEY'],
    aws_secret_access_key=os.environ['R2_SECRET_KEY'],
)
BUCKET = os.environ['R2_BUCKET']

# Content folder তৈরি
os.makedirs('content', exist_ok=True)

def epub_to_html(epub_path, slug):
    """ePub file কে clean HTML body-তে convert করে"""
    book = epub.read_epub(epub_path)
    full_html = ''

    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            body = soup.find('body')
            if body:
                # শুধু h1, h2, h3, p tags রাখো
                for tag in body.find_all(True):
                    if tag.name not in ['h1', 'h2', 'h3', 'p', 'br']:
                        tag.unwrap()
                full_html += str(body)[6:-7]  # <body> </body> বাদ

    return full_html

def process_new_epubs():
    """R2 থেকে নতুন epub files খুঁজে convert করে"""
    print("📖 R2 থেকে epub files check করছি...")

    # R2-তে থাকা সব epub list
    response = r2.list_objects_v2(Bucket=BUCKET, Prefix='epubs/')
    objects = response.get('Contents', [])

    for obj in objects:
        key = obj['Key']
        slug = key.replace('epubs/', '').replace('.epub', '')
        output_path = f'content/{slug}.html'

        # Already converted হলে skip
        if os.path.exists(output_path):
            print(f"  ⏭ {slug} already exists, skipping")
            continue

        print(f"  📥 {slug} download করছি...")
        local_epub = f'/tmp/{slug}.epub'
        r2.download_file(BUCKET, key, local_epub)

        print(f"  🔄 {slug} convert করছি...")
        html_content = epub_to_html(local_epub, slug)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)

        print(f"  ✓ content/{slug}.html")
        os.remove(local_epub)

    print(f"\n✅ epub convert সম্পন্ন!")

if __name__ == '__main__':
    process_new_epubs()
