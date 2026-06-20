// Pure meta-prompt builder + guards for the "Upgrade prompt" feature (the ✨
// button in the Composer). NO electron/SDK imports → unit-testable
// (tsconfig.test.json) AND importable by the renderer, exactly like routing.ts
// ("single owner" of a pure policy). The SDK call that consumes this lives in
// src/main/agent/upgradeRunner.ts.
//
// Design is distilled from the techniques that demonstrably move output quality:
//  • Anthropic's Console prompt-improver — a dedicated chain-of-thought section,
//    clearer structure, grammar/clarity rewrite, explicit output format.
//    (https://claude.com/blog/prompt-improver)
//  • The CO-STAR framework — Context · Objective · Style · Tone · Audience ·
//    Response — Sheila Teo's GPT-4 prompt-engineering competition winner.
//  • Token-frugality (Forge's north star): never pad a prompt that's already
//    clear; only add structure that changes the model's output.

export type UpgradeMode = 'enhance' | 'structured' | 'concise'

export interface UpgradeModeInfo {
  id: UpgradeMode
  label: string
  hint: string
}

/** The three rewrite intents offered in the preview modal. */
export const UPGRADE_MODES: readonly UpgradeModeInfo[] = [
  {
    id: 'enhance',
    label: 'Enhance',
    hint: 'Clarify intent; add the missing context, constraints & success criteria'
  },
  {
    id: 'structured',
    label: 'Structured',
    hint: 'Rewrite into explicit CO-STAR sections (context · objective · format)'
  },
  {
    id: 'concise',
    label: 'Concise',
    hint: 'Tighten the wording — keep only what changes the result'
  }
]

const DEFAULT_MODE: UpgradeMode = 'enhance'

/** Coerce an arbitrary string to a known mode (defends the IPC boundary). */
export function normalizeMode(mode?: string | null): UpgradeMode {
  return UPGRADE_MODES.some((m) => m.id === mode) ? (mode as UpgradeMode) : DEFAULT_MODE
}

// A whole-line slash command (e.g. "/model opus", "/help", "/compact") — a
// control command, not a prompt to rewrite. Single line, reasonably short.
const SLASH_CMD = /^\/[a-z][\w-]*(\s.*)?$/i

/**
 * Whether a draft is worth upgrading: non-trivially short and not a bare
 * slash/REPL command (we never rewrite `/model`, `/help`, …). Pure → the button
 * uses it to enable/disable without a round-trip.
 */
export function canUpgrade(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (t.length < 3) return false
  if (!t.includes('\n') && t.length < 60 && SLASH_CMD.test(t)) return false
  return true
}

/**
 * Strip model framing from the rewrite so it drops straight into the composer:
 * remove a single wrapping code fence and a leading "Here's the improved
 * prompt:"-style preamble line. Conservative — it won't touch real content.
 */
export function cleanUpgradeOutput(raw: string | null | undefined): string {
  let s = (raw ?? '').trim()
  // Unwrap a single fenced block: ```[lang]\n …\n```
  const fence = s.match(/^```[\w-]*\n([\s\S]*?)\n?```$/)
  if (fence) s = fence[1].trim()
  // Drop a leading meta line like "Here is the improved prompt:" / "Improved prompt:"
  const nl = s.indexOf('\n')
  const firstLine = (nl === -1 ? s : s.slice(0, nl)).trim()
  if (/^(here'?s|here is|improved prompt|upgraded prompt|sure[,!]?)[^\n]{0,60}:$/i.test(firstLine)) {
    s = nl === -1 ? '' : s.slice(nl + 1).trim()
  }
  // Unwrap a fully surrounding pair of quotes the model sometimes adds.
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === '“' && s[s.length - 1] === '”'))) {
    const inner = s.slice(1, -1)
    if (!inner.includes('"') && !inner.includes('“')) s = inner.trim()
  }
  return s
}

// ── word-level diff (for the before/after preview) ──────────────────────────

export interface DiffSeg {
  type: 'same' | 'add' | 'del'
  value: string
}

// Tokenize into words and whitespace runs so the diff aligns on word boundaries
// while preserving the original spacing/newlines when re-rendered.
function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? []
}

/**
 * Word-level diff via LCS. Returns ordered segments (same / add / del) suitable
 * for a unified before→after preview. Pure + cheap; the caller caps input size.
 */
export function diffWords(before: string, after: string): DiffSeg[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const n = a.length
  const m = b.length
  // LCS length table (suffix DP).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const segs: DiffSeg[] = []
  const push = (type: DiffSeg['type'], value: string): void => {
    const last = segs[segs.length - 1]
    if (last && last.type === type) last.value += value
    else segs.push({ type, value })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return segs
}

// ── meta-prompt (the system + user messages sent to the model) ──────────────

const BASE_META = `You are an expert prompt engineer. Rewrite the user's DRAFT prompt so an AI assistant produces a markedly better result. You are improving the PROMPT itself — never answer, execute, or fulfil it.

Apply proven prompt-engineering techniques (Anthropic's prompt-improver + the CO-STAR framework), but only where they raise output quality:
- Make the objective explicit and unambiguous; surface the success criteria and constraints the user implied.
- Add the context the assistant needs: the role to adopt, the audience, and any background the draft clearly assumes.
- Specify the desired output format/structure when it matters.
- For reasoning- or code-heavy tasks, tell the assistant to think step by step before answering.
- Fix grammar and spelling; tighten vague wording.

HARD RULES (do not break):
1. Preserve the user's original intent. Keep every concrete detail they gave — file names, code, numbers, URLs, identifiers — verbatim. NEVER invent facts, requirements, or constraints they did not state; if information is missing, instruct the assistant to ask or to state its assumptions rather than fabricating it.
2. Reply in the SAME language as the draft.
3. Preserve any trailing directives, magic keywords, or slash commands (e.g. "ralph", "ultrathink", "/goal") exactly as written.
4. Do not pad. If the draft is already clear, improve it lightly — a good short prompt stays short. Brevity over bloat.
5. Output ONLY the rewritten prompt as plain text: no preamble, no commentary, no surrounding code fences or quotes.`

const MODE_TAIL: Record<UpgradeMode, string> = {
  enhance:
    '\n\nMODE — Enhance: clarify the intent and fill in the missing context, constraints, and success criteria while keeping the user’s overall shape.',
  structured:
    '\n\nMODE — Structured: reorganize into clearly labelled sections following CO-STAR (Context, Objective, Style/Tone, Audience, Response format). Use short headers or XML-style tags; keep it scannable.',
  concise:
    '\n\nMODE — Concise: make it as short and precise as possible. Remove filler and redundancy; keep only words that change the assistant’s output.'
}

/** The system prompt for a given rewrite mode. */
export function buildUpgradeMeta(mode?: string | null): string {
  return BASE_META + MODE_TAIL[normalizeMode(mode)]
}

/** The user message wrapping the draft to rewrite. */
export function buildUpgradeUserMessage(original: string): string {
  return `Here is the DRAFT prompt to rewrite. Output only the improved version.\n\n<draft>\n${original}\n</draft>`
}
