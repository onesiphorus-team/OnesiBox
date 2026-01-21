# Manual Integration Test Checklist

**Feature**: MVP Core System
**Date**: ___________
**Tester**: ___________
**Device**: Raspberry Pi __ (___GB RAM)

## Prerequisites

- [ ] Raspberry Pi with Raspberry Pi OS Lite 64-bit (Bookworm)
- [ ] OnesiBox application installed at /opt/onesibox
- [ ] config.json configured with valid server credentials
- [ ] HDMI display connected
- [ ] USB webcam with microphone connected
- [ ] Network connection (Ethernet or WiFi)

---

## Hardware Tests

### Display

- [ ] **H1**: Power on device → Display shows standby screen within 60s
- [ ] **H2**: Standby screen shows OnesiBox logo
- [ ] **H3**: Standby screen shows current time (updates every second)
- [ ] **H4**: Standby screen shows current date

### Audio

- [ ] **H5**: Run `speaker-test -t wav -c 2` → Audio plays through speakers
- [ ] **H6**: Run `amixer set Master 50%` → Volume changes audibly
- [ ] **H7**: Run `amixer set Master 100%` → Volume at maximum

### Webcam

- [ ] **H8**: Run `v4l2-ctl --list-devices` → Webcam listed
- [ ] **H9**: Webcam LED lights up when accessing camera in browser

---

## Connectivity Tests

### Server Connection

- [ ] **C1**: Device appears online in server dashboard
- [ ] **C2**: Connection indicator on standby screen is GREEN
- [ ] **C3**: Heartbeat received in server logs every ~30 seconds
- [ ] **C4**: Heartbeat contains CPU, memory, disk, temperature metrics

### Connection Recovery

- [ ] **C5**: Disconnect Ethernet → Indicator turns YELLOW within 10s
- [ ] **C6**: After 3 failed polls → Indicator turns RED
- [ ] **C7**: Reconnect Ethernet → Indicator returns to GREEN within 60s
- [ ] **C8**: Check logs: backoff delays applied (5s, 10s, 20s, 60s)

---

## Command Tests

### Video Playback (US1)

- [ ] **V1**: Send `play_media` with JW.org video URL → Video plays fullscreen
- [ ] **V2**: Video plays with audio
- [ ] **V3**: Send `pause_media` → Video pauses
- [ ] **V4**: Send `resume_media` → Video resumes
- [ ] **V5**: Send `stop_media` → Returns to standby screen
- [ ] **V6**: Playback events (started/stopped) appear in server

### Invalid URL Handling

- [ ] **V7**: Send `play_media` with non-whitelisted URL → Command fails
- [ ] **V8**: Error code E005 returned in acknowledgment
- [ ] **V9**: Device remains on standby screen

### Zoom Meetings (US2)

- [ ] **Z1**: Send `join_zoom` with valid meeting URL → Opens Zoom web client
- [ ] **Z2**: Camera and microphone accessible in meeting
- [ ] **Z3**: Send `leave_zoom` → Returns to standby screen
- [ ] **Z4**: State shows status=calling during meeting

### Zoom Priority

- [ ] **Z5**: During video playback, send `join_zoom` → Video stops, Zoom opens
- [ ] **Z6**: Video state cleared before Zoom joins

### Volume Control (US6)

- [ ] **VC1**: Send `set_volume` level=50 → Volume changes audibly
- [ ] **VC2**: Send `set_volume` level=100 → Maximum volume
- [ ] **VC3**: Send `set_volume` level=0 → Muted
- [ ] **VC4**: Volume persists after command

---

## Recovery Tests

### Power Cycle

- [ ] **R1**: Power off device, wait 10s, power on
- [ ] **R2**: Device boots to standby screen within 60s
- [ ] **R3**: Connection indicator turns GREEN
- [ ] **R4**: No manual intervention required

### Error Recovery

- [ ] **R5**: Force error state (invalid command) → Error logged
- [ ] **R6**: Device auto-recovers to idle within 10s
- [ ] **R7**: Standby screen restored

### Service Restart

- [ ] **R8**: Run `sudo systemctl restart onesibox`
- [ ] **R9**: Service restarts successfully
- [ ] **R10**: Check logs: `journalctl -u onesibox -n 50`

---

## Performance Tests

### Boot Time

- [ ] **P1**: Time from power on to standby screen: _____ seconds
- [ ] **P2**: Target: <60 seconds

### Memory Usage

- [ ] **P3**: Idle memory usage (run `free -h`): _____ MB
- [ ] **P4**: Target: <500 MB idle

### During Video Playback

- [ ] **P5**: Memory during video: _____ MB
- [ ] **P6**: Target: <1 GB during video

---

## Log Verification

- [ ] **L1**: Logs written to /var/log/onesibox/
- [ ] **L2**: Log files rotate (check for dated files)
- [ ] **L3**: No sensitive data in logs (no tokens, passwords)
- [ ] **L4**: Errors logged with stack traces

---

## Test Results Summary

| Category | Pass | Fail | Skip |
|----------|------|------|------|
| Hardware | | | |
| Connectivity | | | |
| Commands | | | |
| Recovery | | | |
| Performance | | | |
| Logging | | | |
| **TOTAL** | | | |

## Notes

_Record any issues, observations, or deviations from expected behavior:_

---

## Sign-off

- [ ] All critical tests (marked with bold) passed
- [ ] Device ready for deployment

**Tester Signature**: ___________
**Date**: ___________
