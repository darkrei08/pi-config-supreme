# Git

Use git when `jj root` fails and `git rev-parse --show-toplevel` succeeds.

## Agent Rules

1. Prefer non-interactive commands.
2. Use `--no-pager`, `--no-color`, and `--no-ext-diff` for readable output.
3. Stage only intended files.
4. Verify status after mutating operations.
5. Do not push unless explicitly asked.

## Plain-Text Output

```bash
git --no-pager status --short
git --no-pager status
git --no-pager diff --no-color --no-ext-diff
git --no-pager diff --cached --no-color --no-ext-diff
git --no-pager log --no-color --no-decorate -n 20 --oneline
git --no-pager show --no-color --no-ext-diff <commit>
```

## Common Operations

### Stage / Unstage

```bash
git add <files>
git add -A <files>
git restore --staged <files>
git restore <files>
git restore --source <commit> -- <files>
```

Use pathspecs to limit scope. If no file paths were specified and all changes are intended, `git add -A` is acceptable after reviewing status/diff.

### Commit

When committing or writing commit messages, also read `commit-messages.md`.

```bash
git --no-pager status --short
git --no-pager diff --no-color --no-ext-diff
git --no-pager diff --cached --no-color --no-ext-diff
git log -n 50 --pretty=format:%s
git add <intended-files>
git commit -m "type(scope): summary" -m "Body..."
```

### Branch / Checkout

```bash
git branch
git branch <name>
git switch <name>
git switch -c <name>
git merge <branch>
```

### Rebase / History

Avoid interactive rebase unless user explicitly requests it and you can provide an editor-safe command.

```bash
git rebase <base>
git rebase --abort
git rebase --continue
git commit --amend -m "message"
git reset --soft <commit>
git reset --mixed <commit>
git revert <commit>
```

### Remote Operations

```bash
git fetch
git pull --ff-only
git push
```

Only push when explicitly requested.

## Undo / Recovery

```bash
git reflog
git reset --hard <commit>   # destructive; confirm intent first
git restore <files>
git restore --staged <files>
```

Warn before destructive commands such as `reset --hard`, deleting branches, or discarding uncommitted changes.
