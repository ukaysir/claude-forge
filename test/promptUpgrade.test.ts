// Unit tests for the pure prompt-upgrade helpers (guards, output cleaning, word
// diff, meta-prompt). No electron/SDK — compiled by tsconfig.test.json → out-test,
// run via `npm test` (node:test). The SDK call (upgradeRunner) is not covered
// here (it needs a live session); this gates the deterministic logic around it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canUpgrade,
  cleanUpgradeOutput,
  diffWords,
  normalizeMode,
  buildUpgradeMeta,
  buildUpgradeUserMessage,
  UPGRADE_MODES
} from '../src/main/promptUpgrade'

// ── canUpgrade ───────────────────────────────────────────────────────────────
test('canUpgrade: rejects empty / too-short / whitespace', () => {
  assert.equal(canUpgrade(''), false)
  assert.equal(canUpgrade('   '), false)
  assert.equal(canUpgrade('hi'), false)
  assert.equal(canUpgrade(null), false)
  assert.equal(canUpgrade(undefined), false)
})

test('canUpgrade: rejects a bare slash/REPL command', () => {
  assert.equal(canUpgrade('/model opus'), false)
  assert.equal(canUpgrade('/help'), false)
  assert.equal(canUpgrade('/compact'), false)
})

test('canUpgrade: accepts a real prompt (even one mentioning a slash word)', () => {
  assert.equal(canUpgrade('write a function to parse CSV'), true)
  assert.equal(canUpgrade('explain what the /model command does and when to use it here'), true)
  // multi-line starting with slash is content, not a command
  assert.equal(canUpgrade('/notes\nrefactor this module for clarity'), true)
})

// ── normalizeMode ────────────────────────────────────────────────────────────
test('normalizeMode: passes known, defaults unknown to enhance', () => {
  assert.equal(normalizeMode('structured'), 'structured')
  assert.equal(normalizeMode('concise'), 'concise')
  assert.equal(normalizeMode('enhance'), 'enhance')
  assert.equal(normalizeMode('bogus'), 'enhance')
  assert.equal(normalizeMode(undefined), 'enhance')
  assert.equal(normalizeMode(null), 'enhance')
})

// ── cleanUpgradeOutput ───────────────────────────────────────────────────────
test('cleanUpgradeOutput: strips a wrapping code fence', () => {
  assert.equal(cleanUpgradeOutput('```\nrewrite me\n```'), 'rewrite me')
  assert.equal(cleanUpgradeOutput('```text\nrewrite me\n```'), 'rewrite me')
})

test('cleanUpgradeOutput: drops a leading preamble line', () => {
  assert.equal(
    cleanUpgradeOutput("Here is the improved prompt:\nDo the thing well."),
    'Do the thing well.'
  )
  assert.equal(cleanUpgradeOutput('Improved prompt:\nFoo bar'), 'Foo bar')
})

test('cleanUpgradeOutput: unwraps fully surrounding quotes', () => {
  assert.equal(cleanUpgradeOutput('"just this"'), 'just this')
})

test('cleanUpgradeOutput: leaves clean content untouched', () => {
  const s = 'Refactor `parse()` in a.ts to be O(n). Think step by step.'
  assert.equal(cleanUpgradeOutput(s), s)
})

test('cleanUpgradeOutput: handles empty / nullish', () => {
  assert.equal(cleanUpgradeOutput(''), '')
  assert.equal(cleanUpgradeOutput(null), '')
  assert.equal(cleanUpgradeOutput(undefined), '')
})

// ── diffWords ────────────────────────────────────────────────────────────────
test('diffWords: identical text is all "same"', () => {
  const segs = diffWords('hello world', 'hello world')
  assert.ok(segs.every((s) => s.type === 'same'))
  assert.equal(segs.map((s) => s.value).join(''), 'hello world')
})

test('diffWords: reconstructs both sides exactly', () => {
  const before = 'fix the bug'
  const after = 'fix the critical bug now'
  const segs = diffWords(before, after)
  const reBefore = segs.filter((s) => s.type !== 'add').map((s) => s.value).join('')
  const reAfter = segs.filter((s) => s.type !== 'del').map((s) => s.value).join('')
  assert.equal(reBefore, before)
  assert.equal(reAfter, after)
  assert.ok(segs.some((s) => s.type === 'add'))
})

test('diffWords: pure insertion has no deletions', () => {
  const segs = diffWords('a b', 'a x b')
  assert.ok(!segs.some((s) => s.type === 'del'))
  assert.ok(segs.some((s) => s.type === 'add' && s.value.includes('x')))
})

test('diffWords: empty before ⇒ everything added', () => {
  const segs = diffWords('', 'brand new')
  assert.ok(segs.every((s) => s.type === 'add'))
})

// ── meta-prompt builders ─────────────────────────────────────────────────────
test('buildUpgradeMeta: includes hard rules + the selected mode', () => {
  const enhance = buildUpgradeMeta('enhance')
  assert.match(enhance, /HARD RULES/)
  assert.match(enhance, /SAME language/)
  assert.match(enhance, /MODE — Enhance/)
  assert.match(buildUpgradeMeta('structured'), /CO-STAR/)
  assert.match(buildUpgradeMeta('concise'), /MODE — Concise/)
  // unknown mode falls back to enhance
  assert.match(buildUpgradeMeta('bogus'), /MODE — Enhance/)
})

test('buildUpgradeUserMessage: wraps the draft in a <draft> tag', () => {
  const msg = buildUpgradeUserMessage('do x')
  assert.match(msg, /<draft>\ndo x\n<\/draft>/)
})

test('UPGRADE_MODES: three modes with ids + labels', () => {
  assert.equal(UPGRADE_MODES.length, 3)
  assert.deepEqual(
    UPGRADE_MODES.map((m) => m.id),
    ['enhance', 'structured', 'concise']
  )
  assert.ok(UPGRADE_MODES.every((m) => m.label && m.hint))
})
