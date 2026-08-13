/**
 * dsh-jingle — play sounds on dsh events.
 *
 * Sound-effect plugin for the DeepSeek Harness. Configuration keys are
 * native dsh event names (see the harness event matrix): host lifecycle
 * events (`session/created`, `agent/error`, …), the `agent/status` states
 * (`agent/status/running`, `agent/status/idle`), and session-log events
 * delivered through `session/event` (`turn/start`, `tool/call`, …).
 *
 * Sounds are configured through the `sounds:` section of the user settings
 * document (`$DSH_HOME/settings.yaml`, hot-reloaded), with the plugin's
 * composition entry config (the `cordis.patch.yml` row) as the base layer.
 *
 * @module dsh-jingle
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { LoopPlayer, playOnce } from './player.js'

export const name = 'dsh-jingle'
export const inject = ['commands']

/** Settings namespace: the `sounds:` section of the user settings document. */
const NS = settingsNamespace('sounds')

/** One sound entry: a plain path or an object with optional volume and looping. */
const SoundEntry = z.union([
  z.string(),
  z.object({
    path: z.string().required(),
    volume: z.number().min(0).max(1).default(1),
    /** Loop the sound until the agent returns to idle (or the session disposes). */
    loop: z.boolean().default(false),
  }),
])

/** Plugin composition config; the same shape resolves the `sounds:` settings section. */
export const Config = z.object({
  /** Master switch; `false` silences every event-triggered sound. */
  enabled: z.boolean().default(true),
  /** dsh event name → sound entry. */
  sounds: z.dict(SoundEntry).default({}),
})

/**
 * Settings-section schema. The `sounds:` section of the user settings
 * document accepts both the full config shape (`{ enabled, sounds }`) and
 * the flat README form — the section itself is the event → sound map:
 *
 * ```yaml
 * sounds:
 *   agent/status/idle: ./sounds/done.wav
 * ```
 *
 * The dict branch is tried first so the flat form wins; `{ enabled: true }`
 * alone (or the composition entry's config-shaped base) falls through to
 * `Config`.
 */
const SectionSchema = z.union([z.dict(SoundEntry), Config])

/**
 * Host lifecycle events (emitted on the root context), configured by their
 * exact dsh event name. `agent/status` is split into its two observable
 * states because a sound for a state flip needs to know which way it went.
 */
const HOST_EVENTS = [
  'session/created',
  'session/disposed',
  'agent/created',
  'agent/disposed',
  'agent/session-start',
  'agent/error',
] /* @type {string[]} */

/** Agent running-state keys (the `agent/status` payload). */
const AGENT_RUNNING = 'agent/status/running'
const AGENT_IDLE = 'agent/status/idle'

/** Session-log events (delivered via `session/event`), by exact event type. */
const SESSION_EVENTS = [
  'user/message',
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'tool/call',
  'tool/result',
] /* @type {string[]} */

/** @returns {string} the dsh home directory ($DSH_HOME or ~/.dsh). */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Expand `~/…`, `./…`, and `$DSH_HOME/…` path prefixes. */
function expandPath(path) {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (path.startsWith('$DSH_HOME')) return join(dshHome(), path.slice('$DSH_HOME'.length))
  if (path.startsWith('./')) return join(dshHome(), path.slice(2))
  return path
}

/** Normalize a string-or-object sound entry to `{ path, volume, loop }`. */
function entryOf(entry) {
  if (typeof entry === 'string') return { path: entry, volume: undefined, loop: false }
  return { path: entry.path, volume: entry.volume, loop: entry.loop === true }
}

/** Format one entry for the `/sounds` listing. */
function formatEntry(entry) {
  const { path, volume, loop } = entryOf(entry)
  const volumeText = volume !== undefined && volume !== 1 ? ` at volume ${volume}` : ''
  const loopText = loop ? ' (looping)' : ''
  return `${path}${volumeText}${loopText}`
}

/**
 * Register the plugin: settings wiring, event listeners, and the `/sounds`
 * human command.
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @param {{ enabled?: boolean, sounds?: Record<string, string | { path: string, volume?: number, loop?: boolean }> }} config - composition entry config.
 */
export function apply(ctx, config = {}) {
  const loop = new LoopPlayer()
  let readConfig = () => config

  // User settings override the composition entry; live edits to
  // settings.yaml hot-reload without a restart. Without a settings
  // service, the entry config stays authoritative.
  installSettingsSection(ctx, NS, SectionSchema, config, {
    setSource: (source) => {
      readConfig = source
    },
    onChange: () => {},
  })

  ctx.on('dispose', () => loop.stop())

  /**
   * Resolve the effective config. The settings section may hold the full
   * config shape (`{ enabled, sounds }`) or the flat README form — the
   * section itself is the event → sound map. Both are normalized here;
   * a section merged from a config-shaped base plus flat entries (a flat
   * map with `sounds` defaulted to `{}` by the full-shape schema) is
   * tolerated by collecting the top-level entries.
   *
   * Nothing plays unless the user configures at least one event sound —
   * the plugin is silent by default.
   */
  function resolveConfig() {
    const cfg = readConfig()
    if (cfg === null || typeof cfg !== 'object') return { enabled: true, sounds: {} }
    const isFlat = !('enabled' in cfg) && !('sounds' in cfg)
    if (isFlat) return { enabled: true, sounds: cfg }
    const sounds = cfg.sounds ?? {}
    const hasTopLevelEntries = Object.keys(sounds).length === 0 &&
      Object.keys(cfg).some((key) => key !== 'enabled' && key !== 'sounds')
    if (hasTopLevelEntries) {
      const flat = {}
      for (const [key, value] of Object.entries(cfg)) {
        if (key !== 'enabled' && key !== 'sounds') flat[key] = value
      }
      return { enabled: cfg.enabled ?? true, sounds: flat }
    }
    return { enabled: cfg.enabled ?? true, sounds }
  }

  /**
   * Fire one event-triggered sound, silently. A `loop` entry starts looping
   * playback; the loop stops on the next idle state or session disposal.
   */
  function trigger(key) {
    const { enabled, sounds } = resolveConfig()
    if (!enabled) return
    const entry = sounds[key]
    if (!entry) return
    const { path, volume, loop: looping } = entryOf(entry)
    if (looping) {
      loop.start(expandPath(path), volume)
    } else {
      void playOnce(expandPath(path), volume).catch(() => {})
    }
  }

  // agent/status: 'running' = a task begins (loop-friendly), 'idle' = the
  // task completes and any looping sound stops.
  ctx.on('agent/status', ({ status }) => {
    if (status === 'running') {
      trigger(AGENT_RUNNING)
    } else if (status === 'idle') {
      loop.stop()
      trigger(AGENT_IDLE)
    }
  })

  for (const event of HOST_EVENTS) {
    ctx.on(event, () => {
      if (event === 'session/disposed' || event === 'agent/disposed') loop.stop()
      trigger(event)
    })
  }

  // Session-log events. Replay/resume seeds replay history through the same
  // feed; events up to the last `session/end-seed` marker are seed history
  // and must not trigger sounds.
  const seedBoundary = new WeakMap()
  ctx.on('session/event', (session, event) => {
    if (event.type === 'session/end-seed') {
      seedBoundary.set(session, event.seq)
      return
    }
    const boundary = seedBoundary.get(session)
    if (boundary !== undefined && event.seq <= boundary) return
    if (SESSION_EVENTS.includes(event.type)) trigger(event.type)
  })

  ctx.commands.register({
    name: 'sounds',
    description: 'List, reload, or play configured dsh sounds',
    input: { hint: 'list | reload | play <event> | stop' },
    handler: async (invocation) => {
      const [cmd, ...rest] = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
      const usage =
        'Usage: /sounds [list | reload | play <event> | stop]. Events: ' +
        'session/created, session/disposed, agent/created, agent/disposed, ' +
        'agent/session-start, agent/error, agent/status/running, ' +
        'agent/status/idle, user/message, turn/start, turn/end, step/start, ' +
        'step/end, tool/call, tool/result'

      if (cmd === undefined || cmd === 'list') {
        const { enabled, sounds } = resolveConfig()
        const entries = Object.entries(sounds)
        if (entries.length === 0) {
          return { kind: 'success', text: 'No sounds configured.' }
        }
        const lines = entries.map(([key, entry]) => `- ${key}: ${formatEntry(entry)}`)
        return {
          kind: 'success',
          text: `Configured sounds${enabled ? '' : ' (disabled)'}:\n${lines.join('\n')}`,
        }
      }

      if (cmd === 'reload') {
        resolveConfig()
        return { kind: 'success', text: 'Sounds configuration reloaded.' }
      }

      if (cmd === 'stop') {
        loop.stop()
        return { kind: 'success', text: 'Stopped looping sound.' }
      }

      if (cmd === 'play') {
        const key = rest[0]
        if (!key) {
          return { kind: 'error', text: `Missing sound name.\n${usage}` }
        }
        const entry = resolveConfig().sounds[key]
        if (!entry) {
          return { kind: 'error', text: `No sound for event: ${key}` }
        }
        const { path, volume } = entryOf(entry)
        const played = await playOnce(expandPath(path), volume)
        return {
          kind: 'success',
          text: played
            ? `Played ${path}${volume !== undefined && volume !== 1 ? ` at volume ${volume}` : ''}.`
            : `Could not play ${path} (no working player found).`,
        }
      }

      return { kind: 'error', text: `Unknown argument: ${cmd ?? ''}\n${usage}` }
    },
  })
}
