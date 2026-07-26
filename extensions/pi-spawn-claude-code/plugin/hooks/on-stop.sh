#!/usr/bin/env bash
# Stop hook for pi-spawned Claude Code runs.
# Writes a sentinel file when Claude completes autonomously.

set -euo pipefail

input=$(cat)

stop_hook_active=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active', False))" 2>/dev/null || echo "False")
if [ "$stop_hook_active" = "True" ]; then
  exit 0
fi

if [ -z "${PI_CLAUDE_SENTINEL:-}" ]; then
  exit 0
fi

transcript_path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path', ''))" 2>/dev/null || echo "")
if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  exit 0
fi

user_msg_count=$(python3 - "$transcript_path" <<'EOF'
import sys, json

transcript_path = sys.argv[1]
count = 0
with open(transcript_path, 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            if entry.get('type') != 'user':
                continue
            content = entry.get('message', {}).get('content', '')
            if isinstance(content, str):
                count += 1
        except (json.JSONDecodeError, AttributeError):
            pass
print(count)
EOF
)

if [ -n "$transcript_path" ]; then
  echo "$transcript_path" > "${PI_CLAUDE_SENTINEL}.transcript" 2>/dev/null || true
fi

if [ "$user_msg_count" -eq 1 ]; then
  echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_assistant_message', ''))" > "$PI_CLAUDE_SENTINEL" 2>/dev/null || touch "$PI_CLAUDE_SENTINEL"
fi

exit 0
