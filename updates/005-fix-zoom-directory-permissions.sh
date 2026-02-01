#!/bin/bash
#
# Migration 005: Add Zoom directory to systemd ReadWritePaths
# Fixes "File system in sola lettura" error when Zoom creates SingletonLock
#

SERVICE_FILE="/etc/systemd/system/onesibox.service"

if [[ ! -f "${SERVICE_FILE}" ]]; then
    echo "Service file not found, skipping"
    exit 0
fi

# Get the kiosk user from the service file
KIOSK_USER=$(grep "^User=" "${SERVICE_FILE}" | cut -d= -f2)
if [[ -z "${KIOSK_USER}" ]]; then
    echo "Could not determine kiosk user from service file"
    exit 1
fi

KIOSK_HOME=$(eval echo "~${KIOSK_USER}")
ZOOM_DIR="${KIOSK_HOME}/.onesibox-zoom"

echo "Checking systemd service for Zoom directory..."

# Check if zoom directory already in ReadWritePaths
if grep -q "${ZOOM_DIR}" "${SERVICE_FILE}"; then
    echo "Service already has ${ZOOM_DIR} in ReadWritePaths"
    exit 0
fi

echo "Adding ${ZOOM_DIR} to ReadWritePaths..."
sed -i "s|ReadWritePaths=\(.*\)|ReadWritePaths=\1 ${ZOOM_DIR}|" "${SERVICE_FILE}"

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Done - Zoom directory permissions fixed"
