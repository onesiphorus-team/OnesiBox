#!/bin/bash
# OnesiBox Kiosk Launcher
# Nota: Chromium viene ora gestito da Playwright nel backend Node.js
# Questo script serve solo per compatibilità e per eventuali setup iniziali

URL="${1:-http://localhost:3000}"

# Detect display server
if [ -n "$WAYLAND_DISPLAY" ] || [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "Running on Wayland (labwc/PIXEL)"
    IS_WAYLAND=true
else
    echo "Running on X11"
    IS_WAYLAND=false

    # X11-specific: Disable screensaver and DPMS
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true

    # X11-specific: Hide cursor
    if command -v unclutter &> /dev/null; then
        unclutter -idle 3 -root &
    fi
fi

# Wait for OnesiBox backend to be ready
echo "Waiting for OnesiBox backend at $URL..."
for i in {1..60}; do
    if curl -s "$URL/api/status" > /dev/null 2>&1; then
        echo "Backend ready!"
        break
    fi
    echo "Waiting... ($i/60)"
    sleep 1
done

# The browser is now managed by Playwright in the Node.js backend
# This script keeps the session alive

echo "OnesiBox kiosk startup complete"
echo "Browser is managed by Playwright in the backend"

# Keep running to maintain the session
exec sleep infinity
