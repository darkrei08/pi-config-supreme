# Splitting Mixed Changes

Use when separating large or mixed work into focused commits/changesets.

## Shared Workflow

1. Inspect full diff and file summary.
2. Identify logical groups: refactor, feature, tests, docs, generated files, etc.
3. Split one logical group at a time.
4. Commit/describe each group with a focused message.
5. Verify no intended changes were lost or duplicated.
6. Order by dependency: prerequisites first, dependents later.

## jj Workflow

Prefer `jj-hunk` for non-interactive file/hunk selection.

### Inspect

```bash
jj diff -r <revset> --stat
jj diff -r <revset>
jj-hunk list
jj-hunk list --rev <revset>
jj-hunk list --files
```

### Spec Format

```json
{
  "files": {
    "src/foo.rs": {"hunks": [0, 2]},
    "src/bar.rs": {"action": "keep"},
    "src/baz.rs": {"action": "reset"}
  },
  "default": "reset"
}
```

| Spec | Effect |
|------|--------|
| `{"hunks": [0, 2]}` | Include only hunks 0 and 2 |
| `{"ids": ["hunk-..."]}` | Include hunks by stable ID |
| `{"action": "keep"}` | Include all changes in file |
| `{"action": "reset"}` | Exclude all changes in file |
| `"default": "reset"` | Unlisted files excluded |
| `"default": "keep"` | Unlisted files included |

### Commands

```bash
# selected hunks -> first commit, rest -> second
jj-hunk split '<spec>' "commit message"
jj-hunk split -r <rev> '<spec>' "commit message"

# selected hunks committed, rest stays in working copy
jj-hunk commit '<spec>' "commit message"

# selected hunks squashed into parent
jj-hunk squash '<spec>'
jj-hunk squash -r <rev> '<spec>'

# read spec from file/stdin
jj-hunk split --spec-file spec.json "commit message"
cat spec.json | jj-hunk commit - "commit message"
```

### Example

```bash
jj-hunk list

jj-hunk split '{"files": {"src/db/schema.ts": {"action": "keep"}}, "default": "reset"}' \
  "feat: add database schema"

jj-hunk split '{"files": {"src/lib/utils.ts": {"hunks": [0, 2]}}, "default": "reset"}' \
  "refactor: clean up utils"

jj commit -m "feat: add new endpoint"

jj log -r 'trunk()..@'
```

Verify with `jj interdiff --from <original> --to <last-split-changeset>` when preserving an original changeset. Empty output means no change lost or duplicated.

## Git Workflow

Git uses staging as the split boundary. Build each commit by staging only files/hunks for one logical group, commit, then repeat.

### Inspect

```bash
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --no-color --no-ext-diff
```

### File-Level Split

```bash
git add <files-for-group>
git --no-pager diff --cached --no-color --no-ext-diff
git commit -m "type(scope): summary" -m "Body..."
```

### Hunk-Level Split

Interactive patch mode can be acceptable when user is driving terminal interaction. For autonomous agents, avoid commands that require TUI/editor input unless environment supports it.

```bash
git add -p <files>
git --no-pager diff --cached --no-color --no-ext-diff
git commit -m "type(scope): summary" -m "Body..."
```

If patch mode is not safe, split by editing files directly, staging the intended file state, committing, then restoring/reapplying remaining changes from saved diff only if necessary. Prefer asking before complex manual hunk surgery.

### Unstage / Adjust

```bash
git restore --staged <files>
git restore -p --staged <files>
git --no-pager diff --cached --no-color --no-ext-diff
```

### Verify

```bash
git --no-pager status --short
git --no-pager log --no-color --no-decorate -n 5 --oneline
```
