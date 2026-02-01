#!/bin/bash
#
# Migration 001: Reset browser profile
# Clears Playwright profile to apply new camera/microphone permissions
# and translation settings
#

PROFILE_DIR="/opt/onesibox/data/playwright-profile"

if [[ -d "${PROFILE_DIR}" ]]; then
    echo "Removing old browser profile to apply new permissions..."
    rm -rf "${PROFILE_DIR}"
    echo "Browser profile cleared"
else
    echo "No existing browser profile found"
fi

# Also clear chromium profile if using fallback mode
CHROMIUM_PROFILE="/opt/onesibox/data/chromium"
if [[ -d "${CHROMIUM_PROFILE}" ]]; then
    echo "Removing old Chromium profile..."
    rm -rf "${CHROMIUM_PROFILE}"
    echo "Chromium profile cleared"
fi

echo "New profiles will be created on next browser start"
