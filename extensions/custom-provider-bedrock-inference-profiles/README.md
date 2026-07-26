# custom-provider-bedrock-inference-profiles

Pi extension that registers Claude models backed by AWS Bedrock application inference profile ARNs.

Purpose: keep Pi's built-in Bedrock capability checks working by registering standard Bedrock model IDs, then swapping request `modelId` to configured inference profile ARN right before API call.

## Supported env vars

- `PI_BEDROCK_OPUS_4_5_INFERENCE_PROFILE_ARN`
- `PI_BEDROCK_OPUS_4_6_INFERENCE_PROFILE_ARN`
- `PI_BEDROCK_OPUS_4_7_INFERENCE_PROFILE_ARN`
- `PI_BEDROCK_SONNET_INFERENCE_PROFILE_ARN`
- `PI_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN`

Optional:

- `PI_BEDROCK_AWS_PROFILE` — fallback used when `AWS_PROFILE` is unset
- `PI_BEDROCK_INFERENCE_PROFILES_DEBUG=1`

Constraints:

- All configured inference profile ARNs must use same Bedrock region.
- Runtime endpoint is derived from configured inference profile ARN region, not hardcoded.

## Prerequisite: AWS credentials

The underlying AWS SDK client also needs standard AWS region/credential resolution to
succeed independently of the ARN-derived endpoint above (`~/.aws/config`, `~/.aws/credentials`,
or `AWS_PROFILE`/`AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY`). Without a resolvable region the
SDK throws `Region is missing` even when an inference profile ARN is configured. Set:

```bash
export AWS_DEFAULT_REGION=us-east-1  # or your inference profile's region
export AWS_REGION=us-east-1
```

## Thinking config

Use `/bedrock-inference-profile-config` to configure thinking for active Bedrock inference profile model.

Config persists to `~/.pi/agent/bedrock-thinking.json`.

Per-model support and defaults:

- Claude Haiku 4.5 — no config, extended thinking only, default budget `63999`, default effort `high`
- Claude Opus 4.5 — no config, extended thinking only, default budget `63999`, default effort `high`
- Claude Opus 4.6 — adaptive toggle + effort level, defaults: adaptive `false`, budget `63999`, effort `high`
- Claude Opus 4.7 — effort level only, always adaptive, defaults: adaptive `true`, budget `63999`, effort `high`
- Claude Sonnet 4.6 — adaptive toggle + effort level, defaults: adaptive `false`, budget `63999`, effort `medium`

NOTE: We override `max_tokens` to `64000` tokens for all thinking modes, including adaptive thinking. This keeps thinking headroom consistent and allows extended-thinking budgets up to `63999` tokens.

Extension also shows active thinking mode in footer status.

## What it handles

- model registration for Claude Opus, Sonnet, Haiku variants
- capability flags for reasoning, prompt caching, thinking signatures, interleaved thinking
- per-model thinking config loaded from persisted agent state
- footer status for active thinking mode
- payload rewriting from standard Bedrock model ID to ARN
- Bedrock runtime endpoint + signing region derived from inference profile ARN region
- Bedrock beta header tweaks for specific model families
