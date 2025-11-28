#!/usr/bin/env python3
"""
Merge emoji JSON datastore files (English + Chinese) into a combined JSON for bilingual search

Default: reads `assets/en.json` and `assets/zh.json` and outputs `assets/emoji_merged.json`.

Merging rules:
- Match entries by `emoji` character
- Merge `tags` lists (deduplicated, preserve order: first English then Chinese)
- Combine `annotation` by concatenating English and Chinese annotations with a space; if only one exists, use it
- For `order`, `group`, `version`, prefer English value; if missing in English, use Chinese one
- Preserve `emoticon` if present in either (prefer English if both exist)

Usage:
    python3 scripts/merge_emoji_datastore.py [--en path] [--zh path] [--out path]

Examples:
    python3 scripts/merge_emoji_datastore.py
    python3 scripts/merge_emoji_datastore.py --en assets/en.json --zh assets/zh.json --out assets/emoji_merged.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any


def load_json_array(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"JSON data in {path} is not a list")
    return data


def dedupe_preserve_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def merge_entries(en_item: Dict[str, Any], zh_item: Dict[str, Any] | None) -> Dict[str, Any]:
    merged = {}
    # emoji key
    merged["emoji"] = en_item.get("emoji") if en_item.get("emoji") is not None else (zh_item or {}).get("emoji")

    # Tags: combine unique preserving order (English first then Chinese)
    en_tags = en_item.get("tags") or []
    zh_tags = zh_item.get("tags") if zh_item else []
    merged_tags = dedupe_preserve_order([*(en_tags or []), *(zh_tags or [])])
    if merged_tags:
        merged["tags"] = merged_tags

    # Annotation: combine English and Chinese
    en_annot = (en_item.get("annotation") or "").strip()
    zh_annot = (zh_item.get("annotation") or "").strip() if zh_item else ""
    if en_annot and zh_annot and en_annot != zh_annot:
        merged["annotation"] = f"{en_annot} {zh_annot}"
    elif en_annot:
        merged["annotation"] = en_annot
    elif zh_annot:
        merged["annotation"] = zh_annot

    # order, group, version, emoticon: prefer English; if not present, use Chinese
    for k in ["order", "group", "version", "emoticon"]:
        if k in en_item:
            merged[k] = en_item[k]
        elif zh_item and k in zh_item:
            merged[k] = zh_item[k]

    # Keep other fields from English if present, otherwise from Chinese
    # This preserves any additional keys but won't merge lists except `tags`.
    for k, v in (en_item.items() if en_item else []):
        if k not in merged:  # skip already processed
            merged[k] = v

    if zh_item:
        for k, v in zh_item.items():
            if k not in merged:
                merged[k] = v

    return merged


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Merge emoji en/zh datastore files into a bilingual JSON")
    parser.add_argument("--en", default="assets/en.json", help="Path to English emoji JSON (default assets/en.json)")
    parser.add_argument("--zh", default="assets/zh.json", help="Path to Chinese emoji JSON (default assets/zh.json)")
    parser.add_argument("--out", default="assets/emoji_merged.json", help="Output path for merged JSON (default assets/emoji_merged.json)")
    parser.add_argument("--minify", action="store_true", help="Write minified JSON instead of pretty-printed one")
    args = parser.parse_args(argv)

    en_path = Path(args.en)
    zh_path = Path(args.zh)
    out_path = Path(args.out)

    if not en_path.exists() or not zh_path.exists():
        print(f"ERROR: Input paths not found. en: {en_path}, zh: {zh_path}")
        return 2

    en_data = load_json_array(en_path)
    zh_data = load_json_array(zh_path)

    # Map emoji char -> entry
    zh_map = {item.get("emoji"): item for item in zh_data}
    en_map = {item.get("emoji"): item for item in en_data}

    merged_list: List[Dict[str, Any]] = []

    # Merge entries where English present first
    for emoji, en_item in en_map.items():
        zh_item = zh_map.get(emoji)
        merged_list.append(merge_entries(en_item, zh_item))

    # Add Chinese-only entries
    for emoji, zh_item in zh_map.items():
        if emoji not in en_map:
            merged_list.append(merge_entries({}, zh_item))

    # Optionally, sort merged_list by `order` if present
    def sort_key(item: Dict[str, Any]):
        return item.get("order", 9999999)

    merged_list.sort(key=sort_key)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        if args.minify:
            json.dump(merged_list, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(merged_list, f, ensure_ascii=False, indent=2)

    print(f"Merged {len(merged_list)} emojis to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
