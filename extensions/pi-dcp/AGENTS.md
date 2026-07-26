# Pi-DCP: Dynamic Context Pruning Extension

Pi port of [opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning). Two-layer context management: automatic rule-based pruning + LLM-callable tools.

## Architecture

```
context event
    ↓
[Layer 1] Automatic Rules: prepare → process → repair → filter
    ↓
[Layer 2] LLM-Driven: sync cache → apply prune/distill/compress → post-repair
    ↓
[Layer 3] Injection: <prunable-tools> list + nudge prompts
    ↓
return modified messages
```

## Key Files

| File | Purpose |
|------|---------|
| `src/events/context.ts` | Main event handler — orchestrates all layers |
| `src/workflow.ts` | Prepare > Process > Filter workflow engine |
| `src/tool-cache.ts` | Tracks tool calls for LLM-driven pruning |
| `src/rules/*.ts` | Automatic pruning rules |
| `src/tools/*.ts` | LLM-callable tools (prune, distill, compress) |
| `src/prompts.ts` | System prompt + nudge templates |
| `src/protected-tools.ts` | Tool name matching (supports globs) |
| `src/protected-patterns.ts` | File path matching (supports globs) |
| `src/context-limits.ts` | Model-aware threshold resolution |

## Critical Constraints

### Thinking Blocks

`hasThinkingBlocks()` in `src/events/context.ts` guards against modifying assistant messages containing `thinking` or `redacted_thinking` blocks. **Anthropic API rejects modifications to these.**

### Tool Pairing

Every `tool_use` must have matching `tool_result`. The `tool-pairing` rule + repair phases ensure this. Breaking pairs → API errors.

### Turn Protection

`isTurnProtected()` in `src/metadata.ts` shields recent turns from auto-pruning. All automatic rules (dedup, superseded-writes, error-purging) must check this before marking `shouldPrune = true`.

### Protected Tools

`isToolProtected()` in `src/protected-tools.ts` supports exact names and globs. Built-in defaults include DCP's own tools, todo, subagent*, context_*.

### Protected Files

`isFilePathProtected()` in `src/protected-patterns.ts` shields file-related tool outputs. Supports `**`, `*`, `?` glob syntax.

## Rule Execution Order

1. `deduplication` — Hash/signature comparison
2. `superseded-writes` — File path tracking
3. `error-purging` — Error resolution detection
4. `tool-pairing` — Pair integrity (runs AFTER cascade prune)
5. `recency` — Position-based protection (runs LAST)

**Cascade prune** runs before tool-pairing: if all results are pruned, prune the assistant too.

**Repair** runs after all rules: fixes orphaned pairs from rule interactions.

## State Persistence

- `ENTRY_TYPE_PRUNE`, `ENTRY_TYPE_DISTILL`, `ENTRY_TYPE_COMPRESS` in `index.ts`
- Restored on `session_start` event
- Reset on `session_compact` event

## Testing

```bash
bun test                    # All tests
bun test src/__tests__/     # Unit tests (fast)
bun test tests/             # Integration tests
```

Key test files:
- `src/__tests__/tool-pairing.test.ts` — Pair integrity
- `src/__tests__/turn-protection.test.ts` — Turn-based shielding
- `tests/llm-tools.test.ts` — Prune/distill/compress execution
- `tests/context-limits.test.ts` — Threshold resolution
