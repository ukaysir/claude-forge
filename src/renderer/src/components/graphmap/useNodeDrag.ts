// Grab-and-spring interaction for the GraphMAP canvas. Any node can be dragged
// anywhere; on release it eases back to its layout home via a critically-damped
// spring. Displaced nodes live in `overrides` (the rest render from `layout`); we
// keep state in refs and bump a tick so the rAF loop never reallocates Maps. Kept
// out of GraphMapView so the view stays focused on rendering. Coordinates are in
// content space (the caller undoes the pan/zoom transform before handing points in).
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Pos } from './layout'

type GraphNode = import('../../../../main/codegraph').GraphNode

const SPRING_K = 0.16 // stiffness
const SPRING_D = 0.74 // damping
const SETTLE = 0.25 // distance + speed below which a spring stops
const MOVE_EPS = 1.5 // content units a node must travel before a press counts as a drag

export interface NodeDrag {
  /** Live position of a node: its override if displaced, else its layout home. */
  posOf(id: string): Pos | undefined
  /** True while a node is grabbed or mid-spring (drives the grabbed styling). */
  isHeld(id: string): boolean
  /** True while a node (not the canvas) is being dragged. */
  dragging(): boolean
  /** Begin dragging `node`, grabbed at content point `grab`. */
  begin(node: GraphNode, grab: Pos): void
  /** Update the grabbed node to follow content point `point`. */
  move(point: Pos): void
  /** End the drag. Returns the node + whether it actually moved (so the caller can
   *  treat a no-move press as a click); a real drag springs back automatically. */
  end(): { node: GraphNode; moved: boolean } | null
}

export function useNodeDrag(layout: Map<string, Pos>): NodeDrag {
  const [, bump] = useReducer((c: number) => (c + 1) % 1_000_000, 0)
  const overrides = useRef<Map<string, Pos>>(new Map())
  const springs = useRef<Map<string, { vx: number; vy: number }>>(new Map())
  const raf = useRef<number | null>(null)
  const grab = useRef<{ id: string; node: GraphNode; offX: number; offY: number; moved: boolean } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // A fresh layout (new directory/file view) drops any in-flight drag or spring.
  useEffect(() => {
    overrides.current.clear()
    springs.current.clear()
    grab.current = null
    if (raf.current != null) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
    bump()
  }, [layout])

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current)
    },
    []
  )

  const tick = useCallback(() => {
    const lay = layoutRef.current
    const ov = overrides.current
    const sp = springs.current
    for (const [id, vel] of [...sp]) {
      const home = lay.get(id)
      const cur = ov.get(id)
      if (!home || !cur) {
        sp.delete(id)
        ov.delete(id)
        continue
      }
      vel.vx = (vel.vx + (home.x - cur.x) * SPRING_K) * SPRING_D
      vel.vy = (vel.vy + (home.y - cur.y) * SPRING_K) * SPRING_D
      const nx = cur.x + vel.vx
      const ny = cur.y + vel.vy
      if (Math.hypot(home.x - nx, home.y - ny) < SETTLE && Math.hypot(vel.vx, vel.vy) < SETTLE) {
        ov.delete(id)
        sp.delete(id)
      } else {
        ov.set(id, { x: nx, y: ny })
      }
    }
    bump()
    raf.current = sp.size > 0 ? requestAnimationFrame(tick) : null
  }, [])

  const posOf = useCallback(
    (id: string): Pos | undefined => overrides.current.get(id) ?? layout.get(id),
    [layout]
  )

  const begin = useCallback(
    (node: GraphNode, point: Pos): void => {
      const cur = overrides.current.get(node.id) ?? layoutRef.current.get(node.id)
      if (!cur) return
      springs.current.delete(node.id) // cancel any spring already easing this node
      grab.current = { id: node.id, node, offX: cur.x - point.x, offY: cur.y - point.y, moved: false }
    },
    []
  )

  const move = useCallback((point: Pos): void => {
    const g = grab.current
    if (!g) return
    const nx = point.x + g.offX
    const ny = point.y + g.offY
    const home = layoutRef.current.get(g.id)
    if (home && (Math.abs(nx - home.x) > MOVE_EPS || Math.abs(ny - home.y) > MOVE_EPS)) g.moved = true
    overrides.current.set(g.id, { x: nx, y: ny })
    bump()
  }, [])

  const end = useCallback((): { node: GraphNode; moved: boolean } | null => {
    const g = grab.current
    if (!g) return null
    grab.current = null
    if (g.moved) {
      springs.current.set(g.id, { vx: 0, vy: 0 })
      if (raf.current == null) raf.current = requestAnimationFrame(tick)
    } else {
      overrides.current.delete(g.id)
      bump()
    }
    return { node: g.node, moved: g.moved }
  }, [tick])

  const isHeld = useCallback((id: string): boolean => grab.current?.id === id || overrides.current.has(id), [])
  const dragging = useCallback((): boolean => grab.current != null, [])

  return { posOf, isHeld, dragging, begin, move, end }
}
