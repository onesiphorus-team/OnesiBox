# Implementation Plan: MVP Core System

**Branch**: `001-mvp-core-system` | **Date**: 2026-01-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-mvp-core-system/spec.md`

## Summary

The MVP Core System establishes the foundational OnesiBox client application running on Raspberry Pi. It enables caregivers to remotely control media playback (JW.org) and Zoom meeting participation for elderly beneficiaries through a zero-touch kiosk interface. The system uses a Chromium Kiosk + Node.js Backend architecture with HTTP polling for command reception and periodic heartbeat for health monitoring.

## Technical Context

**Language/Version**: Node.js 20 LTS (JavaScript/TypeScript)
**Primary Dependencies**: Chromium Browser 120+, axios (HTTP), winston (logging), systeminformation (metrics)
**Storage**: JSON config file (plaintext), rotating log files (max 50MB)
**Testing**: Jest for unit tests, manual integration testing on Raspberry Pi hardware
**Target Platform**: Raspberry Pi 5 (4GB RAM), Raspberry Pi OS Lite 64-bit (Bookworm)
**Project Type**: Single embedded application with web UI component
**Performance Goals**: Boot to standby <60s, command execution <1s, page load <5s
**Constraints**: <500MB RAM idle, <1GB RAM during video, 24/7 uptime requirement
**Scale/Scope**: Single device per deployment, one beneficiary per device

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is currently a template placeholder. The following implicit principles apply based on the project documentation:

| Principle | Status | Notes |
|-----------|--------|-------|
| Zero Interaction | PASS | All operations are remote-controlled; no user input required |
| Resilience | PASS | Exponential backoff, auto-reconnect, systemd restart planned |
| Simplicity | PASS | Minimal dependencies, single-purpose components |
| Security | PASS (MVP) | HTTPS/TLS required; token auth; plaintext storage accepted for MVP |
| Efficiency | PASS | Architecture chosen for <500MB RAM footprint |

**Gate Result**: PASS - Proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/001-mvp-core-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.yaml         # Server API contracts consumed by client
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── config/
│   └── config.js           # Configuration loader
├── communication/
│   ├── polling.js          # HTTP polling client
│   ├── heartbeat.js        # Heartbeat service
│   └── api-client.js       # Server API wrapper
├── commands/
│   ├── manager.js          # Command dispatcher
│   ├── handlers/
│   │   ├── media.js        # play_media, stop_media, pause_media, resume_media
│   │   ├── volume.js       # set_volume
│   │   └── zoom.js         # join_zoom, leave_zoom
│   └── validator.js        # Command/URL validation
├── state/
│   └── state-manager.js    # Application state machine
├── browser/
│   └── controller.js       # Chromium navigation control
├── logging/
│   └── logger.js           # Winston logger with rotation
└── main.js                 # Entry point

web/
├── index.html              # Standby screen
├── styles.css              # Large fonts, connection indicator
└── app.js                  # Minimal client-side JS for clock/status

scripts/
├── setup.sh                # Initial device setup
├── start-kiosk.sh          # Chromium kiosk launcher
└── onesibox.service        # systemd service definition

tests/
├── unit/
│   ├── commands/
│   ├── communication/
│   └── state/
└── integration/
    └── manual-test-checklist.md

config/
└── config.json.example     # Configuration template
```

**Structure Decision**: Single embedded application structure selected. The Node.js backend runs as a systemd service, launching Chromium in kiosk mode and controlling it via URL navigation. The web/ folder contains the local standby UI served by the Node.js process.

## Complexity Tracking

> No constitution violations to justify. Architecture follows recommended Option B from project documentation.

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Architecture | Chromium Kiosk + Node.js Backend | Recommended in architecture doc; optimal RAM/control balance |
| Browser Control | URL navigation (no Playwright MVP) | Simpler; Playwright deferred to Phase 2 for Zoom automation if needed |
| Storage | Plaintext JSON config | MVP simplicity; security hardening deferred per clarification |
