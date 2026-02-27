#!/bin/bash
# ============================================================================
# OnesiBox - Script di Riconfigurazione Rapida
# ============================================================================
# Usa questo script per aggiornare la configurazione senza reinstallare tutto.
# Utile quando devi cambiare server, token o altre impostazioni.
#
# Utilizzo:
#   sudo ./reconfigure.sh
# ============================================================================

set -e

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

CONFIG_FILE="/opt/onesibox/config/config.json"
BACKUP_FILE="/opt/onesibox/config/config.json.backup"

# Detect the service user (same logic as install.sh)
detect_service_user() {
    local svc_user
    svc_user=$(stat -c '%U' "$CONFIG_FILE" 2>/dev/null || stat -f '%Su' "$CONFIG_FILE" 2>/dev/null)
    if [ -z "$svc_user" ] || [ "$svc_user" = "root" ]; then
        # Fallback: check systemd service file
        svc_user=$(grep -oP '(?<=User=)\S+' /etc/systemd/system/onesibox.service 2>/dev/null || echo "")
    fi
    if [ -z "$svc_user" ]; then
        # Final fallback: detect kiosk user like install.sh
        if id "admin" &>/dev/null; then svc_user="admin"
        elif id "pi" &>/dev/null; then svc_user="pi"
        elif id "debian" &>/dev/null; then svc_user="debian"
        elif id "onesibox" &>/dev/null; then svc_user="onesibox"
        else svc_user="root"; fi
    fi
    echo "$svc_user"
}

SERVICE_USER=$(detect_service_user)

print_banner() {
    echo -e "${CYAN}"
    echo "╔════════════════════════════════════════════════════╗"
    echo "║       OnesiBox - Riconfigurazione Rapida           ║"
    echo "╚════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Verifica root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Esegui come root: sudo ./reconfigure.sh${NC}"
    exit 1
fi

print_banner

# Verifica installazione esistente
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}OnesiBox non sembra installato. Usa install.sh prima.${NC}"
    exit 1
fi

# Leggi configurazione attuale
echo -e "${BOLD}Configurazione attuale:${NC}"
echo ""

CURRENT_URL=$(jq -r '.server_url // "non impostato"' "$CONFIG_FILE" 2>/dev/null || echo "non leggibile")
CURRENT_ID=$(jq -r '.appliance_id // "non impostato"' "$CONFIG_FILE" 2>/dev/null || echo "non leggibile")
CURRENT_NAME=$(jq -r '.device_name // "OnesiBox"' "$CONFIG_FILE" 2>/dev/null || echo "OnesiBox")

echo -e "  Server URL:    ${YELLOW}$CURRENT_URL${NC}"
echo -e "  Appliance ID:  ${YELLOW}$CURRENT_ID${NC}"
echo -e "  Nome:          ${YELLOW}$CURRENT_NAME${NC}"
echo ""

# Menu opzioni
echo -e "${BOLD}Cosa vuoi modificare?${NC}"
echo ""
echo "  1) URL del server"
echo "  2) Token di autenticazione"
echo "  3) Appliance ID"
echo "  4) Nome dispositivo"
echo "  5) Tutte le impostazioni"
echo "  6) Esci"
echo ""
read -r -p "Scelta [1-6]: " choice

case $choice in
    1)
        echo ""
        read -r -p "Nuovo URL server: " NEW_URL
        NEW_URL="${NEW_URL%/}"

        cp "$CONFIG_FILE" "$BACKUP_FILE"
        jq --arg url "$NEW_URL" '.server_url = $url' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp"
        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

        echo -e "${GREEN}URL aggiornato a: $NEW_URL${NC}"
        ;;
    2)
        echo ""
        read -r -s -p "Nuovo token (nascosto): " NEW_TOKEN
        echo ""

        cp "$CONFIG_FILE" "$BACKUP_FILE"
        jq --arg token "$NEW_TOKEN" '.appliance_token = $token' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp"
        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

        echo -e "${GREEN}Token aggiornato${NC}"
        ;;
    3)
        echo ""
        read -r -p "Nuovo Appliance ID (UUID): " NEW_ID

        cp "$CONFIG_FILE" "$BACKUP_FILE"
        jq --arg id "$NEW_ID" '.appliance_id = $id' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp"
        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

        echo -e "${GREEN}Appliance ID aggiornato a: $NEW_ID${NC}"
        ;;
    4)
        echo ""
        read -r -p "Nuovo nome dispositivo: " NEW_NAME

        cp "$CONFIG_FILE" "$BACKUP_FILE"
        jq --arg name "$NEW_NAME" '.device_name = $name' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp"
        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

        echo -e "${GREEN}Nome aggiornato a: $NEW_NAME${NC}"
        ;;
    5)
        echo ""
        echo -e "${CYAN}Inserisci tutte le nuove impostazioni:${NC}"
        echo ""

        read -r -p "URL Server [$CURRENT_URL]: " NEW_URL
        NEW_URL=${NEW_URL:-$CURRENT_URL}
        NEW_URL="${NEW_URL%/}"

        read -r -p "Appliance ID [$CURRENT_ID]: " NEW_ID
        NEW_ID=${NEW_ID:-$CURRENT_ID}

        read -r -s -p "Nuovo Token (lascia vuoto per mantenere): " NEW_TOKEN
        echo ""

        read -r -p "Nome dispositivo [$CURRENT_NAME]: " NEW_NAME
        NEW_NAME=${NEW_NAME:-$CURRENT_NAME}

        cp "$CONFIG_FILE" "$BACKUP_FILE"

        # Aggiorna campi
        jq --arg url "$NEW_URL" --arg id "$NEW_ID" --arg name "$NEW_NAME" \
           '.server_url = $url | .appliance_id = $id | .device_name = $name' \
           "$CONFIG_FILE" > "${CONFIG_FILE}.tmp"

        if [ -n "$NEW_TOKEN" ]; then
            jq --arg token "$NEW_TOKEN" '.appliance_token = $token' "${CONFIG_FILE}.tmp" > "${CONFIG_FILE}.tmp2"
            mv "${CONFIG_FILE}.tmp2" "${CONFIG_FILE}.tmp"
        fi

        mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

        echo -e "${GREEN}Configurazione aggiornata${NC}"
        ;;
    6)
        echo -e "${YELLOW}Nessuna modifica effettuata.${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Scelta non valida${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BOLD}Riavvio servizio...${NC}"
systemctl restart onesibox

sleep 2

if systemctl is-active --quiet onesibox; then
    echo -e "${GREEN}✓ Servizio riavviato correttamente${NC}"
else
    echo -e "${RED}✗ Errore nel riavvio. Controlla: journalctl -u onesibox -n 20${NC}"
fi

echo ""
echo -e "${CYAN}Backup della configurazione precedente salvato in:${NC}"
echo -e "  $BACKUP_FILE"
echo ""
