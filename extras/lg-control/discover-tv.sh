#!/bin/bash
# Resolve current LG TV IP, accepting only the TV whose MAC matches .tv-mac.
# On success: prints the IP on stdout, exits 0.
# On failure: exits 1. Diagnostics go to stderr.
#
# Every LG TV is called "LGWebOSTV" by default, so a hostname or a fixed IP
# may point to another TV on the LAN: candidates are accepted only if their
# MAC matches.
#
# Strategy:
#   1) ARP: look up our known MAC in the neighbor table
#   2) DNS hostname (LGWebOSTV) and static IP fallback, verified by MAC
#   3) Ping-sweep the /24 to populate the neighbor table, then retry ARP
#   4) Send a WoL magic packet (Mobile TV On must be enabled on the TV),
#      wait, then retry 1-3. Disable with WOL=0.

DIR="$(cd "$(dirname "$0")" && pwd)"
TV_HOSTNAME="${TV_HOSTNAME:-LGWebOSTV}"
TV_IP_FALLBACK="${TV_IP_FALLBACK:-192.168.1.48}"
TV_MAC="$(cat "$DIR/.tv-mac" 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
TV_PORT="${TV_PORT:-3001}"
SUBNET="${SUBNET:-192.168.1}"
WOL="${WOL:-1}"

if [ -z "$TV_MAC" ]; then
  echo "[discover-tv] MAC della TV mancante ($DIR/.tv-mac)" >&2
  exit 1
fi

reachable() {
  # $1 = IP. Returns 0 if the LG WebOS websocket port responds.
  timeout 2 bash -c "echo > /dev/tcp/$1/$TV_PORT" 2>/dev/null
}

mac_of() {
  ip -4 neigh show "$1" | awk '{for (i = 1; i < NF; i++) if ($i == "lladdr") { print tolower($(i + 1)); exit }}'
}

ip_by_mac() {
  ip -4 neigh | awk -v m="$TV_MAC" '$0 !~ /FAILED|INCOMPLETE/ && tolower($5) == m { print $1; exit }'
}

found() {
  echo "[discover-tv] TV trovata: $1 (MAC $TV_MAC, via $2)" >&2
  echo "$1"
}

probe_chain() {
  local ip cand mac

  ip="$(ip_by_mac)"
  if [ -n "$ip" ] && reachable "$ip"; then
    found "$ip" "ARP"; return 0
  fi

  for cand in $(getent ahostsv4 "$TV_HOSTNAME" 2>/dev/null | awk '{print $1}' | sort -u) "$TV_IP_FALLBACK"; do
    reachable "$cand" || continue
    mac="$(mac_of "$cand")"
    if [ "$mac" = "$TV_MAC" ]; then
      found "$cand" "$TV_HOSTNAME/IP fisso"; return 0
    fi
    echo "[discover-tv] scartato $cand: risponde sulla porta $TV_PORT ma il MAC e' ${mac:-sconosciuto}, non $TV_MAC" >&2
  done

  for i in $(seq 1 254); do (ping -c1 -W1 "$SUBNET.$i" >/dev/null 2>&1) & done
  wait
  ip="$(ip_by_mac)"
  if [ -n "$ip" ] && reachable "$ip"; then
    found "$ip" "scansione rete"; return 0
  fi
  if [ -n "$ip" ]; then
    echo "[discover-tv] MAC $TV_MAC presente su $ip ma la porta $TV_PORT non risponde (TV in standby?)" >&2
  fi
  return 1
}

if probe_chain; then
  exit 0
fi

if [ "$WOL" = "1" ]; then
  node "$DIR/wake-tv.js" >&2 || true
  for _ in 1 2 3 4 5; do
    sleep 5
    if probe_chain; then
      exit 0
    fi
  done
fi

echo "[discover-tv] TV unreachable" >&2
exit 1
