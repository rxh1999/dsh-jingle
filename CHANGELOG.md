# Changelog

## [1.2.0] - 2026-08-14

- `agent/status/running` / `agent/status/idle` now follow the **top-level
  (main) agent only**. Subagents drive child sessions (their header records
  a parent session), and their status flips are silent — a background
  subagent finishing no longer rings. `agent/status/idle` therefore means
  "the main agent's turn ended and it is waiting for your next message".

## [1.1.0] - 2026-08-14

- New event: `approval/asked` (waiting for user approval) joins the
  session-log events; configure a sound for it like any other event.
- The `sounds:` settings section now accepts the flat README form (the
  section itself is the event → sound map) in addition to the full config
  shape (`{ enabled, sounds }`); both are normalized internally.

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
