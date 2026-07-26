# interactive-shell

Pi extension for user `!` shell commands that need real terminal control.

It intercepts interactive commands like editors, pagers, TUIs, and interactive git commands, suspends Pi's TUI, runs command with inherited stdio, then restores TUI.

## Examples

- `!vim file.txt`
- `!git rebase -i HEAD~3`
- `!htop`
- `!i any-command` to force interactive mode

## Notes

- only affects user `!` commands
- does not make agent bash tool calls interactive
- command matching can be extended with `INTERACTIVE_COMMANDS`
- commands can be excluded with `INTERACTIVE_EXCLUDE`

## Credits

Adapted from Pi example extension:
https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/interactive-shell.ts
