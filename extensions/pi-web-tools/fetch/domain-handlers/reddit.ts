import { fetchJson } from "../../providers/http"
import type { DomainHandler } from "./types"

interface RedditPost {
  title: string
  selftext: string
  author: string
  score: number
  num_comments: number
  created_utc: number
  subreddit: string
  url: string
  is_self: boolean
}

interface RedditComment {
  body: string
  author: string
  score: number
  created_utc: number
}

function formatDate(utc: number): string {
  return new Date(utc * 1000).toISOString().split("T")[0]
}

function cleanRedditHtml(html: string): string {
  // Basic cleanup of Reddit's markdown-like formatting in selftext/comments
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
}

/**
 * Handle Reddit URLs via the .json API.
 *
 * Appending .json to any Reddit URL returns structured JSON data.
 * No auth required, no rate limiting for simple fetches.
 */
export const handleReddit: DomainHandler = async (
  url: string,
  signal?: AbortSignal
) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (!parsed.hostname.includes("reddit.com")) return null

  // Build JSON URL — strip trailing slash, append .json
  let jsonUrl = `${url.replace(/\/$/, "")}.json`
  if (parsed.search) {
    jsonUrl = `${url.replace(/\/$/, "").replace(parsed.search, "")}.json${parsed.search}`
  }

  const data = await fetchJson(jsonUrl, {
    signal,
    timeout: 15_000,
    headers: { "User-Agent": "pi-web-tools/1.0" },
  })
  if (!data) return null

  const lines: string[] = []

  // Post page: data is an array [postData, commentsData]
  if (Array.isArray(data) && data.length >= 1) {
    const postData = data[0]?.data?.children?.[0]?.data as
      | RedditPost
      | undefined

    if (postData) {
      lines.push(`# ${postData.title}`)
      lines.push("")
      lines.push(
        `**r/${postData.subreddit}** · u/${postData.author} · ${postData.score} points · ${postData.num_comments} comments`
      )
      lines.push(`*${formatDate(postData.created_utc)}*`)
      lines.push("")

      if (postData.is_self && postData.selftext) {
        lines.push("---")
        lines.push("")
        lines.push(cleanRedditHtml(postData.selftext))
        lines.push("")
      } else if (!postData.is_self) {
        lines.push(`**Link:** ${postData.url}`)
        lines.push("")
      }

      // Comments (if available in data[1])
      if (data.length >= 2 && data[1]?.data?.children) {
        const comments = data[1].data.children
          .filter((c: any) => c.kind === "t1")
          .slice(0, 10)
          .map((c: any) => c.data as RedditComment)

        if (comments.length > 0) {
          lines.push("---")
          lines.push("")
          lines.push("## Top Comments")
          lines.push("")

          for (const comment of comments) {
            lines.push(`### u/${comment.author} · ${comment.score} points`)
            lines.push("")
            lines.push(cleanRedditHtml(comment.body))
            lines.push("")
            lines.push("---")
            lines.push("")
          }
        }
      }
    }
  } else if (data?.data?.children) {
    // Listing page (subreddit, front page, etc.)
    const posts = data.data.children
      .slice(0, 20)
      .map((c: any) => c.data as RedditPost)
      .filter(Boolean)

    const subreddit = posts[0]?.subreddit
    lines.push(`# r/${subreddit || "Reddit"}`)
    lines.push("")

    for (const post of posts) {
      lines.push(
        `- **${post.title}** (${post.score} pts, ${post.num_comments} comments)`
      )
      lines.push(`  by u/${post.author}`)
      lines.push("")
    }
  }

  if (lines.length === 0) return null
  return lines.join("\n")
}
