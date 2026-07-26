# Commit Messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) format for git commits and jj descriptions.

## Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Type

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only (README, comments, docstrings) |
| `style` | Formatting, whitespace, semicolons; no logic change |
| `refactor` | Code restructuring; no new feature or bug fix |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or external dependencies |
| `ci` | CI configuration and scripts |
| `chore` | Maintenance tasks, tooling, misc |
| `revert` | Reverting a previous commit |

## Scope

Optional short noun in parentheses, e.g. `feat(api):`, `fix(parser):`.

Check recent history for common scopes:

```bash
# jj
jj log -n 50 --no-graph -T 'description.first_line() ++ "\n"'

# git
git log -n 50 --pretty=format:%s
```

## Description

- Required.
- Short imperative summary: `add Polish language`, not `added Polish language`.
- Lowercase first word.
- No trailing period.

## Body

Strongly encouraged unless change is trivially obvious. Explain what changed, why, and approach taken. Reader of `jj log` / `git log` should understand change without opening diff.

## Footers

Optional. Use `token: value` or `token #value` format.

Common footers:

- `Refs: #123`
- `Co-authored-by: Name <email>`

## Rules

- Do not add sign-offs (`Signed-off-by`) unless explicitly asked.
- Do not push after committing unless explicitly asked.
