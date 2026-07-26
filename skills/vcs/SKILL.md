---
name: vcs
description: >
  Version control operations for git and jujutsu. Use for status, diff, log,
  commit, commit-message review, push, pull/fetch, branch/bookmark, rebase,
  restore, undo, conflict resolution, splitting mixed changes, and history
  editing. Selects backend with workspace-aware jj/git decision matrix.
---

# Version Control

Unified workflow for git and Jujutsu (jj).

## Step 1: Detect Backend

Before any VCS command, select backend with this decision matrix:

1. If current directory is a registered non-default jj workspace → `jj`
2. Else if current directory is a linked git worktree → `git`
3. Else if a `.jj` directory exists → `jj`
4. Else → `git`

```bash
jj_root=$(jj root 2>/dev/null || true)
if [ -n "$jj_root" ] && jj workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null \
  | awk -F '\t' -v root="$jj_root" '$2 == root && $1 != "default" { found = 1 } END { exit !found }'; then
  echo "jj"
else
  git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  git_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$git_common" ] && [ -n "$git_top" ] && [ "$git_common" != "$git_top/.git" ]; then
    echo "git"
  elif [ -d .jj ] || [ -n "$jj_root" ]; then
    echo "jj"
  else
    echo "git"
  fi
fi
```

- `jj` — read `references/jj.md` and use jj commands.
- `git` — read `references/git.md` and use git commands.

## Step 2: Load Task References

Always read the backend reference before acting:

- `references/jj.md` for jj repos
- `references/git.md` for git repos

Read extra topic references only when needed:

- `references/commit-messages.md` when committing, describing commits, or reviewing/writing commit messages.
- `references/splitting.md` when splitting mixed changes, doing partial commits, or separating file/hunk groups.

## Universal Rules

1. Inspect status and diff before committing or destructive changes.
2. Do not push unless explicitly asked.
3. Avoid interactive commands that open editors or TUIs.
4. After mutating operations, verify status.
5. If caller provides file paths/globs, operate only on intended files.
6. If unrelated or ambiguous changes exist, ask before including them.
