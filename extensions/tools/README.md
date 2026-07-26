# tools

Pi extension that adds `/tools` for interactively enabling and disabling tools.

Tools are displayed in a grouped tree view organized by source:

```
builtin
→ [✓] bash
  [✓] edit
  [ ] find
user
  npm:@scope/package
    [✓] web_search
    [✓] web_extract
  ~/.pi/agent/extensions/my-ext
    [✓] my_tool

12 tools · 10 active · 4 from extensions

↑/↓ navigate · space/enter toggle · esc close
```

## Features

- **Grouped by source**: tools organized under builtin, sdk, project, user scopes
- **Extension sub-groups**: extension tools nested under their package name or path
- **Checkbox toggles**: `[✓]` enabled (green), `[ ]` disabled (dim entire line)
- **Keyboard navigation**: ↑/↓/j/k to move, space/enter to toggle, esc/q to close
- **Stats line**: total tools, active count, extension count

## Storage

Global state lives in:

`~/.pi/agent/tools-disabled.json`

Only disabled tools are stored. Anything not listed stays enabled.
Toggles persist across sessions and projects.

## Behavior

- Groups tools using `sourceInfo` from `pi.getAllTools()`
- Applies active tools with `pi.setActiveTools(...)`
- Reloads state on session start, tree navigation, and fork

## Credits

Adapted from Pi example extension:
https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/tools.ts

Source grouping inspired by:
https://github.com/shaftoe/pi-loaded-tools
