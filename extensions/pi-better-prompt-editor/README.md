# pi-better-prompt-editor

Custom Pi prompt editor and footer cleanup.

## Features

- Boxed prompt editor with border labels:
  - session cost
  - model
  - thinking level
  - context usage
  - cwd and git branch
- Bounded editor height for large pasted prompts.
- Cursor-aware prompt cropping, so moving through long prompts keeps cursor visible.
- One blank line above the editor box.
- Filtered status-only footer for extension statuses that are not duplicated in the editor border.

## Configuration

Set max editor body lines with:

```bash
PI_BETTER_PROMPT_EDITOR_MAX_BODY_LINES=10 pi
```

Default: `8`.

Set `SHOW_STATUS_IDS=1` to show footer status IDs for ordering/hiding work.
