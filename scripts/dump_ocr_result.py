"""Dump old ocr_uploads.ocr_result jsonb to local JSON files and NULL the column.

Strategy (decision 2026-05-25, condition relaxed):
- Target: ocr_uploads where ocr_result IS NOT NULL AND created_at < NOW() - 30 days
- Step 1: SELECT all matching rows, write each row's ocr_result to
          C:/Data/aiocr/<id>.json (skip if file exists, byte-identical).
- Step 2: After confirmed dumps, UPDATE the matching rows to set ocr_result=NULL
- Step 3: VACUUM is not done here (issue VACUUM FULL ocr_uploads manually if needed)

USAGE:
    python scripts/dump_ocr_result.py --dry-run    # show what would be dumped
    python scripts/dump_ocr_result.py              # dump + NULL
    python scripts/dump_ocr_result.py --null-only  # NULL only (assumes dump already done)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not (SUPABASE_URL and SUPABASE_KEY):
    print("ERROR: SUPABASE env not set in .env.local", file=sys.stderr)
    sys.exit(1)

OUT_DIR = Path(r"C:\Data\aiocr")
AGE_DAYS = 30
PAGE_SIZE = 50


def fetch_targets(sb) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=AGE_DAYS)).isoformat()
        res = (
            sb.table("ocr_uploads")
            .select("id, file_name, mode, ocr_result, created_at, client_id, user_id")
            .not_.is_("ocr_result", "null")
            .lt("created_at", cutoff)
            .order("created_at")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        chunk = res.data or []
        if not chunk:
            break
        rows.extend(chunk)
        offset += len(chunk)
        if len(chunk) < PAGE_SIZE:
            break
    return rows


def dump_rows(rows: list[dict]) -> tuple[int, int]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    skipped = 0
    for r in rows:
        path = OUT_DIR / f"{r['id']}.json"
        payload = {
            "id": r["id"],
            "file_name": r.get("file_name"),
            "mode": r.get("mode"),
            "created_at": r.get("created_at"),
            "client_id": r.get("client_id"),
            "user_id": r.get("user_id"),
            "ocr_result": r.get("ocr_result"),
        }
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            if existing.get("ocr_result") == r.get("ocr_result"):
                skipped += 1
                continue
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        written += 1
    return written, skipped


def null_rows(sb, ids: list[str]) -> int:
    nulled = 0
    for i in range(0, len(ids), 25):
        batch = ids[i : i + 25]
        res = sb.table("ocr_uploads").update({"ocr_result": None}).in_("id", batch).execute()
        nulled += len(res.data or [])
    return nulled


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="show targets only, no writes")
    ap.add_argument("--null-only", action="store_true", help="skip dump, only NULL (assume dumps exist)")
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    t0 = time.time()
    rows = fetch_targets(sb)
    print(f"[dump_ocr] target rows (created_at < now-{AGE_DAYS}d AND ocr_result IS NOT NULL): {len(rows)}")
    if rows:
        print(f"  oldest: {rows[0]['created_at']} | newest: {rows[-1]['created_at']}")

    if args.dry_run:
        for r in rows[:5]:
            print(f"  sample: id={r['id']} created_at={r['created_at']} mode={r['mode']}")
        return

    if not args.null_only:
        written, skipped = dump_rows(rows)
        print(f"[dump_ocr] dumped: written={written} skipped(already-exist)={skipped} dir={OUT_DIR}")

    ids = [r["id"] for r in rows]
    nulled = null_rows(sb, ids)
    print(f"[dump_ocr] NULLed in DB: {nulled} rows | elapsed={time.time()-t0:.1f}s")
    print("[dump_ocr] DONE. Run VACUUM FULL public.ocr_uploads in SQL Editor to reclaim space.")


if __name__ == "__main__":
    main()
