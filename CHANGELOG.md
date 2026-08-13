# Changelog

## [1.0.0] - 2026-08-14

First stable release.

- Sound effects for dsh events, configured with **native dsh event names**
  (`session/created`, `agent/error`, `turn/end`, `tool/call`, `agent/status/running`, …)
  instead of a remapped vocabulary.
- Silent by default: nothing plays unless the `sounds:` settings section
  configures at least one event.
- Per-entry `volume` (0.0–1.0, needs ffplay) and `loop` (loops until
  `agent/status/idle`, `session/disposed`, or `agent/disposed`).
- Cross-platform playback: afplay / paplay / aplay / PowerShell with ffplay
  fallback; ffplay `-af volume` when volume control is requested.
- `/sounds` human command: `list`, `reload`, `play <event>`, `stop`.
- Session-log sounds skip replay/resume seed history (`session/end-seed`).
- Settings hot-reload through the `sounds:` namespace of the dsh user
  settings document; composition config (`cordis.patch.yml` row `config:`)
  as the base layer.
