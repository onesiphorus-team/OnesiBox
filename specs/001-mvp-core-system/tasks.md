# Tasks: MVP Core System

**Input**: Design documents from `/specs/001-mvp-core-system/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested. Manual integration testing per quickstart.md.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US6)
- File paths follow plan.md structure

---

## Phase 1: Setup (Shared Infrastructure) ✅

**Purpose**: Project initialization and Node.js environment

- [x] T001 Create project structure with src/, web/, scripts/, config/, tests/ directories per plan.md
- [x] T002 Initialize Node.js project with package.json (name: onesibox, version: 1.0.0)
- [x] T003 [P] Install dependencies: axios, winston, systeminformation
- [x] T004 [P] Install dev dependencies: jest, eslint
- [x] T005 [P] Create .eslintrc.json with Node.js configuration
- [x] T006 [P] Create config/config.json.example with schema from data-model.md
- [x] T007 [P] Create .gitignore for node_modules, logs, config.json

---

## Phase 2: Foundational (Blocking Prerequisites) ✅

**Purpose**: Core infrastructure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Logging Infrastructure

- [x] T008 Implement logger with winston rotation in src/logging/logger.js (50MB max, info level default)

### Configuration Management

- [x] T009 Implement config loader with validation in src/config/config.js (load from config/config.json, validate per data-model.md rules)

### State Management

- [x] T010 Implement state-manager with status enum (idle/playing/calling/error) in src/state/state-manager.js
- [x] T011 Add connection status tracking (connected/reconnecting/offline) to src/state/state-manager.js

### API Client Foundation

- [x] T012 Implement base API client with auth headers in src/communication/api-client.js (Authorization: Bearer, X-Appliance-ID)
- [x] T013 Add exponential backoff retry logic to src/communication/api-client.js (5s, 10s, 20s, max 60s)

### Command Infrastructure

- [x] T014 Implement URL whitelist validator in src/commands/validator.js (jw.org, www.jw.org, wol.jw.org, *.jw-cdn.org, download-a.akamaihd.net)
- [x] T015 Implement command validator for structure/payload in src/commands/validator.js
- [x] T016 Create command manager skeleton with priority handling in src/commands/manager.js

### Browser Control Foundation

- [x] T017 Implement browser controller for URL navigation in src/browser/controller.js

**Checkpoint**: Foundation ready - user story implementation can begin

---

## Phase 3: User Story 3 - Automatic Device Startup and Connection (Priority: P1) 🎯 MVP ✅

**Goal**: Device boots, displays standby screen, connects to server automatically

**Independent Test**: Power cycle device → standby screen appears with green indicator within 60s

### Implementation for User Story 3

- [x] T018 [US3] Create standby screen HTML with logo, clock, connection indicator in web/index.html
- [x] T019 [P] [US3] Create standby screen CSS with large fonts, indicator colors in web/styles.css
- [x] T020 [P] [US3] Create client-side JS for clock update and status display in web/app.js
- [x] T021 [US3] Add simple HTTP server to serve web/ files in src/main.js
- [x] T022 [US3] Implement connection status indicator updates (green/yellow/red) via state-manager events
- [x] T023 [P] [US3] Create Chromium kiosk launcher script in scripts/start-kiosk.sh with flags from research.md
- [x] T024 [P] [US3] Create systemd service definition in scripts/onesibox.service
- [x] T025 [US3] Wire up main.js entry point: load config → start server → launch browser → connect

**Checkpoint**: Device can boot to standby screen with connection status

---

## Phase 4: User Story 4 - Server Communication via Polling (Priority: P2) ✅

**Goal**: Device polls server for commands, executes them, sends acknowledgments

**Independent Test**: Place command on server → device executes within 10s → ack received

### Implementation for User Story 4

- [x] T026 [US4] Implement polling client with configurable interval in src/communication/polling.js
- [x] T027 [US4] Add command fetching via GET /appliances/{id}/commands?status=pending
- [x] T028 [US4] Implement command dispatch from polling to command manager
- [x] T029 [US4] Add acknowledgment sending via POST /commands/{id}/ack in src/communication/api-client.js
- [x] T030 [US4] Handle connection failures: update state to reconnecting, apply backoff
- [x] T031 [US4] Handle 3 consecutive failures: update state to offline
- [x] T032 [US4] Wire polling to main.js startup sequence after connection established

**Checkpoint**: Device can receive and acknowledge commands from server

---

## Phase 5: User Story 5 - Device Health Monitoring (Priority: P2) ✅

**Goal**: Device sends heartbeat with status and metrics every 30 seconds

**Independent Test**: Monitor server → heartbeat received every 30s with correct status

### Implementation for User Story 5

- [x] T033 [P] [US5] Implement system metrics collector using systeminformation in src/communication/heartbeat.js
- [x] T034 [US5] Implement heartbeat service with configurable interval in src/communication/heartbeat.js
- [x] T035 [US5] Add heartbeat payload construction from state-manager (status, current_media)
- [x] T036 [US5] Implement heartbeat sending via POST /appliances/{id}/heartbeat
- [x] T037 [US5] Wire heartbeat to main.js startup after initial connection

**Checkpoint**: Device reports status and metrics to server periodically

---

## Phase 6: User Story 1 - Remote Video Playback (Priority: P1) 🎯 Core Feature ✅

**Goal**: Caregiver can play JW.org videos on device remotely

**Independent Test**: Send play_media command with JW.org URL → video plays fullscreen within 10s

### Implementation for User Story 1

- [x] T038 [US1] Implement play_media handler in src/commands/handlers/media.js
- [x] T039 [US1] Add URL validation using whitelist before navigation
- [x] T040 [US1] Implement stop_media handler to return to standby in src/commands/handlers/media.js
- [x] T041 [US1] Update state-manager on play (status=playing, current_media populated)
- [x] T042 [US1] Update state-manager on stop (status=idle, current_media=null)
- [x] T043 [US1] Add playback event reporting via POST /appliances/{id}/playback (started/stopped/completed)
- [x] T044 [US1] Register media handlers in command manager
- [x] T045 [US1] Add audio-only playback support (play audio, keep standby screen visible)

**Checkpoint**: Can play and stop JW.org videos remotely

---

## Phase 7: User Story 2 - Remote Zoom Meeting Participation (Priority: P1) 🎯 Core Feature ✅

**Goal**: Caregiver can connect device to Zoom meetings remotely

**Independent Test**: Send join_zoom command → device joins meeting with camera/mic within 15s

### Implementation for User Story 2

- [x] T046 [US2] Implement join_zoom handler in src/commands/handlers/zoom.js
- [x] T047 [US2] Add Zoom URL parsing (extract meeting_id, password from URL)
- [x] T048 [US2] Implement leave_zoom handler in src/commands/handlers/zoom.js
- [x] T049 [US2] Update state-manager on join (status=calling, current_meeting populated)
- [x] T050 [US2] Update state-manager on leave (status=idle, current_meeting=null)
- [x] T051 [US2] Implement priority interrupt: join_zoom interrupts playing state
- [x] T052 [US2] Register zoom handlers in command manager

**Checkpoint**: Can join and leave Zoom meetings remotely

---

## Phase 8: User Story 6 - Media Playback Controls (Priority: P3) ✅

**Goal**: Caregiver can pause, resume, and adjust volume during playback

**Independent Test**: Play video → send pause → playback pauses → send resume → playback resumes

### Implementation for User Story 6

- [x] T053 [US6] Implement pause_media handler in src/commands/handlers/media.js
- [x] T054 [US6] Implement resume_media handler in src/commands/handlers/media.js
- [x] T055 [US6] Update state-manager with is_paused flag
- [x] T056 [US6] Implement set_volume handler using ALSA amixer in src/commands/handlers/volume.js
- [x] T057 [US6] Add volume persistence in state-manager
- [x] T058 [US6] Add playback event reporting for paused/resumed
- [x] T059 [US6] Register control handlers in command manager

**Checkpoint**: Can control playback remotely (pause/resume/volume)

---

## Phase 9: Polish & Cross-Cutting Concerns ✅

**Purpose**: Error handling, edge cases, deployment preparation

- [x] T060 Add error state handling and auto-recovery (10s timeout) in state-manager
- [x] T061 Implement error code reporting (E001-E008) for all command failures
- [x] T062 Add graceful shutdown handling in main.js (SIGTERM, SIGINT)
- [x] T063 [P] Create device setup script in scripts/setup.sh (install deps, create user, enable service)
- [x] T064 [P] Create tests/integration/manual-test-checklist.md with scenarios from quickstart.md
- [x] T065 Add log rotation verification (check 50MB limit works)
- [ ] T066 Verify Chromium kiosk flags work on Raspberry Pi hardware (requires hardware)
- [ ] T067 Test full boot-to-ready sequence timing (<60s target) (requires hardware)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational) ← BLOCKS ALL STORIES
    ↓
    ├── Phase 3 (US3: Startup/Connection) ← MVP baseline
    │       ↓
    ├── Phase 4 (US4: Polling) ← Required for commands
    │       ↓
    ├── Phase 5 (US5: Heartbeat)
    │       ↓
    ├── Phase 6 (US1: Video Playback) ← Core feature
    │       ↓
    ├── Phase 7 (US2: Zoom) ← Core feature
    │       ↓
    └── Phase 8 (US6: Controls)
            ↓
        Phase 9 (Polish)
```

### User Story Dependencies

| Story | Depends On | Can Parallelize With |
|-------|-----------|---------------------|
| US3 (Startup) | Foundational | None (first story) |
| US4 (Polling) | US3 | US5 (after both have foundation) |
| US5 (Heartbeat) | US3, US4 | - |
| US1 (Video) | US4 | US2 (different handlers) |
| US2 (Zoom) | US4 | US1 (different handlers) |
| US6 (Controls) | US1 | - |

### Parallel Opportunities

**Within Setup (Phase 1):**
- T003, T004, T005, T006, T007 can all run in parallel

**Within User Stories:**
- T018/T019/T020 (web assets) can run in parallel
- T023/T024 (deployment scripts) can run in parallel
- US1 and US2 handlers can be developed in parallel after US4

**Across Stories (if team capacity allows):**
- After Phase 4 completes, US1 and US2 implementation can proceed in parallel

---

## Parallel Example: Phase 1 Setup

```bash
# All can run simultaneously:
Task: "Install dependencies: axios, winston, systeminformation" (T003)
Task: "Install dev dependencies: jest, eslint" (T004)
Task: "Create .eslintrc.json" (T005)
Task: "Create config.json.example" (T006)
Task: "Create .gitignore" (T007)
```

## Parallel Example: User Story 3 Web Assets

```bash
# These web files have no dependencies between them:
Task: "Create standby screen HTML" (T018)
Task: "Create standby screen CSS" (T019)
Task: "Create client-side JS" (T020)
```

---

## Implementation Strategy

### MVP First (Minimum Viable Product)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US3 (Startup/Connection)
4. Complete Phase 4: US4 (Polling)
5. Complete Phase 6: US1 (Video Playback)
6. **STOP and VALIDATE**: Test video playback end-to-end on Raspberry Pi
7. This is a deployable MVP that delivers core value

### Incremental Delivery Order

1. **MVP**: Setup → Foundational → US3 → US4 → US1 (Video)
2. **+Zoom**: Add US2 (Zoom meetings)
3. **+Monitoring**: Add US5 (Heartbeat)
4. **+Controls**: Add US6 (Pause/Resume/Volume)
5. **Polish**: Phase 9 refinements

### Recommended Execution

For a single developer:
1. Work sequentially through phases
2. Complete each checkpoint before proceeding
3. Test on actual Raspberry Pi hardware after US3
4. MVP checkpoint after US1 completion

For two developers:
1. Both work on Setup + Foundational
2. Dev A: US3 → US4 → US1
3. Dev B: US5 (after US4) → US2 (after US4)
4. Rejoin for US6 and Polish

---

## Task Summary

| Phase | Story | Task Count | Parallel Tasks |
|-------|-------|------------|----------------|
| 1 | Setup | 7 | 5 |
| 2 | Foundational | 10 | 0 |
| 3 | US3 (Startup) | 8 | 4 |
| 4 | US4 (Polling) | 7 | 0 |
| 5 | US5 (Heartbeat) | 5 | 1 |
| 6 | US1 (Video) | 8 | 0 |
| 7 | US2 (Zoom) | 7 | 0 |
| 8 | US6 (Controls) | 7 | 0 |
| 9 | Polish | 8 | 2 |
| **Total** | | **67** | **12** |

---

## Notes

- Each user story is independently testable after its phase completes
- [P] tasks can be assigned to parallel agents or team members
- Commit after each task or logical group
- Validate on Raspberry Pi hardware early (after Phase 3)
- MVP deliverable after Phase 6 (US1: Video Playback)
