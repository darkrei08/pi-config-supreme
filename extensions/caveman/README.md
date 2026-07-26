# caveman

Pi extension that appends a response-style prompt and adds `/caveman` to switch modes.

## Modes

- `off`
- `lite`
- `full`
- `ultra` (default)

Mode persists in session state and is shown in footer status.

## What it does

- loads base caveman system prompt from `caveman-system-prompt.md`
- appends filtered skill text to system prompt before agent start
- restores last selected mode on session start
- supports `/caveman [off|lite|full|ultra]`

## Config

Default mode resolution:

1. `CAVEMAN_DEFAULT_MODE`
2. `~/.config/caveman/config.json` with `{ "defaultMode": "..." }`
3. fallback: `ultra`

## Related

- system prompt source: `caveman-system-prompt.md`
- sync script: `sync-skill.sh`

## Credits

Prompt and skill content come directly from main caveman project:
https://github.com/JuliusBrussee/caveman

This Pi extension adds mode persistence, `/caveman`, footer status, and system-prompt plumbing.
