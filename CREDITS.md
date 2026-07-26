# Credits

This configuration is a merge of three MIT-licensed Pi configs plus the `pi-extensible-workflows` plugin. All original authors retain copyright on their respective portions; see [LICENSE](LICENSE).

## [vekexasia/pi-config](https://github.com/vekexasia/pi-config) — base skeleton
`AGENTS.md` operating rules, `settings.json`/`modes.json`/`keybindings.json`/`models.json` layout, `pi-extensible-workflows/roles/*` wiring, and the following extensions: `answer`, `compact-tools`, `footer`, `fork-out`, `ha-quota`, `hashline-tool-display-bridge`, `herdr-agent-state`, `herdr-manual-state`, `learning-opportunities-auto`, `live-dashboard`, `piextworkflows`, `pi-ext-workflows/*`, `pi-tool-display`, `questionnaire`, `show-system-prompt`, `tmux-progress`, `vim-editor`. Skills: `learning-opportunities`, `orient`.

## [vekexasia/pi-extensible-workflows](https://github.com/vekexasia/pi-extensible-workflows) — workflow engine
The plugin this configuration is wired for. Not vendored here; installed as a package per `settings.json`.

## [PrayagS/pi-config](https://github.com/PrayagS/pi-config) — MIT, Copyright (c) 2026 Prayag Savsani
Core philosophy section of `AGENTS.md`, and extensions: `pi-dcp` (Dynamic Context Pruning — originally ported from opencode-dcp by Edmund Miller), `pi-web-tools`, `caveman`, `commit`, `prompt-history`, `pi-images`, `pi-better-prompt-editor`, `sandbox`, `working-indicator`, `interactive-shell`, `reasoning`, `zzz-system-prompt-filter`, `qmd-sessions-indexer`, `custom-provider-bedrock-inference-profiles`, `pi-spawn-claude-code`, `pi-co-authored-by`, `tools`. Skills: `skill-creator`, `vcs`, `yaml-reader`. Ghostty themes.

## [Gentleman-Programming/gentle-pi](https://github.com/Gentleman-Programming/gentle-pi) — MIT, Copyright (c) 2025 Mario Zechner
Lightweight standalone extensions: `skill-registry`, `quiet-tools`, `pi-pretty`, `codegraph-tools`, `startup-banner`. Optional 4R adversarial review roles (`readability`, `refuter`, `reliability`, `resilience`, `risk`, `validator`) ported to `pi-extensible-workflows/roles-optional-4r-review/` as static role definitions.

**Deliberately not ported**: gentle-pi's native Receipt-Driven Development (RDD) runtime (`lib/native-review-*`, `contracts/review-integration`, `openspec/changes/` history). The upstream README self-flags this line as "unstable", and the runtime is tightly coupled to a proprietary `gentle-ai-binary` dependency and Gentleman-Programming's own OpenSpec change-management history — not portable or safely reusable outside that repo.
