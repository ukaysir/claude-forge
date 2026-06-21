// Dependency-free force-directed layout + sizing for the GraphMAP canvas. Pure
// math, no DOM and no RNG (a circular seed makes every layout deterministic), so
// the same graph always settles into the same shape. Kept apart from the React
// view so the component stays focused on rendering + interaction.
type GraphNode = import('../../../../main/codegraph').GraphNode
type GraphEdge = import('../../../../main/codegraph').GraphEdge

export const CANVAS_W = 1000
export const CANVAS_H = 680

// The graph settles inside a circular frame centered on the canvas. computeLayout
// hard-clamps every node within FRAME_R of the center each step, so the cloud reads
// as a disc (the GraphMapView draws a faint ring at this radius to make it explicit).
export const FRAME_CX = CANVAS_W / 2
export const FRAME_CY = CANVAS_H / 2
export const FRAME_R = Math.min(CANVAS_W, CANVAS_H) * 0.46

export const EDGE_KINDS = ['calls', 'imports', 'references', 'instantiates', 'implements'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export interface Pos {
  x: number
  y: number
}

/** Fruchterman-Reingold-style force layout. O(n²) per step, fine for the capped
 *  node counts (directories: dozens; files: ≤350). Returns id → position. */
export function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Pos> {
  const n = nodes.length
  const out = new Map<string, Pos>()
  if (n === 0) return out
  const cx = FRAME_CX
  const cy = FRAME_CY
  const seedR = FRAME_R * 0.9
  const p = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / n
    return { x: cx + seedR * Math.cos(a), y: cy + seedR * Math.sin(a) }
  })
  if (n === 1) {
    out.set(nodes[0].id, { x: cx, y: cy })
    return out
  }
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]))
  const links = edges
    .map((e) => [idx.get(e.source), idx.get(e.target)] as const)
    .filter((l): l is readonly [number, number] => l[0] != null && l[1] != null && l[0] !== l[1])
  const area = CANVAS_W * CANVAS_H
  const k = Math.sqrt(area / n) * 0.55 // ideal edge length
  const ITER = 240
  for (let it = 0; it < ITER; it++) {
    const cool = 1 - it / ITER
    const disp = p.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i].x - p[j].x
        const dy = p[i].y - p[j].y
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        const rep = (k * k) / d
        const ux = dx / d
        const uy = dy / d
        disp[i].x += ux * rep
        disp[i].y += uy * rep
        disp[j].x -= ux * rep
        disp[j].y -= uy * rep
      }
    }
    for (const [a, b] of links) {
      const dx = p[a].x - p[b].x
      const dy = p[a].y - p[b].y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const att = (d * d) / k
      const ux = dx / d
      const uy = dy / d
      disp[a].x -= ux * att
      disp[a].y -= uy * att
      disp[b].x += ux * att
      disp[b].y += uy * att
    }
    const maxStep = 28 * cool + 2
    for (let i = 0; i < n; i++) {
      disp[i].x += (cx - p[i].x) * 0.012
      disp[i].y += (cy - p[i].y) * 0.012
      const d = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y) || 0.01
      const step = Math.min(d, maxStep)
      p[i].x += (disp[i].x / d) * step
      p[i].y += (disp[i].y / d) * step
      // Keep the cloud inside the circular frame: clamp to FRAME_R from center.
      const rx = p[i].x - cx
      const ry = p[i].y - cy
      const rd = Math.sqrt(rx * rx + ry * ry)
      if (rd > FRAME_R) {
        p[i].x = cx + (rx / rd) * FRAME_R
        p[i].y = cy + (ry / rd) * FRAME_R
      }
    }
  }
  nodes.forEach((nd, i) => out.set(nd.id, { x: p[i].x, y: p[i].y }))
  return out
}

/** Node radius from its weight (sqrt so area, not radius, tracks size). */
export function radiusOf(size: number, level: string): number {
  const base = level === 'dir' ? 11 : 7
  return base + Math.sqrt(Math.max(0, size)) * (level === 'dir' ? 2.6 : 1.4)
}
