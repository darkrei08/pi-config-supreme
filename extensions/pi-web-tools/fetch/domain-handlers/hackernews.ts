import { fetchJson } from "../../providers/http"
import type { DomainHandler } from "./types"

const API_BASE = "https://hacker-news.firebaseio.com/v0"

interface HNItem {
  id: number
  deleted?: boolean
  type?: string
  by?: string
  time?: number
  text?: string
  dead?: boolean
  kids?: number[]
  url?: string
  score?: number
  title?: string
  descendants?: number
}

async function fetchItem(
  id: number,
  signal?: AbortSignal
): Promise<HNItem | null> {
  return fetchJson<HNItem>(`${API_BASE}/item/${id}.json`, {
    signal,
    timeout: 15_000,
  })
}

async function fetchItems(
  ids: number[],
  limit: number,
  signal?: AbortSignal
): Promise<HNItem[]> {
  const results = await Promise.all(
    ids.slice(0, limit).map((id) => fetchItem(id, signal))
  )
  return results.filter(
    (item): item is HNItem => item !== null && !item.deleted && !item.dead
  )
}

function decodeHNText(html: string): string {
  return html
    .replace(/<p>/g, "\n\n")
    .replace(/<\/p>/g, "")
    .replace(/<pre><code>/g, "\n```\n")
    .replace(/<\/code><\/pre>/g, "\n```\n")
    .replace(/<code>/g, "`")
    .replace(/<\/code>/g, "`")
    .replace(/<i>/g, "*")
    .replace(/<\/i>/g, "*")
    .replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .trim()
}

function formatTimeAgo(unixTime: number): string {
  const diff = Date.now() - unixTime * 1000
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 7) return new Date(unixTime * 1000).toISOString().split("T")[0]
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  return `${Math.floor(diff / (1000 * 60))}m ago`
}

async function renderStory(
  item: HNItem,
  signal?: AbortSignal,
  depth = 0
): Promise<string> {
  const lines: string[] = []

  if (depth === 0) {
    lines.push(`# ${item.title || "HN Story"}`)
    lines.push("")
    if (item.url) lines.push(`**URL:** ${item.url}`)
    lines.push(
      `**Posted by:** ${item.by || "?"} · **Score:** ${item.score ?? 0} · **Time:** ${formatTimeAgo(item.time ?? 0)}`
    )
    if (item.descendants) lines.push(`**Comments:** ${item.descendants}`)
    lines.push("")
  }

  if (item.text) {
    lines.push(decodeHNText(item.text))
    lines.push("")
  }

  if (item.kids && item.kids.length > 0 && depth < 2) {
    const topComments = item.kids.slice(0, depth === 0 ? 20 : 10)
    const comments = await fetchItems(topComments, topComments.length, signal)

    if (comments.length > 0) {
      if (depth === 0) {
        lines.push("---")
        lines.push("")
        lines.push("## Comments")
        lines.push("")
      }

      for (const comment of comments) {
        const indent = "  ".repeat(depth)
        const score = comment.score !== undefined ? ` [${comment.score}]` : ""
        lines.push(
          `${indent}**${comment.by || "?"}** (${formatTimeAgo(comment.time ?? 0)})${score}`
        )
        lines.push("")

        if (comment.text) {
          for (const line of decodeHNText(comment.text).split("\n")) {
            lines.push(`${indent}${line}`)
          }
          lines.push("")
        }

        // Recurse into child comments (depth 1 only)
        if (comment.kids && comment.kids.length > 0 && depth < 1) {
          const childOutput = await renderStory(comment, signal, depth + 1)
          lines.push(childOutput)
        }
      }
    }
  }

  return lines.join("\n")
}

async function renderListing(
  ids: number[],
  title: string,
  signal?: AbortSignal
): Promise<string> {
  const stories = await fetchItems(ids, 20, signal)

  const lines = [`# ${title}`, ""]

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i]
    const comments = story.descendants ? ` | ${story.descendants} comments` : ""
    lines.push(`${i + 1}. **${story.title}**`)
    if (story.url) lines.push(`   ${story.url}`)
    lines.push(
      `   ${story.score ?? 0} points by ${story.by || "?"} | ${formatTimeAgo(story.time ?? 0)}${comments}`
    )
    lines.push(`   https://news.ycombinator.com/item?id=${story.id}`)
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Handle Hacker News URLs via the official Firebase API.
 */
export const handleHackerNews: DomainHandler = async (
  url: string,
  signal?: AbortSignal
) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (!parsed.hostname.includes("news.ycombinator.com")) return null

  const itemId = parsed.searchParams.get("id")
  const title = parsed.hostname

  // Individual item: ?id=12345678
  if (itemId) {
    const item = await fetchItem(parseInt(itemId, 10), signal)
    if (!item) {
      return `# HN Item ${itemId}\n\nFailed to fetch.`
    }
    return await renderStory(item, signal)
  }

  // Front pages
  if (parsed.pathname === "/" || parsed.pathname === "/news") {
    const ids = await fetchJson<number[]>(`${API_BASE}/topstories.json`, {
      signal,
      timeout: 15_000,
    })
    if (!ids) return null
    return await renderListing(ids, "Hacker News — Top Stories", signal)
  }

  if (parsed.pathname === "/newest") {
    const ids = await fetchJson<number[]>(`${API_BASE}/newstories.json`, {
      signal,
      timeout: 15_000,
    })
    if (!ids) return null
    return await renderListing(ids, "Hacker News — New", signal)
  }

  if (parsed.pathname === "/best") {
    const ids = await fetchJson<number[]>(`${API_BASE}/beststories.json`, {
      signal,
      timeout: 15_000,
    })
    if (!ids) return null
    return await renderListing(ids, "Hacker News — Best", signal)
  }

  // Unknown path — let normal fetch handle it
  return null
}
