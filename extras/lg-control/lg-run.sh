#!/bin/bash
# Usage: lg-run.sh <tag> <appId>
# Trova la TV (discover-tv.sh), lancia lg-switch.js e registra tutto in
# lg-control.log. In caso di errore l'output va anche su stderr, perche'
# OnesiBox nel suo log riporta solo lo stderr dello script.
DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="$1"
APP="$2"
LOG="$DIR/lg-control.log"

log() { printf '%s [%s:%s] %s\n' "$(date '+%F %T')" "$TAG" "$$" "$*" >> "$LOG"; }

# Tiene il log entro le 2000 righe
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 1000 "$LOG" > "$LOG.tmp.$$" && mv "$LOG.tmp.$$" "$LOG"
fi

log "avvio -> $APP"

disc="$(mktemp)"
TV_HOST="$("$DIR/discover-tv.sh" 2>"$disc")"
rc=$?
while IFS= read -r line; do log "$line"; done < "$disc"
if [ $rc -ne 0 ]; then
  cat "$disc" >&2
  rm -f "$disc"
  log "esito: TV non raggiungibile"
  echo "[$TAG] TV non raggiungibile" >&2
  exit 1
fi
rm -f "$disc"

out="$(NODE_NO_WARNINGS=1 LG_TV_HOST="$TV_HOST" node "$DIR/lg-switch.js" "$APP" 2>&1)"
rc=$?
while IFS= read -r line; do log "$line"; done <<< "$out"
log "esito: rc=$rc host=$TV_HOST"

if [ $rc -eq 0 ]; then
  echo "$out"
else
  echo "[$TAG] host=$TV_HOST $out" >&2
fi
exit $rc
