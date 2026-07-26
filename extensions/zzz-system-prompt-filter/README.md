# zzz-system-prompt-filter

Pi extension that filters unwanted text out of final assembled system prompt.

Named with `zzz-` so it loads late, after other extensions and skills have already appended prompt content.

## Commands

- `/spf`
- `/spf add`
- `/spf remove`
- `/spf toggle`
- `/spf list`
- `/spf show`
- `/spf test`

## Rule types

- `string` — exact literal removal
- `regex` — JS regex replacement
- `section` — remove a heading and its body

## Storage

Rules are stored in:

`~/.pi/agent/system-prompt-filter.json`
