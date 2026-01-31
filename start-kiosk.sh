#!/bin/bash

xset s off
xset s noblank
xset -dpms

unclutter -idle 0.5 -root &

chromium \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --disable-session-crashed-bubble \
      --disable-restore-session-state \
      --autoplay-policy=no-user-gesture-required \
      --use-fake-ui-for-media-stream \
      --check-for-update-interval=31536000 \
      --disable-component-update \
      --disable-background-networking \
      --disable-sync \
      --disable-default-apps \
      --disable-translate \
      --no-first-run \
      --start-fullscreen \
      --window-position=0,0 \
      --user-data-dir=/tmp/chromium \
      "$1"