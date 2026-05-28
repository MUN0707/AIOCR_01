"""Delete old files from the 'ocr-uploads' Supabase Storage bucket.

Deletes files older than RETENTION_DAYS (default: 90) days.
Designed to run monthly on Mac mini cron (same pattern as dump_ocr_result.py).

USAGE:
    python scripts/cleanup_storage.py --dry-run    # show what would be deleted
    python scripts/cleanup_storage.py              # actually delete
    python scripts/cleanup_storage.py --days 60   # custom retention
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not (SUPABASE_URL and SUPABASE_KEY):
    print("ERROR: SUPABASE env not set in .env.local", file=sys.stderr)
    sys.exit(1)

BUCKET = "ocr-uploads"
RETENTION_DAYS = 90
BATCH_SIZE = 25


def list_folders(sb) -> list[str]:
    """バケットルートのフォルダ（user_id）一覧を取得。"""
    items = sb.storage.from_(BUCKET).list("", {"limit": 1000})
    return [item["name"] for item in items if item.get("id") is None]


def list_old_files_in_folder(sb, folder: str, cutoff: datetime) -> list[str]:
    """指定フォルダ内の古いファイルのフルパスを返す。"""
    old_paths: list[str] = []
    offset = 0
    while True:
        items = sb.storage.from_(BUCKET).list(folder, {"limit": 100, "offset": offset})
        if not items:
            break
        for item in items:
            if item.get("id") is None:
                continue  # サブフォルダはスキップ
            raw_ts = item.get("created_at", "")
            if not raw_ts:
                continue
            created_at = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            if created_at < cutoff:
                old_paths.append(f"{folder}/{item['name']}")
        if len(items) < 100:
            break
        offset += len(items)
    return old_paths


def delete_files(sb, paths: list[str]) -> tuple[int, int]:
    deleted = 0
    failed = 0
    for i in range(0, len(paths), BATCH_SIZE):
        batch = paths[i : i + BATCH_SIZE]
        try:
            sb.storage.from_(BUCKET).remove(batch)
            deleted += len(batch)
        except Exception as e:
            print(f"  ERROR deleting {batch[:2]}...: {e}", file=sys.stderr)
            failed += len(batch)
        time.sleep(0.2)
    return deleted, failed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--days", type=int, default=RETENTION_DAYS, help=f"保存日数 (既定: {RETENTION_DAYS})")
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    print(f"[cleanup_storage] bucket={BUCKET} retention={args.days}d cutoff={cutoff.date()}")

    folders = list_folders(sb)
    print(f"[cleanup_storage] found {len(folders)} user folders")

    all_old_paths: list[str] = []
    for folder in folders:
        old = list_old_files_in_folder(sb, folder, cutoff)
        all_old_paths.extend(old)

    total_files = len(all_old_paths)
    print(f"[cleanup_storage] {total_files} files older than {args.days} days")

    if total_files == 0:
        print("[cleanup_storage] nothing to delete. DONE.")
        return

    for p in all_old_paths[:5]:
        print(f"  sample: {p}")

    if args.dry_run:
        print("[cleanup_storage] DRY RUN - no files deleted")
        return

    deleted, failed = delete_files(sb, all_old_paths)
    print(f"[cleanup_storage] deleted={deleted} failed={failed}")
    print("[cleanup_storage] DONE.")


if __name__ == "__main__":
    main()
