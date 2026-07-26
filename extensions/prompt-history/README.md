# prompt-history

Pi extension that recalls prompts from all saved sessions with keyboard shortcuts.

## Usage

- `Ctrl+K` — recall older prompt
- `Ctrl+J` — recall newer prompt
- `Ctrl+R` — open fuzzy prompt-history search

Type a prefix before pressing `Ctrl+K` to filter history to matching prompts. Pressing `Ctrl+J` past the newest match restores the original typed text.

Press `Ctrl+R` to open a searchable prompt-history picker. Type to fuzzy-filter prompt text, use `↑`/`↓` to move, press `Enter` to load the selected prompt, or `Esc` to cancel. Fuzzy search matches query characters in order and sorts better matches first.

## Behavior

- scans `~/.pi/agent/sessions/**/*.jsonl`
- reads session files as streams to avoid loading full session history into memory
- returns only the last 50 unique user prompts
- merges current-session prompts into cached history so new prompts appear immediately
- prewarms the session scan cache on startup to reduce first `Ctrl+R` delay
- caches session scans for 30 seconds
- resets history navigation after submitting input

## Notes

This intentionally does not use `SessionManager.listAll()` because session summaries include `allMessagesText`, which can load large session stores into memory.
