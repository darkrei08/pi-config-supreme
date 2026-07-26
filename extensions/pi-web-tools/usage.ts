import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { fetchWithTimeout } from "./providers/http"

const TIMEOUT_MS = 15_000

interface UsageLine {
  provider: string
  status: "ok" | "missing" | "error"
  remaining?: string
  detail?: string
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
}

function color(text: string, ...styles: string[]) {
  return `${styles.join("")}${text}${ANSI.reset}`
}

function env(name: string) {
  return process.env[name]?.trim()
}

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function moneyFromCents(value: number) {
  return `$${(value / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function credits(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = env(name)
    if (value) return { name, value }
  }
  return undefined
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>
): Promise<T> {
  const res = await fetchWithTimeout(url, { headers, timeout: TIMEOUT_MS })
  const body = await res.text()
  if (!res.ok) {
    let detail = body.trim()
    try {
      const json = JSON.parse(body)
      detail = json.error ?? json.detail?.error ?? json.detail ?? detail
    } catch {}
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`)
  }
  return JSON.parse(body) as T
}

async function parallelUsageFromToken(): Promise<UsageLine | null> {
  const token = env("PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN")
  if (!token) return null

  const json = await getJson<{
    credit_balance_cents: number
    pending_debit_balance_cents: number
    will_invoice: boolean
  }>("https://api.parallel.ai/account/service/v1/balance", {
    Authorization: `Bearer ${token}`,
  })

  if (json.will_invoice) {
    return {
      provider: "Parallel",
      status: "ok",
      remaining: "postpaid invoice",
      detail: "PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN; will_invoice=true",
    }
  }

  const effective = json.credit_balance_cents - json.pending_debit_balance_cents
  return {
    provider: "Parallel",
    status: "ok",
    remaining: moneyFromCents(effective),
    detail: `PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN; ${moneyFromCents(json.credit_balance_cents)} balance - ${moneyFromCents(json.pending_debit_balance_cents)} pending`,
  }
}

async function parallelUsageFromCli(pi: ExtensionAPI): Promise<UsageLine | null> {
  const which = await pi.exec("bash", ["-lc", "command -v parallel-cli"], { timeout: 5_000 })
  if (which.code !== 0) return null

  const auth = await pi.exec("parallel-cli", ["auth", "--json"], { timeout: TIMEOUT_MS })
  if (auth.code !== 0) return null

  let authJson: { authenticated?: boolean; selected_org_name?: string; selected_org_id?: string }
  try {
    authJson = JSON.parse(auth.stdout)
  } catch {
    return null
  }
  if (!authJson.authenticated) return null

  const balance = await pi.exec("parallel-cli", ["balance", "get"], { timeout: TIMEOUT_MS })
  if (balance.code !== 0) throw new Error(balance.stderr.trim() || `parallel-cli balance get failed: ${balance.code}`)

  const centsMatch = balance.stdout.match(/\((\d+(?:\.\d+)?)¢\)/)
  const dollarsMatch = balance.stdout.match(/Credit balance:\s*(\$[\d,]+(?:\.\d+)?)/)
  const orgMatch = balance.stdout.match(/Organization:\s*(.+)/)
  const remaining = centsMatch ? moneyFromCents(Number(centsMatch[1])) : dollarsMatch?.[1]
  const org = authJson.selected_org_name ?? orgMatch?.[1] ?? authJson.selected_org_id

  return {
    provider: "Parallel",
    status: "ok",
    remaining: remaining ?? "unknown",
    detail: `parallel-cli${org ? `; ${org}` : ""}`,
  }
}

async function parallelUsage(pi: ExtensionAPI): Promise<UsageLine> {
  let cliError: string | undefined
  try {
    const cliUsage = await parallelUsageFromCli(pi)
    if (cliUsage) return cliUsage
  } catch (error) {
    cliError = errorText(error)
  }

  const tokenUsage = await parallelUsageFromToken()
  if (tokenUsage) return tokenUsage

  return {
    provider: "Parallel",
    status: "error",
    detail: cliError
      ? `parallel-cli failed: ${cliError}; run \`parallel-cli auth\` or set PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN`
      : "run `parallel-cli auth` or set PI_WEB_FETCH_PARALLEL_ACCOUNT_TOKEN (account API access token)",
  }
}

async function exaUsage(): Promise<UsageLine> {
  const apiKey = firstEnv("PI_WEB_FETCH_EXA_SERVICE_API_KEY", "PI_WEB_FETCH_EXA_API_KEY")
  if (!apiKey) {
    return {
      provider: "Exa",
      status: "missing",
      detail: "set PI_WEB_FETCH_EXA_SERVICE_API_KEY (Team Management service key)",
    }
  }

  const apiKeyId = env("PI_WEB_FETCH_EXA_API_KEY_ID")
  if (!apiKeyId) {
    return {
      provider: "Exa",
      status: "missing",
      detail: "set PI_WEB_FETCH_EXA_API_KEY_ID to the Exa API key ID to inspect",
    }
  }

  let usage: { api_key_name?: string | null; total_cost_usd?: number; period?: { start?: string; end?: string } }
  try {
    usage = await getJson(
      `https://admin-api.exa.ai/team-management/api-keys/${encodeURIComponent(apiKeyId)}/usage`,
      { "x-api-key": apiKey.value }
    )
  } catch (error) {
    const message = errorText(error)
    if (message.startsWith("401 ")) {
      return {
        provider: "Exa",
        status: "error",
        detail: `${apiKey.name} is unauthorized for Team Management; set PI_WEB_FETCH_EXA_SERVICE_API_KEY to a service key with team access`,
      }
    }
    if (message.startsWith("404 ")) {
      return {
        provider: "Exa",
        status: "error",
        detail: `PI_WEB_FETCH_EXA_API_KEY_ID not found or inaccessible: ${apiKeyId}`,
      }
    }
    throw error
  }

  const usedUsd = numberValue(usage.total_cost_usd)
  const keyName = usage.api_key_name ?? apiKeyId

  return {
    provider: "Exa",
    status: "ok",
    remaining: usedUsd === undefined ? "unknown used" : `${moneyFromCents(usedUsd * 100)} used`,
    detail: `${keyName}; last 30 days`,
  }
}

async function firecrawlUsage(): Promise<UsageLine> {
  const apiKey = env("PI_WEB_FETCH_FIRECRAWL_API_KEY")
  if (!apiKey) return { provider: "Firecrawl", status: "missing", detail: "set PI_WEB_FETCH_FIRECRAWL_API_KEY" }

  const json = await getJson<{
    data?: { remainingCredits?: number; planCredits?: number; billingPeriodEnd?: string | null }
  }>("https://api.firecrawl.dev/v2/team/credit-usage", { Authorization: `Bearer ${apiKey}` })

  const remaining = numberValue(json.data?.remainingCredits)
  const plan = numberValue(json.data?.planCredits)
  return {
    provider: "Firecrawl",
    status: "ok",
    remaining: remaining === undefined ? "unknown" : `${credits(remaining)} credits`,
    detail: `plan ${plan === undefined ? "unknown" : credits(plan)} credits${json.data?.billingPeriodEnd ? `; period ends ${json.data.billingPeriodEnd}` : ""}`,
  }
}

async function youUsage(): Promise<UsageLine> {
  const apiKey = env("PI_WEB_FETCH_YOU_API_KEY")
  if (!apiKey) return { provider: "You.com", status: "missing", detail: "set PI_WEB_FETCH_YOU_API_KEY" }

  const json = await getJson<{ data?: { attributes?: { balance?: number } } }>(
    "https://api.you.com/v1/billing/account_balance",
    { "X-API-Key": apiKey }
  )
  const balance = cents(json.data?.attributes?.balance)
  return {
    provider: "You.com",
    status: "ok",
    remaining: balance === undefined ? "unknown" : moneyFromCents(balance),
    detail: "account balance",
  }
}

function remainingFromLimit(limit: number | null | undefined, used: number | undefined) {
  if (limit === null) return undefined
  if (typeof limit !== "number" || typeof used !== "number") return undefined
  return Math.max(0, limit - used)
}

function remainingCredits(used: number | undefined, limit: number | null | undefined) {
  const remaining = remainingFromLimit(limit, used)
  return remaining === undefined ? undefined : `${credits(remaining)} credits`
}

async function tavilyUsage(): Promise<UsageLine> {
  const apiKey = env("PI_WEB_FETCH_TAVILY_API_KEY")
  if (!apiKey) return { provider: "Tavily", status: "missing", detail: "set PI_WEB_FETCH_TAVILY_API_KEY" }

  const json = await getJson<{
    key?: { usage?: number; limit?: number | null }
    account?: { plan_usage?: number; plan_limit?: number; paygo_usage?: number; paygo_limit?: number }
  }>("https://api.tavily.com/usage", { Authorization: `Bearer ${apiKey}` })

  const accountRemaining = remainingCredits(json.account?.plan_usage, json.account?.plan_limit)
  const keyRemaining = remainingCredits(json.key?.usage, json.key?.limit)
  const plan = numberValue(json.account?.plan_limit)
  const used = numberValue(json.account?.plan_usage)

  return {
    provider: "Tavily",
    status: "ok",
    remaining: accountRemaining ?? keyRemaining ?? "unknown credits",
    detail: `plan ${plan === undefined ? "unknown" : credits(plan)} credits`,
  }
}

async function settle(provider: () => Promise<UsageLine>): Promise<UsageLine> {
  try {
    return await provider()
  } catch (error) {
    const fallbackProvider = provider.name.replace(/Usage$/, "")
    return {
      provider: fallbackProvider.charAt(0).toUpperCase() + fallbackProvider.slice(1),
      status: "error",
      detail: errorText(error),
    }
  }
}

function renderLine(line: UsageLine) {
  const marker =
    line.status === "ok"
      ? color("✓", ANSI.green, ANSI.bold)
      : line.status === "missing"
        ? color("-", ANSI.dim)
        : color("!", ANSI.yellow, ANSI.bold)
  const provider = color(line.provider.padEnd(10), ANSI.bold)
  const remaining = line.remaining ? ` ${color(line.remaining, ANSI.cyan)}` : ""
  const firstLine = `${marker} ${provider}${remaining}`
  return line.detail ? `${firstLine}\n  ${color(line.detail, line.status === "ok" ? ANSI.dim : ANSI.yellow)}` : firstLine
}

function renderUsage(lines: UsageLine[]) {
  return [color("Web provider usage", ANSI.magenta, ANSI.bold), "", ...lines.map(renderLine)].join("\n")
}

async function collectUsage(pi: ExtensionAPI) {
  return Promise.all([
    settle(() => parallelUsage(pi)),
    settle(exaUsage),
    settle(firecrawlUsage),
    settle(youUsage),
    settle(tavilyUsage),
  ])
}

export function registerWebUsageCommand(pi: ExtensionAPI) {
  pi.registerCommand("web-tools", {
    description: "Web tools commands: /web-tools usage",
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trim().toLowerCase()
      return "usage".startsWith(trimmed) ? [{ value: "usage", label: "usage" }] : null
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().toLowerCase()
      if (subcommand !== "usage") {
        ctx.ui.notify("Usage: /web-tools usage", "warning")
        return
      }

      ctx.ui.notify("Fetching web provider usage…", "info")
      ctx.ui.notify(renderUsage(await collectUsage(pi)), "info")
    },
  })
}
