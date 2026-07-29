#!/usr/bin/env python3
"""
Process Bookmarks Queue - Claims items from Google Sheet queue and archives them.

This script:
1. Claims a pending item from the Google Sheet queue
2. Calls archive_tweet.py to fetch and archive the tweet
3. Marks the item as complete (or releases it for retry on failure)

Requires:
    - SHEETS_WEBHOOK_URL environment variable (Google Apps Script web app URL)

Optional:
    - TWITTER_BEARER_TOKEN for richer media metadata from archive_tweet.py
"""
import json
import os
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVER = ROOT / "scripts" / "archive_tweet.py"

WEBHOOK_URL = os.environ.get("SHEETS_WEBHOOK_URL")
SHARED_SECRET = os.environ.get("QUEUE_SHARED_SECRET", "")

MAX_PER_RUN = 1  # Process one item per run to stay within API limits

def post_json(url: str, payload: dict) -> dict:
    """POST JSON to webhook and return response."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
        return json.loads(text)
    except urllib.error.HTTPError as e:
        print(f"[error] HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        return {"error": str(e)}
    except json.JSONDecodeError:
        return {"_raw": text}
    except Exception as e:
        print(f"[error] Request failed: {e}", file=sys.stderr)
        return {"error": str(e)}

def claim_one() -> dict | None:
    payload = {"action": "claim"}
    if SHARED_SECRET:
        payload["secret"] = SHARED_SECRET
    res = post_json(WEBHOOK_URL, payload)
    return res.get("item")

def complete_item(item_id: int | str, meta: dict) -> None:
    payload = {"action": "complete", "id": item_id, "meta": meta}
    if SHARED_SECRET:
        payload["secret"] = SHARED_SECRET
    _ = post_json(WEBHOOK_URL, payload)

def release_item(item_id: int | str) -> None:
    payload = {"action": "release", "id": item_id}
    if SHARED_SECRET:
        payload["secret"] = SHARED_SECRET
    _ = post_json(WEBHOOK_URL, payload)

def fail_item(item_id: int | str, error_msg: str = "") -> None:
    """Mark item as failed - won't be retried."""
    payload = {"action": "fail", "id": item_id, "error": error_msg}
    if SHARED_SECRET:
        payload["secret"] = SHARED_SECRET
    _ = post_json(WEBHOOK_URL, payload)

def to_sheet_meta(arch_meta: dict) -> dict:
    return {
        "name":   arch_meta.get("name") or arch_meta.get("title") or "",
        "author": arch_meta.get("author") or "",
        "type":   ("thread" if "Thread" in (arch_meta.get("title") or "") else "tweet"),
        "link":   arch_meta.get("url") or "",
    }

def archive_to_sheets(meta: dict) -> None:
    """Archive tweet to Google Sheets Learning tab via webhook."""
    # Parse the tweet date
    tweet_date = meta.get("date", "")[:10]  # YYYY-MM-DD

    # Build media paths as JSON
    images = meta.get("images", [])
    videos = meta.get("videos", [])
    media_json = json.dumps({"images": images, "videos": videos}) if (images or videos) else ""

    # Clean tweet text (replace newlines with spaces)
    tweet_text = (meta.get("text") or "").replace("\n", " ").replace("\r", "")

    payload = {
        "action": "archive",
        "name": meta.get("name") or "",
        "type": "thread" if "Thread" in (meta.get("title") or "") else "tweet",
        "link": meta.get("url") or "",
        "author": meta.get("author") or "",
        "date_added": tweet_date,
        "notes": tweet_text,
        "media": media_json,
    }

    if SHARED_SECRET:
        payload["secret"] = SHARED_SECRET

    res = post_json(WEBHOOK_URL, payload)

    if res.get("status") == "archived":
        print(f"[info] Archived to Google Sheets: {payload['name'][:50]}...", file=sys.stderr)
    elif res.get("status") == "duplicate":
        print(f"[info] Tweet already in Sheets, skipping: {payload['link']}", file=sys.stderr)
    else:
        print(f"[warn] Failed to archive to Sheets: {res}", file=sys.stderr)

# Patterns that indicate temporary/retryable errors (rate limits, network issues)
RETRYABLE_PATTERNS = [
    "429",
    "rate limit",
    "too many requests",
    "timeout",
    "connection",
    "temporarily",
    "try again",
]

def is_retryable_error(stderr: str) -> bool:
    """Check if the error message indicates a temporary/retryable failure."""
    stderr_lower = stderr.lower()
    return any(pattern in stderr_lower for pattern in RETRYABLE_PATTERNS)

def archive_url(url: str) -> tuple[dict | None, bool]:
    """
    Archive a tweet URL.

    Returns:
        (meta, is_retryable): meta dict if successful, None if failed.
                             is_retryable is True if failure was temporary (rate limit, etc.)
    """
    proc = subprocess.run(
        ["python", str(ARCHIVER), url],
        capture_output=True,
        text=True,
        check=False,
    )

    # Always print archiver logs so we can see what happened
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)

    if proc.returncode != 0:
        print(f"[error] archiver failed ({proc.returncode})", file=sys.stderr)
        retryable = is_retryable_error(proc.stderr)
        return None, retryable

    try:
        last_line = proc.stdout.strip().splitlines()[-1]
        obj = json.loads(last_line)
        return obj.get("archived"), False
    except Exception as e:
        print(f"[error] could not parse archiver output: {e}\nSTDOUT:\n{proc.stdout}", file=sys.stderr)
        return None, False

def main():
    if not WEBHOOK_URL:
        print("[info] No SHEETS_WEBHOOK_URL set; exiting.", file=sys.stderr)
        sys.exit(0)

    # The archiver can fall back to public X oEmbed when no API token is
    # available. Keep a diagnostic so workflow logs show which path is active.
    if not os.environ.get("TWITTER_BEARER_TOKEN"):
        print(
            "[warn] TWITTER_BEARER_TOKEN not set; using public oEmbed fallback.",
            file=sys.stderr,
        )

    print(f"[info] Using webhook: {WEBHOOK_URL[:50]}...", file=sys.stderr)
    processed_count = 0

    for _ in range(MAX_PER_RUN):
        item = claim_one()
        if not item:
            print("[info] No queued items.", file=sys.stderr)
            break

        item_id = item.get("id")
        url = (item.get("url") or "").strip()
        if not url:
            print(f"[warn] Claimed item {item_id} missing URL; releasing.", file=sys.stderr)
            release_item(item_id)
            continue

        print(f"[info] Archiving: {url} (queue id {item_id})", file=sys.stderr)

        meta, is_retryable = archive_url(url)
        if not meta:
            if is_retryable:
                print(f"[warn] Archiving failed for {url} due to rate limit or temporary error. Releasing for retry.", file=sys.stderr)
                release_item(item_id)
            else:
                print(f"[warn] Archiving failed for {url}. Marking as failed (won't retry).", file=sys.stderr)
                fail_item(item_id, "Archive failed - tweet may be deleted or protected")
            continue

        try:
            # Archive to Google Sheets Resources tab
            archive_to_sheets(meta)

            sheet_meta = to_sheet_meta(meta)
            complete_item(item_id, sheet_meta)
            processed_count += 1
            print(f"[info] Completed: {url}", file=sys.stderr)
        except Exception as e:
            print(f"[warn] Could not complete queue item {item_id}: {e}", file=sys.stderr)
            release_item(item_id)

    print(f"[info] Run finished. Processed {processed_count} item(s).", file=sys.stderr)

if __name__ == "__main__":
    main()
