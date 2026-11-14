#!/bin/sh
# Attende che il compositor Wayland accetti connessioni, prima di avviare OnesiBox.
#
# onesibox.service dichiara `After=graphical.target`, ma graphical.target è
# raggiunto prima che labwc sia pronto ad accettare client. Playwright partiva
# quindi in una finestra in cui il socket c'è ma nessuno risponde, e falliva con:
#
#   Failed to connect to Wayland display: Connection refused (111)
#   The platform failed to initialize. Exiting.
#
# Il servizio cadeva allora in fallback "spawn", modalità in cui il controllo
# CDP del kiosk non è disponibile. È successo in 5 avvii su 21 (24%).
#
# Testare l'esistenza del socket non basta: esiste già quando il compositor sta
# ancora inizializzando. wlr-randr apre una connessione vera e fallisce finché
# il compositor non risponde davvero, quindi è il test corretto.
#
# Esce SEMPRE 0: se dopo il timeout il compositor non risponde, tanto vale
# lasciar partire il servizio e affidarsi al suo fallback, piuttosto che
# bloccare l'avvio di un dispositivo che sta in casa di una persona anziana
# e che nessuno può riavviare a mano.

TIMEOUT_SECONDS=45

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

elapsed=0
while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
    if wlr-randr >/dev/null 2>&1; then
        echo "compositor Wayland pronto dopo ${elapsed}s"
        exit 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

echo "ATTENZIONE: compositor non pronto dopo ${TIMEOUT_SECONDS}s, avvio comunque"
exit 0
