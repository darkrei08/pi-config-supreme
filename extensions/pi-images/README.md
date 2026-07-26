# pi-images

A unified Pi extension that combines the clipboard attachment behavior of [`@jordyvd/pi-image-attachments`](https://github.com/jordyvandomselaar/pi-image-attachments) with the kitty graphics preview thumbnails of [`pi-image-preview`](https://github.com/rielj/pi-image-preview).

## Features

- **`Ctrl+V` clipboard images** attach as draft images with `[Image #N]` placeholders in the editor
- **Drag/paste local image paths** — automatically detected and converted to attachments
- **Kitty graphics thumbnails** — attached images render as inline previews above the editor using the kitty graphics protocol
- **Horizontal layout** — multiple images display side by side
- **tmux support** — uses kitty's Unicode placeholder protocol (`U=1`) for pane-aware rendering (no ghosting)
- **Text fallback** — non-kitty terminals show text labels instead of thumbnails
- **Submit handling** — placeholders are stripped from text; only image content is sent to the model
- **Image-only messages** — drafts containing only image placeholders send the images directly
- **Screenshot promotion** — screenshot tool results that save to `filePath` are promoted to inline image content

## Why unified?

The two original extensions cannot be used together — they conflict on editor ownership (`setEditorComponent` vs `getEditorText` polling), duplicate screenshot tool-result upgrades, and have incompatible submit transform logic. This extension resolves all conflicts by using the custom editor approach for paste interception and driving the kitty gallery widget from the editor's attachment state.

## Install

```bash
# If this extension is in your pi-config extensions directory, it loads automatically.
# Otherwise, install from a local path:
pi install ./path/to/pi-images
```

## Prerequisites

### For image previews (optional)

- **Terminal**: [Kitty](https://sw.kovidgoyal.net/kitty/) 0.28+ (or Ghostty / WezTerm with kitty graphics support)
- **tmux** (optional): 3.3a+ with `set -g allow-passthrough all` in `~/.tmux.conf`

Image previews are a progressive enhancement — the extension works in any terminal, but only renders thumbnails in kitty-compatible terminals.

## Credits

Built from the excellent work in:
- [`@jordyvd/pi-image-attachments`](https://github.com/jordyvandomselaar/pi-image-attachments) by Jordy Van Domselaar
- [`pi-image-preview`](https://github.com/rielj/pi-image-preview) by rielj

## License

MIT
