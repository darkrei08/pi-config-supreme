# pi-co-authored-by

A [Pi](https://github.com/badlogic/pi) extension that automatically appends git trailers to commit messages when the agent runs `git commit`, `jj commit`, or `jj describe`. Adds the model name and pi version so you always know which AI helped write the code.

## Features

**Co-Authored-By trailer** — Credits the model that helped write the code:
```
Co-Authored-By: Claude Sonnet 4 <noreply@pi.dev>
```

**Generated-By trailer** — Records which version of Pi was used:
```
Generated-By: pi 0.52.12
```

**Example commit:**
```
fix: resolve null pointer

Co-Authored-By: Claude Sonnet 4 <noreply@pi.dev>
Generated-By: pi 0.52.12
```

## Supported commands

| Command | Example |
|---------|---------|
| `git commit -m` | `git commit -m "fix: typo"` |
| `jj commit -m` | `jj commit -m "fix: typo"` |
| `jj describe -m` | `jj describe -m "fix: typo"` |

The built-in aliases `jj ci` and `jj desc` are also recognized.

Both `-m` and `--message` flags are detected.

## Requirements

- [Pi](https://github.com/badlogic/pi) coding agent

## Install

```bash
pi install npm:pi-co-authored-by
```

Or try it without installing:

```bash
pi -e npm:pi-co-authored-by
```

You can also install from git:

```bash
pi install git:github.com/bruno-garcia/pi-co-authored-by
```

## How it works

The extension hooks into Pi's `tool_call` event. When it detects a `git commit -m`, `jj commit -m`, or `jj describe -m` command, it appends extra `-m` flags to create [git trailers](https://git-scm.com/docs/git-interpret-trailers) with the current model name and pi version.

| What | Value |
|------|-------|
| `Co-Authored-By` | Model name (e.g., `Claude Sonnet 4`) |
| `Generated-By` | Pi version (e.g., `pi 0.52.12`) |

## Development

```bash
npm install
npm test
```

## License

MIT
