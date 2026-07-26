/**
 * Co-Authored-By Extension
 *
 * Automatically appends a Co-Authored-By trailer to commit/describe messages
 * when the agent runs `git commit`, `jj commit`, `jj describe`, or `jj new`.
 *
 * Example message:
 *   fix: resolve null pointer
 *
 *   Co-Authored-By: Claude Sonnet 4 <noreply@pi.dev>
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { isToolCallEventType } from "@mariozechner/pi-coding-agent"

function hasMessageFlag(cmd: string): boolean {
  return /\s-[^\s]*m\b/.test(cmd) || /\s--message\b/.test(cmd)
}

function isGitCommit(cmd: string): boolean {
  const normalized = cmd.replace(/\\\n/g, " ")
  return /\bgit\s+commit\b/.test(normalized) && hasMessageFlag(normalized)
}

function isJjCommitOrDescribe(cmd: string): boolean {
  const normalized = cmd.replace(/\\\n/g, " ")
  return (
    /\bjj\s+(commit|ci|describe|desc|new)\b/.test(normalized) &&
    hasMessageFlag(normalized)
  )
}

/**
 * Find the end position of a subcommand starting at `startPos`, stopping at
 * the next unquoted `&&`, `||`, or `;` shell operator.
 */
function findSubcommandEnd(cmd: string, startPos: number): number {
  let inSingle = false
  let inDouble = false
  for (let i = startPos; i < cmd.length; i++) {
    const ch = cmd[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (!inSingle && !inDouble) {
      if (
        (ch === "&" && cmd[i + 1] === "&") ||
        (ch === "|" && cmd[i + 1] === "|") ||
        ch === ";"
      ) {
        return i
      }
    }
  }
  return cmd.length
}

function appendTrailer(cmd: string, modelName: string): string {
  const trailer = `-m "Co-Authored-By: ${modelName} <noreply@pi.dev>"`

  // Locate the matching jj/git subcommand within a potentially compound bash command.
  // Appending to the end of the full string breaks with `cmd1 && jj describe -m "..." && cmd2`
  // because the trailer lands on cmd2 instead of jj describe.
  const normalized = cmd.replace(/\\\n/g, " ")
  const match =
    /\bjj\s+(commit|ci|describe|desc|new)\b/.exec(normalized) ??
    /\bgit\s+commit\b/.exec(normalized)

  if (!match || match.index === undefined) {
    return `${cmd.trimEnd()} ${trailer}`
  }

  const endPos = findSubcommandEnd(cmd, match.index)
  const before = cmd.slice(0, endPos).trimEnd()
  const rest = cmd.slice(endPos).trimStart()
  return rest ? `${before} ${trailer} ${rest}` : `${before} ${trailer}`
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return

    const cmd = event.input.command
    if (!isGitCommit(cmd) && !isJjCommitOrDescribe(cmd)) return

    const modelName = ctx.model?.name ?? "unknown"

    event.input.command = appendTrailer(cmd, modelName)
  })
}
