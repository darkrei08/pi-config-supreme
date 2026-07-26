import { handleGitHub } from "./github"
import { handleHackerNews } from "./hackernews"
import { handleReddit } from "./reddit"
import type { DomainHandler } from "./types"

/**
 * Ordered list of domain handlers.
 *
 * The fetch tool runs these before the normal HTML pipeline.
 * First handler to return non-null wins.
 * Order matters — put most specific URL patterns first.
 */
export const domainHandlers: DomainHandler[] = [
  handleGitHub,
  handleHackerNews,
  handleReddit,
]
