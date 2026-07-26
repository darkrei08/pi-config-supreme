# qmd-sessions-indexer

Keeps the local `qmd` `sessions` collection fresh when Pi session state changes.

This extension listens for session lifecycle events and starts the renderer script in a detached, fire-and-forget process:

```bash
~/bin/rebuild-qmd-sessions-rendered.sh
```

The script is expected to render saved Pi/Claude/Codex session JSONL files into markdown under `~/.cache/qmd-sessions-rendered`, update the `sessions` qmd collection, and refresh embeddings.

## Events

The indexer runs after any of these Pi extension events:

- `session_before_switch`
- `session_before_fork`
- `session_before_compact`
- `session_before_tree`
- `session_tree`
- `session_shutdown`

## Behavior

- Fire-and-forget: Pi does not wait for indexing to finish.
- Detached process: stdio is ignored and the child is `unref()`'d.
- Coalescing: if another event fires while the indexer is running, one queued rerun starts after the current run exits.
- Missing script: if `~/bin/rebuild-qmd-sessions-rendered.sh` does not exist, the extension does nothing.

Each run receives the triggering event name in:

```bash
QMD_SESSIONS_TRIGGER=<eventName>
```

Logs are handled by the script, not by this extension.
