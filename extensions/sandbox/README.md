# Sandbox Extension

OS-level sandboxing for Pi bash commands, plus path policy enforcement for read/write/edit tools with interactive permission prompts.

Uses [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo/packages/sandbox-runtime) to enforce filesystem and network restrictions at the OS level (sandbox-exec on macOS, bubblewrap on Linux).

## Features

- **OS-level bash sandboxing** — filesystem and network restrictions enforced via native OS mechanisms
- **Tool interception** — read/write/edit tools apply same denyRead/denyWrite/allowWrite rules
- **Interactive prompts** — when blocked, choose to allow for session, project, or globally
- **Config merging** — global + project configs merged, project takes precedence
- **Session allowances** — temporary grants stored in memory (agent cannot access)
- **Auto-allow session paths** — repo roots plus `$TMPDIR` / system temp dir auto-allowed for read/write at session start
- **Domain glob patterns** — support `*.github.com` style wildcards
- **Path glob patterns** — support `*.pem`, `.env.*` style patterns
- **Optional Atuin history** — if `atuin` is installed, bash commands are recorded with author `pi`

## Commands

| Command | Description |
|---------|-------------|
| `/sandbox` | Show current sandbox configuration |
| `/sandbox-enable` | Enable sandbox for this session |
| `/sandbox-disable` | Disable sandbox for this session |
| `/sandbox-add <read\|write> <path>` | Add path to allowlist |
| `/sandbox-remove` | Remove path from session allowlist |

## Configuration

Config files are merged in order (later wins):

1. Built-in defaults
2. `~/.pi/agent/sandbox.json` (global)
3. `<cwd>/.pi/sandbox.json` (project)

### Example `.pi/sandbox.json`

```json
{
  "enabled": true,
  "network": {
    "allowedDomains": ["github.com", "*.github.com"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["/Users", "/home"],
    "allowRead": [".", "~/.config", "~/.local", "Library"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
  }
}
```

### Default Configuration

**Network — allowed by default:**
- `npmjs.org`, `*.npmjs.org`, `registry.npmjs.org`, `registry.yarnpkg.com`
- `pypi.org`, `*.pypi.org`
- `github.com`, `*.github.com`, `api.github.com`, `raw.githubusercontent.com`

**Filesystem — defaults:**
- `denyRead`: `/Users`, `/home`
- `allowRead`: `.`, `~/.config`, `~/.local`, `Library`
- `allowWrite`: `.`, `/tmp`
- Session startup also auto-allows repo roots plus `$TMPDIR` / system temp dir for read/write
- `denyWrite`: `.env`, `.env.*`, `*.pem`, `*.key`

## Precedence Rules

| Type | Rule |
|------|------|
| **Read** | `allowRead` OVERRIDES `denyRead` — prompt grant adds to allowRead |
| **Write** | `denyWrite` OVERRIDES `allowWrite` — most specific deny wins |

## Interactive Prompts

When a block is triggered, you're prompted to:

1. **Abort** — keep blocked
2. **Allow for this session only** — stored in memory, agent cannot access
3. **Allow for this project** — written to `.pi/sandbox.json`
4. **Allow for all projects** — written to `~/.pi/agent/sandbox.json`

### What Gets Prompted vs Hard-Blocked

| Type | Behavior |
|------|----------|
| **Domains** | Prompted if not whitelisted nor explicitly denied |
| **Write paths** | Prompted if not whitelisted; hard-blocked if in `denyWrite` |
| **Read paths** | Always prompted if not in `allowRead` (denyRead sets default deny) |

## Platform Support

| Platform | Sandbox Technology |
|----------|-------------------|
| macOS | `sandbox-exec` |
| Linux | `bubblewrap` |
| Windows | Not supported |

## Credits

- [carderne/pi-sandbox](https://github.com/carderne/pi-sandbox) — original inspiration
- [badlogic/pi-mono sandbox example](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/sandbox/index.ts) — reference implementation by Mario Zechner
