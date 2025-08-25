import os
import json
import argparse
import sqlite3
import requests
import hashlib
import mimetypes
from pathlib import Path
from zipfile import ZipFile
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_NAME = 'packed_images.db'


def init_db(db_path):
    conn = sqlite3.connect(db_path, check_same_thread=False)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            file_name TEXT,
            file_size INTEGER,
            mime_type TEXT,
            sha256 TEXT,
            data BLOB
        )
    ''')
    conn.commit()
    return conn


def get_mime_type(file_name):
    mime_type, _ = mimetypes.guess_type(file_name)
    return mime_type or "application/octet-stream"


def compute_sha256(content):
    return hashlib.sha256(content).hexdigest()


def download_and_store_attachment(attachment, conn, skip_hash=False, skip_size_check=False, print_progress=False):
    url = attachment.get('url')
    file_id = attachment.get('id')
    file_name = attachment.get('fileName')
    file_size = attachment.get('fileSizeBytes')

    if not url or not file_id:
        raise ValueError("Missing 'url' or 'id' in attachment")

    cursor = conn.cursor()
    cursor.execute("SELECT id FROM attachments WHERE id = ?", (file_id,))
    exists = cursor.fetchone()

    if exists:
        if print_progress:
            print(f"Already exists in DB: {file_id}")
        return f"db://attachments/{file_id}"

    try:
        # Stream download with tqdm progress bar
        with requests.get(url, timeout=10, stream=True) as response:
            if response.status_code != 200:
                raise Exception(f"Download failed with status {response.status_code}")

            content = b""
            total = int(response.headers.get("content-length", 0))
            if file_size and not skip_size_check:
                total = file_size

            if print_progress:
                progress = tqdm(total=total, unit="B", unit_scale=True, desc=file_name[:30])
            else:
                progress = None

            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    content += chunk
                    if progress:
                        progress.update(len(chunk))

            if progress:
                progress.close()

    except Exception as e:
        raise RuntimeError(f"Failed to download {url}: {e}")

    if not skip_size_check and file_size and len(content) != file_size:
        raise ValueError(f"Size mismatch for {file_id}: expected {file_size}, got {len(content)}")

    sha256_hash = compute_sha256(content) if not skip_hash else None
    mime_type = get_mime_type(file_name)

    cursor.execute('''
        INSERT INTO attachments (id, file_name, file_size, mime_type, sha256, data)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (file_id, file_name, file_size, mime_type, sha256_hash, content))
    conn.commit()

    if print_progress:
        print(f"Stored: {file_id}, Size: {len(content)} bytes, MIME: {mime_type}")

    return f"db://attachments/{file_id}"


def process_attachments_parallel(attachments, conn, skip_hash=False, skip_size_check=False, print_progress=False):
    results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_attachment = {
            executor.submit(download_and_store_attachment, attachment, conn,
                            skip_hash, skip_size_check, print_progress): attachment
            for attachment in attachments
        }
        for future in as_completed(future_to_attachment):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                raise RuntimeError(f"Failed to process attachment: {e}")
    return results

def process_json_file(json_path, conn, skip_hash=False, skip_size_check=False, print_progress=False):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if "messages" not in data:
        return

    for message in data["messages"]:
        if 'attachments' in message and message['attachments']:
            try:
                new_attachments = process_attachments_parallel(
                    message['attachments'],
                    conn,
                    skip_hash=skip_hash,
                    skip_size_check=skip_size_check,
                    print_progress=print_progress
                )
                message['attachments'] = new_attachments
            except Exception as e:
                raise RuntimeError(f"Failed to process message attachments in {json_path}: {e}")

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def zip_output(folder_path, output_path):
    with ZipFile(output_path, 'w') as zipf:
        for file_path in Path(folder_path).rglob('*'):
            if file_path.is_file():
                zipf.write(file_path, file_path.relative_to(folder_path))


def get_size_mb(path):
    return os.path.getsize(path) / (1024 * 1024)

def main():
    parser = argparse.ArgumentParser(description="Download and pack attachments from JSON files.")
    parser.add_argument('--export-path', '-e', required=True, help="Folder containing JSON files")
    parser.add_argument('--output-path', '-o', required=True, help="Output ZIP file path")
    parser.add_argument('--print-progress', '-V', action='store_true', help="Print progress")
    parser.add_argument('--skip-hash', action='store_true', help="Skip hash checking")
    parser.add_argument('--skip-errors', '-E', action='store_true', help="Continue on errors instead of aborting")
    parser.add_argument('--skip-size-check', action='store_true',
                    help="Skip verifying that the downloaded file matches the expected size")

    args = parser.parse_args()

    export_path = Path(args.export_path)
    if not export_path.exists():
        print("Export path does not exist.")
        return

    # ✅ db_path must be defined before init_db()
    db_path = export_path / DB_NAME
    conn = init_db(db_path)

    json_files = list(export_path.glob("*.json"))

    if args.print_progress:
        json_files = tqdm(json_files, desc="Processing JSON files")

    for json_file in json_files:
        try:
            process_json_file(json_file, conn,
                  skip_hash=args.skip_hash,
                  skip_size_check=args.skip_size_check,
                  print_progress=args.print_progress)

        except Exception as e:
            print(f"Error processing {json_file}: {e}")
            if not args.skip_errors:
                conn.close()
                exit(1)
            else:
                continue

    conn.close()

    if args.print_progress:
        print("Zipping result...")

    zip_output(export_path, args.output_path)

    # --- Size reporting ---
    total_json_size = sum(os.path.getsize(f) for f in export_path.glob("*.json")) / (1024 * 1024)
    db_size = os.path.getsize(db_path) / (1024 * 1024)
    zip_size = os.path.getsize(args.output_path) / (1024 * 1024)

    print(f"\n=== Size Report ===")
    print(f"Total JSON size: {total_json_size:.2f} MB")
    print(f"Database size:   {db_size:.2f} MB")
    print(f"ZIP file size:   {zip_size:.2f} MB")

    if args.print_progress:
        print(f"Export complete: {args.output_path}")


if __name__ == '__main__':
    main()

