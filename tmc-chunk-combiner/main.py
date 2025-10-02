#!/usr/bin/env python3
import json
import logging
import sys
import argparse
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

try:
    import colorlog
except ImportError:
    print("Please install colorlog: pip install colorlog")
    sys.exit(1)

# Setup logging with colors
handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter(
    "%(log_color)s[%(levelname)s]%(reset)s %(message)s",
    log_colors={
        'DEBUG': 'cyan',
        'INFO': 'green',
        'WARNING': 'yellow',
        'ERROR': 'red',
        'CRITICAL': 'bold_red',
    }
))
logger = colorlog.getLogger()
logger.addHandler(handler)
logger.setLevel(logging.DEBUG)


def is_special_message(content: str) -> bool:
    """Check if message starts with '>' or is enclosed in quotes (multi-line allowed)."""
    text = content.strip()
    if not text:
        return False
    if text.startswith(">"):
        return True
    # Check if fully enclosed in single or double quotes
    if (text.startswith('"') and text.endswith('"')) or \
       (text.startswith("'") and text.endswith("'")):
        return True
    return False


def process_json_file(file_path: Path, special_only: bool) -> List[Dict[str, str]]:
    """Extract relevant fields from a JSON file's messages."""
    try:
        with file_path.open("r", encoding="utf-8") as f:
            data: Dict[str, Any] = json.load(f)
        messages: List[Dict[str, Any]] = data.get("messages", [])

        results = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            name = msg.get("author", {}).get("name", "")
            content = msg.get("content", "")

            if special_only:
                if not is_special_message(content):
                    continue

            results.append({"name": name, "content": content})

        return results
    except Exception as e:
        logger.error(f"Failed to process {file_path}: {e}")
        return []


def combine_jsons(input_dir: Path, output_dir: Path, special_only: bool) -> None:
    """Combine all .json files into one output file."""
    all_messages: List[Dict[str, str]] = []

    for file_path in input_dir.glob("*.json"):
        logger.info(f"Processing {file_path.name}")
        all_messages.extend(process_json_file(file_path, special_only))

    if not all_messages:
        logger.warning("No messages found. Nothing to write.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%d-%m-%Y")
    output_file = output_dir / f"output-{date_str}.json"

    try:
        with output_file.open("w", encoding="utf-8") as f:
            json.dump(all_messages, f, indent=2, ensure_ascii=False)
        logger.info(f"Combined JSON written to {output_file}")
    except Exception as e:
        logger.error(f"Failed to write output file: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Combine JSON message files.")
    parser.add_argument(
        "-s", "--special", 
        action="store_true",
        help="Keep only messages that start with '>' or are enclosed in quotes"
    )
    args = parser.parse_args()

    input_dir = Path("seschunk")
    output_dir = Path("output")

    if not input_dir.exists():
        logger.critical(f"Input directory {input_dir} does not exist.")
        sys.exit(1)

    combine_jsons(input_dir, output_dir, args.special)

