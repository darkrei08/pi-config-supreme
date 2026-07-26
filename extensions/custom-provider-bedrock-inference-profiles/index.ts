/**
 * AWS Bedrock Application Inference Profile Extension
 *
 * Works around the built-in Bedrock provider's model ID substring checks by
 * registering models with standard Bedrock model IDs (so capability checks for
 * adaptive thinking, prompt caching, thinking signatures, etc. all pass), then
 * swapping the modelId to the actual ARN via onPayload right before the API call.
 *
 * Set one or more env vars to register models:
 *   PI_BEDROCK_OPUS_4_5_INFERENCE_PROFILE_ARN=arn:aws:bedrock:region:account:application-inference-profile/<uuid>
 *   PI_BEDROCK_OPUS_4_6_INFERENCE_PROFILE_ARN=arn:aws:bedrock:region:account:application-inference-profile/<uuid>
 *   PI_BEDROCK_OPUS_4_7_INFERENCE_PROFILE_ARN=arn:aws:bedrock:region:account:application-inference-profile/<uuid>
 *   PI_BEDROCK_SONNET_INFERENCE_PROFILE_ARN=arn:aws:bedrock:region:account:application-inference-profile/<uuid>
 *   PI_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN=arn:aws:bedrock:region:account:application-inference-profile/<uuid>
 *
 * Thinking configuration via /bedrock-inference-profile-config command:
 *
 *   Haiku 4.5: no configuration (extended thinking, 63999 tokens)
 *   Opus 4.5: no configuration (extended thinking only, no adaptive support)
 *   Opus 4.6 / Sonnet 4.6: adaptive toggle + effort level
 *   Opus 4.7: effort level only (always adaptive)
 *
 * Config persisted to <agentDir>/bedrock-thinking.json
 *
 * Usage:
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-bedrock-inference-profiles
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Api,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  streamSimple,
} from "@mariozechner/pi-ai"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import {
  getAgentDir,
  getSettingsListTheme,
} from "@mariozechner/pi-coding-agent"
import { Container, type SettingItem, SettingsList } from "@mariozechner/pi-tui"

// =============================================================================
// Model Definitions
// =============================================================================

interface ProfileModel {
  /** Standard Bedrock model ID — ensures built-in capability checks pass */
  id: string
  name: string
  envVar: string
  reasoning: boolean
  input: ("text" | "image")[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
  /** Allowed effort levels for this model */
  effortLevels: EffortLevel[]
  /** Which config knobs are available for this model */
  configKnobs: ("adaptive" | "effort")[]
  /** Default thinking config for this model */
  defaultThinking: ThinkingConfig
}

type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

interface ThinkingConfig {
  adaptive: boolean
  budget: number
  effort: EffortLevel
}

interface InferenceProfileArn {
  partition: string
  region: string
}

const EXTENDED_THINKING_MAX_TOKENS = 64000

// =============================================================================
// Persistent Config
// =============================================================================

const CONFIG_DIR = getAgentDir()
const CONFIG_FILE = join(CONFIG_DIR, "bedrock-thinking.json")

interface PersistedConfig {
  [modelEnvPrefix: string]: {
    adaptive?: boolean
    effort?: EffortLevel
  }
}

function loadConfig(): PersistedConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as PersistedConfig
    }
  } catch {}
  return {}
}

function saveConfig(config: PersistedConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

const PROFILE_MODELS: ProfileModel[] = [
  {
    id: "anthropic.claude-opus-4-5-20251101-v1:0",
    name: "Claude Opus 4.5",
    envVar: "PI_BEDROCK_OPUS_4_5_INFERENCE_PROFILE_ARN",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 128000,
    effortLevels: [],
    configKnobs: [],
    defaultThinking: { adaptive: false, budget: 63999, effort: "high" },
  },
  {
    id: "anthropic.claude-opus-4-6-v1",
    name: "Claude Opus 4.6",
    envVar: "PI_BEDROCK_OPUS_4_6_INFERENCE_PROFILE_ARN",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1000000,
    maxTokens: 128000,
    effortLevels: ["low", "medium", "high", "max"],
    configKnobs: ["adaptive", "effort"],
    defaultThinking: { adaptive: false, budget: 63999, effort: "high" },
  },
  {
    id: "anthropic.claude-opus-4-7",
    name: "Claude Opus 4.7",
    envVar: "PI_BEDROCK_OPUS_4_7_INFERENCE_PROFILE_ARN",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1000000,
    maxTokens: 128000,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    configKnobs: ["effort"],
    defaultThinking: { adaptive: true, budget: 63999, effort: "high" },
  },
  {
    id: "anthropic.claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    envVar: "PI_BEDROCK_SONNET_INFERENCE_PROFILE_ARN",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1000000,
    maxTokens: 64000,
    effortLevels: ["low", "medium", "high", "max"],
    configKnobs: ["adaptive", "effort"],
    defaultThinking: { adaptive: false, budget: 63999, effort: "medium" },
  },
  {
    id: "anthropic.claude-haiku-4-5-20251001-v1:0",
    name: "Claude Haiku 4.5",
    envVar: "PI_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 64000,
    effortLevels: [],
    configKnobs: [],
    defaultThinking: { adaptive: false, budget: 63999, effort: "high" },
  },
]

// Map from model ID to the env var that holds its ARN
const MODEL_ENV_MAP = new Map(PROFILE_MODELS.map((m) => [m.id, m.envVar]))

function parseInferenceProfileArn(arn: string): InferenceProfileArn {
  const parts = arn.split(":", 6)
  if (parts.length < 6 || parts[0] !== "arn" || parts[2] !== "bedrock") {
    throw new Error(`Invalid Bedrock inference profile ARN: ${arn}`)
  }

  const partition = parts[1]
  const region = parts[3]
  const resource = parts[5]

  if (!region || !resource.startsWith("application-inference-profile/")) {
    throw new Error(`Invalid Bedrock inference profile ARN: ${arn}`)
  }

  return { partition, region }
}

function getBedrockDnsSuffix(partition: string): string {
  switch (partition) {
    case "aws":
    case "aws-us-gov":
      return "amazonaws.com"
    case "aws-cn":
      return "amazonaws.com.cn"
    default:
      throw new Error(`Unsupported AWS partition for Bedrock: ${partition}`)
  }
}

function getBedrockRuntimeBaseUrl(arn: string): string {
  const { partition, region } = parseInferenceProfileArn(arn)
  return `https://bedrock-runtime.${region}.${getBedrockDnsSuffix(partition)}`
}

// Map from model ID to resolved thinking config
const MODEL_THINKING_CONFIG = new Map<string, ThinkingConfig>()

/** Resolve thinking config for a model from persisted config + defaults */
function resolveThinkingConfig(model: ProfileModel): ThinkingConfig {
  const config = loadConfig()
  const persisted = config[model.id] ?? {}
  const { configKnobs, defaultThinking } = model

  const adaptive =
    configKnobs.includes("adaptive") && persisted.adaptive !== undefined
      ? persisted.adaptive
      : defaultThinking.adaptive
  const effort =
    configKnobs.includes("effort") && persisted.effort !== undefined
      ? persisted.effort
      : defaultThinking.effort

  return { adaptive, budget: defaultThinking.budget, effort }
}

/** Reload all thinking configs from disk */
function reloadThinkingConfigs(): void {
  for (const model of PROFILE_MODELS) {
    MODEL_THINKING_CONFIG.set(model.id, resolveThinkingConfig(model))
  }
}

// Initialize thinking configs for all models
reloadThinkingConfigs()

const DEBUG = process.env.PI_BEDROCK_INFERENCE_PROFILES_DEBUG === "1"
const TAG = "[bedrock-inference-profiles]"

// =============================================================================
// Capability Checks (mirrors amazon-bedrock.ts logic)
// =============================================================================

function isClaudeModel(modelId: string): boolean {
  return (
    modelId.includes("anthropic.claude") || modelId.includes("anthropic/claude")
  )
}

function checksAdaptiveThinking(modelId: string): boolean {
  return (
    modelId.includes("opus-4-6") ||
    modelId.includes("opus-4.6") ||
    modelId.includes("opus-4-7") ||
    modelId.includes("opus-4.7") ||
    modelId.includes("sonnet-4-6") ||
    modelId.includes("sonnet-4.6")
  )
}

function checksPromptCaching(model: ProfileModel): boolean {
  if (model.cost.cacheRead || model.cost.cacheWrite) return true
  const id = model.id.toLowerCase()
  if (id.includes("claude") && (id.includes("-4-") || id.includes("-4.")))
    return true
  if (id.includes("claude-3-7-sonnet")) return true
  if (id.includes("claude-3-5-haiku")) return true
  return false
}

function checksThinkingSignature(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id.includes("anthropic.claude") || id.includes("anthropic/claude")
}

function checksInterleavedThinking(modelId: string): boolean {
  // Interleaved thinking is enabled when Claude is detected but adaptive thinking is NOT supported
  return isClaudeModel(modelId) && !checksAdaptiveThinking(modelId)
}

function isOpus47(modelId: string): boolean {
  return modelId.includes("opus-4-7") || modelId.includes("opus-4.7")
}

function needsInterleavedThinkingBetaHeader(modelId: string): boolean {
  return modelId.includes("opus-4-5") || modelId.includes("opus-4.5")
}

function setPayloadMaxTokens(
  payload: Record<string, unknown>,
  maxTokens: number
): void {
  const inferenceConfig =
    (payload.inferenceConfig as Record<string, unknown> | undefined) ?? {}
  payload.inferenceConfig = {
    ...inferenceConfig,
    maxTokens,
  }
}

function usesFixed64kExtendedThinking(modelId: string): boolean {
  return (
    modelId.includes("opus-4-5") ||
    modelId.includes("opus-4.5") ||
    modelId.includes("opus-4-6") ||
    modelId.includes("opus-4.6") ||
    modelId.includes("sonnet-4-6") ||
    modelId.includes("sonnet-4.6")
  )
}

function toAnthropicBetaList(existing: unknown): string[] {
  return Array.isArray(existing)
    ? existing.filter((v): v is string => typeof v === "string")
    : typeof existing === "string"
      ? [existing]
      : []
}

function mergeAnthropicBeta(existing: unknown, beta: string): string[] {
  const values = toAnthropicBetaList(existing)
  return values.includes(beta) ? values : [...values, beta]
}

function removeAnthropicBetas(
  existing: unknown,
  betasToRemove: string[]
): string[] | undefined {
  const values = toAnthropicBetaList(existing).filter(
    (beta) => !betasToRemove.includes(beta)
  )
  return values.length > 0 ? values : undefined
}

function logCapabilityChecks(model: ProfileModel): void {
  const id = model.id
  const thinkingConfig = MODEL_THINKING_CONFIG.get(id)!
  console.log(`${TAG} ${model.name} (${id})`)
  console.log(`${TAG}   Claude detected:       ${isClaudeModel(id)}`)
  console.log(`${TAG}   Adaptive thinking:      ${checksAdaptiveThinking(id)}`)
  console.log(`${TAG}   Prompt caching:         ${checksPromptCaching(model)}`)
  console.log(`${TAG}   Thinking signature:     ${checksThinkingSignature(id)}`)
  console.log(
    `${TAG}   Interleaved thinking:   ${checksInterleavedThinking(id)}`
  )
  console.log(
    `${TAG}   Thinking config:        ${thinkingConfig.adaptive ? `adaptive (effort: ${thinkingConfig.effort})` : `extended (budget: ${thinkingConfig.budget})`}`
  )
}

// =============================================================================
// Stream Function
// =============================================================================

/**
 * Wraps the built-in Bedrock streaming by:
 * 1. Setting api to "bedrock-converse-stream" so the built-in provider handles the call
 * 2. Injecting an onPayload callback that replaces modelId with the actual ARN
 */
export function streamBedrockProfile(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()
  ;(async () => {
    try {
      const envVar = MODEL_ENV_MAP.get(model.id)
      if (!envVar) throw new Error(`Unknown model: ${model.id}`)

      const arn = process.env[envVar]
      if (!arn) throw new Error(`${envVar} is not set`)

      const { region } = parseInferenceProfileArn(arn)

      // Delegate to the built-in Bedrock provider by setting correct api +
      // endpoint for this inference profile's region.
      const delegateModel: Model<Api> = {
        ...model,
        api: "bedrock-converse-stream" as Api,
        baseUrl: getBedrockRuntimeBaseUrl(arn),
      }

      // Wrap onPayload to intercept, log, and replace modelId with the actual ARN
      const originalOnPayload = options?.onPayload
      const wrappedOptions: SimpleStreamOptions & { region: string } = {
        ...options,
        region,
        onPayload: (commandInput: unknown) => {
          const payload = commandInput as Record<string, unknown>
          const additional =
            (payload.additionalModelRequestFields as
              | Record<string, unknown>
              | undefined) ?? {}

          if (isOpus47(model.id)) {
            delete payload.temperature
            delete payload.top_p
            delete payload.topP
            delete payload.top_k
            delete payload.topK
            const anthropicBeta = removeAnthropicBetas(
              additional.anthropic_beta,
              [
                "interleaved-thinking-2025-05-14",
                "effort-2025-11-24",
                "fine-grained-tool-streaming-2025-05-14",
              ]
            )
            payload.additionalModelRequestFields = {
              ...additional,
              ...(anthropicBeta ? { anthropic_beta: anthropicBeta } : {}),
            }
            if (!anthropicBeta) {
              delete (
                payload.additionalModelRequestFields as Record<string, unknown>
              ).anthropic_beta
            }
          }

          if (options?.reasoning && isClaudeModel(model.id)) {
            const nextAdditional =
              (payload.additionalModelRequestFields as
                | Record<string, unknown>
                | undefined) ?? {}

            const thinkingConfig = MODEL_THINKING_CONFIG.get(model.id)
            if (!thinkingConfig) {
              throw new Error(`No thinking config for model: ${model.id}`)
            }

            if (thinkingConfig.adaptive) {
              // Adaptive thinking with configured effort. Keep max_tokens at 64k
              // so thinking output has same headroom as extended-thinking mode.
              setPayloadMaxTokens(payload, EXTENDED_THINKING_MAX_TOKENS)
              payload.additionalModelRequestFields = {
                ...nextAdditional,
                thinking: { type: "adaptive" },
                output_config: { effort: thinkingConfig.effort },
              }
            } else {
              // Extended thinking with configured budget, clamped below max_tokens
              const anthropicBeta = needsInterleavedThinkingBetaHeader(model.id)
                ? mergeAnthropicBeta(
                    nextAdditional.anthropic_beta,
                    "interleaved-thinking-2025-05-14"
                  )
                : nextAdditional.anthropic_beta
              const maxTokens = usesFixed64kExtendedThinking(model.id)
                ? EXTENDED_THINKING_MAX_TOKENS
                : model.maxTokens
              setPayloadMaxTokens(payload, maxTokens)
              const budgetTokens = Math.max(
                1,
                Math.min(thinkingConfig.budget, maxTokens - 1)
              )
              payload.additionalModelRequestFields = {
                ...nextAdditional,
                ...(anthropicBeta ? { anthropic_beta: anthropicBeta } : {}),
                thinking: {
                  type: "enabled",
                  budget_tokens: budgetTokens,
                },
              }
              delete (
                payload.additionalModelRequestFields as Record<string, unknown>
              ).output_config
            }
          }

          if (DEBUG) {
            const additional = payload.additionalModelRequestFields as
              | Record<string, unknown>
              | undefined
            console.log(`${TAG} onPayload intercepted:`)
            console.log(`${TAG}   modelId (before swap):   ${payload.modelId}`)
            console.log(`${TAG}   modelId (after swap):    ${arn}`)
            if (additional) {
              console.log(
                `${TAG}   thinking config:         ${JSON.stringify(additional.thinking)}`
              )
              if (additional.output_config) {
                console.log(
                  `${TAG}   output_config:           ${JSON.stringify(additional.output_config)}`
                )
              }
              if (additional.anthropic_beta) {
                console.log(
                  `${TAG}   anthropic_beta:          ${JSON.stringify(additional.anthropic_beta)}`
                )
              }
            } else {
              console.log(
                `${TAG}   thinking config:         (none — reasoning not requested)`
              )
            }

            // Check for cache points in system/messages
            const system = payload.system as unknown[] | undefined
            const hasCacheInSystem = system?.some(
              (b: any) => b.cachePoint !== undefined
            )
            const messages = payload.messages as unknown[] | undefined
            const lastMsg = messages?.[messages.length - 1] as
              | Record<string, unknown>
              | undefined
            const lastMsgContent = lastMsg?.content as unknown[] | undefined
            const hasCacheInMessages = lastMsgContent?.some(
              (b: any) => b.cachePoint !== undefined
            )
            console.log(
              `${TAG}   cache point (system):    ${!!hasCacheInSystem}`
            )
            console.log(
              `${TAG}   cache point (messages):  ${!!hasCacheInMessages}`
            )
          }

          payload.modelId = arn
          return originalOnPayload?.(commandInput)
        },
      }

      const innerStream = streamSimple(delegateModel, context, wrappedOptions)

      for await (const event of innerStream) stream.push(event)
      stream.end()
    } catch (error) {
      stream.push({
        type: "error",
        reason: "error",
        error: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        },
      })
      stream.end()
    }
  })()

  return stream
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
  // Apply default AWS profile if AWS_PROFILE is not explicitly set.
  // Set PI_BEDROCK_AWS_PROFILE in your shell rc / env to use a fixed profile
  // without having to export AWS_PROFILE every session.
  if (!process.env.AWS_PROFILE) {
    const fallback = process.env.PI_BEDROCK_AWS_PROFILE ?? "default"
    process.env.AWS_PROFILE = fallback
    if (DEBUG)
      console.log(`${TAG} AWS_PROFILE not set — using fallback: "${fallback}"`)
  }

  // Only register models whose ARN env var is set
  const configuredModels = PROFILE_MODELS.filter((m) => process.env[m.envVar])

  if (configuredModels.length === 0) {
    console.warn(
      "[bedrock-inference-profiles] No ARN env vars configured. Set PI_BEDROCK_OPUS_4_5_INFERENCE_PROFILE_ARN, PI_BEDROCK_OPUS_4_6_INFERENCE_PROFILE_ARN, PI_BEDROCK_OPUS_4_7_INFERENCE_PROFILE_ARN, PI_BEDROCK_SONNET_INFERENCE_PROFILE_ARN, or PI_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN."
    )
    return
  }

  let providerBaseUrl: string
  try {
    const configuredArns = configuredModels.map((m) => {
      const arn = process.env[m.envVar]
      if (!arn) {
        throw new Error(`${m.envVar} is not set`)
      }
      return arn
    })
    const configuredRegions = new Set(
      configuredArns.map((arn) => parseInferenceProfileArn(arn).region)
    )
    if (configuredRegions.size !== 1) {
      throw new Error(
        `Configured inference profiles span multiple regions: ${[...configuredRegions].sort().join(", ")}`
      )
    }
    providerBaseUrl = getBedrockRuntimeBaseUrl(configuredArns[0])
  } catch (error) {
    console.warn(
      `${TAG} ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }

  if (DEBUG) {
    console.log(`${TAG} Capability check results for synthetic model IDs:`)
    console.log(`${TAG}   provider endpoint:      ${providerBaseUrl}`)
    for (const m of configuredModels) {
      logCapabilityChecks(m)
      console.log(`${TAG}   ARN:                    ${process.env[m.envVar]}`)
    }
    console.log(
      `${TAG} Set PI_BEDROCK_INFERENCE_PROFILES_DEBUG=0 to suppress these logs.`
    )
  }

  pi.registerProvider("bedrock-inference-profiles", {
    baseUrl: providerBaseUrl,
    apiKey: "$AWS_PROFILE",
    api: "bedrock-inference-profiles-api" as Api,
    models: configuredModels.map(
      ({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({
        id,
        name,
        reasoning,
        input,
        cost,
        contextWindow,
        maxTokens,
      })
    ),
    streamSimple: streamBedrockProfile,
  })

  // =========================================================================
  // Footer status — show thinking mode for active model
  // =========================================================================

  function updateThinkingStatus(
    ctx: { ui: { setStatus(id: string, text: string | undefined): void } },
    modelId: string | undefined
  ): void {
    const model = configuredModels.find((m) => m.id === modelId)
    if (!model) {
      ctx.ui.setStatus("bedrock-thinking", undefined)
      return
    }
    const cfg = MODEL_THINKING_CONFIG.get(model.id)
    if (!cfg) {
      ctx.ui.setStatus("bedrock-thinking", undefined)
      return
    }
    const label = cfg.adaptive ? `adaptive:${cfg.effort}` : "extended-thinking"
    ctx.ui.setStatus("bedrock-thinking", label)
  }

  pi.on("model_select", async (event, ctx) => {
    updateThinkingStatus(ctx, event.model.id)
  })

  pi.on("session_start", async (_event, ctx) => {
    updateThinkingStatus(ctx, ctx.model?.id)
  })

  // =========================================================================
  // /bedrock-inference-profile-config — configure active model's thinking
  // =========================================================================

  pi.registerCommand("bedrock-inference-profile-config", {
    description: "Configure thinking for the active Bedrock model",
    handler: async (_args, ctx) => {
      const activeModelId = ctx.model?.id
      const model = configuredModels.find((m) => m.id === activeModelId)
      if (!model) {
        const current = activeModelId ?? "none"
        ctx.ui.notify(
          `Active model is not a Bedrock inference profile: ${current}`,
          "warn"
        )
        return
      }

      if (model.configKnobs.length === 0) {
        ctx.ui.notify(
          `${model.name} has no configurable thinking options`,
          "info"
        )
        return
      }

      reloadThinkingConfigs()
      const config = loadConfig()
      const thinkingConfig = MODEL_THINKING_CONFIG.get(model.id)!

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const items: SettingItem[] = []

        if (model.configKnobs.includes("adaptive")) {
          items.push({
            id: "adaptive",
            label: "Mode",
            currentValue: thinkingConfig.adaptive ? "adaptive" : "extended",
            values: ["extended", "adaptive"],
          })
        }

        if (model.configKnobs.includes("effort")) {
          items.push({
            id: "effort",
            label: "Effort",
            currentValue: thinkingConfig.effort,
            values: [...model.effortLevels],
          })
        }

        const container = new Container()
        container.addChild(
          new (class {
            render(_width: number) {
              return [theme.fg("accent", theme.bold(model.name)), ""]
            }
            invalidate() {}
          })()
        )

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 8),
          getSettingsListTheme(),
          (id, newValue) => {
            if (!config[model.id]) config[model.id] = {}

            if (id === "adaptive") {
              config[model.id].adaptive = newValue === "adaptive"
            } else if (id === "effort") {
              config[model.id].effort = newValue as EffortLevel
            }

            saveConfig(config)
            reloadThinkingConfigs()
          },
          () => done()
        )

        container.addChild(settingsList)

        return {
          render(width: number) {
            return container.render(width)
          },
          invalidate() {
            container.invalidate()
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data)
            tui.requestRender()
          },
        }
      })

      const updated = MODEL_THINKING_CONFIG.get(model.id)!
      const summary = updated.adaptive
        ? `adaptive (effort: ${updated.effort})`
        : `extended (budget: ${updated.budget})`
      ctx.ui.notify(`${model.name}: ${summary}`, "info")
      updateThinkingStatus(ctx, model.id)
    },
  })
}
