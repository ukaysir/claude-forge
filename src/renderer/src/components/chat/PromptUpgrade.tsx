// The Upgrade button + preview/diff modal. Sends the composer draft to a single
// read-only model call (window.forge.agent.upgradePrompt) and shows the rewrite
// as a unified word-diff. NOTHING is applied until the user clicks "Apply" — the
// draft is never silently overwritten, and applying only fills the composer (the
// user still presses Send). Mode tabs (Enhance / Structured / Concise) re-run
// against the SAME original draft for an honest comparison. Pure guards/diff/mode
// list come from the main promptUpgrade module (imported as values, like routing).
//
// Design follows docs/DESIGN.md + the design-taste skill: a line icon (no emoji),
// token-driven colors, the eight interactive states, no em dashes in copy.
import { useCallback, useState, type JSX } from 'react'
import { canUpgrade, diffWords, UPGRADE_MODES, type UpgradeMode } from '../../../../main/promptUpgrade'
import Icon from '../Icon'

type UpgradeResult = Awaited<ReturnType<typeof window.forge.agent.upgradePrompt>>

// Word-diff is O(n·m); skip it for very large drafts and just show the rewrite.
const MAX_DIFF_CHARS = 8000

export default function PromptUpgrade({
  text,
  model,
  disabled,
  onAccept
}: {
  /** The current composer draft. */
  text: string
  /** The conversation's selected model (the upgrade follows it). */
  model: string
  /** Disable while a run is streaming. */
  disabled?: boolean
  /** Apply the chosen rewrite to the composer (text only; never sends). */
  onAccept: (next: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<UpgradeMode>('enhance')
  const [result, setResult] = useState<UpgradeResult | null>(null)

  const run = useCallback(
    async (m: UpgradeMode, draft: string): Promise<void> => {
      setLoading(true)
      setError(null)
      setMode(m)
      setOpen(true)
      try {
        setResult(await window.forge.agent.upgradePrompt(draft, model, m))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [model]
  )

  const enabled = !disabled && canUpgrade(text)

  function close(): void {
    setOpen(false)
    setResult(null)
    setError(null)
  }
  function accept(): void {
    if (result?.upgraded) onAccept(result.upgraded)
    close()
  }
  // Re-run a mode against the original draft we opened with (not the live composer
  // text) so switching modes compares the same starting point.
  function reRun(m: UpgradeMode): void {
    if (loading) return
    void run(m, result?.original ?? text)
  }

  const changed = !!result && result.upgraded.trim() !== result.original.trim()
  const tooBig =
    !!result && (result.original.length > MAX_DIFF_CHARS || result.upgraded.length > MAX_DIFF_CHARS)

  return (
    <>
      <button
        type="button"
        className="pu-btn"
        title={
          enabled
            ? 'Upgrade this prompt with AI; preview the changes before applying'
            : 'Type a prompt to upgrade'
        }
        disabled={!enabled || loading}
        onClick={() => void run('enhance', text)}
      >
        {loading && !open ? <span className="pu-spin" aria-hidden /> : <Icon name="upgrade" />}
        Upgrade
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal pu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title pu-title">
              <Icon name="upgrade" /> UPGRADE PROMPT
            </div>

            <div className="pu-modes" role="tablist" aria-label="Upgrade style">
              {UPGRADE_MODES.map((mInfo) => (
                <button
                  key={mInfo.id}
                  type="button"
                  role="tab"
                  className={`pu-mode ${mode === mInfo.id ? 'on' : ''}`}
                  title={mInfo.hint}
                  disabled={loading}
                  aria-selected={mode === mInfo.id}
                  onClick={() => reRun(mInfo.id)}
                >
                  {mInfo.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="pu-loading">
                <span className="pu-spin" aria-hidden /> Upgrading your prompt…
              </div>
            ) : error ? (
              <div className="pu-error">Upgrade failed: {error}</div>
            ) : result ? (
              <>
                <div className="pu-diff" aria-label="Upgraded prompt preview">
                  {tooBig ? (
                    <span className="pu-after">{result.upgraded}</span>
                  ) : (
                    diffWords(result.original, result.upgraded).map((seg, i) =>
                      seg.type === 'same' ? (
                        <span key={i}>{seg.value}</span>
                      ) : seg.type === 'add' ? (
                        <ins key={i} className="pu-add">
                          {seg.value}
                        </ins>
                      ) : (
                        <del key={i} className="pu-del">
                          {seg.value}
                        </del>
                      )
                    )
                  )}
                </div>
                <div className="pu-meta">
                  {changed ? (
                    <span className="pu-legend">
                      <span className="pu-leg pu-leg-add">added</span>
                      <span className="pu-leg pu-leg-del">removed</span>
                    </span>
                  ) : (
                    <span className="pu-nochange">
                      No changes suggested. Your prompt is already clear.
                    </span>
                  )}
                  {result.costUsd > 0 && (
                    <span className="pu-cost">${result.costUsd.toFixed(4)}</span>
                  )}
                </div>
              </>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" className="mini-btn" disabled={loading} onClick={() => reRun(mode)}>
                Regenerate
              </button>
              <button type="button" className="primary" disabled={loading || !changed} onClick={accept}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
