/**
 * Smoke test for dsh-jingle.
 *
 * Boots a minimal cordis context with a mock `commands` service and the
 * plugin applied, then verifies:
 *   1. apply() does not throw,
 *   2. the `/sounds` command is registered,
 *   3. event handlers tolerate empty/mocked payloads without throwing,
 *   4. the command handler returns the expected shapes.
 *
 * Run from the installed profile (so `@deepseek-ai/cordis` and the
 * plugin's own dependencies resolve):
 *
 *   cd ~/.dsh/profiles/web && node /path/to/dsh-jingle/test/smoke.mjs
 *
 * The `sounds` settings section is deliberately left empty here, so no
 * real audio is triggered during the event assertions.
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from 'dsh-jingle'

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
const settingsScopes = new Map()
const mockSettings = {
  register(ns, schema) {
    const scope = {
      get: () => schema({}),
      watch: () => () => {},
      update: async () => {},
      replace: async () => {},
      mutate: async () => {},
    }
    settingsScopes.set(ns, scope)
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
await ctx.plugin(plugin, { enabled: true, sounds: {} })

// 1–2. command registration + settings namespace registration.
const sounds = registered.get('sounds')
assert.ok(sounds, 'expected the /sounds command to be registered')
assert.equal(settingsScopes.size, 1, 'expected the sounds settings namespace to register')

// 3. event handlers must tolerate payloads without throwing.
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

// Seed-boundary events must be skipped (nothing to play anyway — the
// assertions above are about not throwing).

// 4. command handler shapes.
const handler = sounds.handler
const run = (rawInput) => handler({ agent: {}, rawInput, signal: new AbortController().signal, commandId: 't' })

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

console.log('dsh-jingle smoke test: ok')
