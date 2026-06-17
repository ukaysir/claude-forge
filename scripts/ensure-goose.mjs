// Build-time fetch of the goose binary into resources/ (docs/GOOSE_INTEGRATION.md
// §4). electron-builder then bundles resources/goose/** via extraResources, and
// src/main/goose/binary.ts resolves it at runtime under process.resourcesPath.
//
// Downloads the asset for the CURRENT platform/arch by default; pass a target
// triple dir to fetch another (e.g. `node scripts/ensure-goose.mjs win32-x64`).
// Idempotent: skips the download if the binary already exists, but ALWAYS
// (re)ensures the win32 runtime DLLs so a half-populated dir self-heals.

import { spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  copyFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { tag, host } = JSON.parse(readFileSync(join(root, 'scripts/goose-version.json'), 'utf8'))

// platform-arch dir (matches binary.ts) → goose release asset name.
const ASSETS = {
  'linux-x64': 'goose-x86_64-unknown-linux-gnu.tar.bz2',
  'linux-arm64': 'goose-aarch64-unknown-linux-gnu.tar.bz2',
  'darwin-x64': 'goose-x86_64-apple-darwin.tar.bz2',
  'darwin-arm64': 'goose-aarch64-apple-darwin.tar.bz2',
  'win32-x64': 'goose-x86_64-pc-windows-msvc.zip'
}

const target = process.argv[2] || `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (!asset) {
  console.error(`[ensure-goose] no goose asset for ${target}. Known:`, Object.keys(ASSETS).join(', '))
  process.exit(1)
}

const outDir = join(root, 'resources', 'goose', target)
const exe = join(outDir, target.startsWith('win32') ? 'goose.exe' : 'goose')

/** Download + extract the goose binary unless it's already on disk. */
async function ensureBinary() {
  if (existsSync(exe)) {
    console.log(`[ensure-goose] binary already present: ${exe}`)
    return
  }
  const url = `https://github.com/${host}/releases/download/${tag}/${asset}`
  const archive = join(outDir, asset)
  mkdirSync(outDir, { recursive: true })
  console.log(`[ensure-goose] ${target} ← ${url}`)

  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    console.error(`[ensure-goose] download failed: HTTP ${res.status}`)
    process.exit(1)
  }
  await new Promise((resolve, reject) => {
    const f = createWriteStream(archive)
    res.body.pipe?.(f) // node stream
    if (!res.body.pipe) {
      // web stream → buffer
      res.arrayBuffer().then((b) => { f.end(Buffer.from(b), resolve) }).catch(reject)
    } else {
      f.on('finish', resolve)
      f.on('error', reject)
    }
  })

  // Extract: .tar.bz2 via tar, .zip via unzip. The goose binary lands at top level.
  const r = asset.endsWith('.zip')
    ? spawnSync('unzip', ['-o', archive, '-d', outDir], { stdio: 'inherit' })
    : spawnSync('tar', ['xjf', archive, '-C', outDir], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('[ensure-goose] extract failed (need tar/unzip on PATH)')
    process.exit(1)
  }
  rmSync(archive, { force: true })
  if (!target.startsWith('win32')) spawnSync('chmod', ['+x', exe])
}

// Run as a build step when invoked directly; importable (helpers exported) for tests.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await ensureBinary()
  // win32: the msvc goose build dynamically links the UCRT + VC runtime. On a
  // locked-down box without them it dies at spawn (0xC0000135 / 0xC000007B). Ship
  // the runtime DLLs app-local (next to goose.exe) so extraResources bundles them.
  // Verified fix, docs/GOOSE_INTEGRATION.md Risk #5 (live goose→provider PASS 2026-06-17).
  if (target.startsWith('win32') && process.platform === 'win32' && existsSync(exe)) {
    await ensureWinRuntime(outDir)
  }
  console.log(existsSync(exe) ? `[ensure-goose] ✓ ${exe}` : `[ensure-goose] ⚠ extracted but ${exe} missing — check archive layout`)
}

export { ensureWinRuntime, harvestVcRuntimeFromRedist }

/**
 * Make sure the UCRT api-set forwarders + the x64 VC runtime DLLs sit next to
 * goose.exe. Three tiers, each best-effort (never fails the build):
 *   (a) UCRT forwarders from System32\downlevel (goose's own zip usually already
 *       ships these; we top up any missing).
 *   (b) VC runtime from System32 — present when the x64 VC++ redist is installed
 *       on the build machine (the fast path).
 *   (c) Fallback for locked-down / CI boxes WITHOUT the redist installed: fetch
 *       the OFFICIAL Microsoft VC++ redist and harvest its x64 runtime DLLs.
 */
async function ensureWinRuntime(dir) {
  const winRoot = process.env.SystemRoot || 'C:\\Windows'
  const critical = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']
  const have = (n) => existsSync(join(dir, n))
  let copied = 0

  // (a) UCRT api-set forwarders.
  const downlevel = join(winRoot, 'System32', 'downlevel')
  if (existsSync(downlevel)) {
    for (const f of readdirSync(downlevel)) {
      if (/^api-ms-win-.*\.dll$/i.test(f) && !existsSync(join(dir, f))) {
        try { copyFileSync(join(downlevel, f), join(dir, f)); copied++ } catch {}
      }
    }
  }
  // (b) VC runtime from System32 (case-preserving copy; resolves to the right file).
  for (const name of ['VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'MSVCP140.dll']) {
    if (have(name)) continue
    const src = join(winRoot, 'System32', name)
    if (existsSync(src)) { try { copyFileSync(src, join(dir, name)); copied++ } catch {} }
  }
  // (c) Official-redist fallback when a critical DLL is still missing.
  if (critical.some((n) => !have(n))) {
    try { copied += await harvestVcRuntimeFromRedist(dir) } catch (e) {
      console.warn(`[ensure-goose] ⚠ VC++ redist fallback failed: ${String(e).slice(0, 200)}`)
    }
  }

  const missing = critical.filter((n) => !have(n))
  if (missing.length) {
    console.warn(`[ensure-goose] ⚠ still missing x64 VC runtime: ${missing.join(', ')} — goose may fail to spawn on UCRT-less boxes`)
  }
  console.log(`[ensure-goose] win32 runtime: ${copied} DLL(s) app-local; critical present: ${critical.filter(have).join(', ') || 'NONE'}`)
}

/**
 * Download the official Microsoft VC++ x64 redistributable (a WiX-burn self-
 * extractor) and harvest its x64 runtime DLLs WITHOUT installing (no admin):
 *   1. Carve the largest embedded cabinet (the burn "attached container") by
 *      scanning for the MSCF magic + a valid cabinet header.
 *   2. `expand` that container → the burn payload set (a0..aN).
 *   3. For each payload that is itself a cabinet, extract the *_amd64 entries;
 *      the one carrying vcruntime140.dll_amd64 is the x64 runtime package.
 *   4. Copy those app-local, stripping the `_amd64` suffix to the real .dll name.
 * Uses Windows' built-in expand.exe (no 7-Zip needed). Verified 2026-06-17.
 */
async function harvestVcRuntimeFromRedist(dir) {
  const REDIST = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  const work = join(dir, '_vcrt-tmp')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const expand = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'expand.exe')

  console.log(`[ensure-goose] fetching official VC++ redist ← ${REDIST}`)
  const res = await fetch(REDIST, { redirect: 'follow' })
  if (!res.ok) throw new Error(`redist HTTP ${res.status}`)
  const exePath = join(work, 'vc_redist.x64.exe')
  writeFileSync(exePath, Buffer.from(await res.arrayBuffer()))

  // 1. Carve the largest valid MSCF cabinet (the attached container).
  const buf = readFileSync(exePath)
  let best = null
  for (let i = buf.indexOf('MSCF'); i >= 0; i = buf.indexOf('MSCF', i + 4)) {
    if (buf.readUInt32LE(i + 4) !== 0 || buf.readUInt32LE(i + 12) !== 0) continue // reserved1/2 must be 0
    const cb = buf.readUInt32LE(i + 8) // cbCabinet (total size)
    if (cb > 36 && i + cb <= buf.length && (!best || cb > best.cb)) best = { off: i, cb }
  }
  if (!best) throw new Error('no MSCF cabinet found in redist')
  const cab = join(work, 'attached.cab')
  writeFileSync(cab, buf.subarray(best.off, best.off + best.cb))

  // 2. Expand the container → payloads.
  const stage = join(work, 'payloads')
  mkdirSync(stage, { recursive: true })
  if (spawnSync(expand, [cab, '-F:*', stage], { stdio: 'ignore' }).status !== 0) {
    throw new Error('expand of attached container failed')
  }

  // 3. Find the payload cabinet holding the x64 runtime, extract its *_amd64 set.
  const dlls = join(work, 'dlls')
  let harvested = 0
  for (const f of readdirSync(stage)) {
    const p = join(stage, f)
    let head
    try { head = readFileSync(p, { encoding: null }).subarray(0, 4).toString('ascii') } catch { continue }
    if (head !== 'MSCF') continue
    rmSync(dlls, { recursive: true, force: true })
    mkdirSync(dlls, { recursive: true })
    spawnSync(expand, [p, '-F:*_amd64', dlls], { stdio: 'ignore' }) // best-effort per payload
    if (!existsSync(join(dlls, 'vcruntime140.dll_amd64'))) continue // not the x64 runtime cab
    for (const g of readdirSync(dlls)) {
      if (/_amd64$/i.test(g)) {
        try { copyFileSync(join(dlls, g), join(dir, g.slice(0, -'_amd64'.length))); harvested++ } catch {}
      }
    }
    break
  }
  rmSync(work, { recursive: true, force: true })
  if (!harvested) throw new Error('redist parsed but no x64 runtime DLLs harvested')
  console.log(`[ensure-goose] VC++ redist fallback: harvested ${harvested} x64 runtime DLL(s)`)
  return harvested
}
