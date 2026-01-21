# Feature Specification: MVP Core System

**Feature Branch**: `001-mvp-core-system`
**Created**: 2026-01-21
**Status**: Draft
**Input**: MVP Core System - Setup iniziale Raspberry Pi con Chromium kiosk, polling HTTP per comandi, riproduzione media JW.org, partecipazione Zoom, e heartbeat di base

## Clarifications

### Session 2026-01-21

- Q: How should the authentication token be protected at rest? → A: Token stored in plaintext config file (accept risk for MVP simplicity)
- Q: What logging level and retention policy should the device use? → A: Info-level logging with automatic rotation (max 50MB)
- Q: How should the system handle a high-priority command arriving during an active action? → A: Higher priority commands interrupt current action immediately

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remote Video Playback for Elderly Beneficiary (Priority: P1)

As a caregiver, I want to send a video from JW.org to my elderly relative's device so that they can watch spiritual content without needing any technical knowledge or interaction with the device.

The beneficiary (elderly person with limited mobility) sits in front of their TV connected to the OnesiBox. The caregiver, using their smartphone or tablet, selects a video and sends a command through the Onesiforo server. The OnesiBox automatically receives the command, navigates to the video, and plays it fullscreen with audio - all without the beneficiary needing to touch anything.

**Why this priority**: This is the core value proposition of OnesiBox. Media playback from JW.org is the primary use case that directly serves the beneficiaries' spiritual needs. Without this capability, the system provides no value.

**Independent Test**: Can be fully tested by sending a play_media command with a JW.org video URL and verifying the video plays fullscreen with audio on the connected display.

**Acceptance Scenarios**:

1. **Given** the OnesiBox is powered on and connected to the server, **When** a caregiver sends a video playback command with a valid JW.org URL, **Then** the video displays fullscreen on the TV within 10 seconds and audio plays at the configured volume level.

2. **Given** a video is currently playing, **When** the caregiver sends a stop command, **Then** the video stops and the standby screen appears within 2 seconds.

3. **Given** the OnesiBox is in standby mode, **When** a caregiver sends an audio-only playback command, **Then** the audio plays at the configured volume while the standby screen remains visible.

4. **Given** the device is displaying the standby screen, **When** no commands are received, **Then** the screen shows the logo, current time, and a green connection indicator.

---

### User Story 2 - Remote Zoom Meeting Participation (Priority: P1)

As a caregiver, I want to connect my elderly relative to a Zoom meeting so they can participate in congregation gatherings remotely without needing to know how to use technology.

The beneficiary wants to attend a congregation meeting via Zoom. The caregiver receives the Zoom meeting link and sends it to the OnesiBox through the Onesiforo server. The device automatically joins the meeting, enables camera and microphone, and displays the meeting fullscreen so the beneficiary can see and hear everyone, and they can see and hear them.

**Why this priority**: Zoom participation is equally critical as media playback - it enables social connection and participation in congregation activities, which is a primary goal of the Onesiforo project.

**Independent Test**: Can be fully tested by sending a join_zoom command with meeting credentials and verifying the device joins the meeting with video/audio enabled.

**Acceptance Scenarios**:

1. **Given** the OnesiBox is in standby mode, **When** a caregiver sends a Zoom meeting join command with meeting URL and password, **Then** the device joins the meeting within 15 seconds with camera and microphone active.

2. **Given** the device is in a Zoom meeting, **When** the caregiver sends a leave command, **Then** the device disconnects from the meeting and returns to standby within 5 seconds.

3. **Given** a Zoom meeting is active, **When** the beneficiary speaks into the webcam, **Then** their audio and video are transmitted to meeting participants.

---

### User Story 3 - Automatic Device Startup and Connection (Priority: P1)

As an installer/technician, I want the OnesiBox to automatically start, connect to the server, and be ready to receive commands when powered on, so that the beneficiary never needs to interact with the device.

When the OnesiBox is plugged in, it boots automatically, launches the browser in kiosk mode, displays the standby screen, and establishes connection with the Onesiforo server. The device should be fully operational without any user intervention.

**Why this priority**: Zero-touch operation is a fundamental principle. The entire value proposition depends on the beneficiary never needing to interact with the device. Without automatic startup and connection, the system cannot function.

**Independent Test**: Can be fully tested by power cycling the device and measuring time to reach connected standby state, verifying no user interaction is required.

**Acceptance Scenarios**:

1. **Given** the OnesiBox is powered off, **When** power is applied, **Then** the device boots to the standby screen with server connection established within 60 seconds.

2. **Given** the device has just booted, **When** the first heartbeat is sent, **Then** it occurs within 15 seconds of reaching the standby screen.

3. **Given** the device is connected, **When** viewing the standby screen, **Then** a green indicator confirms the active connection.

---

### User Story 4 - Server Communication via Polling (Priority: P2)

As a caregiver, I want commands I send to be received by the device reliably, so I can be confident my elderly relative will receive the content I send.

The OnesiBox periodically checks the Onesiforo server for new commands. When a command is found, it is executed and the result is reported back to the server. This allows caregivers to see confirmation that their actions were successful.

**Why this priority**: Reliable command reception is essential infrastructure, but polling is a fallback mechanism (WebSocket is preferred in later phases). It must work correctly but is slightly lower priority than core user-facing features.

**Independent Test**: Can be tested by sending a command via the server API and monitoring the device logs to verify command reception, execution, and acknowledgment.

**Acceptance Scenarios**:

1. **Given** the device is connected, **When** a command is placed in the queue on the server, **Then** the device retrieves and executes the command within 5-10 seconds (depending on polling interval).

2. **Given** a command has been executed, **When** execution completes, **Then** an acknowledgment with success/failure status is sent to the server within 5 seconds.

3. **Given** the server is temporarily unreachable, **When** connectivity is restored, **Then** the device resumes polling and processes any pending commands.

---

### User Story 5 - Device Health Monitoring (Priority: P2)

As a technician, I want to monitor the health of installed devices from the server dashboard, so I can proactively identify and resolve issues before they affect beneficiaries.

The OnesiBox sends periodic heartbeat signals to the server containing device status and basic health metrics. This allows technicians to see which devices are online, what they're currently doing, and whether any issues exist.

**Why this priority**: Monitoring enables proactive maintenance and troubleshooting, reducing support burden. It's essential infrastructure but not directly user-facing.

**Independent Test**: Can be tested by monitoring the server for heartbeat reception and verifying included data accuracy.

**Acceptance Scenarios**:

1. **Given** the device is connected, **When** 30 seconds elapse, **Then** a heartbeat is sent to the server containing device status (idle/playing/calling).

2. **Given** a video is playing, **When** a heartbeat is sent, **Then** it includes the current media URL and playback position.

3. **Given** the device is online, **When** viewing the server dashboard, **Then** the device appears as online with its current status visible.

---

### User Story 6 - Media Playback Controls (Priority: P3)

As a caregiver, I want to pause, resume, and adjust volume for content playing on my relative's device, so I can help them if they need a break or the volume needs adjustment.

While media is playing, the caregiver can send commands to pause playback, resume it, stop it entirely, or adjust the volume level without needing physical access to the device.

**Why this priority**: Controls enhance the media experience but are not essential for basic operation. The ability to start/stop media (covered in Story 1) is more critical.

**Independent Test**: Can be tested by playing media and sending pause/resume/volume commands, verifying correct response.

**Acceptance Scenarios**:

1. **Given** a video is playing, **When** a pause command is sent, **Then** playback pauses within 1 second.

2. **Given** playback is paused, **When** a resume command is sent, **Then** playback resumes from the pause point within 1 second.

3. **Given** media is playing at volume 80, **When** a set_volume command with value 50 is sent, **Then** the audio volume reduces immediately.

---

### Edge Cases

- What happens when the network disconnects during video playback?
  - The video continues if buffered; when network returns, heartbeats resume.

- How does the system handle an invalid or expired Zoom meeting link?
  - The device reports an error to the server and returns to standby screen.

- What happens when a command contains a URL from an unauthorized domain?
  - The command is rejected with error code E005, logged, and reported to the server.

- What happens if the server is unreachable at boot time?
  - The device displays the standby screen with a yellow "reconnecting" indicator and retries with exponential backoff.

- What happens if power is lost during a Zoom meeting?
  - On power restoration, the device boots to standby. The meeting session is lost, but this is expected behavior.

- What happens if multiple commands arrive while one is being executed?
  - Higher priority commands interrupt the current action immediately; equal or lower priority commands are queued and may be skipped if superseded.

## Requirements *(mandatory)*

### Functional Requirements

**Device Initialization**

- **FR-001**: System MUST boot automatically when power is applied without requiring any user interaction.
- **FR-002**: System MUST launch a fullscreen browser in kiosk mode displaying the standby screen.
- **FR-003**: System MUST reach the standby screen within 60 seconds of power-on.
- **FR-004**: System MUST automatically connect to the configured Onesiforo server using stored credentials.

**Server Communication**

- **FR-005**: System MUST poll the server for pending commands every 5 seconds (configurable).
- **FR-006**: System MUST include authentication token in all server requests.
- **FR-007**: System MUST send acknowledgment (success/failure) after executing each command.
- **FR-008**: System MUST retry failed server connections using exponential backoff (5s, 10s, 20s, max 60s).
- **FR-009**: System MUST send heartbeat to server every 30 seconds (configurable).
- **FR-010**: System MUST include in heartbeat: current status (idle/playing/calling), media info if playing.

**Media Playback**

- **FR-011**: System MUST play video from authorized JW.org domains in fullscreen mode.
- **FR-012**: System MUST play audio from authorized JW.org domains at configured volume level.
- **FR-013**: System MUST validate media URLs against the authorized domain whitelist before navigation.
- **FR-014**: System MUST reject URLs not matching: jw.org, www.jw.org, wol.jw.org, *.jw-cdn.org, download-a.akamaihd.net.
- **FR-015**: System MUST support pause, resume, and stop commands during media playback.
- **FR-016**: System MUST support volume adjustment (0-100 range).
- **FR-017**: System MUST report playback events (started, paused, resumed, stopped, completed) to the server.

**Zoom Integration**

- **FR-018**: System MUST join Zoom meetings by navigating to the provided meeting URL.
- **FR-019**: System MUST automatically accept browser permission prompts for camera and microphone.
- **FR-020**: System MUST display Zoom meeting in fullscreen mode.
- **FR-021**: System MUST support leaving Zoom meetings on command.

**Standby Screen**

- **FR-022**: System MUST display standby screen when not playing media or in a call.
- **FR-023**: System MUST show connection status indicator (green=connected, yellow=reconnecting, red=offline).
- **FR-024**: System MUST show current time on standby screen.
- **FR-025**: System MUST display error messages in large, readable font when errors occur.

**Command Processing**

- **FR-026**: System MUST process commands in priority order; higher priority commands MUST interrupt the current action immediately (e.g., join_zoom interrupts video playback).
- **FR-027**: System MUST validate command structure and payload before execution.
- **FR-028**: System MUST report command execution errors with appropriate error codes.

**Observability**

- **FR-029**: System MUST log events at info level by default (commands received, executed, errors, state changes).
- **FR-030**: System MUST automatically rotate logs when size exceeds 50MB to prevent storage exhaustion.

### Key Entities

- **Appliance**: The OnesiBox device instance, identified by unique ID and authentication token. Has status (idle, playing, calling, error), configuration settings, and current media state.

- **Command**: An instruction sent from the server to the appliance. Has type (play_media, stop_media, pause_media, resume_media, set_volume, join_zoom, leave_zoom), payload (type-specific parameters), priority level, and status (pending, executed, failed, skipped).

- **Heartbeat**: Periodic status report from appliance to server. Contains device status, current media information (if playing), and timestamp.

- **Configuration**: Device settings including server URL, polling interval, heartbeat interval, default volume, and authentication credentials. Token stored in plaintext config file for MVP simplicity (security hardening deferred to future phase).

## Assumptions

- Internet connectivity is available at the beneficiary's location (WiFi, Ethernet, or LTE).
- The Onesiforo server is operational and reachable.
- A display (TV/monitor) is connected via HDMI.
- A USB webcam with microphone is connected and functional.
- The device has been pre-configured with valid authentication token by the installer.
- JW.org content is publicly accessible without authentication.
- Zoom web client works in Chromium kiosk mode on Raspberry Pi.
- Time synchronization (NTP) is available for accurate clock display.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Device reaches connected standby state within 60 seconds of power-on without any user interaction.
- **SC-002**: Commands are received and execution begins within 10 seconds of being placed on the server queue.
- **SC-003**: JW.org video pages load and begin playback within 5 seconds of receiving command.
- **SC-004**: Zoom meetings are joined with camera/microphone active within 15 seconds of receiving command.
- **SC-005**: 100% of commands receive acknowledgment sent to server within 5 seconds of execution completion.
- **SC-006**: Device maintains connection with server for 24+ hours without manual intervention.
- **SC-007**: Beneficiaries can view video and participate in Zoom calls without touching the device (zero-touch operation).
- **SC-008**: System recovers from network disconnection within 2 minutes of connectivity restoration.
- **SC-009**: Caregivers can verify command execution status through server dashboard for 100% of sent commands.
