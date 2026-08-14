/**
 * Smoke test for dsh-jingle.
 *
 * Boots a minimal cordis context with a mock `commands` service and the
 * plugin applied, then verifies:
 *   1. apply() does not throw,
 *   2. the /sounds command is registered,
 *   3. event handlers tolerate empty/mocked payloads without throwing,
 *   4. the command handler returns the expected shapes,
 *   5. the `sounds:` settings section resolves in BOTH the full config
 *      shape ({ enabled, sounds }) and the flat README form (the section
 *      itself is the event → sound map), including the merged-tolerant
 *      case where a config-shaped base meets flat entries,
 *   6. agent/status sounds follow the top-level agent only: subagent
 *      status flips never reach the player.
 *
 * Run from the installed profile (so `@deepseek-ai/cordis` and the
 * plugin's own dependencies resolve):
 *
 *   cd ~/.dsh/profiles/web && node /path/to/dsh-jingle/test/smoke.mjs
 *
 * The `sounds` settings section is deliberately left empty for the event
 * assertions, so no real audio is triggered there.
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from 'dsh-jingle'

/**
 * Boot one plugin instance in a fresh context.
 * @param {{ section?: object, config?: object }} options
 * @returns {{ ctx: Context, run: (rawInput: string) => Promise<{kind: string, text?: string}>, registered: Map<string, object> }}
 */
async function bootPlugin({ section, config = { enabled: true, sounds: {} } } = {}) {
  const registered = new Map()
  const mockCommands = {
    register(definition) {
      assert.equal(typeof definition.name, 'string')
      assert.equal(typeof definition.description, 'string')
      assert.equal(typeof definition.handler, 'function')
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
    list() {
      return []
    },
    find() {
      return undefined
    },
    execute() {
      return undefined
    },
  }

  // Minimal settings provider so the real installSettingsSection wiring runs.
  const scopes = new Map()
  const mockSettings = {
    register(ns, schema) {
      const scope = {
        get: () => schema(section),
        watch: () => () => {},
        update: async () => {},
        replace: async () => {},
        mutate: async () => {},
      }
      scopes.set(ns, scope)
      return scope
    },
    describe: () => [],
    get: () => undefined,
    update: async () => {},
    replace: async () => {},
    mutate: async () => {},
    prepareDocument: async () => undefined,
  }

  const ctx = new Context()
  ctx.provide('commands', mockCommands)
  ctx.provide('settings', mockSettings)
  await ctx.plugin(plugin, config)

  const sounds = registered.get('sounds')
  assert.ok(sounds, 'expected the /sounds command to be registered')
  assert.equal(scopes.size, 1, 'expected the sounds settings namespace to register')
  const run = (rawInput) => sounds.handler({
    agent: {},
    rawInput,
    signal: new AbortController().signal,
    commandId: 't',
  })
  return { ctx, run, registered }
}

// 1–4. Command registration, event tolerance, command shapes on an empty
// section: silence by default.
{
  const { ctx, run } = await bootPlugin({ section: {} })
  ctx.emit('agent/status', { agent: {}, status: 'running' })
  ctx.emit('agent/status', { agent: {}, status: 'idle' })
  ctx.emit('agent/created', { agent: {} })
  ctx.emit('agent/disposed', { agent: {} })
  ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  ctx.emit('agent/error', { agent: {}, turn: 1, step: 0, error: new Error('x') })
  ctx.emit('session/created', {})
  ctx.emit('session/disposed', {})
  const session = {}
  ctx.emit('session/event', session, { type: 'session/end-seed', seq: 3, time: Date.now(), data: {} })
  ctx.emit('session/event', session, { type: 'turn/start', seq: 4, time: Date.now(), data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'turn/end', seq: 5, time: Date.now(), data: { turn: 1, reason: { kind: 'success' } } })
  ctx.emit('session/event', session, { type: 'step/start', seq: 6, time: Date.now(), data: { turn: 1, step: 0 } })
  ctx.emit('session/event', session, { type: 'step/end', seq: 7, time: Date.now(), data: { turn: 1, step: 0 } })
  ctx.emit('session/event', session, { type: 'tool/call', seq: 8, time: Date.now(), data: { turn: 1, step: 0, callId: 'c1', name: 'x', arguments: '{}' } })
  ctx.emit('session/event', session, { type: 'tool/result', seq: 9, time: Date.now(), data: { turn: 1, step: 0, message: {} } })
  ctx.emit('session/event', session, { type: 'user/message', seq: 10, time: Date.now(), data: {} })
  ctx.emit('session/event', session, { type: 'approval/asked', seq: 11, time: Date.now(), data: { id: 'a1', toolName: 'bash' } })

  const empty = await run('')
  assert.equal(empty.kind, 'success')
  // Empty config means silence by default — no sounds configured at all.
  assert.match(empty.text, /No sounds configured/)

  const bad = await run('nope')
  assert.equal(bad.kind, 'error')

  const missing = await run('play turn_start')
  assert.equal(missing.kind, 'error')

  const stopped = await run('stop')
  assert.equal(stopped.kind, 'success')

  const reloaded = await run('reload')
  assert.equal(reloaded.kind, 'success')
}

// 5a. Flat README form: the `sounds:` section is itself the event → map.
{
  const { run } = await bootPlugin({
    section: {
      'agent/status/idle': './sounds/done.wav',
      'turn/end': { path: './sounds/chime.wav', volume: 0.4 },
      'approval/asked': './sounds/ding.wav',
    },
  })
  const listed = await run('list')
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /agent\/status\/idle: \.\/sounds\/done\.wav/)
  assert.match(listed.text, /turn\/end: \.\/sounds\/chime\.wav at volume 0\.4/)
  assert.match(listed.text, /approval\/asked: \.\/sounds\/ding\.wav/)
}

// 5b. Full config shape in the section.
{
  const { run } = await bootPlugin({
    section: { enabled: true, sounds: { 'tool/result': './sounds/tick.wav' } },
  })
  const listed = await run('list')
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /tool\/result: \.\/sounds\/tick\.wav/)
}

// 5c. Merged-tolerant: a config-shaped base (as the composition entry
// contributes) meeting a flat section still resolves the flat entries.
{
  const { run } = await bootPlugin({
    config: { enabled: true, sounds: {} },
    section: { 'agent/status/running': { path: './sounds/music.wav', loop: true } },
  })
  const listed = await run('list')
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /agent\/status\/running: \.\/sounds\/music\.wav \(looping\)/)
}

// 5d. enabled: false in the section silences event sounds but stays listed.
{
  const { run } = await bootPlugin({
    section: { enabled: false, sounds: { 'agent/status/idle': './sounds/done.wav' } },
  })
  const listed = await run('list')
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /\(disabled\)/)
  assert.match(listed.text, /agent\/status\/idle: \.\/sounds\/done\.wav/)
}

// 6. agent/status scoping: only the top-level agent's status flips ring.
// Subagents drive child sessions (`header.parentSession` set) — their flips
// must never reach the player; the main conversation's agent (no parent)
// rings as before.
{
  // Shadow the native one-shot player with a shim in PATH: every spawn
  // attempt appends a line to a log and exits non-zero, so "did the plugin
  // try to play?" is observable without playing audio and without touching
  // module bindings.
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const shimDir = mkdtempSync(join(tmpdir(), 'jingle-shim-'))
  const logPath = join(shimDir, 'calls.log')
  writeFileSync(
    join(shimDir, 'afplay'),
    '#!/bin/sh\n' + 'echo "$@" >> ' + JSON.stringify(logPath) + '\nexit 1\n',
    { mode: 0o755 },
  )
  const previousPath = process.env.PATH
  process.env.PATH = shimDir + ':' + previousPath
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
  try {
    // A nonexistent sound file: the shim still runs (and fails silently),
    // so the log counts trigger attempts without playing audio.
    const { ctx } = await bootPlugin({
      section: { 'agent/status/idle': './sounds/nope.wav' },
    })
    const attempts = () =>
      existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split(/\n+/).filter(Boolean).length : 0

    ctx.emit('agent/status', {
      agent: { session: { header: { parentSession: 'root' } } },
      status: 'idle',
    })
    await settle()
    assert.equal(attempts(), 0, 'subagent idle must not play anything')

    ctx.emit('agent/status', {
      agent: { session: { header: { parentSession: 'root' } } },
      status: 'running',
    })
    await settle()
    assert.equal(attempts(), 0, 'subagent running must not play anything')

    ctx.emit('agent/status', { agent: { session: { header: {} } }, status: 'idle' })
    await settle()
    assert.equal(attempts(), 1, 'top-level idle must trigger playback')

    // Defensive fallback: a payload without the injected agent keeps the
    // historical behavior (treated as top-level).
    ctx.emit('agent/status', { status: 'idle' })
    await settle()
    assert.equal(attempts(), 2, 'missing agent falls back to playing')
  } finally {
    process.env.PATH = previousPath
  }
}

console.log('dsh-jingle smoke test: ok')
