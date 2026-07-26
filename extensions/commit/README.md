# commit

Pi command extension that adds `/commit`.

`/commit` gathers VCS context, detects whether the workspace should use `git` or `jj`, then sends a prepared commit request back into the agent with the current status, diff, and recent commit subjects/descriptions.

## Features

- detects backend with project jj/git workspace rules
- collects relevant status and diff before asking the agent to commit
- includes recent commit history so message scope/style can match the repo
- supports optional user instructions or file scope after the command
- asks the agent to create a polished Conventional Commit message
- asks the agent to commit with the detected backend and verify status afterward

## Usage

```text
/commit
/commit only extensions/commit
/commit commit README changes
```

## Collected context

For `jj` workspaces:

- `jj st`
- `jj --color=never --no-pager diff --git`
- `jj log -n 50 --no-graph -T 'description.first_line() ++ "\n"'`

For `git` workspaces:

- `git --no-pager status --short`
- `git --no-pager diff --no-color --no-ext-diff`
- `git --no-pager diff --cached --no-color --no-ext-diff`
- `git log -n 50 --pretty=format:%s`

## Notes

- does not push
- truncates each captured output block to 80,000 characters
- currently invokes `/skill:vcs` for VCS and commit-message guidance
