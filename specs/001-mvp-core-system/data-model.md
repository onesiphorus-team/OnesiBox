# Data Model: MVP Core System

**Feature**: 001-mvp-core-system
**Date**: 2026-01-21

## Overview

This document defines the data entities, their attributes, relationships, and state transitions for the OnesiBox MVP client application.

---

## Entities

### 1. Configuration

Device settings loaded from local JSON file at startup.

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| server_url | string (URL) | Yes | - | Onesiforo server base URL |
| appliance_id | string (UUID) | Yes | - | Unique device identifier |
| appliance_token | string | Yes | - | Bearer authentication token |
| polling_interval_seconds | integer | No | 5 | Command polling frequency |
| heartbeat_interval_seconds | integer | No | 30 | Heartbeat send frequency |
| default_volume | integer (0-100) | No | 80 | Initial audio volume |

**Validation Rules**:
- `server_url` must be valid HTTPS URL
- `appliance_id` must be valid UUID format
- `polling_interval_seconds` must be >= 1
- `heartbeat_interval_seconds` must be >= 10
- `default_volume` must be 0-100

**Example**:
```json
{
  "server_url": "https://onesiforo.example.com",
  "appliance_id": "550e8400-e29b-41d4-a716-446655440000",
  "appliance_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "polling_interval_seconds": 5,
  "heartbeat_interval_seconds": 30,
  "default_volume": 80
}
```

---

### 2. ApplianceState

Runtime state of the OnesiBox device (in-memory).

| Attribute | Type | Description |
|-----------|------|-------------|
| status | enum | Current device status |
| current_media | MediaInfo | null | Active media if playing |
| current_meeting | MeetingInfo | null | Active meeting if calling |
| connection_status | enum | Server connection state |
| last_heartbeat | timestamp | Last successful heartbeat time |
| volume | integer (0-100) | Current audio volume level |

**Status Enum Values**:
- `idle` - Standby screen displayed, ready for commands
- `playing` - Media (video/audio) actively playing
- `calling` - In Zoom meeting
- `error` - Error state, awaiting recovery

**Connection Status Enum**:
- `connected` - Server reachable, polling active
- `reconnecting` - Attempting to restore connection
- `offline` - 3+ consecutive failures, backoff active

---

### 3. Command

Instruction received from the Onesiforo server.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string (UUID) | Yes | Unique command identifier |
| type | enum | Yes | Command type |
| payload | object | No | Type-specific parameters |
| priority | integer | No | Execution priority (lower = higher) |
| created_at | timestamp | Yes | Server-side creation time |
| expires_at | timestamp | No | Command expiration (null = no expiry) |

**Command Types**:

| Type | Priority | Payload Schema |
|------|----------|----------------|
| `play_media` | 2 | `{ url: string, media_type: "video"|"audio", autoplay?: boolean, start_position?: number }` |
| `stop_media` | 2 | `{}` |
| `pause_media` | 2 | `{}` |
| `resume_media` | 2 | `{}` |
| `set_volume` | 3 | `{ level: number (0-100) }` |
| `join_zoom` | 1 | `{ meeting_url: string, meeting_id?: string, password?: string }` |
| `leave_zoom` | 1 | `{}` |

**Priority Rules**:
- Priority 1 commands (Zoom) interrupt any current action
- Priority 2 commands (media) queue if lower priority action in progress
- Priority 3 commands (volume) execute alongside current action

---

### 4. MediaInfo

Information about currently playing media.

| Attribute | Type | Description |
|-----------|------|-------------|
| url | string | Media source URL |
| media_type | enum | "video" or "audio" |
| position | number | Current playback position (seconds) |
| duration | number | null | Total duration if known (seconds) |
| started_at | timestamp | Playback start time |
| is_paused | boolean | Whether playback is paused |

---

### 5. MeetingInfo

Information about active Zoom meeting.

| Attribute | Type | Description |
|-----------|------|-------------|
| meeting_url | string | Zoom meeting URL |
| meeting_id | string | null | Extracted meeting ID |
| joined_at | timestamp | Meeting join time |

---

### 6. Heartbeat

Periodic status report sent to server.

| Attribute | Type | Description |
|-----------|------|-------------|
| status | enum | Current appliance status |
| current_media | object | null | Media info if playing |
| cpu_usage | number | CPU utilization percentage |
| memory_usage | number | RAM utilization percentage |
| disk_usage | number | Disk utilization percentage |
| temperature | number | CPU temperature in Celsius |
| uptime | number | Device uptime in seconds |
| timestamp | timestamp | Heartbeat creation time |

**Example Payload**:
```json
{
  "status": "playing",
  "current_media": {
    "url": "https://www.jw.org/finder?docid=...",
    "media_type": "video",
    "position": 120,
    "duration": 3600
  },
  "cpu_usage": 25,
  "memory_usage": 45,
  "disk_usage": 30,
  "temperature": 52.5,
  "uptime": 86400,
  "timestamp": "2026-01-21T10:30:00Z"
}
```

---

### 7. CommandAcknowledgment

Confirmation sent after command execution.

| Attribute | Type | Description |
|-----------|------|-------------|
| command_id | string (UUID) | Reference to executed command |
| status | enum | Execution result |
| error_code | string | null | Error code if failed |
| error_message | string | null | Human-readable error description |
| executed_at | timestamp | Execution completion time |

**Status Enum**:
- `success` - Command executed successfully
- `failed` - Command execution failed
- `skipped` - Command superseded by higher priority

**Error Codes**:
| Code | Description |
|------|-------------|
| E001 | Server connection error |
| E002 | Invalid authentication token |
| E003 | Unknown command type |
| E004 | Invalid command payload |
| E005 | URL not in authorized domain whitelist |
| E006 | Media playback error |
| E007 | Zoom join error |
| E008 | Volume adjustment error |

---

## State Transitions

### Appliance Status State Machine

```
                    ┌─────────────────────────────────────────┐
                    │              BOOT                        │
                    │         (initial state)                  │
                    └──────────────┬──────────────────────────┘
                                   │
                                   │ boot complete
                                   │ connection established
                                   v
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│    ┌──────────┐                                      ┌──────────┐          │
│    │   IDLE   │ ─────── play_media ────────────────> │ PLAYING  │          │
│    │          │ <────── stop_media/complete ──────── │          │          │
│    └──────────┘                                      └──────────┘          │
│         │  ^                                              │                 │
│         │  │                                              │                 │
│         │  │ leave_zoom                                   │                 │
│         │  │                                              │                 │
│         │  │         ┌───────────────────────────────────┘                 │
│         │  │         │  join_zoom (interrupts playing)                     │
│         │  │         v                                                      │
│         │  └──────────────────┐                                            │
│         │                     │                                            │
│         │ join_zoom           │                                            │
│         v                     │                                            │
│    ┌──────────┐ <─────────────┘                                            │
│    │ CALLING  │                                                            │
│    │          │                                                            │
│    └──────────┘                                                            │
│         │                                                                   │
│         │ error (any state)                                                │
│         v                                                                   │
│    ┌──────────┐                                      ┌──────────┐          │
│    │  ERROR   │ ─────── auto-recovery (10s) ───────> │   IDLE   │          │
│    │          │                                      │          │          │
│    └──────────┘                                      └──────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Connection Status Transitions

```
┌───────────┐
│ connected │ ───── poll failure ─────> ┌──────────────┐
│           │ <──── poll success ────── │ reconnecting │
└───────────┘                           └──────────────┘
                                               │
                                               │ 3 consecutive failures
                                               v
                                        ┌──────────┐
                                        │ offline  │
                                        │          │ ◄─── backoff retry loop
                                        └──────────┘
                                               │
                                               │ poll success
                                               v
                                        ┌───────────┐
                                        │ connected │
                                        └───────────┘
```

---

## Relationships

```
┌──────────────┐       uses        ┌───────────────┐
│ Configuration│ ─────────────────>│ ApplianceState│
└──────────────┘                   └───────────────┘
                                          │
                                          │ contains (0..1)
                                          v
                                   ┌─────────────┐
                                   │  MediaInfo  │
                                   └─────────────┘
                                          │
                                          │ or (0..1)
                                          v
                                   ┌─────────────┐
                                   │ MeetingInfo │
                                   └─────────────┘

┌─────────┐         triggers        ┌──────────────┐
│ Command │ ───────────────────────>│ApplianceState│
└─────────┘                         │  transition  │
     │                              └──────────────┘
     │ produces
     v
┌─────────────────────┐
│CommandAcknowledgment│
└─────────────────────┘

┌───────────────┐        reports        ┌───────────┐
│ ApplianceState│ ─────────────────────>│ Heartbeat │
└───────────────┘                       └───────────┘
```

---

## Data Flow

1. **Startup**: Configuration loaded from `config.json` → ApplianceState initialized as `idle`
2. **Polling**: Commands fetched from server → validated → dispatched to handlers
3. **Execution**: Handler updates ApplianceState → triggers browser navigation if needed
4. **Acknowledgment**: CommandAcknowledgment sent to server with result
5. **Heartbeat**: ApplianceState sampled → Heartbeat constructed → sent to server
