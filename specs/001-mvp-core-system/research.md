# Research: MVP Core System

**Feature**: 001-mvp-core-system
**Date**: 2026-01-21

## Overview

This document captures technology decisions, best practices research, and resolved unknowns for the MVP Core System implementation.

---

## 1. Architecture Decision: Chromium Kiosk + Node.js Backend

### Decision
Use Chromium in kiosk mode controlled by a separate Node.js backend process.

### Rationale
- **RAM Efficiency**: 250-400MB vs 400-600MB for Electron
- **Separation of Concerns**: Backend handles server communication; browser handles rendering
- **Native Optimization**: Chromium on Raspberry Pi OS is optimized for ARM64
- **Update Independence**: Can update backend or browser independently
- **Proven Pattern**: Documented in project architecture as recommended approach

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| Electron + Node.js | Higher RAM consumption (400-600MB); packaging complexity |
| Pure Web SPA | No system access (reboot, volume, TTS); limited error recovery |
| Playwright-controlled | Higher overhead; deferred to Phase 2 if Zoom automation requires it |

---

## 2. Browser Control Strategy

### Decision
Control Chromium via URL navigation for MVP; no direct DOM manipulation.

### Rationale
- **Simplicity**: URL navigation is sufficient for media playback and Zoom join
- **Reliability**: No dependency on page DOM structure (JW.org, Zoom may change)
- **Performance**: Minimal overhead compared to injection or automation frameworks

### Implementation Pattern
```javascript
// Browser controller navigates to URLs
async navigateTo(url) {
  // Validate URL against whitelist first
  if (!this.isValidUrl(url)) throw new Error('E005');
  // Use child_process to send URL to running Chromium
  // Chromium launched with remote-debugging or via x11 window manager
}
```

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| Playwright automation | Overhead for MVP; revisit if permission dialogs require automation |
| Chrome DevTools Protocol | Complex setup; URL navigation sufficient for MVP |
| Browser extension | Maintenance burden; cross-origin restrictions |

---

## 3. Chromium Kiosk Configuration

### Decision
Launch Chromium with specific flags for kiosk operation and auto-permissions.

### Best Practices Researched
From Raspberry Pi and Chromium documentation:

```bash
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --enable-features=WebRTCPipeWireCapturer \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --disable-component-update \
  --disable-background-networking \
  --disable-sync \
  --disable-default-apps \
  --no-first-run \
  --start-fullscreen \
  http://localhost:3000
```

### Key Flags Explained
| Flag | Purpose |
|------|---------|
| `--kiosk` | Fullscreen, no address bar or controls |
| `--autoplay-policy=no-user-gesture-required` | Auto-play videos without user click |
| `--use-fake-ui-for-media-stream` | Auto-accept camera/mic permissions |
| `--disable-infobars` | Hide "Chrome is being controlled" bar |
| `--disable-session-crashed-bubble` | No crash dialogs on recovery |

---

## 4. HTTP Polling Implementation

### Decision
Use axios with exponential backoff for polling; 5-second default interval.

### Rationale
- **axios**: Well-maintained, promise-based, good error handling
- **Exponential backoff**: Standard resilience pattern for network failures
- **5-second interval**: Balance between responsiveness and server load

### Best Practices
```javascript
const BACKOFF_SCHEDULE = [5000, 10000, 20000, 60000]; // ms
let consecutiveFailures = 0;

async function poll() {
  try {
    const commands = await apiClient.getCommands();
    consecutiveFailures = 0;
    return commands;
  } catch (error) {
    consecutiveFailures = Math.min(consecutiveFailures + 1, BACKOFF_SCHEDULE.length - 1);
    const delay = BACKOFF_SCHEDULE[consecutiveFailures];
    logger.warn(`Poll failed, retry in ${delay}ms`, { error: error.message });
    await sleep(delay);
    return poll();
  }
}
```

---

## 5. State Machine Design

### Decision
Implement finite state machine with four states: idle, playing, calling, error.

### Rationale
- **Predictability**: Clear transitions, easy to test and debug
- **Interrupt handling**: Higher priority commands trigger state transitions
- **Recovery**: Error state allows graceful recovery to idle

### State Transitions
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────┐    play_media    ┌─────────┐               │
│  │  IDLE   │ ───────────────> │ PLAYING │               │
│  └─────────┘ <─────────────── └─────────┘               │
│       │        stop/complete        │                    │
│       │                             │                    │
│       │ join_zoom                   │ join_zoom          │
│       │ (higher priority)           │ (interrupts)       │
│       v                             v                    │
│  ┌─────────┐    leave_zoom    ┌─────────┐               │
│  │ CALLING │ ───────────────> │  IDLE   │               │
│  └─────────┘                  └─────────┘               │
│       │                                                  │
│       │ error                                            │
│       v                                                  │
│  ┌─────────┐    auto-recover  ┌─────────┐               │
│  │  ERROR  │ ───────────────> │  IDLE   │               │
│  └─────────┘                  └─────────┘               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Logging Strategy

### Decision
Use winston with daily rotation, max 50MB, info level default.

### Rationale
- **winston**: Industry standard for Node.js; supports rotation and transports
- **50MB limit**: Prevents storage exhaustion on 32GB microSD
- **Info level**: Captures commands and errors without verbose debug noise

### Configuration
```javascript
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: '/var/log/onesibox/app.log',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 2,
      tailable: true
    })
  ]
});
```

---

## 7. URL Whitelist Validation

### Decision
Validate all media URLs against strict domain whitelist before navigation.

### Rationale
- **Security**: Prevents navigation to malicious sites
- **Compliance**: Only authorized content sources allowed
- **Error handling**: Clear error code (E005) for rejected URLs

### Allowed Domains
```javascript
const ALLOWED_DOMAINS = [
  'jw.org',
  'www.jw.org',
  'wol.jw.org',
  /.*\.jw-cdn\.org$/,  // Wildcard for CDN subdomains
  'download-a.akamaihd.net'
];

function isUrlAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(domain =>
      domain instanceof RegExp ? domain.test(hostname) : hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}
```

---

## 8. systemd Service Configuration

### Decision
Run OnesiBox as a systemd service with automatic restart.

### Rationale
- **Auto-start**: Service starts on boot without user intervention
- **Watchdog**: systemd monitors and restarts on crash
- **Logging**: Integrates with journald for system-level logging

### Service Definition
```ini
[Unit]
Description=OnesiBox Client
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=onesibox
ExecStart=/usr/bin/node /opt/onesibox/src/main.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
WorkingDirectory=/opt/onesibox

[Install]
WantedBy=graphical.target
```

---

## 9. Zoom Web Client Considerations

### Decision
Use Zoom web client URL pattern; defer Playwright automation if permission issues arise.

### Research Findings
- Zoom web client works in Chromium on desktop; Raspberry Pi ARM64 compatibility needs testing
- Permission prompts may require `--use-fake-ui-for-media-stream` flag
- Meeting URL format: `https://zoom.us/j/{meeting_id}?pwd={password}`

### Fallback Strategy
If Zoom web client has issues on Raspberry Pi:
1. First attempt: Chromium flags for auto-permissions
2. Second attempt: Playwright for controlled automation
3. Third attempt: Native Zoom client (significant complexity increase)

### MVP Approach
Test with Chromium flags first; document any issues for Phase 2 resolution.

---

## 10. Volume Control

### Decision
Use ALSA amixer for system volume control via Node.js child_process.

### Rationale
- **Universal**: ALSA is standard on Raspberry Pi OS
- **Simple**: Single command for volume adjustment
- **Persistent**: amixer changes persist across reboots

### Implementation
```javascript
const { exec } = require('child_process');

async function setVolume(level) {
  const clampedLevel = Math.max(0, Math.min(100, level));
  return new Promise((resolve, reject) => {
    exec(`amixer set Master ${clampedLevel}%`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
```

---

## Summary

All technical unknowns from the Technical Context have been resolved:

| Unknown | Resolution |
|---------|------------|
| Architecture pattern | Chromium Kiosk + Node.js Backend |
| Browser control method | URL navigation |
| Polling mechanism | axios with exponential backoff |
| Logging approach | winston with 50MB rotation |
| Volume control | ALSA amixer |
| Service management | systemd |
| Zoom integration | Web client with Chromium flags |

**Phase 0 Complete** - Proceed to Phase 1: Design & Contracts
