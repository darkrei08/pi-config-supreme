# Reasoning

Stores an exact `provider/model` to reasoning-level mapping and reapplies it when
the selected model changes.

## Usage

```text
/reasoning
/reasoning off|minimal|low|medium|high|xhigh|max
/reasoning reset
```

With no argument, `/reasoning` opens a selector containing only levels supported
by the model's native `thinkingLevelMap`. `reset` removes the mapping for the
current model. Models without a saved mapping are left unchanged.

Mappings are stored globally in `~/.pi/agent/reasoning-levels.json`:

```json
{
  "anthropic/claude-opus-4-6": "high",
  "openai-codex/gpt-5.4": "xhigh"
}
```

The extension does not guess levels, show notifications, or add footer status.
