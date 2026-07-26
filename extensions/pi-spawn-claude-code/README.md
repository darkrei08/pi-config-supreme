# pi-spawn-claude-code

Pi tool extension that adds `claude`, a Claude Code CLI launcher for background `claude -p` runs or interactive tmux-pane runs.

## Tool parameters

- `prompt` — prompt passed to Claude Code CLI
- `mode` — `background` uses `claude -p`; `interactive` opens a tmux pane and runs `claude`
- `async` — return immediately and send completion report back later as a steer message
- `resumeSessionId?` — resume a previous Claude Code session and send `prompt` as follow-up instruction

## Config

Config file:

```text
~/.pi/agent/pi-spawn-claude-code.json
```

Example:

```json
{
  "model": "claude-sonnet-4-6",
  "effort": "medium",
  "allowDangerouslySkipPermissions": true,
  "additionalArgs": ["--some-flag", "value"],
  "allowedTools": ["Read", "Grep"],
  "blockTimeoutMs": 600000,
  "closePaneOnCompletion": true
}
```

Options:

- `model?` — adds `--model <model>`
- `effort?` — adds `--effort <level>`
- `allowDangerouslySkipPermissions?` — default `true`; adds `--allow-dangerously-skip-permissions`; set `false` to disable
- `additionalArgs?` — extra CLI args appended before prompt
- `allowedTools?` — adds `--allowed-tools <comma-separated-tools>` when set
- `blockTimeoutMs?` — sync-mode timeout; default `600000`
- `closePaneOnCompletion?` — interactive mode only; default closes tmux pane; set `false` to leave pane open

## Async behavior

With `async: true`, tool returns `Claude run started: <runId>` immediately. Claude keeps running in extension process. A widget above the editor shows running Claude jobs with elapsed time and prompt preview.

When done, extension sends a formatted `pi_spawn_claude_code_result` custom message back into Pi as a steer. The custom renderer shows a colored boxed preview by default and expanded output on demand.

## Prompt guidance

The tool prompt guidance tells Pi to use `claude` for direct Claude Code requests and hands-on code investigation: repo internals, complex debugging, experiments, prototypes, builds, tests, and resuming prior Claude Code sessions.

It also tells Pi not to use `claude` for simple file reads, small obvious edits, quick local commands, web research, URL fetching, or documentation lookup.

## Interactive mode

Interactive mode uses tmux plus Claude Code Stop hook glue:

- sets `PI_CLAUDE_SENTINEL=/tmp/pi-claude-<runId>-done`
- passes bundled `--plugin-dir`
- Stop hook writes final assistant message to sentinel
- transcript sidecar is copied into `.pi/agent/sessions/pi-spawn-claude-code/`
