/**
 * Generate `sounds/done.wav` — a soft two-note "ding-dong" bell.
 *
 * Pure Node, no dependencies: 44.1 kHz mono 16-bit PCM, synthesized as
 * decaying sine partials. Run from the package root:
 *
 *   node scripts/gen-done-wav.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 44100
const DURATION = 1.2
const COUNT = Math.floor(SAMPLE_RATE * DURATION)
const samples = new Float64Array(COUNT)

/** Add one decaying tone (fundamental + soft octave harmonic). */
function addTone(start, freq, amp, decay) {
  const s0 = Math.floor(start * SAMPLE_RATE)
  for (let i = s0; i < COUNT; i++) {
    const t = (i - s0) / SAMPLE_RATE
    const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.004))
    const wave =
      Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t)
    samples[i] += amp * env * wave
  }
}

// "ding" (A5) then "dong" (D6), each with a short echo partial.
addTone(0.0, 880.0, 0.6, 0.28)
addTone(0.0, 1760.0, 0.12, 0.16)
addTone(0.24, 1174.66, 0.5, 0.34)
addTone(0.24, 2349.32, 0.1, 0.18)

let peak = 0
for (const s of samples) peak = Math.max(peak, Math.abs(s))
const scale = 0.85 / peak

const pcm = Buffer.alloc(44 + COUNT * 2)
pcm.write('RIFF', 0)
pcm.writeUInt32LE(36 + COUNT * 2, 4)
pcm.write('WAVE', 8)
pcm.write('fmt ', 12)
pcm.writeUInt32LE(16, 16) // fmt chunk size
pcm.writeUInt16LE(1, 20) // PCM
pcm.writeUInt16LE(1, 22) // mono
pcm.writeUInt32LE(SAMPLE_RATE, 24)
pcm.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
pcm.writeUInt16LE(2, 32) // block align
pcm.writeUInt16LE(16, 34) // bits per sample
pcm.write('data', 36)
pcm.writeUInt32LE(COUNT * 2, 40)
for (let i = 0; i < COUNT; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] * scale))
  pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds', 'done.wav')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, pcm)
console.log(`wrote ${out} (${pcm.length} bytes, ${DURATION}s)`)
