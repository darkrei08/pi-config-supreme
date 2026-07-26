import type { SearchFilters } from "../search/types"

export function buildKagiSearchArgs(
  query: string,
  opts: SearchFilters
): string[] {
  const args = ["search", "--format", "compact"]
  if (opts.age) args.push("--time", opts.age)
  const domainTerms = [
    ...(opts.includeDomains ?? []).map((domain) => `site:${domain}`),
    ...(opts.excludeDomains ?? []).map((domain) => `-site:${domain}`),
  ]
  args.push([...domainTerms, query].join(" "))
  return args
}
