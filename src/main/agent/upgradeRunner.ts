// Headless single-shot runner for the "Upgrade prompt" feature. Takes the user's
// draft and returns an improved rewrite + its cost. Mirrors subtaskRunner's SDK
// plumbing but is purpose-built for a pure text transform:
//   • a REPLACED system prompt (the meta-prompt) instead of the claude_code
//     preset — leaner, no coding-agent framing for a one-shot rewrite;
//   • ALL tools denied — the rewrite is deterministic and can never spend tokens
//     on Read/WebSearch or touch the workspace;
//   • maxTurns: 1 — it answers in a single turn.
// The meta-prompt + output cleaning are the pure (testable) promptUpgrade module.

import { buildEnv, ensureWorkspace, SETTING_SOURCES } from './env'
import {
  buildUpgradeMeta,
  buildUpgradeUserMessage,
  cleanUpgradeOutput,
  normalizeMode,
  type UpgradeMode
} from '../promptUpgrade'

export interface UpgradeRunResult {
  /** The trimmed draft we were asked to improve. */
  original: string
  /** The improved prompt (falls back to the original if the model returns nothing). */
  upgraded: string
  /** Cost of the single rewrite call, in USD. */
  costUsd: number
  /** The concrete model that ran (from the SDK init event). */
  model: string
  /** The rewrite mode actually used. */
  mode: UpgradeMode
}

/**
 * Improve a draft prompt with one read-only, tool-free model call. Follows the
 * conversation's currently selected model (passed by the renderer); falls back
 * to 'sonnet' when none/`default`.
 */
export async function runUpgradePrompt(
  original: string,
  model?: string,
  mode?: string
): Promise<UpgradeRunResult> {
  const draft = (original ?? '').trim()
  const m = normalizeMode(mode)
  const runModel = model && model !== 'default' ? model : 'sonnet'
  if (!draft) return { original: draft, upgraded: '', costUsd: 0, model: runModel, mode: m }

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const env = await buildEnv()
  const cwd = await ensureWorkspace()

  const options: Record<string, unknown> = {
    env,
    cwd,
    model: runModel,
    maxTurns: 1,
    settingSources: [...SETTING_SOURCES],
    // 'default' routes tool uses through canUseTool — which denies everything, so
    // the model can only answer in text. Never bypassPermissions.
    permissionMode: 'default',
    systemPrompt: buildUpgradeMeta(m),
    canUseTool: async (): Promise<{ behavior: 'deny'; message: string }> => ({
      behavior: 'deny',
      message: 'Prompt upgrade is a text-only rewrite — tools are not available.'
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = query({ prompt: buildUpgradeUserMessage(draft), options } as any)
  let text = ''
  let costUsd = 0
  let resolvedModel = runModel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const msg of q as AsyncIterable<any>) {
    if (msg.type === 'system' && msg.subtype === 'init' && msg.model) {
      resolvedModel = msg.model
    } else if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'text' && b.text) text += b.text
      }
    } else if (msg.type === 'result') {
      costUsd = msg.total_cost_usd ?? 0
    }
  }

  const upgraded = cleanUpgradeOutput(text)
  return { original: draft, upgraded: upgraded || draft, costUsd, model: resolvedModel, mode: m }
}
