#!/bin/bash
#
# Migration 004: Install Playwright browser for Zoom
# Required for Zoom web client to work
#

cd /opt/onesibox

echo "Installing Playwright Chromium browser..."
npx playwright install chromium

echo "Done"
