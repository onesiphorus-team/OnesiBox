#!/bin/bash
#
# Migration 002: Fix systemd service permissions
# Adds /run/user/UID to ReadWritePaths and DBUS_SESSION_BUS_ADDRESS
# Required for Chromium to work properly with Wayland
#

SERVICE_FILE="/etc/systemd/system/onesibox.service"

if [[ ! -f "${SERVICE_FILE}" ]]; then
    echo "Service file not found, skipping"
    exit 0
fi

# Get the kiosk user UID from the service file
KIOSK_USER=$(grep "^User=" "${SERVICE_FILE}" | cut -d= -f2)
if [[ -z "${KIOSK_USER}" ]]; then
    echo "Could not determine kiosk user from service file"
    exit 1
fi

KIOSK_USER_UID=$(id -u "${KIOSK_USER}" 2>/dev/null)
if [[ -z "${KIOSK_USER_UID}" ]]; then
    echo "Could not get UID for user ${KIOSK_USER}"
    exit 1
fi

KIOSK_HOME=$(eval echo "~${KIOSK_USER}")
ZOOM_DIR="${KIOSK_HOME}/.onesibox-zoom"

echo "Updating systemd service for user ${KIOSK_USER} (UID: ${KIOSK_USER_UID})"

# Check if /run/user/UID already added
if grep -q "/run/user/${KIOSK_USER_UID}" "${SERVICE_FILE}"; then
    echo "Service already has /run/user/${KIOSK_USER_UID} in ReadWritePaths"
else
    echo "Adding /run/user/${KIOSK_USER_UID} to ReadWritePaths..."
    sed -i "s|ReadWritePaths=\(.*\)|ReadWritePaths=\1 /run/user/${KIOSK_USER_UID}|" "${SERVICE_FILE}"
fi

# Check if zoom directory already added
if grep -q "${ZOOM_DIR}" "${SERVICE_FILE}"; then
    echo "Service already has ${ZOOM_DIR} in ReadWritePaths"
else
    echo "Adding ${ZOOM_DIR} to ReadWritePaths..."
    sed -i "s|ReadWritePaths=\(.*\)|ReadWritePaths=\1 ${ZOOM_DIR}|" "${SERVICE_FILE}"
fi

# Add DBUS_SESSION_BUS_ADDRESS if not present
if grep -q "DBUS_SESSION_BUS_ADDRESS" "${SERVICE_FILE}"; then
    echo "DBUS_SESSION_BUS_ADDRESS already configured"
else
    echo "Adding DBUS_SESSION_BUS_ADDRESS..."
    sed -i "/Environment=XDG_RUNTIME_DIR/a Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${KIOSK_USER_UID}/bus" "${SERVICE_FILE}"
fi

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Systemd service updated successfully"
