#!/usr/bin/env python3
"""
Tweet Archiver - Fetches a single tweet and saves it as Markdown.

The authenticated X API/twarc2 path is preferred because it exposes media
metadata. If that path is unavailable (for example, an API plan returns 403),
the archiver falls back to X's public oEmbed endpoint.

Usage:
    python scripts/archive_tweet.py <tweet_url>

Requires:
    - python-slugify installed (pip install python-slugify)
    - requests installed (pip install requests)

Optional:
    - TWITTER_BEARER_TOKEN and twarc2 for richer media metadata
"""
import datetime
import html.parser
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import requests
from slugify import slugify

# ====== OUTPUT DIRECTORIES ======
MD_DIR   = pathlib.Path("static/md/tweets")         # Markdown output
IMG_DIR  = pathlib.Path("static/img/tweets")        # images (jpg/png/gif)
VID_DIR  = pathlib.Path("static/vid/tweets")        # videos (mp4)
for d in (MD_DIR, IMG_DIR, VID_DIR):
    d.mkdir(parents=True, exist_ok=True)
# ================================

def get_bearer_token():
    """Get Twitter bearer token from environment."""
    return os.environ.get("TWITTER_BEARER_TOKEN", "").strip()


def redact_command(cmd):
    """Return a log-safe command with credential values removed."""
    redacted = list(cmd)
    for idx, part in enumerate(redacted[:-1]):
        if part == "--bearer-token":
            redacted[idx + 1] = "[REDACTED]"
    return redacted

def run_to_file(cmd, outpath: pathlib.Path):
    """Run a command that writes to stdout; save stdout to a file."""
    safe_cmd = redact_command(cmd)
    print(f"[debug] Running: {' '.join(safe_cmd)}", file=sys.stderr)
    with open(outpath, "w", encoding="utf-8") as f:
        r = subprocess.run(cmd, text=True, env=os.environ, stdout=f, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(safe_cmd)}\n{r.stderr}")

def run_optional(cmd):
    """Run a command that may fail (for optional operations like media download)."""
    print(f"[debug] Running (optional): {' '.join(cmd)}", file=sys.stderr)
    r = subprocess.run(cmd, text=True, env=os.environ, capture_output=True)
    if r.returncode != 0:
        print(f"[warn] Optional command failed: {' '.join(cmd)}\n{r.stderr}", file=sys.stderr)
        return False
    return True

def iso_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def tweet_id_from_url(url: str):
    """Extract tweet ID from a Twitter/X URL."""
    m = re.search(r"/status/(\d+)", url)
    return m.group(1) if m else ""


def created_at_from_tweet_id(tweet_id: str) -> str:
    """Recover an exact UTC creation time from an X/Twitter snowflake ID."""
    timestamp_ms = (int(tweet_id) >> 22) + 1288834974657
    created = datetime.datetime.fromtimestamp(
        timestamp_ms / 1000, tz=datetime.timezone.utc
    )
    return created.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class OEmbedTweetParser(html.parser.HTMLParser):
    """Extract the visible post text from X's oEmbed blockquote."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_paragraph = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "p" and not self.parts:
            self.in_paragraph = True
        elif tag == "br" and self.in_paragraph:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "p" and self.in_paragraph:
            self.in_paragraph = False

    def handle_data(self, data):
        if self.in_paragraph:
            self.parts.append(data)

    def text(self):
        return re.sub(r"[ \t]+", " ", "".join(self.parts)).strip()


def fetch_tweet_oembed(url: str) -> dict:
    """Fetch public post metadata without requiring an X developer API plan."""
    tweet_id = tweet_id_from_url(url)
    if not tweet_id:
        raise RuntimeError(f"Could not extract numeric tweet ID from URL: {url}")

    query = urllib.parse.urlencode({"url": url, "omit_script": "true"})
    endpoint = f"https://publish.twitter.com/oembed?{query}"
    print(f"[info] Falling back to X oEmbed for tweet {tweet_id}...", file=sys.stderr)
    try:
        response = requests.get(
            endpoint,
            headers={
                "Accept": "application/json",
                "User-Agent": "ai-landing-page-tweet-archiver/1.0",
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise RuntimeError(f"X oEmbed lookup failed: {exc}") from exc

    parser = OEmbedTweetParser()
    parser.feed(payload.get("html", ""))
    text = parser.text()
    username = (payload.get("author_name") or "").strip()
    if not text or not username:
        raise RuntimeError("X oEmbed response did not contain post text and author")

    return {
        "id": tweet_id,
        "text": text,
        "created_at": created_at_from_tweet_id(tweet_id),
        "author": {"username": username.lstrip("@")},
    }

def find_existing_media(tweet_id: str) -> list[str]:
    """Check if media already exists for this tweet ID."""
    existing = []
    for directory in (IMG_DIR, VID_DIR):
        for f in directory.glob(f"*{tweet_id}*"):
            if f.is_file():
                existing.append(f.name)
    return existing

def download_media_from_tweet(tweet_obj: dict, tweet_id: str, tmp_dir: pathlib.Path) -> list[pathlib.Path]:
    """Extract media URLs from tweet object and download them."""
    downloaded = []

    if not isinstance(tweet_obj, dict):
        return downloaded

    # Look for media in attachments
    attachments = tweet_obj.get("attachments", {})
    if not isinstance(attachments, dict):
        attachments = {}

    # Also check includes.media for the actual media objects
    includes = tweet_obj.get("includes", {})
    if not isinstance(includes, dict):
        includes = {}

    media_list = includes.get("media", [])

    # If no includes, check if media is directly on the tweet (flattened format)
    if not media_list:
        media_list = tweet_obj.get("media", [])

    # Also check for attachments.media (another possible location)
    if not media_list:
        media_list = attachments.get("media", [])

    # Ensure media_list is actually a list
    if not isinstance(media_list, list):
        media_list = []

    for media in media_list:
        if not isinstance(media, dict):
            continue
        media_type = media.get("type", "")
        url = None
        ext = ".jpg"

        if media_type == "photo":
            url = media.get("url")
            ext = ".jpg"
        elif media_type == "video" or media_type == "animated_gif":
            # Videos have variants, pick the highest bitrate mp4
            variants = media.get("variants", [])
            best_variant = None
            best_bitrate = -1
            for v in variants:
                if v.get("content_type") == "video/mp4":
                    bitrate = v.get("bit_rate", 0)
                    if bitrate > best_bitrate:
                        best_bitrate = bitrate
                        best_variant = v
            if best_variant:
                url = best_variant.get("url")
                ext = ".mp4"

        if url:
            try:
                # Generate filename with tweet_id for easy lookup
                media_key = media.get("media_key", "unknown")
                filename = f"{tweet_id}_{media_key}{ext}"
                filepath = tmp_dir / filename

                print(f"[info] Downloading media: {url[:80]}...", file=sys.stderr)

                # Use proper headers to avoid 403 errors from Twitter/X CDN
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://x.com/',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                })
                with urllib.request.urlopen(req) as response:
                    with open(filepath, 'wb') as out_file:
                        out_file.write(response.read())

                downloaded.append(filepath)
                print(f"[info] Downloaded: {filename}", file=sys.stderr)
            except Exception as e:
                print(f"[warn] Failed to download media: {e}", file=sys.stderr)

    return downloaded

def extract_author(obj):
    """Extract author username from tweet object."""
    for key in ("author", "user"):
        if key in obj and isinstance(obj[key], dict):
            u = obj[key].get("username") or obj[key].get("screen_name")
            if u:
                return f"@{u}"
    return f"@{obj.get('author_id', 'unknown')}"

def fetch_tweet(url: str, workdir: pathlib.Path):
    """
    Fetch a single tweet using twarc2.

    Note: On Twitter's free API tier, we can only fetch individual tweets,
    not full conversations/threads. This is a limitation of the free tier.
    """
    raw_jsonl  = workdir / "tweet.jsonl"
    flat_jsonl = workdir / "tweet_flat.jsonl"

    bearer_token = get_bearer_token()
    if not bearer_token:
        raise RuntimeError("TWITTER_BEARER_TOKEN is not set")

    tid = tweet_id_from_url(url) or url.strip()
    if not re.fullmatch(r"\d+", tid):
        raise RuntimeError(f"Could not extract numeric tweet ID from URL: {url}")

    # Check if media already exists for this tweet
    existing_media = find_existing_media(tid)
    if existing_media:
        print(f"[info] Found existing media for tweet {tid}: {existing_media}", file=sys.stderr)

    print(f"[info] Fetching tweet {tid}...", file=sys.stderr)

    # Fetch single tweet (works on free tier)
    run_to_file(["twarc2", "--bearer-token", bearer_token, "tweet", tid], raw_jsonl)

    # Flatten the JSON for easier processing
    run_to_file(["twarc2", "--bearer-token", bearer_token, "flatten", str(raw_jsonl)], flat_jsonl)

    # Skip media download if we already have media for this tweet
    if existing_media:
        print(f"[info] Skipping media download - already have {len(existing_media)} file(s)", file=sys.stderr)
        return raw_jsonl, flat_jsonl, existing_media

    # Try to download media from tweet data (non-fatal if it fails)
    tmp_media = workdir / "media"
    tmp_media.mkdir(exist_ok=True)

    # Read raw tweet data to extract media URLs
    try:
        with open(raw_jsonl, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    tweet_data = json.loads(line)
                    download_media_from_tweet(tweet_data, tid, tmp_media)
                    # Also check nested data structure
                    if "data" in tweet_data:
                        download_media_from_tweet(tweet_data["data"], tid, tmp_media)
    except Exception as e:
        print(f"[warn] Error extracting media URLs: {e}", file=sys.stderr)

    # Move downloaded media to permanent locations
    moved = []
    for f in tmp_media.rglob("*"):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
            dest_dir = IMG_DIR
        elif ext in (".mp4", ".mov", ".m4v"):
            dest_dir = VID_DIR
        else:
            dest_dir = IMG_DIR
        target = dest_dir / f.name
        i = 2
        while target.exists():
            target = dest_dir / (f.stem + f"-{i}" + f.suffix)
            i += 1
        shutil.move(str(f), str(target))
        moved.append(target.name)
        print(f"[info] Saved media: {target.name}", file=sys.stderr)

    return raw_jsonl, flat_jsonl, moved

def read_jsonl(path):
    objs = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                objs.append(json.loads(line))
    objs.sort(key=lambda o: o.get("created_at",""))
    return objs

def short_name_from_objs(objs):
    text = (objs[0].get("text","") or "").strip() if objs else ""
    text = re.sub(r"\s+", " ", text)
    return (text[:120] + "…") if len(text) > 120 else text

def build_markdown(objs, url: str, local_media_files):
    if not objs:
        md = MD_DIR / (slugify(iso_now()+"-tweet") + ".md")
        md.write_text(f"---\ntitle: \"Tweet\"\ndate: \"{iso_now()}\"\nurl: \"{url}\"\n---\n", encoding="utf-8")
        return md, {}

    first   = objs[0]
    author  = extract_author(first)
    created = first.get("created_at") or iso_now()
    is_thread = len(objs) > 1
    title   = f"{'Thread' if is_thread else 'Tweet'} by {author}"
    md_slug = slugify(f"{created[:10]}-{title}") or "tweet"
    md_path = MD_DIR / f"{md_slug}.md"

    lines = [
        "---",
        f'title: "{title}"',
        f'author: "{author}"',
        f'date: "{created}"',
        f'url: "{url}"',
        f'tweet_id: "{tweet_id_from_url(url)}"',
        f'media_count: {len(local_media_files)}',
        "---",
        ""
    ]
    for o in objs:
        ttime = o.get("created_at","")
        text  = (o.get("text","") or "").replace("\r","").strip()
        lines.append(f"**{ttime}**  \n{text}\n")

    if local_media_files:
        lines.append("<details><summary>Local media</summary>\n")
        for name in local_media_files:
            if name.lower().endswith(".mp4"):
                lines.append(f"- [video](/static/vid/tweets/{name})")
            else:
                lines.append(f"- ![](/static/img/tweets/{name})")
        lines.append("\n</details>\n")

    md_path.write_text("\n".join(lines), encoding="utf-8")

    # Get full tweet text (combine all tweets if thread)
    full_text = "\n\n".join((o.get("text","") or "").strip() for o in objs)

    # Categorize media files
    images = [f for f in local_media_files if not f.lower().endswith(('.mp4', '.mov', '.m4v'))]
    videos = [f for f in local_media_files if f.lower().endswith(('.mp4', '.mov', '.m4v'))]

    meta = {
        "url": url,
        "author": author,
        "title": title,
        "name": short_name_from_objs(objs),  # Sheet "Name"
        "date": created,
        "md_path": str(md_path),
        "media_count": len(local_media_files),
        "tweet_id": tweet_id_from_url(url),
        "text": full_text,
        "images": images,
        "videos": videos,
    }
    return md_path, meta

def read_raw_tweet(path):
    """Try to extract tweet data from raw twarc2 output (before flatten)."""
    objs = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            print(f"[debug] Raw tweet file contents ({len(content)} bytes): {content[:500]}...", file=sys.stderr)

        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    # Check for API errors
                    if "errors" in data:
                        for err in data["errors"]:
                            print(f"[error] Twitter API error: {err.get('detail', err)}", file=sys.stderr)
                    # twarc2 tweet output has {"data": {...tweet...}, "includes": {...}}
                    if "data" in data and isinstance(data["data"], dict):
                        tweet = data["data"]
                        # Merge in includes for author info
                        if "includes" in data:
                            tweet["includes"] = data["includes"]
                            # Try to get author from includes.users
                            users = data["includes"].get("users", [])
                            if users:
                                tweet["author"] = users[0]
                        objs.append(tweet)
                    elif "text" in data:
                        # Already flat format
                        objs.append(data)
    except Exception as e:
        print(f"[warn] Error reading raw tweet: {e}", file=sys.stderr)
    return objs

def archive(url: str):
    """Archive a tweet to Markdown with media."""
    print(f"[info] Archiving: {url}", file=sys.stderr)

    with tempfile.TemporaryDirectory() as td:
        workdir = pathlib.Path(td)
        objs = []
        local_media = find_existing_media(tweet_id_from_url(url))

        try:
            raw, flat, local_media = fetch_tweet(url, workdir)
            objs = read_jsonl(flat)

            # If flatten produced nothing, try reading raw output
            if not objs:
                print("[info] Flatten produced no output, trying raw data...", file=sys.stderr)
                objs = read_raw_tweet(raw)
        except Exception as api_error:
            print(
                f"[warn] Authenticated X API lookup unavailable: {api_error}",
                file=sys.stderr,
            )
            objs = [fetch_tweet_oembed(url)]

        if not objs:
            print(f"[error] No tweet data found for {url}", file=sys.stderr)
            raise RuntimeError(f"Could not fetch tweet data for {url}")

        md_path, meta = build_markdown(objs, url, local_media)
        print(f"[info] Created: {md_path}", file=sys.stderr)

        # Output JSON for caller (process_bookmarks.py expects this on last line)
        print(json.dumps({"archived": meta, "md": str(md_path)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/archive_tweet.py <tweet_url>", file=sys.stderr)
        print("TWITTER_BEARER_TOKEN is optional; public oEmbed is the fallback.", file=sys.stderr)
        sys.exit(1)

    try:
        archive(sys.argv[1])
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        sys.exit(1)
