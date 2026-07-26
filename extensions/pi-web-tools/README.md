# pi-web-tools

Pi extension providing `web_search`, `web_fetch`, `web_extract`, and `/web-tools usage`, plus a web-content untrusted-data system prompt guard when any of those tools are enabled.

## Structure

```
├── index.ts                  # extension entry — registers tools/commands
├── usage.ts                  # /web-tools usage provider balance command
├── providers/                # shared provider API clients
│   ├── http.ts               #   fetchWithTimeout + fetchJson + postJson
│   ├── kagi.ts               #   Kagi CLI argument builder
│   ├── firecrawl.ts          #   Firecrawl scrape client
│   ├── exa.ts                #   Exa contents client
│   ├── parallel.ts           #   Parallel extract client + session reuse
│   ├── tavily.ts             #   Tavily extract client
│   ├── jina.ts               #   Jina Reader client
│   └── you.ts                #   You.com contents client
├── search/                   # web_search tool
│   ├── index.ts              #   createWebSearchTool factory + execute
│   ├── kagi.ts               #   Kagi result formatting
│   ├── render.ts             #   render functions
│   └── types.ts              #   Kagi response/tool detail types
├── fetch/                    # web_fetch tool
│   ├── index.ts              #   webFetchTool config (domain dispatch → pipeline → truncate)
│   ├── pipeline.ts           #   fetchAndExtract/fetchRawHtml orchestration
│   ├── content-negotiation.ts #   direct markdown fetch stage
│   ├── defuddle.ts           #   Defuddle fallback extraction
│   ├── result.ts             #   FetchResult types + result builder
│   ├── render.ts             #   render functions
│   ├── truncate.ts           #   truncation helper
│   ├── extractors/           #   API content extractor adapters
│   │   ├── index.ts          #     barrel + apiExtractors registry
│   │   ├── types.ts          #     Extractor interface
│   │   ├── jina.ts → firecrawl.ts → parallel.ts → exa.ts → tavily.ts → you.ts
│   │   └── markdown-new.ts
│   ├── domain-handlers/      #   specialized handlers for GitHub, HN, Reddit
│   └── test-handlers.ts      #   domain handler smoke tests
├── extract/                  # web_extract tool
│   ├── index.ts              #   webExtractTool config + validation
│   ├── pipeline.ts           #   summary/targeted provider fallback orchestration
│   ├── render.ts             #   TUI render functions
│   ├── render-markdown.ts    #   markdown output formatting
│   └── providers/            #   web_extract provider adapters
├── package.json
└── README.md
```

## Adding an extractor

1. Create `fetch/extractors/<name>.ts` implementing `Extractor`
2. Export named const with `name` + `extract(url)` method
3. Register in `fetch/extractors/index.ts` barrel + `apiExtractors` array
4. Add stage name to `ExtractionStage` union in `fetch/result.ts`

## `web_search`

Search the web using a multi-provider pipeline. Runs one or more queries in parallel and returns numbered result blocks with title, URL, provider source, published date, and snippet.

Provider order: Parallel → Exa → Kagi CLI → You.com → Firecrawl → Tavily. Each API provider self-skips when its API key env var is missing. Set `PI_WEB_SEARCH_STAGE` to force one provider: `parallel`, `exa`, `kagi`, `you`, `firecrawl`, or `tavily`.

### Parameters

- `queries[]` — search queries (supports Kagi operators: site:, filetype:, intitle:, etc.)
- `limit?` — max results per query (default 10, max 50)
- `age?` — restrict result age where supported: `day`, `week`, `month`, `year` (Kagi, Firecrawl, Tavily, Parallel, Exa, You.com)
- `includeDomains?` — restrict results to these domains (Kagi query operators, Firecrawl, Tavily, Parallel, Exa, You.com)
- `excludeDomains?` — exclude results from these domains (Kagi query operators, Firecrawl, Tavily, Parallel, Exa, You.com)
- `includeContent?` — include provider-supported page content in result snippets; uses Firecrawl markdown, Tavily markdown, Parallel excerpts, Exa summaries, and You.com markdown. Kagi is skipped when enabled.

Kagi requires the `kagi` CLI to be installed and authenticated. API providers reuse existing web fetch credentials:

- `PI_WEB_FETCH_FIRECRAWL_API_KEY`
- `PI_WEB_FETCH_TAVILY_API_KEY`
- `PI_WEB_FETCH_PARALLEL_API_KEY`
- `PI_WEB_FETCH_EXA_API_KEY`
- `PI_WEB_FETCH_YOU_API_KEY`

## `web_fetch`

Fetch a URL and return clean, readable Markdown content, or raw HTML when requested.

`web_fetch` validates URLs before fetching: only `http`/`https` are allowed, embedded credentials are rejected, and localhost/private/link-local/internal hosts are blocked.

### Extraction pipeline

1. **Domain handlers** — GitHub, Hacker News, Reddit get specialized extraction
2. **Content negotiation** — prefers markdown if server supports it
3. **API extractors** (priority order) — each self-checks its env var
   - Jina AI Reader (`PI_WEB_FETCH_JINA_API_KEY`)
   - Firecrawl (`PI_WEB_FETCH_FIRECRAWL_API_KEY`)
   - Parallel (`PI_WEB_FETCH_PARALLEL_API_KEY`)
   - Exa.ai (`PI_WEB_FETCH_EXA_API_KEY`)
   - Tavily (`PI_WEB_FETCH_TAVILY_API_KEY`)
   - You.com (`PI_WEB_FETCH_YOU_API_KEY`)
   - markdown.new proxy
4. **Defuddle** — default HTML extraction

Large outputs are truncated to Pi limits and saved to a temp file for paging.

Set `PI_WEB_FETCH_STAGE` to force one fetch stage:

- `content-negotiation`
- `jina-ai`
- `firecrawl`
- `parallel`
- `tavily`
- `exa`
- `you`
- `markdown-new`
- `defuddle`

### Parameters

- `url` — URL to fetch
- `rawHtml?` — return raw HTML instead of Markdown. Uses Jina AI Reader → Firecrawl `rawHtml` → You.com HTML → Defuddle HTML.

## `web_extract`

Extract summaries or targeted information from up to 5 URLs.

### Parameters

- `urls[]` — 1 to 5 URLs to extract from
- `mode` — `summary` or `targeted`
- `prompt?` — required for `targeted`, ignored for `summary`

### Provider order

- `summary`: Firecrawl → Exa → Kagi CLI
- `targeted`: Exa → Parallel → Tavily

Set `PI_WEB_EXTRACT_STAGE` to force one provider:

- `summary`: `firecrawl`, `exa`, `kagi`
- `targeted`: `exa`, `parallel`, `tavily`

Firecrawl is single-URL only, so summary mode fans out one scrape request per URL before falling back to Exa for missing URLs.

### Response mapping

- Firecrawl summary → `data.summary`
- Exa summary/targeted → `results[].summary`
- Kagi summary → `data.markdown`
- Parallel targeted → `results[].excerpts[]`
- Tavily targeted → `results[].raw_content`

Provider credentials reuse existing environment variables:

- `PI_WEB_FETCH_FIRECRAWL_API_KEY`
- `PI_WEB_FETCH_EXA_API_KEY`
- `PI_WEB_FETCH_PARALLEL_API_KEY`
- `PI_WEB_FETCH_TAVILY_API_KEY`

## `/web-tools usage`

Shows effective remaining usage for providers with billing/usage APIs:

- Parallel: first uses `parallel-cli auth --json` and `parallel-cli balance get` when `parallel-cli` is installed/authenticated. Falls back to `credit_balance_cents - pending_debit_balance_cents` from `GET https://api.parallel.ai/account/service/v1/balance` with `PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN` (Parallel account API access token; standard API key is not accepted by this endpoint).
- Exa: usage cost for the API key ID in `PI_WEB_FETCH_EXA_API_KEY_ID` from `GET https://admin-api.exa.ai/team-management/api-keys/{id}/usage`. Requires `PI_WEB_FETCH_EXA_SERVICE_API_KEY` with Team Management access; falls back to `PI_WEB_FETCH_EXA_API_KEY` and reports a permission error on 401.
- Firecrawl: `data.remainingCredits` from `GET https://api.firecrawl.dev/v2/team/credit-usage`. Requires `PI_WEB_FETCH_FIRECRAWL_API_KEY`.
- You.com: `data.attributes.balance` from `GET https://api.you.com/v1/billing/account_balance`. Requires `PI_WEB_FETCH_YOU_API_KEY`.
- Tavily: remaining account plan credits from `GET https://api.tavily.com/usage`, with plan total in the detail line. Requires `PI_WEB_FETCH_TAVILY_API_KEY`.

## Future work

- Add a small session-local `web_fetch` page cache with TTL/LRU behavior to avoid repeated provider calls for the same URL.
- Ship a `web-research` skill documenting the recommended search → fetch → extract workflow.

