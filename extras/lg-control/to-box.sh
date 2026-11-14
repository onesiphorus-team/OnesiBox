#!/bin/bash
# Porta l'input della TV LG sull'onesi-box (HDMI 2)
# Host risolto da discover-tv.sh (solo la TV con il MAC in .tv-mac),
# esito registrato in lg-control.log
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/lg-run.sh" to-box com.webos.app.hdmi2
