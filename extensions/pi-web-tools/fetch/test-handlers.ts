/**
 * Smoke test for web-fetch domain handlers.
 *
 * Run: bun test-handlers.ts
 */

import { handleGitHub } from "./domain-handlers/github"
import { handleHackerNews } from "./domain-handlers/hackernews"
import { handleReddit } from "./domain-handlers/reddit"

const tests = [
  {
    name: "GitHub repo",
    url: "https://github.com/nicobailon/pi-web-access",
    handler: handleGitHub,
  },
  {
    name: "GitHub blob",
    url: "https://github.com/nicobailon/pi-web-access/blob/main/index.ts",
    handler: handleGitHub,
  },
  {
    name: "GitHub issue",
    url: "https://github.com/nicobailon/pi-web-access/issues/42",
    handler: handleGitHub,
  },
  {
    name: "GitHub PR",
    url: "https://github.com/nodejs/node/pull/55689",
    handler: handleGitHub,
  },
  {
    name: "GitHub gist",
    url: "https://gist.github.com/anonymous/abc123",
    handler: handleGitHub,
  },
  {
    name: "GitHub raw",
    url: "https://raw.githubusercontent.com/nicobailon/pi-web-access/main/README.md",
    handler: handleGitHub,
  },

  {
    name: "HN item",
    url: "https://news.ycombinator.com/item?id=42500123",
    handler: handleHackerNews,
  },
  {
    name: "HN front page",
    url: "https://news.ycombinator.com/",
    handler: handleHackerNews,
  },

  {
    name: "Reddit subreddit",
    url: "https://www.reddit.com/r/programming/",
    handler: handleReddit,
  },

  // Should return null (fall through to normal fetch)
  {
    name: "Not matched — null",
    url: "https://example.com",
    handler: handleGitHub,
  },
  {
    name: "Not matched — null",
    url: "https://en.wikipedia.org/wiki/TypeScript",
    handler: handleHackerNews,
  },
]

async function main() {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 60_000)

  for (const { name, url, handler } of tests) {
    console.log(`\n${"=".repeat(60)}`)
    console.log(`TEST: ${name}`)
    console.log(`URL:  ${url}`)
    console.log(`${"-".repeat(60)}`)

    try {
      const result = await handler(url, ac.signal)
      if (result === null) {
        console.log("→ null (falls through to normal fetch)")
      } else {
        const preview = result.slice(0, 800)
        const truncated = result.length > 800 ? "…" : ""
        console.log(preview + truncated)
        console.log(
          `\n[${result.length} chars, ${result.split("\n").length} lines]`
        )
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`)
    }
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log("All tests complete.")
  ac.abort()
}

main()
