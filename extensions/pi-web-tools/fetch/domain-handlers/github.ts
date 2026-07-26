import type { DomainHandler } from "./types"

/**
 * Parse a GitHub URL into its components.
 * Returns null if the URL is not a GitHub link we handle.
 */
interface GitHubUrl {
  kind:
    | "repo"
    | "blob"
    | "tree"
    | "raw-blob"
    | "issue"
    | "issues"
    | "pull"
    | "pulls"
    | "gist"
    | "gist-file"
  owner: string
  repo: string
  ref?: string
  path?: string
  number?: number
}

function parseGitHubUrl(url: string): GitHubUrl | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }

  // Gists: gist.github.com/{user}/{id}[/raw]
  if (u.hostname === "gist.github.com") {
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const [owner, id] = parts
    // raw variant: /{user}/{id}/raw[/ref]/file
    if (parts[2] === "raw") {
      return { kind: "gist", owner, repo: id }
    }
    return { kind: "gist", owner, repo: id }
  }

  // Gist raw content: gist.githubusercontent.com/{user}/{id}/raw[/ref]/file
  if (u.hostname === "gist.githubusercontent.com") {
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const [owner, id] = parts
    // This is already raw — let normal fetch handle it
    return null
  }

  // Raw content: raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
  if (u.hostname === "raw.githubusercontent.com") {
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length < 3) return null
    const [owner, repo, ref, ...pathParts] = parts
    return { kind: "raw-blob", owner, repo, ref, path: pathParts.join("/") }
  }

  // Main GitHub: github.com/{owner}/{repo}[/...]
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") {
    return null
  }

  const parts = u.pathname.split("/").filter(Boolean)
  if (parts.length < 2) return null

  const [owner, repo, section, ...rest] = parts

  if (!section) {
    return { kind: "repo", owner, repo }
  }

  switch (section) {
    case "blob": {
      const [ref, ...pathParts] = rest
      return { kind: "blob", owner, repo, ref, path: pathParts.join("/") }
    }
    case "tree": {
      const [ref, ...pathParts] = rest
      return { kind: "tree", owner, repo, ref, path: pathParts.join("/") }
    }
    case "issues":
      if (rest.length > 0 && /^\d+$/.test(rest[0])) {
        return { kind: "issue", owner, repo, number: parseInt(rest[0], 10) }
      }
      return { kind: "issues", owner, repo }
    case "pull":
      if (rest.length > 0 && /^\d+$/.test(rest[0])) {
        return { kind: "pull", owner, repo, number: parseInt(rest[0], 10) }
      }
      return { kind: "pulls", owner, repo }
    case "pulls":
      return { kind: "pulls", owner, repo }
    default:
      // /{owner}/{repo}/releases, /{owner}/{repo}/wiki, etc. — skip, let normal fetch handle
      return null
  }
}

/**
 * Build `gh` CLI instructions for the parsed GitHub URL.
 */
function buildGhInstructions(gh: GitHubUrl): string {
  const repoFull = `${gh.owner}/${gh.repo}`

  switch (gh.kind) {
    case "repo": {
      return [
        `# GitHub Repository: ${repoFull}`,
        "",
        "Use the `gh` CLI to inspect this repository:",
        "",
        "```bash",
        `gh repo view ${repoFull}          # View repo details (description, stars, language, README)`,
        `gh api repos/${repoFull}          # Raw JSON from GitHub API`,
        `gh api repos/${repoFull}/readme --jq .content | base64 -d`,
        "                                   # Decode and view README",
        `gh api repos/${repoFull}/git/trees/HEAD --jq .tree[].path`,
        "                                   # List all files in repo",
        `gh search code --repo ${repoFull} "search term"`,
        "                                   # Search code in this repo",
        "```",
        "",
        "Cloning (if you need full local access):",
        "```bash",
        `gh repo clone ${repoFull} /tmp/${gh.repo} -- --depth 1`,
        "```",
      ].join("\n")
    }

    case "blob": {
      const ref = gh.ref ? `?ref=${gh.ref}` : ""
      const path = gh.path || ""
      return [
        `# GitHub File: ${repoFull}/${path}`,
        "",
        "Use `gh` CLI to get the raw file content:",
        "",
        "```bash",
        `gh api repos/${repoFull}/contents/${path}${ref} --jq .content | base64 -d`,
        "```",
        "",
        `Or fetch directly (raw URL):`,
        "",
        "```bash",
        `curl -sS https://raw.githubusercontent.com/${repoFull}/${gh.ref || "HEAD"}/${path}`,
        "```",
      ].join("\n")
    }

    case "tree": {
      const ref = gh.ref || "HEAD"
      const dir = gh.path ? `${gh.path}/` : ""
      return [
        `# GitHub Directory: ${repoFull}/${dir} (ref: ${ref})`,
        "",
        "Use `gh` CLI to list directory contents:",
        "",
        "```bash",
        `gh api repos/${repoFull}/contents/${gh.path || ""}?ref=${ref}`,
        "```",
        "",
        "Or view the full repo tree:",
        "",
        "```bash",
        `gh api repos/${repoFull}/git/trees/${ref}?recursive=1 --jq .tree[].path`,
        "```",
      ].join("\n")
    }

    case "raw-blob": {
      const rawUrl = `https://raw.githubusercontent.com/${repoFull}/${gh.ref}/${gh.path}`
      return [
        `# Raw GitHub File: ${repoFull}/${gh.path}`,
        "",
        "This is a raw.githubusercontent.com URL. Fetch it directly:",
        "",
        "```bash",
        `curl -sS ${rawUrl}`,
        "```",
        "Or use the `read` tool with the URL to view it.",
      ].join("\n")
    }

    case "issue": {
      return [
        `# GitHub Issue: ${repoFull}#${gh.number}`,
        "",
        "Use `gh` CLI to view this issue with all comments:",
        "",
        "```bash",
        `gh issue view ${gh.number} --repo ${repoFull} --comments`,
        "```",
      ].join("\n")
    }

    case "issues": {
      return [
        `# GitHub Issues: ${repoFull}`,
        "",
        "Use `gh` CLI to list issues:",
        "",
        "```bash",
        `gh issue list --repo ${repoFull} --limit 30    # Open issues`,
        `gh issue list --repo ${repoFull} --limit 30 --state all`,
        "                                              # All issues",
        `gh issue list --repo ${repoFull} --search "bug" --limit 20`,
        "                                              # Search issues",
        "```",
      ].join("\n")
    }

    case "pull": {
      return [
        `# GitHub Pull Request: ${repoFull}#${gh.number}`,
        "",
        "Use `gh` CLI to view this PR with all comments and diff:",
        "",
        "```bash",
        `gh pr view ${gh.number} --repo ${repoFull} --comments`,
        `gh pr diff ${gh.number} --repo ${repoFull}`,
        "```",
        "",
        "To check out the PR locally:",
        "",
        "```bash",
        `gh pr checkout ${gh.number} --repo ${repoFull}`,
        "```",
      ].join("\n")
    }

    case "pulls": {
      return [
        `# GitHub Pull Requests: ${repoFull}`,
        "",
        "Use `gh` CLI to list PRs:",
        "",
        "```bash",
        `gh pr list --repo ${repoFull} --limit 30    # Open PRs`,
        `gh pr list --repo ${repoFull} --limit 30 --state all`,
        "                                              # All PRs",
        `gh pr list --repo ${repoFull} --search "fix" --limit 20`,
        "                                              # Search PRs",
        "```",
      ].join("\n")
    }

    case "gist": {
      return [
        `# GitHub Gist: ${repoFull}`,
        "",
        "Use `gh` CLI to view this gist:",
        "",
        "```bash",
        `gh gist view ${gh.repo}    # View the gist`,
        `gh gist view ${gh.repo} --raw`,
        "                            # Raw content (useful for piping)",
        "```",
        "",
        `To view a specific file from the gist, use the raw URL with \`read\` or \`curl\` directly.`,
      ].join("\n")
    }

    case "gist-file":
      return [
        `# GitHub Gist File: ${repoFull}/${gh.path}`,
        "",
        "Use `gh` CLI to view this gist:",
        "",
        "```bash",
        `gh gist view ${gh.repo}    # View entire gist`,
        "```",
      ].join("\n")
  }
}

/**
 * Handle GitHub URLs.
 *
 * Instead of fetching content ourselves, we return `gh` CLI instructions
 * to the agent. This keeps the fetch tool lightweight and lets the agent
 * use authenticated GitHub access (gh CLI) for better results.
 *
 * raw.githubusercontent.com URLs pass through to normal fetch.
 */
export const handleGitHub: DomainHandler = async (
  url: string,
  _signal?: AbortSignal
) => {
  const gh = parseGitHubUrl(url)
  if (!gh) return null

  return buildGhInstructions(gh)
}
