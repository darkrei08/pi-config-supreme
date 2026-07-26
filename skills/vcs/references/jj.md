# Jujutsu (jj)

Git-compatible VCS with mutable commits, automatic rebasing, and no staging area.

## Core Concepts

> Not Git. jj syntax and model differ significantly.

1. No staging area — every file change is automatically part of the working-copy commit.
2. Working copy is a commit — `@` is current working-copy commit.
3. Commits are mutable — modify commits freely; descendants auto-rebase.
4. Conflicts are values — conflicts do not block operations; resolve later.
5. Bookmarks, not branches — bookmarks are publication pointers, not current-branch state.

## Terminology

| Git | jj |
|-----|----|
| `branch` | `bookmark` |
| `HEAD` | `@` |
| `checkout` | `edit` or `new` |
| `stash` | not needed; create commits |
| staging/index | none |
| `commit --amend` | edit files; changes auto-apply to `@` |
| `reflog` | `jj evolog` / `jj op log` |

## IDs

- Change ID: stable across rewrites. Prefer in commands.
- Commit ID: content hash; changes after rewrites.

## Agent Rules

1. Always pass `-m "message"` when command can open editor:

```bash
jj desc -m "message"
jj squash -m "message"
jj new -m "message"
```

2. Avoid interactive commands:

| Avoid | Use instead |
|-------|-------------|
| `jj describe` without `-m` | `jj describe -m "message"` |
| `jj squash -i` | `jj squash -m "message"` |
| `jj split` without filesets | `jj-hunk` or explicit filesets |
| `jj restore -i` | `jj restore <files>` |
| `jj resolve` | edit conflict markers directly |
| `jj diffedit` | `jj restore` / `jj squash` |
| commands with `--tool` | non-interactive alternatives |

3. Verify after mutations with `jj st`.

4. Use `jj commit -m` to finalize current work. It describes `@` and creates a new empty working-copy commit:

```bash
jj commit -m "feat: add feature"
```

## Plain-Text Output

Use agent-readable flags:

```bash
jj st
jj --color=never --no-pager log --no-graph
jj --color=never --no-pager log -r 'all()' --no-graph
jj --color=never --no-pager diff
jj --color=never --no-pager diff --git
jj --color=never --no-pager diff --git -r <change>
jj show <change>
jj evolog
jj op log
```

## Common Operations

### Create / Navigate

```bash
jj new
jj new -m "feat: new work"
jj new main -m "feat: ..."
jj new x y -m "merge: ..."
jj edit <change-id>
jj edit @-
jj next --edit
jj prev --edit
jj new --before @ -m "msg"
```

### Edit History

```bash
jj desc -m "new message"
jj desc -r <change> -m "new message"
jj squash -m "combined"
jj squash -r <change> -m "combined"
jj squash --into <target> -m "msg"
jj squash --from <src> --into <target> -m "msg"
jj absorb
jj rebase -r <change> -d <dest>
jj rebase -s <change> -d <dest>
jj rebase -b <change> -d <dest>
jj abandon <change-id>
jj restore
jj restore path/to/file.txt
jj restore --from <change> path/file
jj metaedit -r @ -m "new message"
jj duplicate <change>
jj cat -r <change> path/file
jj interdiff --from <a> --to <b>
```

### Undo / Recovery

```bash
jj undo
jj op log
jj op undo
jj op restore <operation>
```

Nothing is truly lost while operation log remains available.

## Commit Flow

When committing/describing work, also read `commit-messages.md`.

```bash
jj st
jj --color=never --no-pager diff
jj log -n 50 --no-graph -T 'description.first_line() ++ "\n"'
jj commit -m "type(scope): summary

Body..."
```
