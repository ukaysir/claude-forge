// The GRAPHMAP tab — a visual, human-facing map of a project's code, read straight
// from its codegraph index (.codegraph/codegraph.db) via the main process. Two
// altitudes: a directory dependency map (default) you can drill into a file-level
// map, then into a file's symbols. Dependency-free: the force-directed layout and
// the pan/zoom SVG canvas are hand-rolled so the whole thing rides the app's design
// tokens and ships no new packages (matching Forge's local-first, low-dep ethos).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type WheelEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import Icon from '../Icon'
import { loadJson, saveJson } from '../../lib/storage'
import {
  CANVAS_W,
  CANVAS_H,
  FRAME_CX,
  FRAME_CY,
  FRAME_R,
  EDGE_KINDS,
  computeLayout,
  radiusOf,
  type EdgeKind,
  type Pos
} from './layout'
import { useNodeDrag } from './useNodeDrag'

type GraphStatus = import('../../../../main/codegraph').GraphStatus
type GraphData = import('../../../../main/codegraph').GraphData
type GraphNode = import('../../../../main/codegraph').GraphNode
type SymbolRow = import('../../../../main/codegraph').SymbolRow
type SearchHit = import('../../../../main/codegraph').SearchHit

const ROOT_KEY = 'forge-graphmap-root'

export default function GraphMapView({
  active,
  chatFolder
}: {
  active: boolean
  chatFolder?: string
}): JSX.Element {
  const [root, setRoot] = useState<string | null>(() => loadJson<string | null>(ROOT_KEY, null))
  const [status, setStatus] = useState<GraphStatus | null>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<string | undefined>(undefined) // drilled directory
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [symbols, setSymbols] = useState<SymbolRow[] | null>(null)
  const [kinds, setKinds] = useState<Set<EdgeKind>>(() => new Set(EDGE_KINDS))
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  // Pan/zoom transform applied to the SVG content group.
  const [tf, setTf] = useState({ k: 1, x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const persistRoot = useCallback((r: string | null) => {
    setRoot(r)
    saveJson(ROOT_KEY, r)
  }, [])

  const loadStatus = useCallback(async (r: string) => {
    try {
      const s = await window.forge.graphmap.status(r)
      setStatus(s)
      return s
    } catch {
      setStatus(null)
      return null
    }
  }, [])

  const loadOverview = useCallback(async (r: string, opts: { level: 'dir' | 'file'; scope?: string }) => {
    setLoading(true)
    try {
      const d = await window.forge.graphmap.overview(r, opts)
      setData(d)
      setScope(opts.level === 'file' ? opts.scope : undefined)
      setSelected(null)
      setSymbols(null)
      setTf({ k: 1, x: 0, y: 0 })
    } finally {
      setLoading(false)
    }
  }, [])

  // Load when the tab becomes active or the root changes.
  useEffect(() => {
    if (!active || !root) return
    void (async () => {
      const s = await loadStatus(root)
      if (s?.hasIndex && s.available) await loadOverview(root, { level: 'dir' })
      else setData(null)
    })()
  }, [active, root, loadStatus, loadOverview])

  // Debounced symbol search.
  useEffect(() => {
    if (!root || !query.trim()) {
      setHits([])
      return
    }
    const id = setTimeout(() => {
      window.forge.graphmap
        .search(root, query)
        .then(setHits)
        .catch(() => setHits([]))
    }, 200)
    return () => clearTimeout(id)
  }, [query, root])

  const layout = useMemo(
    () => (data ? computeLayout(data.nodes, data.edges) : new Map<string, Pos>()),
    [data]
  )
  // Grab-and-spring interaction (drag a node, it eases back home on release).
  const nodes = useNodeDrag(layout)

  const visibleEdges = useMemo(
    () =>
      (data?.edges ?? []).filter((e) =>
        e.kinds.split(',').some((kRaw) => kinds.has(kRaw as EdgeKind))
      ),
    [data, kinds]
  )

  const maxWeight = useMemo(
    () => visibleEdges.reduce((m, e) => Math.max(m, e.weight), 1),
    [visibleEdges]
  )

  async function pickFolder(): Promise<void> {
    const dir = await window.forge.dialog.pickFolder()
    if (dir) persistRoot(dir)
  }

  function onNodeClick(node: GraphNode): void {
    if (!root) return
    if (node.kind === 'dir') {
      void loadOverview(root, { level: 'file', scope: node.id })
    } else {
      setSelected(node)
      setSymbols(null)
      window.forge.graphmap
        .symbols(root, node.id)
        .then(setSymbols)
        .catch(() => setSymbols([]))
    }
  }

  function backToDirs(): void {
    if (root) void loadOverview(root, { level: 'dir' })
  }

  function openHit(hit: SearchHit): void {
    if (!root) return
    setQuery('')
    setHits([])
    // Drill to the file's directory, then select the file + show its symbols.
    const fileNode: GraphNode = { id: hit.file, label: hit.file, kind: 'file', size: 0 }
    const dir = hit.file.split('/').slice(0, 2).join('/')
    void loadOverview(root, { level: 'file', scope: dir }).then(() => {
      setSelected(fileNode)
      window.forge.graphmap
        .symbols(root, hit.file)
        .then(setSymbols)
        .catch(() => setSymbols([]))
    })
  }

  // ── pan / zoom ──
  function clientToSvg(clientX: number, clientY: number): Pos {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H
    }
  }
  // Client pixel -> content-space coords (undo the pan/zoom group transform), so a
  // grabbed node tracks the cursor 1:1 regardless of zoom.
  function clientToContent(clientX: number, clientY: number): Pos {
    const s = clientToSvg(clientX, clientY)
    return { x: (s.x - tf.x) / tf.k, y: (s.y - tf.y) / tf.k }
  }
  function onWheel(e: WheelEvent<SVGSVGElement>): void {
    const dir = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setTf((cur) => {
      const k = Math.min(6, Math.max(0.3, cur.k * dir))
      const sp = clientToSvg(e.clientX, e.clientY)
      return {
        k,
        x: sp.x - (sp.x - cur.x) * (k / cur.k),
        y: sp.y - (sp.y - cur.y) * (k / cur.k)
      }
    })
  }
  // Background press -> pan the whole canvas.
  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y }
  }
  // Node press -> grab that node (stops the background pan via stopPropagation).
  function onNodePointerDown(e: ReactPointerEvent<SVGGElement>, nd: GraphNode): void {
    if (e.button !== 0) return
    e.stopPropagation()
    svgRef.current?.setPointerCapture?.(e.pointerId)
    nodes.begin(nd, clientToContent(e.clientX, e.clientY))
  }
  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void {
    if (nodes.dragging()) {
      nodes.move(clientToContent(e.clientX, e.clientY))
      return
    }
    if (!drag.current) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = ((e.clientX - drag.current.x) / rect.width) * CANVAS_W
    const dy = ((e.clientY - drag.current.y) / rect.height) * CANVAS_H
    setTf((cur) => ({ ...cur, x: drag.current!.tx + dx, y: drag.current!.ty + dy }))
  }
  function endDrag(): void {
    const released = nodes.end()
    if (released) {
      // A press with no real drag is a click -> drill in; a real drag springs back.
      if (!released.moved) onNodeClick(released.node)
      return
    }
    drag.current = null
  }
  function resetView(): void {
    setTf({ k: 1, x: 0, y: 0 })
  }

  function toggleKind(k: EdgeKind): void {
    setKinds((cur) => {
      const next = new Set(cur)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next.size === 0 ? new Set(EDGE_KINDS) : next
    })
  }

  // ── render ──
  return (
    <div className="gm-root">
      <header className="gm-bar">
        <div className="gm-bar-title">
          <Icon name="graphmap" className="gm-bar-mark" />
          GraphMAP
          {status?.hasIndex && status.available && (
            <span className="gm-bar-sub">
              {status.nodeCount.toLocaleString()} symbols · {status.edgeCount.toLocaleString()} edges
            </span>
          )}
        </div>
        <div className="gm-bar-actions">
          {root && (
            <div className="gm-search">
              <Icon name="inspect" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a symbol"
                aria-label="Search symbols"
              />
              {hits.length > 0 && (
                <ul className="gm-hits" role="listbox">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button className="gm-hit" onClick={() => openHit(h)}>
                        <span className="gm-hit-name">{h.name}</span>
                        <span className="gm-hit-kind">{h.kind}</span>
                        <span className="gm-hit-file">{h.file}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button className="gm-folder" onClick={() => void pickFolder()} title={root ?? undefined}>
            <Icon name="folder" />
            <span className="gm-folder-label">{root ? folderName(root) : 'Choose folder'}</span>
          </button>
          {chatFolder && chatFolder !== root && (
            <button
              className="gm-folder ghosty"
              onClick={() => persistRoot(chatFolder)}
              title={`Use the active chat's working folder: ${chatFolder}`}
            >
              Use chat folder
            </button>
          )}
        </div>
      </header>

      {!root ? (
        <Empty
          icon="graphmap"
          title="Map a codebase"
          lines={[
            'Pick a project folder to visualize its structure as a graph.',
            'The folder needs a codegraph index. If it has none, run codegraph init in it first.'
          ]}
          cta={{ label: 'Choose folder', onClick: () => void pickFolder() }}
        />
      ) : status && !status.available ? (
        <Empty
          icon="graphmap"
          title="SQLite unavailable"
          lines={['This runtime cannot read the codegraph database, so the map cannot load.']}
        />
      ) : status && !status.hasIndex ? (
        <Empty
          icon="folder"
          title="No codegraph index here"
          lines={[
            `${root}`,
            'Build the index once, then reopen this tab:'
          ]}
          code="codegraph init"
          cta={{ label: 'Choose a different folder', onClick: () => void pickFolder() }}
        />
      ) : (
        <div className="gm-body">
          <div className="gm-canvas-wrap">
            <div className="gm-toolbar">
              <div className="gm-crumbs">
                <button className={`gm-crumb ${!scope ? 'on' : ''}`} onClick={backToDirs}>
                  Directories
                </button>
                {scope && (
                  <>
                    <span className="gm-crumb-sep">/</span>
                    <span className="gm-crumb on">{scope}</span>
                  </>
                )}
              </div>
              <div className="gm-filters">
                {EDGE_KINDS.map((k) => (
                  <button
                    key={k}
                    className={`gm-filter ${kinds.has(k) ? 'on' : ''}`}
                    onClick={() => toggleKind(k)}
                  >
                    {k}
                  </button>
                ))}
                <button className="gm-filter gm-reset" onClick={resetView} title="Reset view">
                  Reset
                </button>
              </div>
            </div>

            {loading ? (
              <div className="gm-loading">
                <span className="gm-spin" />
                Reading the graph…
              </div>
            ) : data && data.nodes.length > 0 ? (
              <svg
                ref={svgRef}
                className="gm-svg"
                viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                preserveAspectRatio="xMidYMid meet"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
              >
                <defs>
                  <marker
                    id="gm-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0 L10 5 L0 10 z" className="gm-arrow-head" />
                  </marker>
                </defs>
                <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
                  <circle
                    className="gm-frame"
                    cx={FRAME_CX}
                    cy={FRAME_CY}
                    r={FRAME_R + 14}
                  />
                  {visibleEdges.map((e, i) => {
                    const a = nodes.posOf(e.source)
                    const b = nodes.posOf(e.target)
                    if (!a || !b) return null
                    const sel =
                      selected && (selected.id === e.source || selected.id === e.target)
                    return (
                      <line
                        key={i}
                        className={`gm-edge ${sel ? 'sel' : ''}`}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        strokeWidth={0.6 + (e.weight / maxWeight) * 2.4}
                        markerEnd="url(#gm-arrow)"
                      />
                    )
                  })}
                  {data.nodes.map((nd) => {
                    const p = nodes.posOf(nd.id)
                    if (!p) return null
                    const r = radiusOf(nd.size, data.level)
                    const on = selected?.id === nd.id
                    const held = nodes.isHeld(nd.id)
                    return (
                      <g
                        key={nd.id}
                        className={`gm-node ${nd.kind} ${on ? 'on' : ''} ${held ? 'held' : ''}`}
                        transform={`translate(${p.x} ${p.y})`}
                        onPointerDown={(e) => onNodePointerDown(e, nd)}
                      >
                        <circle r={r} className="gm-node-dot" />
                        <text className="gm-node-label" y={r + 12}>
                          {nd.label}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            ) : (
              <Empty
                icon="graphmap"
                title="Nothing to show"
                lines={[
                  data?.truncated
                    ? 'This directory was too large to render in full.'
                    : 'No dependency edges were found at this level.'
                ]}
              />
            )}
            {data?.truncated && (
              <div className="gm-note">Showing the {data.nodes.length} most-connected files.</div>
            )}
          </div>

          {selected && selected.kind === 'file' && (
            <aside className="gm-detail">
              <div className="gm-detail-head">
                <Icon name="file" />
                <span className="gm-detail-path">{selected.id}</span>
                <button
                  className="gm-detail-x"
                  onClick={() => {
                    setSelected(null)
                    setSymbols(null)
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {symbols === null ? (
                <div className="gm-detail-loading">
                  <span className="gm-spin" />
                </div>
              ) : symbols.length === 0 ? (
                <p className="gm-detail-empty">No symbols indexed in this file.</p>
              ) : (
                <ul className="gm-symbols">
                  {symbols.map((s, i) => (
                    <li key={i} className="gm-symbol">
                      <span className="gm-symbol-head">
                        <span className={`gm-symbol-kind k-${s.kind}`}>{s.kind}</span>
                        <span className="gm-symbol-name">{s.name}</span>
                        {s.exported && <span className="gm-symbol-ex">export</span>}
                        <span className="gm-symbol-line">:{s.line}</span>
                      </span>
                      {s.signature && <code className="gm-symbol-sig">{s.signature}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function Empty({
  icon,
  title,
  lines,
  code,
  cta
}: {
  icon: 'graphmap' | 'folder'
  title: string
  lines: string[]
  code?: string
  cta?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="gm-empty">
      <Icon name={icon} className="gm-empty-mark" />
      <p className="gm-empty-title">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="gm-empty-line">
          {l}
        </p>
      ))}
      {code && <code className="gm-empty-code">{code}</code>}
      {cta && (
        <button className="gm-empty-cta" onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  )
}
