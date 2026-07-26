# Pi-DCP: Dynamic Context Pruning Extension

Intelligent context management for pi. Automatically prunes obsolete messages and gives the LLM tools to manage its own context — reducing token costs while preserving conversation coherence.

## Features

- **Two-Layer Pruning**: Automatic rules + LLM-callable tools
- **Deduplication**: Removes duplicate tool outputs (keeps latest)
- **Superseded Writes**: Removes older file writes when newer versions exist
- **Error Purging**: Removes resolved errors from context
- **Turn Protection**: Shields recent agent turns from auto-pruning
- **Recency Protection**: Always preserves the last N messages
- **Tool Pairing**: Guarantees tool_use/tool_result pairs stay intact (API compliance)
- **Protected Tools**: Shield workflow-critical tools from pruning (supports globs)
- **Protected Files**: Shield file-related outputs matching glob patterns
- **Dumb Zone Integration**: Responds to pi-dumb-zone signals for urgent context management
- **Compression Management**: Decompress/recompress summaries on demand

## Architecture

### Two-Layer System

**Layer 1: Automatic Rule-Based Pruning**

Rules run on every LLM call via the `context` event. Workflow: prepare → process → repair → filter.

| Rule | Behavior |
|------|----------|
| `deduplication` | Tool results: compare by signature, keep latest. Text: compare by hash, keep first. |
| `superseded-writes` | Prune older write/edit operations to the same file |
| `error-purging` | Remove tool errors that were later resolved by success |
| `tool-pairing` | Ensure every tool_use has its tool_result (and vice versa) |
| `recency` | Protect last N messages from all pruning |

**Layer 2: LLM-Driven Pruning**

The LLM can call these tools to manage context proactively:

| Tool | Purpose |
|------|---------|
| `dcp_prune` | Remove tool outputs entirely (no preservation) |
| `dcp_distill` | Replace verbose outputs with concise summaries |
| `dcp_compress` | Squash a range of tool calls into a single summary |

**Layer 3: Context Injection**

- `<prunable-tools>` list injected into context showing what can be managed
- Periodic nudges remind the LLM to manage context
- Iteration nudges after many turns without user input
- Urgent nudges when context exceeds thresholds or dumb-zone signals

## Configuration

Pure JSON config. Two locations:

- **Project**: `.pi/pi-dcp.json` (highest priority)
- **Global**: `~/.pi/agent/pi-dcp.json`

Project config overrides global. Both override defaults.

```json
{
  "enabled": true,
  "debug": false,
  "rules": [
    "deduplication",
    "superseded-writes",
    "error-purging",
    "tool-pairing",
    "recency"
  ],
  "keepRecentCount": 10,
  "turnProtection": { "enabled": true, "turns": 3 },
  "contextLimits": {
    "min": 80000,
    "max": 120000,
    "modelMin": { "claude-3-haiku": 40000 },
    "modelMax": { "claude-3-haiku": "60%" }
  },
  "nudgeFrequency": 15,
  "iterationNudgeThreshold": 15,
  "nudgeForce": "soft",
  "summaryBuffer": true,
  "protectedTools": {
    "global": ["my_custom_tool"],
    "compress": ["important_tool"]
  },
  "protectedFilePatterns": [
    "**/PLAN.md",
    "**/migrations/**",
    ".env*"
  ]
}
```

### Configuration Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master toggle |
| `debug` | `boolean` | `false` | Verbose logging |
| `rules` | `(string \| PruneRule)[]` | see above | Rules to run, in order |
| `keepRecentCount` | `number` | `10` | Always keep last N messages |
| `turnProtection.enabled` | `boolean` | `true` | Enable turn-based protection |
| `turnProtection.turns` | `number` | `3` | Number of recent turns to protect |
| `contextLimits.min` | `number \| string` | `80_000` | Soft threshold (tokens or "N%") |
| `contextLimits.max` | `number \| string` | `120_000` | Hard threshold (tokens or "N%") |
| `nudgeFrequency` | `number` | `15` | Periodic nudge every N events |
| `iterationNudgeThreshold` | `number` | `15` | Iteration nudge after N non-user turns |
| `nudgeForce` | `'soft' \| 'strong'` | `'soft'` | Nudge injection target |
| `summaryBuffer` | `boolean` | `true` | Extend limits by active summary tokens |
| `protectedTools` | `object` | see below | Tool protection config |
| `protectedFilePatterns` | `string[]` | `[]` | File path glob patterns to protect |

### Built-in Protected Tools

These tools are protected by default:

```typescript
// Global (all pruning)
"dcp_prune", "dcp_distill", "dcp_compress",  // Self-protection
"todo",                                        // Task tracking
"subagent", "subagent_resume", "subagent_interrupt",  // Orchestration
"context_tag", "context_checkout", "context_log",     // Context management
"plannotator_submit_plan"                      // Planning

// Compression only (also prunable/distillable but not compressible)
"write", "edit"  // File operations (filesystem is source of truth)
```

## Commands

| Command | Description |
|---------|-------------|
| `/dcp-toggle` | Enable/disable DCP |
| `/dcp-debug` | Toggle debug logging |
| `/dcp-stats` | Show pruning statistics for current session |
| `/dcp-recent <N>` | Set how many recent messages to always keep |
| `/dcp-init` | Generate `.pi/pi-dcp.json` (use `--global` for global config) |
| `/dcp-tools [on\|off]` | Toggle tool output expansion in UI |
| `/dcp-compressions` | List all compression summaries with status |
| `/dcp-decompress <id>` | Restore a compression (show original tool outputs) |
| `/dcp-recompress <id>` | Re-apply a previously decompressed compression |
| `/dcp-logs` | View DCP debug logs |

### CLI Flags

```bash
pi --dcp-enabled=false  # Start with DCP disabled
pi --dcp-debug=true     # Enable debug logging at startup
```

## LLM Tools

### `dcp_prune`

Remove tool outputs entirely. Use for old file reads, resolved errors, redundant listings.

```typescript
// LLM calls with numeric IDs from <prunable-tools> list
dcp_prune({ ids: ["3", "7", "12"] })
```

**Behavior**:
- Write/edit results are removed entirely (filesystem is source of truth)
- Other tool results are replaced with a stub message
- Tool pairing is maintained (removes both toolCall and toolResult)

### `dcp_distill`

Replace verbose outputs with concise summaries. Preserves key information.

```typescript
dcp_distill({
  targets: [
    { id: "5", distillation: "Found 3 TypeScript errors in auth module" },
    { id: "8", distillation: "Package.json has React 18.2.0, no peer conflicts" }
  ]
})
```

**Best for**: Outputs you might reference later but don't need in full.

### `dcp_compress`

Squash a contiguous range of tool calls into a single summary.

```typescript
dcp_compress({
  topic: "Initial codebase exploration",
  startId: "0",
  endId: "15",
  summary: "Explored auth module: found JWT middleware in src/auth/, user model in src/models/user.ts, 3 API routes in src/routes/auth.ts. No obvious security issues."
})
```

**Best for**: Natural phase boundaries — exploration complete, feature done, bug fixed.

## Protection Mechanisms

### Turn Protection

Prevents auto-rules from pruning messages in recent agent turns. A "turn" increments on each user message.

**Why**: A single turn with 20 tool calls shouldn't be pruned just because `keepRecentCount` is 10.

**Scope**: Deduplication, error-purging, superseded-writes all check `isTurnProtected()`.

### Recency Protection

Always preserves the last N messages regardless of other rules. Position-based, not semantic.

**Relationship**: Turn protection and recency are complementary:
- Recency = last N *messages*
- Turn protection = last N *turns* (can contain many messages)

### Tool Protection

Tools matching protected patterns are never pruned, distilled, or compressed.

- Supports exact names: `"todo"`
- Supports globs: `"subagent*"`, `"context_*"`

### File Path Protection

Tool outputs touching files matching protected patterns are shielded.

- Supports glob syntax: `**`, `*`, `?`
- Example: `"**/migrations/**"` protects all migration-related reads/writes

## Dumb Zone Integration

If [pi-dumb-zone](../pi-dumb-zone/) is loaded, DCP responds to its signals:

- At 40%+ context utilization → **critical nudge** prompting immediate action
- Nudge shows current utilization percentage
- More urgent than periodic or threshold nudges

Signal read via `globalThis.__piDumbZoneSignal`.

## Compression Management

Compressions can be managed after creation:

1. **List compressions**: `/dcp-compressions`
   ```
   Compressions:
     ● #1  [active]  "Initial exploration"  (15 tools, ~2400 tokens)
     ○ #2  [decompressed]  "Auth investigation"  (8 tools, ~1200 tokens)
   ```

2. **Decompress**: `/dcp-decompress 1`
   - Restores original tool outputs to context
   - Summary remains available for recompression

3. **Recompress**: `/dcp-recompress 2`
   - Re-applies a previously decompressed summary
   - Only works for user-decompressed compressions

## State Persistence

DCP state is persisted across session restarts:

- Pruned IDs, distillations, compressions stored via `pi.appendEntry()`
- Restored on `session_start` event
- Reset on `session_compact` event

## API Compliance

### Thinking Blocks

The Anthropic API forbids modifying assistant messages containing `thinking` or `redacted_thinking` blocks. DCP:
- Detects these via `hasThinkingBlocks()`
- Skips modification of affected messages
- Finds alternative injection points for nudges

### Tool Pairing

Every `tool_use` must have a matching `tool_result`. DCP ensures this via:

1. **tool-pairing rule**: Forward/backward pass maintains pairs
2. **Cascade pruning**: If all results are pruned, prune the assistant too
3. **Post-repair**: Final safety net fixes orphans from rule interactions
4. **Layer 2 repair**: Catches orphans from LLM-driven pruning

## Development

### Project Structure

```
pi-dcp/
├── index.ts                 # Extension entry point
├── src/
│   ├── config.ts           # Configuration loading (JSON)
│   ├── types.ts            # Type definitions
│   ├── workflow.ts         # Prepare > Process > Filter engine
│   ├── metadata.ts         # Message metadata + turn protection
│   ├── registry.ts         # Rule registration system
│   ├── tool-cache.ts       # Tracks tool calls for LLM tools
│   ├── tokens.ts           # Token estimation (char/4 heuristic)
│   ├── prompts.ts          # System prompt, nudges, prunable-tools
│   ├── protected-tools.ts  # Tool name matching (globs)
│   ├── protected-patterns.ts # File path matching (globs)
│   ├── context-limits.ts   # Model-aware threshold resolution
│   ├── dumb-zone-bridge.ts # Integration with pi-dumb-zone
│   ├── logger.ts           # Logging utilities
│   ├── events/
│   │   ├── context.ts      # Main context event handler
│   │   └── sessionStart.ts # Session start event handler
│   ├── tools/
│   │   ├── prune.ts        # dcp_prune tool
│   │   ├── distill.ts      # dcp_distill tool
│   │   └── compress.ts     # dcp_compress tool
│   ├── rules/
│   │   ├── deduplication.ts
│   │   ├── superseded-writes.ts
│   │   ├── error-purging.ts
│   │   ├── tool-pairing.ts
│   │   └── recency.ts
│   ├── cmds/
│   │   ├── toggle.ts, debug.ts, stats.ts, recent.ts
│   │   ├── init.ts, logs.ts, tools-expanded.ts
│   │   └── compressions.ts, decompress.ts, recompress.ts
│   └── __tests__/
└── tests/
```

### Type Checking

```bash
bun run typecheck
```

### Running Tests

```bash
bun test
```

## Custom Rules

Implement the `PruneRule` interface:

```typescript
import type { PruneRule } from "./src/types";

const myRule: PruneRule = {
  name: "my-custom-rule",
  description: "My custom pruning logic",

  prepare(msg, ctx) {
    // Annotate metadata during prepare phase
    msg.metadata.myScore = calculateScore(msg.message);
  },

  process(msg, ctx) {
    // Check protections
    if (msg.metadata.shouldPrune) return;
    if (isTurnProtected(msg, currentTurn, ctx.config.turnProtection)) return;

    // Make pruning decision
    if (msg.metadata.myScore < threshold) {
      msg.metadata.shouldPrune = true;
      msg.metadata.pruneReason = "low score";
    }
  },
};
```

Add to config: `rules: ['deduplication', myRule, 'recency']`

## Example Output

Normal operation:
```
[pi-dcp] Initialized with 5 rules: deduplication, superseded-writes, error-purging, tool-pairing, recency
[pi-dcp] Pruned 12 / 45 messages
```

Debug mode (`/dcp-debug`):
```
[pi-dcp] Dedup: marking earlier tool result at index 15 (sig: read::{"path":"src/index.ts"})
[pi-dcp] SupersededWrites: marking superseded write at index 23: src/index.ts
[pi-dcp] ErrorPurging: found resolved error at index 31
[pi-dcp] Recency: protecting message at index 48 (turnIndex: 5, protected turns: 3)
[pi-dcp] Filter phase complete: 12 pruned, 33 kept (45 total)
[pi-dcp] Nudge triggered: overMax=false, overMin=true, iteration=false, periodic=true, dumbZone=false
```

## Credits

Inspired by and built upon:

- [opencode-dynamic-context-pruning](https://github.com/AaronFriel/opencode-dynamic-context-pruning) — original DCP concept for opencode
- [Edmund Miller's pi-dcp](https://github.com/edmundmiller/dotfiles/tree/main/pi-packages/pi-dcp) — early pi port and experimentation

## License

MIT
