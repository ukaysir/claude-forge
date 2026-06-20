// Unified monochrome line-icon set (docs/MAINTAINABILITY.md). One coherent
// family — uniform 24×24 grid, 1.75 stroke, `currentColor` — so every icon
// inherits the surrounding text color and stays perfectly on-theme. Replaces
// the old multicolor emoji (🧩 ⌨ 🪝 🔌 🤖 📦 ⚡ …) that ignored the palette.
import type { JSX, SVGProps } from 'react'

export type IconName =
  | 'chat'
  | 'squad'
  | 'extend'
  | 'skills'
  | 'commands'
  | 'hooks'
  | 'mcp'
  | 'agents'
  | 'plugins'
  | 'bolt'
  | 'tool'
  | 'guide'
  | 'cost'
  | 'theme'
  | 'thinking'
  | 'inspect'
  | 'upgrade'
  | 'target'
  | 'scale'
  | 'file'
  | 'pet'

const PATHS: Record<IconName, JSX.Element> = {
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  squad: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  extend: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  skills: (
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  ),
  commands: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  hooks: (
    <>
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </>
  ),
  mcp: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <line x1="12" y1="8" x2="12" y2="5" />
      <circle cx="12" cy="3.6" r="1.1" />
      <line x1="9" y1="12.5" x2="9" y2="14.5" />
      <line x1="15" y1="12.5" x2="15" y2="14.5" />
    </>
  ),
  plugins: (
    <>
      <path d="M12 2 20 7v10l-8 5-8-5V7z" />
      <path d="M4 7l8 5 8-5" />
      <line x1="12" y1="12" x2="12" y2="22" />
    </>
  ),
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  tool: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
  ),
  guide: (
    <>
      <path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" />
      <path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" />
    </>
  ),
  cost: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.6 9.2A2.6 2.6 0 0 0 12 7.7c-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.9 2.6 2-1.1 2-2.6 2a2.6 2.6 0 0 1-2.6-1.5" />
      <line x1="12" y1="6.2" x2="12" y2="17.8" />
    </>
  ),
  // A 4-point sparkle — the model's reasoning ("thinking"). Concave star drawn
  // with quadratic curves so it reads as a single clean glyph in the line family.
  thinking: (
    <path d="M12 3 Q12.6 9.4 18 12 Q12.6 14.6 12 21 Q11.4 14.6 6 12 Q11.4 9.4 12 3 Z" />
  ),
  // Artist palette + paint wells — recolor the app (Theme tab).
  theme: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18 2.4 2.4 0 0 0 2.4-2.4c0-.6-.2-1.1-.6-1.5-.4-.4-.6-.9-.6-1.5a2 2 0 0 1 2-2H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8z" />
      <circle cx="7.5" cy="11.5" r="0.6" />
      <circle cx="9.5" cy="7.5" r="0.6" />
      <circle cx="14.5" cy="7.5" r="0.6" />
    </>
  ),
  // Magnifier — inspect / debug a run.
  inspect: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="20.5" y1="20.5" x2="16.65" y2="16.65" />
    </>
  ),
  // Double sparkle — AI prompt upgrade. A large concave 4-point star plus a small
  // twinkle, distinct from the single `thinking` sparkle. Same quadratic-curve
  // construction so it reads as one clean glyph in the line family.
  upgrade: (
    <>
      <path d="M10 5 Q10.5 11 15.5 13 Q10.5 15 10 21 Q9.5 15 4.5 13 Q9.5 11 10 5 Z" />
      <path d="M17.5 3.5 Q17.7 5.8 20 6.2 Q17.7 6.6 17.5 9 Q17.3 6.6 15 6.2 Q17.3 5.8 17.5 3.5 Z" />
    </>
  ),
  // Concentric target — an autonomous goal/objective (the RALPH goal loop).
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" />
    </>
  ),
  // Balance scale — verification by an LLM rubric judge.
  scale: (
    <>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="8" y1="20" x2="16" y2="20" />
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M4 7 1.5 13 6.5 13Z" />
      <path d="M20 7 17.5 13 22.5 13Z" />
    </>
  ),
  // Document with folded corner — an attached text/code file.
  file: (
    <>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19" />
      <line x1="8.5" y1="13" x2="15.5" y2="13" />
      <line x1="8.5" y1="16.5" x2="13" y2="16.5" />
    </>
  ),
  // Paw print — the optional desktop pet (Clawd) toggle.
  pet: (
    <>
      <ellipse cx="12" cy="15.5" rx="3.6" ry="3" />
      <circle cx="6.6" cy="11" r="1.7" />
      <circle cx="10" cy="7.2" r="1.7" />
      <circle cx="14" cy="7.2" r="1.7" />
      <circle cx="17.4" cy="11" r="1.7" />
    </>
  )
}

/** Inline mono icon. Sizes to `1em`; color follows `currentColor`. */
export default function Icon({
  name,
  className,
  ...rest
}: { name: IconName; className?: string } & SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      className={'icon' + (className ? ' ' + className : '')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
