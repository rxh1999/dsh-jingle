/**
 * Cross-platform sound playback for dsh-jingle.
 *
 * Strategy mirrors pi-jingle: try the platform's native one-shot player
 * first (afplay / paplay / aplay / PowerShell), fall back to ffplay; use
 * ffplay when a volume filter is requested because the native players
 * cannot attenuate. Looping songs prefer `ffplay -loop 0` and fall back to
 * respawning the native player after each exit.
 *
 * Every function is failure-silent on purpose: a missing player or a bad
 * file must never disturb the agent loop that triggered the sound.
 */

import { spawn } from 'node:child_process'

const PLATFORM = process.platform

/** Run one command, resolve `{ code }` after exit; hard timeout, no stdio. */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { stdio: 'ignore' })
    } catch {
      resolve({ code: null })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code })
    })
  })
}

/** Ordered one-shot player candidates for the current platform. */
export function playerCandidates(path, volume) {
  const commands = []
  // Volume control needs ffplay's `-af volume=` filter (0.0–1.0).
  const wantsVolume = volume !== undefined && volume !== null && volume !== 1
  if (wantsVolume) {
    commands.push({
      cmd: 'ffplay',
      args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-af', `volume=${volume}`, path],
      timeoutMs: 10000,
    })
  }
  if (PLATFORM === 'darwin') {
    commands.push({ cmd: 'afplay', args: [path], timeoutMs: 15000 })
  } else if (PLATFORM === 'linux') {
    commands.push({ cmd: 'paplay', args: [path], timeoutMs: 10000 })
    commands.push({ cmd: 'aplay', args: [path], timeoutMs: 10000 })
  } else if (PLATFORM === 'win32') {
    commands.push({
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `(New-Object System.Media.SoundPlayer '${path.replace(/'/g, "''")}').PlaySync()`,
      ],
      timeoutMs: 30000,
    })
  }
  // Generic fallback; without volume support.
  commands.push({
    cmd: 'ffplay',
    args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', path],
    timeoutMs: 10000,
  })
  return commands
}

/**
 * Play one sound through the first working player.
 * @returns {Promise<boolean>} whether any player exited 0.
 */
export async function playOnce(path, volume) {
  for (const { cmd, args, timeoutMs } of playerCandidates(path, volume)) {
    const { code } = await run(cmd, args, timeoutMs)
    if (code === 0) return true
  }
  return false
}

/** Looping-song playback: stop() kills the current child and cancels respawns. */
export class LoopPlayer {
  #child = null
  #stopped = true

  get playing() {
    return !this.#stopped
  }

  #spawn(cmd, args) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore' })
      // A missing binary reports through 'error'; never let it crash the host.
      child.on('error', () => {})
      return child
    } catch {
      return null
    }
  }

  /** Begin looping `path`. Stops any previous loop first. */
  start(path, volume) {
    this.stop()
    this.#stopped = false
    const volumeArgs =
      volume !== undefined && volume !== null && volume !== 1
        ? ['-af', `volume=${volume}`]
        : []
    const ffplay = this.#spawn('ffplay', [
      '-nodisp',
      '-loop',
      '0',
      '-loglevel',
      'quiet',
      ...volumeArgs,
      path,
    ])
    if (ffplay) {
      this.#child = ffplay
      // ffplay can die asynchronously (ENOENT); fall back to respawning
      // the native player so the song still plays where ffplay is absent.
      ffplay.on('error', () => {
        if (this.#child === ffplay) this.#child = null
        this.#fallbackLoop(path)
      })
      return
    }
    this.#fallbackLoop(path)
  }

  /** Fallback: respawn the platform's one-shot player after each exit. */
  #fallbackLoop(path) {
    if (this.#stopped || PLATFORM === 'win32') return
    const oneShot = PLATFORM === 'darwin' ? 'afplay' : 'paplay'
    const respawn = () => {
      if (this.#stopped) return
      const child = this.#spawn(oneShot, [path])
      if (!child) return
      this.#child = child
      child.on('exit', () => {
        if (this.#child === child) this.#child = null
        respawn()
      })
    }
    respawn()
  }

  /** Stop the current loop and prevent any further respawn. */
  stop() {
    this.#stopped = true
    if (this.#child) {
      try {
        this.#child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      this.#child = null
    }
  }
}
