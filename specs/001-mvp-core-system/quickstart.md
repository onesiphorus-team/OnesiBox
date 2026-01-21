# Quickstart: MVP Core System

**Feature**: 001-mvp-core-system
**Date**: 2026-01-21

## Prerequisites

### Hardware
- Raspberry Pi 5 (4GB RAM) or Raspberry Pi 4 (4GB RAM, legacy)
- 32GB microSD card (Class A2 recommended)
- HDMI display
- USB webcam with microphone (e.g., Logitech C920)
- Ethernet cable or WiFi access
- Power supply (official Raspberry Pi 5 27W USB-C)

### Software (on development machine)
- Node.js 20 LTS
- Git
- SSH client

### Server
- Onesiforo server instance running and accessible
- Pre-generated appliance token for this device

---

## Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/onesiphorus-team/onesibox-client.git
cd onesibox-client
git checkout 001-mvp-core-system
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Configuration

```bash
cp config/config.json.example config/config.json
```

Edit `config/config.json`:
```json
{
  "server_url": "https://your-onesiforo-server.com",
  "appliance_id": "your-appliance-uuid",
  "appliance_token": "your-appliance-token",
  "polling_interval_seconds": 5,
  "heartbeat_interval_seconds": 30,
  "default_volume": 80
}
```

### 4. Run Locally (without kiosk mode)

```bash
# Development mode with logging to console
npm run dev

# Production mode
npm start
```

### 5. Run Tests

```bash
# Unit tests
npm test

# Watch mode during development
npm run test:watch
```

---

## Raspberry Pi Deployment

### 1. Flash Raspberry Pi OS

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Select "Raspberry Pi OS Lite (64-bit)" - Bookworm
3. Configure:
   - Hostname: `onesibox-<beneficiary-name>`
   - Enable SSH with password
   - Configure WiFi if not using Ethernet
4. Flash to microSD card

### 2. Initial Pi Setup

SSH into the Pi:
```bash
ssh pi@onesibox-<name>.local
```

Update system:
```bash
sudo apt update && sudo apt upgrade -y
```

Install dependencies:
```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Chromium and display dependencies
sudo apt install -y chromium-browser xserver-xorg x11-xserver-utils xinit openbox

# Audio tools
sudo apt install -y alsa-utils

# Webcam tools (for testing)
sudo apt install -y v4l-utils
```

### 3. Deploy Application

```bash
# Create application directory
sudo mkdir -p /opt/onesibox
sudo chown pi:pi /opt/onesibox

# Clone and install
cd /opt/onesibox
git clone https://github.com/onesiphorus-team/onesibox-client.git .
git checkout 001-mvp-core-system
npm install --production

# Create config
cp config/config.json.example config/config.json
nano config/config.json  # Edit with actual values
```

### 4. Configure Auto-Start

Create systemd service:
```bash
sudo nano /etc/systemd/system/onesibox.service
```

Content:
```ini
[Unit]
Description=OnesiBox Client
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=pi
ExecStart=/usr/bin/node /opt/onesibox/src/main.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
WorkingDirectory=/opt/onesibox

[Install]
WantedBy=graphical.target
```

Enable service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable onesibox
sudo systemctl start onesibox
```

### 5. Configure Chromium Kiosk

Create kiosk autostart:
```bash
mkdir -p ~/.config/openbox
nano ~/.config/openbox/autostart
```

Content:
```bash
# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Start Chromium in kiosk mode
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
  http://localhost:3000 &
```

Configure auto-login and X start:
```bash
# Auto-login to console
sudo raspi-config  # Console Autologin

# Start X on login
echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx' >> ~/.bash_profile
```

### 6. Verify Installation

Reboot and verify:
```bash
sudo reboot
```

After reboot:
- Display should show standby screen with logo, time, and green connection indicator
- Check logs: `journalctl -u onesibox -f`
- Test command from server dashboard

---

## Testing Checklist

### Hardware Tests
- [ ] Display shows standby screen
- [ ] Audio plays through connected speakers
- [ ] Webcam visible in Zoom test
- [ ] Microphone captures audio

### Connectivity Tests
- [ ] Device appears online in server dashboard
- [ ] Heartbeat received every 30 seconds
- [ ] Connection indicator is green

### Command Tests
- [ ] `play_media` with video URL → video plays fullscreen
- [ ] `stop_media` → returns to standby
- [ ] `pause_media` / `resume_media` → playback pauses/resumes
- [ ] `set_volume` → volume changes audibly
- [ ] `join_zoom` with test meeting → joins meeting with A/V
- [ ] `leave_zoom` → returns to standby

### Recovery Tests
- [ ] Disconnect network → yellow indicator, reconnects when restored
- [ ] Power cycle → auto-starts and reconnects within 60s
- [ ] Invalid URL command → error logged, device returns to standby

---

## Troubleshooting

### No display output
```bash
# Check X is running
ps aux | grep X
# Start manually
startx
```

### Audio not working
```bash
# List audio devices
aplay -l
# Test audio
speaker-test -t wav -c 2
# Set volume
amixer set Master 80%
```

### Webcam not detected
```bash
# List video devices
v4l2-ctl --list-devices
# Check permissions
ls -la /dev/video*
```

### Service not starting
```bash
# Check service status
sudo systemctl status onesibox
# View logs
journalctl -u onesibox -n 100
```

### Connection issues
```bash
# Test server connectivity
curl -I https://your-server.com/api/v1/health
# Check DNS
nslookup your-server.com
# Check token (should return 401 without valid token)
curl -H "Authorization: Bearer invalid" https://your-server.com/api/v1/appliances/test/commands
```

---

## Next Steps

After successful MVP deployment:
1. Document any Zoom permission issues for Phase 2 Playwright integration
2. Monitor RAM usage over 24h to validate <500MB idle target
3. Test with actual JW.org content URLs
4. Gather feedback from pilot beneficiary installation
