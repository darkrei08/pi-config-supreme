/**
 * Working Indicator Extension
 *
 * Phase-aware working indicator that changes shape and speed
 * based on what the agent is doing:
 *
 *   thinking  — noise/static, contemplative (120ms)
 *   tool      — vertical block pulse, active (40ms)
 *   streaming — noise/static, contemplative (120ms)
 *   working   — vertical block pulse, active (40ms)
 *
 * Commands:
 *   /working-indicator           Show current phase
 *   /working-indicator on        Enable phase-aware indicators
 *   /working-indicator off       Disable (restore default)
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  WorkingIndicatorOptions,
} from "@mariozechner/pi-coding-agent"
import spinners, { type Spinner } from "unicode-animations"

// ── Raw frame definitions (colored at runtime via theme) ────────

interface IndicatorDef {
  frames: readonly string[]
  intervalMs: number
}

function fromSpinner(spinner: Spinner): IndicatorDef {
  return {
    frames: spinner.frames,
    intervalMs: spinner.interval,
  }
}

const THINKING_DEF = fromSpinner(spinners.waverows)
const TOOL_DEF = fromSpinner(spinners.pulse)
const STREAMING_DEF = fromSpinner(spinners.rain)
const WORKING_DEF = fromSpinner(spinners.helix)
const MESSAGE_REFRESH_INTERVAL_MS = 1_000

function formatElapsed(ms: number): string {
  let seconds = Math.max(0, Math.floor(ms / 1_000))
  const parts: string[] = []
  const hours = Math.floor(seconds / 3_600)
  seconds -= hours * 3_600
  const minutes = Math.floor(seconds / 60)
  seconds -= minutes * 60

  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return tokens.toString()
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

class StreamingWordCounter {
  private inWordByStream = new Map<string, boolean>()

  count(text: string, stream: string): number {
    let inWord = this.inWordByStream.get(stream) ?? false
    let count = 0

    for (const char of text) {
      if (/\s/.test(char)) {
        inWord = false
      } else if (!inWord) {
        count++
        inWord = true
      }
    }

    this.inWordByStream.set(stream, inWord)
    return count
  }

  reset() {
    this.inWordByStream.clear()
  }
}

// ── Phase state ─────────────────────────────────────────────────

type Phase = "idle" | "working" | "thinking" | "tool" | "streaming"

function colorize(
  def: IndicatorDef,
  colorFn: (s: string) => string
): WorkingIndicatorOptions {
  return {
    frames: def.frames.map(colorFn),
    intervalMs: def.intervalMs,
  }
}

export default function (pi: ExtensionAPI) {
  let enabled = true
  let isThinking = false
  let isToolRunning = false
  let isStreaming = false
  let currentPhase: Phase = "idle"
  let activeContext: ExtensionContext | undefined
  let startedAt = 0
  let completedOutputTokens = 0
  let liveOutputTokens = 0
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  const wordCounter = new StreamingWordCounter()

  // Colored indicators — built on session_start with theme accent
  let THINKING: WorkingIndicatorOptions
  let TOOL: WorkingIndicatorOptions
  let STREAMING: WorkingIndicatorOptions
  let WORKING: WorkingIndicatorOptions

  function buildIndicators(ctx: ExtensionContext) {
    const accent = (s: string) => ctx.ui.theme.fg("accent", s)
    THINKING = colorize(THINKING_DEF, accent)
    TOOL = colorize(TOOL_DEF, accent)
    STREAMING = colorize(STREAMING_DEF, accent)
    WORKING = colorize(WORKING_DEF, accent)
  }

  function indicatorForPhase(phase: Phase): WorkingIndicatorOptions {
    switch (phase) {
      case "thinking":
        return THINKING
      case "tool":
        return TOOL
      case "streaming":
        return STREAMING
      default:
        return WORKING
    }
  }

  function resolvePhase(): Phase {
    if (isThinking) return "thinking"
    if (isToolRunning) return "tool"
    if (isStreaming) return "streaming"
    return "working"
  }

  function applyPhase(ctx: ExtensionContext) {
    if (!enabled) return
    const phase = resolvePhase()
    if (phase === currentPhase) return
    currentPhase = phase
    ctx.ui.setWorkingIndicator(indicatorForPhase(phase))
  }

  function refreshWorkingMessage() {
    if (!enabled || !activeContext || !startedAt) return
    const elapsed = formatElapsed(Date.now() - startedAt)
    const tokens = formatTokens(completedOutputTokens + liveOutputTokens)
    activeContext.ui.setWorkingMessage(
      `Working… (${elapsed} · ↓ ${tokens} tokens)`
    )
  }

  function startRefreshTimer() {
    if (refreshTimer) return
    refreshTimer = setInterval(
      refreshWorkingMessage,
      MESSAGE_REFRESH_INTERVAL_MS
    )
  }

  function stopRefreshTimer() {
    if (!refreshTimer) return
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }

  function resetTurn(now: number) {
    startedAt = now
    completedOutputTokens = 0
    liveOutputTokens = 0
    wordCounter.reset()
  }

  // ── Events ──────────────────────────────────────────────────

  pi.on("session_start", async (_e, ctx) => {
    buildIndicators(ctx)
  })

  pi.on("input", async (_e, ctx) => {
    activeContext = ctx
    resetTurn(Date.now())
  })

  pi.on("agent_start", async (_e, ctx) => {
    activeContext = ctx
    if (!startedAt) resetTurn(Date.now())
    isThinking = false
    isToolRunning = false
    isStreaming = false
    currentPhase = "idle"
    applyPhase(ctx)
    startRefreshTimer()
    refreshWorkingMessage()
  })

  pi.on("agent_end", async (_e, ctx) => {
    stopRefreshTimer()
    isThinking = false
    isToolRunning = false
    isStreaming = false
    currentPhase = "idle"
    startedAt = 0
    liveOutputTokens = 0
    wordCounter.reset()
    ctx.ui.setWorkingIndicator()
    ctx.ui.setWorkingMessage()
    activeContext = undefined
  })

  pi.on("message_update", async (event, ctx) => {
    activeContext = ctx
    const se = event.assistantMessageEvent as {
      type: string
      delta?: string
    }
    if (!se?.type) return

    if (se.type === "thinking_start" || se.type === "thinking_delta") {
      isThinking = true
    } else if (se.type === "thinking_end") {
      isThinking = false
    } else if (se.type === "text_delta") {
      isThinking = false
      isStreaming = true
    }

    if (
      (se.type === "thinking_delta" || se.type === "text_delta") &&
      se.delta
    ) {
      liveOutputTokens += wordCounter.count(se.delta, se.type)
      refreshWorkingMessage()
    }

    applyPhase(ctx)
  })

  pi.on("message_end", async (event, ctx) => {
    activeContext = ctx
    if (event.message.role === "assistant") {
      completedOutputTokens += event.message.usage?.output ?? liveOutputTokens
      liveOutputTokens = 0
      wordCounter.reset()
      refreshWorkingMessage()
    }
    isThinking = false
    isStreaming = false
  })

  pi.on("tool_execution_start", async (_e, ctx) => {
    activeContext = ctx
    isToolRunning = true
    applyPhase(ctx)
  })

  pi.on("tool_execution_end", async (_e, ctx) => {
    activeContext = ctx
    isToolRunning = false
    applyPhase(ctx)
  })

  pi.on("session_shutdown", async () => stopRefreshTimer())

  // ── Command ─────────────────────────────────────────────────

  pi.registerCommand("working-indicator", {
    description: "Phase-aware working indicator: on/off",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase()

      if (arg === "off") {
        enabled = false
        ctx.ui.setWorkingIndicator()
        ctx.ui.setWorkingMessage()
        ctx.ui.notify(
          "Working indicator: default (phase-aware disabled)",
          "info"
        )
        return
      }

      if (arg === "on") {
        enabled = true
        currentPhase = "idle"
        activeContext = ctx
        applyPhase(ctx)
        refreshWorkingMessage()
        ctx.ui.notify("Working indicator: phase-aware enabled", "info")
        return
      }

      const status = enabled
        ? `Phase-aware enabled — current: ${currentPhase}`
        : "Phase-aware disabled (using pi default)"
      ctx.ui.notify(`Working indicator: ${status}`, "info")
    },
  })
}
