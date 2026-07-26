#!/usr/bin/env bash
# sync-skill.sh — fetch upstream caveman files and rewrite bundled base skill.

set -euo pipefail

UPSTREAM_REPO="JuliusBrussee/caveman"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

fetch_raw() {
	local upstream_path="$1"
	local dest="$2"
	curl -fsSL "https://raw.githubusercontent.com/$UPSTREAM_REPO/main/$upstream_path" -o "$dest"
}

fetch_dir() {
	local upstream_dir="$1"
	local dest_dir="$2"
	python3 - <<'PY' "$UPSTREAM_REPO" "$upstream_dir" "$dest_dir"
from pathlib import Path
import json
import shutil
import sys
import urllib.request

repo = sys.argv[1]
upstream_dir = sys.argv[2]
dest_dir = Path(sys.argv[3])
api_url = f"https://api.github.com/repos/{repo}/contents/{upstream_dir}"
with urllib.request.urlopen(api_url) as response:
    entries = json.load(response)

if dest_dir.exists():
    shutil.rmtree(dest_dir)
dest_dir.mkdir(parents=True, exist_ok=True)

for entry in entries:
    if entry["type"] != "file":
        continue
    target = dest_dir / entry["name"]
    with urllib.request.urlopen(entry["download_url"]) as response:
        target.write_bytes(response.read())
PY
}

echo "Fetching upstream caveman files from $UPSTREAM_REPO..."

BASE_SKILL_UPSTREAM="$TMPDIR/caveman-SKILL.md"
fetch_raw "skills/caveman/SKILL.md" "$BASE_SKILL_UPSTREAM"

python3 - <<'PY' "$BASE_SKILL_UPSTREAM" "$REPO_ROOT/caveman-system-prompt.md"
from pathlib import Path
import re
import sys

src = Path(sys.argv[1]).read_text()
lines = src.splitlines()
out = []
for line in lines:
    if "Supports intensity levels:" in line:
        line = re.sub(r"Supports intensity levels:.*", "Supports intensity levels: lite, full (default), ultra.", line)
    elif re.fullmatch(r"\s*wenyan-lite, wenyan-full, wenyan-ultra\.\s*", line):
        continue
    if line.startswith("Default: **full**. Switch:"):
        line = "Default: **full**. Switch: `/caveman lite|full|ultra`."
    table = re.match(r"^\|\s*\*\*(\S+?)\*\*\s*\|", line)
    if table and table.group(1).startswith("wenyan"):
        continue
    example = re.match(r"^-\s+(\S+?):\s", line)
    if example and example.group(1).startswith("wenyan"):
        continue
    out.append(line)
Path(sys.argv[2]).write_text("\n".join(out) + "\n")
PY

UPSTREAM_BASE_SHA="$(curl -fsSL "https://api.github.com/repos/$UPSTREAM_REPO/commits?path=caveman/SKILL.md&per_page=1" |
	grep -o '"sha": "[^"]*"' | head -1 | cut -d'"' -f4)"

echo "Synced $REPO_ROOT/caveman-system-prompt.md"
echo "Base skill SHA: $UPSTREAM_BASE_SHA"
