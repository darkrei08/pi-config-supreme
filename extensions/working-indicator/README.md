# working-indicator

Phase-aware working indicator that swaps the spinner based on what the agent is doing, with live elapsed time and output-token count.

## Phases

| Phase | Spinner | Speed | When |
|-------|---------|-------|------|
| **thinking** | `unicode-animations` `waverows` | 90ms | Extended thinking active |
| **tool** | `unicode-animations` `pulse` | 180ms | Tool executing (bash, read, edit, etc.) |
| **streaming** | `unicode-animations` `rain` | 100ms | Text tokens streaming |
| **working** | `unicode-animations` `helix` | 80ms | Default/fallback |

Priority: **thinking > tool > streaming > working**

All frames are colored with the theme's accent color at runtime.

## Working message

While Pi works, loader text shows `Working… (1m 2s · ↓ 1.2k tokens)`.

- Elapsed time starts when prompt is submitted.
- Token count is a live whitespace-boundary estimate during streaming, then reconciles with Pi's reported `usage.output` after each assistant message.
- Both reset for each prompt and Pi's default working message returns when agent finishes or `/working-indicator off` runs.

## Commands

- `/working-indicator` — show current phase and status
- `/working-indicator on` — enable phase-aware indicators
- `/working-indicator off` — disable, restore pi default spinner

## How it works

Uses the `setWorkingIndicator()` API to swap spinner frames from `unicode-animations` on phase transitions. Phase is tracked via extension events (`agent_start/end`, `message_update`, `tool_execution_start/end`). Frames are pre-colored with `ctx.ui.theme.fg("accent", ...)` on `session_start` since the Loader renders custom indicators verbatim (without applying `spinnerColorFn`).
