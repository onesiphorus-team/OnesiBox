#!/bin/bash
# Porta l'ingresso della TV LG su Live TV
# Host risolto da discover-tv.sh (solo la TV con il MAC in .tv-mac),
# esito registrato in lg-control.log
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/lg-run.sh" to-tv com.webos.app.livetv
