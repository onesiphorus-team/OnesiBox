#!/bin/bash
#
# Migration 003: Create Zoom profile directory
# Required for Zoom web client to work
#

# Get kiosk user from systemd service
KIOSK_USER=$(grep "^User=" /etc/systemd/system/onesibox.service 2>/dev/null | cut -d= -f2)
KIOSK_USER=${KIOSK_USER:-debian}
KIOSK_HOME=$(eval echo "~$KIOSK_USER")

ZOOM_DIR="${KIOSK_HOME}/.onesibox-zoom"

if [[ -d "${ZOOM_DIR}" ]]; then
    echo "Zoom directory already exists: ${ZOOM_DIR}"
else
    echo "Creating Zoom directory: ${ZOOM_DIR}"
    mkdir -p "${ZOOM_DIR}"
    chown "${KIOSK_USER}:${KIOSK_USER}" "${ZOOM_DIR}"
    echo "Done"
fi
