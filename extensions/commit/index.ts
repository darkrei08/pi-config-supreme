import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const MAX_OUTPUT_CHARS = 80_000

async function execShell(pi: ExtensionAPI, command: string) {
  return pi.exec("bash", ["-lc", command], { timeout: 10_000 })
}

function formatOutput(label: string, output: string) {
  const text = output.trimEnd()
  const truncated =
    text.length > MAX_OUTPUT_CHARS
      ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`
      : text

  return `## ${label}\n\n\`\`\`text\n${truncated || "(empty)"}\n\`\`\``
}

async function detectBackend(pi: ExtensionAPI) {
  const script = String.raw`
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
`

  const result = await execShell(pi, script)
  return result.stdout.trim() === "jj" ? "jj" : "git"
}

async function collectContext(pi: ExtensionAPI, backend: "git" | "jj") {
  if (backend === "jj") {
    const [status, diff, subjects] = await Promise.all([
      execShell(pi, "jj st"),
      execShell(pi, "jj --color=never --no-pager diff --git"),
      execShell(
        pi,
        "jj log -n 50 --no-graph -T 'description.first_line() ++ \"\\n\"'"
      ),
    ])

    return [
      formatOutput("Status", status.stdout || status.stderr),
      formatOutput("Diff", diff.stdout || diff.stderr),
      formatOutput("Recent commit descriptions", subjects.stdout || subjects.stderr),
    ].join("\n\n")
  }

  const [status, unstagedDiff, stagedDiff, subjects] = await Promise.all([
    execShell(pi, "git --no-pager status --short"),
    execShell(pi, "git --no-pager diff --no-color --no-ext-diff"),
    execShell(pi, "git --no-pager diff --cached --no-color --no-ext-diff"),
    execShell(pi, "git log -n 50 --pretty=format:%s"),
  ])

  return [
    formatOutput("Status", status.stdout || status.stderr),
    formatOutput("Unstaged diff", unstagedDiff.stdout || unstagedDiff.stderr),
    formatOutput("Staged diff", stagedDiff.stdout || stagedDiff.stderr),
    formatOutput("Recent commit subjects", subjects.stdout || subjects.stderr),
  ].join("\n\n")
}

export default function commit(pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description: "Review current VCS diff and commit with vcs skill guidance",
    handler: async (args, ctx) => {
      const backend = await detectBackend(pi)
      const context = await collectContext(pi, backend)
      const userInstructions = args.trim() || "(none)"

      await pi.sendUserMessage(`/skill:vcs

Commit the current changes.

Use the vcs skill's commit-message instructions directly. Backend has already been detected and status/diff/recent history have already been fetched by the /commit command.

Backend: ${backend}
User instructions / file scope: ${userInstructions}

Do not re-run backend detection, status, diff, or recent-history commands unless this provided context is insufficient or stale. Review the provided diff, decide intended files from user instructions, create a polished Conventional Commit message, run the correct ${backend} commit command, then verify status.

${context}`)

      ctx.ui.notify(`Prepared ${backend} commit context`, "success")
    },
  })
}
