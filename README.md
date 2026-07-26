# pi-config-supreme

Personal [Pi coding agent](https://github.com/badlogic/pi-mono) configuration. Merges three MIT-licensed configs into one, wired for [pi-extensible-workflows](https://github.com/vekexasia/pi-extensible-workflows):

- **[vekexasia/pi-config](https://github.com/vekexasia/pi-config)** — base skeleton, operating rules, `pi-extensible-workflows` role wiring
- **[PrayagS/pi-config](https://github.com/PrayagS/pi-config)** — Dynamic Context Pruning, multi-provider web tools, quality-of-life extensions, themes
- **[Gentleman-Programming/gentle-pi](https://github.com/Gentleman-Programming/gentle-pi)** — lightweight tooling extensions + optional 4R adversarial review roles

Full attribution and inclusion/exclusion rationale in [CREDITS.md](CREDITS.md).

The repository is checked out directly at `~/.pi/agent`. `.gitignore` keeps credentials, sessions, package clones, dependencies, logs, and machine state out of Git.

## Install on another machine

Pi creates `~/.pi/agent`, so preserve local credentials before replacing it:

```bash
mv ~/.pi/agent ~/.pi/agent.old
git clone https://github.com/darkrei08/pi-config-supreme.git ~/.pi/agent
cp ~/.pi/agent.old/auth.json ~/.pi/agent/ 2>/dev/null || true
cp ~/.pi/agent.old/ha.json ~/.pi/agent/ 2>/dev/null || true
pi update --extensions
```

Review and remove `~/.pi/agent.old` after confirming the new setup works.

## Sync

```bash
git -C ~/.pi/agent pull --ff-only
git -C ~/.pi/agent add -A
git -C ~/.pi/agent commit -m "Update Pi config"
git -C ~/.pi/agent push
```

## Structure

```
AGENTS.md                          merged operating philosophy + execution rules
settings.json / modes.json         provider/model defaults, package list
keybindings.json / models.json     editor + model registry
package.json                       pi extension/skill/theme discovery (folder scan)
extensions/                        ~35 extensions, one folder (or flat .ts) per feature
pi-extensible-workflows/
  roles/                           default roles: developer, reviewer, scout, summarizer, tests-expert
  roles-optional-4r-review/        opt-in adversarial review roles (readability, refuter, reliability, resilience, risk, validator)
  settings.json                    workflow engine settings
skills/                            learning-opportunities, orient, skill-creator, vcs, yaml-reader
themes/                            ghostty terminal themes
docs/reference/                    source READMEs kept for provenance
```

## Extensions included

Dynamic Context Pruning (`pi-dcp`), multi-provider web fetch/search/extract (`pi-web-tools`), caveman compression, structured commits, prompt history, image attachments with kitty graphics preview, sandboxed execution, working indicator, interactive shell, reasoning display, system-prompt filtering, session indexing, Bedrock inference-profile provider, Claude Code spawning, co-authored-by trailer management, skill registry, quiet-tools, pretty output, codegraph tools, startup banner — plus vekexasia's personal set (live dashboard, HA quota, herdr agent/manual state, vim editor, fork-out, hashline bridge, learning-opportunities-auto, questionnaire, tmux progress, answer, show-system-prompt).

## Deliberately excluded

gentle-pi's native Receipt-Driven Development (RDD) runtime — self-flagged **unstable** by its own README, and coupled to a proprietary binary and to Gentleman-Programming's own OpenSpec change history. Not portable. See [CREDITS.md](CREDITS.md) for detail.

## Never committed

`auth.json`, `ha.json`, Home Assistant configuration, trust decisions, sessions, logs, locks, backups, package clones, `node_modules`.

## License

MIT — see [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md) for per-source attribution.
