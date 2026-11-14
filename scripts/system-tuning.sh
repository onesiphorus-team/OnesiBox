#!/bin/bash
#
# Ottimizzazioni di sistema OnesiBox, comuni a Raspberry Pi 4 e Pi 5.
#
# Nate sul box Pi 4 che dal 15/08/2026 entra in tutte le adunanze senza
# problemi; qui sono raccolte in un posto solo, cosi' le applicano allo stesso
# modo install.sh (installazioni nuove) e updates/007 (box gia' installati).
#
# Idempotente: si puo' rieseguire quante volte si vuole.
#
# NON riavvia nulla che possa interrompere una riunione in corso: niente
# restart di onesibox, wireplumber o journald. Cio' che non si applica a caldo
# entra in vigore al prossimo riavvio (il servizio si riavvia comunque ogni
# notte alle 01:00, il resto al primo reboot).
#
# Uso: sudo scripts/system-tuning.sh [utente-kiosk]
#

set -u

INSTALL_DIR="${INSTALL_DIR:-/opt/onesibox}"
UNIT_FILE=/etc/systemd/system/onesibox.service
DROPIN_DIR=/etc/systemd/system/onesibox.service.d

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: va eseguito come root" >&2
    exit 1
fi

# Utente del kiosk: argomento, altrimenti User= della unit, altrimenti admin.
KIOSK_USER="${1:-}"
if [ -z "$KIOSK_USER" ] && [ -f "$UNIT_FILE" ]; then
    KIOSK_USER="$(sed -n 's/^User=//p' "$UNIT_FILE" | head -1)"
fi
KIOSK_USER="${KIOSK_USER:-admin}"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
if [ -z "$KIOSK_HOME" ]; then
    echo "ERRORE: utente $KIOSK_USER inesistente" >&2
    exit 1
fi

MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo sconosciuto)"
echo "Modello: $MODEL - utente kiosk: $KIOSK_USER"

is_pi4() {
    case "$MODEL" in
        *"Raspberry Pi 4"*) return 0 ;;
        *) return 1 ;;
    esac
}

# -----------------------------------------------------------------------------
# 1. Avvio del servizio: attesa del compositor e riavvii illimitati
# -----------------------------------------------------------------------------
# - ExecStartPre=wait-for-compositor.sh: senza, Playwright falliva al boot in
#   ~1 avvio su 4 ("Failed to connect to Wayland display") e il servizio cadeva
#   nel fallback senza controllo CDP del kiosk.
# - StartLimitIntervalSec=0: col vecchio 300s/5 tentativi, cinque fallimenti
#   ravvicinati lasciavano l'unita' "failed" per sempre. In casa di una persona
#   anziana nessuno puo' dare un `systemctl reset-failed`.
chmod +x "$INSTALL_DIR/scripts/wait-for-compositor.sh" 2>/dev/null || true
if [ -f "$UNIT_FILE" ] && grep -q "wait-for-compositor" "$UNIT_FILE"; then
    echo "[1] unit gia' aggiornata (wait-for-compositor presente)"
else
    mkdir -p "$DROPIN_DIR"
    cat > "$DROPIN_DIR/10-avvio-robusto.conf" << EOF
# Generato da $INSTALL_DIR/scripts/system-tuning.sh
[Unit]
StartLimitIntervalSec=0

[Service]
ExecStartPre=$INSTALL_DIR/scripts/wait-for-compositor.sh
EOF
    echo "[1] drop-in $DROPIN_DIR/10-avvio-robusto.conf scritto"
fi
# daemon-reload rilegge le unit senza riavviare i servizi in esecuzione.
systemctl daemon-reload

# -----------------------------------------------------------------------------
# 2. Audio: i nodi ALSA non devono mai sospendersi
# -----------------------------------------------------------------------------
# Alla ripresa da una sospensione Zoom web puo' perdere l'aggancio all'audio e
# riproporre "Join Audio by Computer": sul kiosk nessuno lo preme e la riunione
# resta muta. Entra in vigore al prossimo avvio di wireplumber (reboot).
WP_DIR="$KIOSK_HOME/.config/wireplumber/wireplumber.conf.d"
mkdir -p "$WP_DIR"
cat > "$WP_DIR/99-onesibox-no-suspend.conf" << 'EOF'
# I nodi audio non devono sospendersi.
#
# Con la sospensione attiva PipeWire spegne sink e source dopo qualche secondo
# di silenzio. Alla ripresa il dispositivo viene riaperto, e Zoom web client
# puo perdere l aggancio all audio: ripropone "Join Audio by Computer" al
# centro dello schermo. Su questo dispositivo quel pulsante non lo puo premere
# nessuno, quindi la riunione resterebbe muta fino alla fine.
monitor.alsa.rules = [
  {
    matches = [ { node.name = "~alsa_output.*" }, { node.name = "~alsa_input.*" } ]
    actions = {
      update-props = {
        session.suspend-timeout-seconds = 0
      }
    }
  }
]
EOF
chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config/wireplumber"
echo "[2] wireplumber: sospensione audio disattivata"

# -----------------------------------------------------------------------------
# 3. Journal persistente e limitato
# -----------------------------------------------------------------------------
# Senza, dopo un riavvio notturno i log di quello che e' successo durante
# l'adunanza sono persi. 200M bastano per settimane e non consumano la SD.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/onesibox.conf << 'EOF'
[Journal]
Storage=persistent
SystemMaxUse=200M
EOF
echo "[3] journald: persistente, max 200M (attivo dal prossimo riavvio)"

# -----------------------------------------------------------------------------
# 4. Swap solo quando serve davvero
# -----------------------------------------------------------------------------
# Lo swap su microSD e' lentissimo: con due Chromium aperti (kiosk + Zoom) il
# default 60 spostava pagine su disco anche con RAM libera.
echo "vm.swappiness=10" > /etc/sysctl.d/99-onesibox.conf
sysctl -q -p /etc/sysctl.d/99-onesibox.conf || true
echo "[4] vm.swappiness=10"

# -----------------------------------------------------------------------------
# 5. Solo Pi 4: CPU sempre alla frequenza massima
# -----------------------------------------------------------------------------
# Il governor ondemand parte da 600MHz e sale solo sotto carico: sul Pi 4 la
# latenza di salita diventa micro-scatti in videochiamata. Il Pi 5 ha margine
# sufficiente e non ne ha bisogno.
if is_pi4; then
    cat > /etc/systemd/system/cpu-performance.service << 'EOF'
[Unit]
Description=CPU governor performance per OnesiBox (Raspberry Pi 4)
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
# ondemand parte da 600MHz e sale solo sotto carico: la latenza di salita si
# traduce in micro-scatti durante una videochiamata.
ExecStart=/bin/sh -c 'for c in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > "$c"; done'

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now cpu-performance.service >/dev/null 2>&1 || true
    echo "[5] Pi 4: governor performance attivo"
else
    echo "[5] non e' un Pi 4: governor lasciato al default"
fi

echo "Ottimizzazioni di sistema applicate"
exit 0
