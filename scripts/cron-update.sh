#!/bin/bash
#
# Wrapper script for cron-based auto-updates
# Adds random delay to avoid all devices updating simultaneously
#
# Install in crontab:
#   0 3 * * * /opt/onesibox/app/scripts/cron-update.sh
#
# This will check for updates every night at 3 AM (with random delay 0-30 min)
#

# Random delay (0-1800 seconds = 0-30 minutes)
# Prevents all devices from hitting the git server at the same time
DELAY=$((RANDOM % 1800))
sleep $DELAY

# Run update in cron mode (silent, no colors)
/opt/onesibox/update.sh --cron
