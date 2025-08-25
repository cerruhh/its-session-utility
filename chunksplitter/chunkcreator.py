import os
import json
import time
from math import ceil
from typing import Any

def split_json_messages(file_path: str, chunk_size: int = 3000) -> None:
    start_time = time.perf_counter()

    with open(file_path, 'r', encoding='utf-8') as f:
        data: dict[str, Any] = json.load(f)

    messages = data.get("messages")
    if messages is None or not isinstance(messages, list):
        print("The JSON does not contain a valid 'messages' list.")
        return

    total_messages = len(messages)
    chunks_count = ceil(total_messages / chunk_size)

    base_dir = os.path.dirname(file_path)
    base_name = os.path.splitext(os.path.basename(file_path))[0]
    chunk_dir = os.path.join(base_dir, f"{base_name}_chunks")
    os.makedirs(chunk_dir, exist_ok=True)

    chunk_base = {k: v for k, v in data.items() if k != "messages"}

    for i in range(chunks_count):
        start = i * chunk_size
        end = min(start + chunk_size, total_messages)
        chunk_messages = messages[start:end]

        chunk_data = dict(chunk_base)
        chunk_data["messages"] = chunk_messages
        chunk_data["messageCount"] = len(chunk_messages)

        chunk_file_path = os.path.join(chunk_dir, f"{base_name}_part{i+1}.json")

        with open(chunk_file_path, 'w', encoding='utf-8') as chunk_file:
            json.dump(chunk_data, chunk_file, ensure_ascii=False, indent=2)

    end_time = time.perf_counter()
    print(f"Saved {chunks_count} chunk files to '{chunk_dir}'.")
    print(f"Chunk creation took {end_time - start_time:.4f} seconds.")

# Example usage:
if __name__ == "__main__":
    chunk_size = input("Chunk size: ")
    export_path = input("Export path: ")
    split_json_messages(file_path=export_path, chunk_size=int(chunk_size))

