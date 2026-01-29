#!/bin/bash
# ============================================================================
# OnesiBox - Script di Installazione Interattivo per Raspberry Pi OS
# ============================================================================
# Questo script guida l'utente attraverso l'installazione completa di OnesiBox
# su un Raspberry Pi con Raspberry Pi OS (Bookworm 64-bit)
#
# Utilizzo:
#   curl -sSL https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh | sudo bash
#   oppure:
#   sudo ./install.sh
# ============================================================================

set -e

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configurazione
INSTALL_DIR="/opt/onesibox"
LOG_DIR="/var/log/onesibox"
SERVICE_USER="onesibox"
CONFIG_FILE="$INSTALL_DIR/config/config.json"
REPO_URL="https://github.com/onesiphorus-team/OnesiBox.git"
DEFAULT_SERVER_URL="https://onesiforo.a80.it"

# ============================================================================
# Funzioni di utilità
# ============================================================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                                                                  ║"
    echo "║   ██████╗ ███╗   ██╗███████╗███████╗██╗██████╗  ██████╗ ██╗  ██╗ ║"
    echo "║  ██╔═══██╗████╗  ██║██╔════╝██╔════╝██║██╔══██╗██╔═══██╗╚██╗██╔╝ ║"
    echo "║  ██║   ██║██╔██╗ ██║█████╗  ███████╗██║██████╔╝██║   ██║ ╚███╔╝  ║"
    echo "║  ██║   ██║██║╚██╗██║██╔══╝  ╚════██║██║██╔══██╗██║   ██║ ██╔██╗  ║"
    echo "║  ╚██████╔╝██║ ╚████║███████╗███████║██║██████╔╝╚██████╔╝██╔╝ ██╗ ║"
    echo "║   ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ║"
    echo "║                                                                  ║"
    echo "║         Sistema di Assistenza Remota per Anziani                 ║"
    echo "║                                                                  ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${GREEN}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_info() {
    echo -e "${CYAN}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓ ${NC}$1"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${NC}$1"
}

print_error() {
    echo -e "${RED}✗ ${NC}$1"
}

# Genera UUID v4
generate_uuid() {
    cat /proc/sys/kernel/random/uuid 2>/dev/null || \
    python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || \
    uuidgen 2>/dev/null || \
    echo "$(head -c 16 /dev/urandom | xxd -p | sed 's/\(..\)/\1-/g;s/-$//' | cut -c1-36)"
}

# Valida URL
validate_url() {
    local url="$1"
    if [[ "$url" =~ ^https?:// ]]; then
        return 0
    fi
    return 1
}

# Test connessione al server
test_server_connection() {
    local url="$1"
    local timeout=10

    # Rimuovi trailing slash
    url="${url%/}"

    print_info "Verifico connessione a $url..."

    if curl -sSf --connect-timeout "$timeout" "$url" > /dev/null 2>&1; then
        return 0
    fi

    # Prova anche con /api/v1 endpoint
    if curl -sSf --connect-timeout "$timeout" "$url/api/v1" > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Chiedi conferma
confirm() {
    local prompt="$1"
    local default="${2:-n}"
    local response

    if [[ "$default" == "y" ]]; then
        prompt="$prompt [S/n]: "
    else
        prompt="$prompt [s/N]: "
    fi

    read -r -p "$prompt" response
    response=${response:-$default}

    case "$response" in
        [sS][iI]|[sS]|[yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

# ============================================================================
# Verifica prerequisiti
# ============================================================================

check_prerequisites() {
    print_step "Verifica Prerequisiti"

    # Verifica root
    if [ "$EUID" -ne 0 ]; then
        print_error "Questo script deve essere eseguito come root (sudo)"
        echo -e "\n  Esegui: ${BOLD}sudo ./install.sh${NC}\n"
        exit 1
    fi
    print_success "Esecuzione come root"

    # Verifica sistema operativo
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        print_info "Sistema operativo: $PRETTY_NAME"

        if [[ "$ID" != "raspbian" && "$ID" != "debian" ]]; then
            print_warning "Sistema non Raspberry Pi OS. Alcune funzionalità potrebbero non funzionare."
            if ! confirm "Vuoi continuare comunque?"; then
                exit 1
            fi
        fi
    fi

    # Verifica architettura
    ARCH=$(uname -m)
    print_info "Architettura: $ARCH"

    # Verifica connessione internet
    print_info "Verifico connessione internet..."
    if ! ping -c 1 -W 5 google.com > /dev/null 2>&1; then
        print_error "Nessuna connessione internet rilevata"
        exit 1
    fi
    print_success "Connessione internet attiva"

    # Verifica spazio disco
    AVAILABLE_SPACE=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    print_info "Spazio disponibile: ${AVAILABLE_SPACE}GB"
    if [ "$AVAILABLE_SPACE" -lt 2 ]; then
        print_error "Spazio disco insufficiente. Richiesti almeno 2GB."
        exit 1
    fi
    print_success "Spazio disco sufficiente"
}

# ============================================================================
# Raccolta configurazione (interattivo)
# ============================================================================

collect_configuration() {
    print_step "Configurazione OnesiBox"

    echo -e "${CYAN}Per completare l'installazione, sono necessarie alcune informazioni.${NC}"
    echo -e "${CYAN}Le puoi ottenere dal pannello Onesiforo Web nella sezione 'Nuova Appliance'.${NC}\n"

    # Nome dispositivo (opzionale, per riferimento)
    echo -e "${BOLD}1. Nome del dispositivo${NC} (es: 'Casa Nonna Maria')"
    echo -e "   ${YELLOW}Questo nome serve solo come riferimento locale.${NC}"
    read -r -p "   Nome [OnesiBox]: " DEVICE_NAME
    DEVICE_NAME=${DEVICE_NAME:-"OnesiBox"}
    print_success "Nome: $DEVICE_NAME"

    echo ""

    # URL Server
    echo -e "${BOLD}2. URL del Server Onesiforo${NC}"
    echo -e "   ${YELLOW}L'indirizzo del server dove si trova il pannello di controllo.${NC}"
    echo -e "   ${YELLOW}Premi Invio per usare il server predefinito: $DEFAULT_SERVER_URL${NC}"
    while true; do
        read -r -p "   URL [$DEFAULT_SERVER_URL]: " SERVER_URL
        SERVER_URL=${SERVER_URL:-$DEFAULT_SERVER_URL}
        SERVER_URL="${SERVER_URL%/}"  # Rimuovi trailing slash

        if [ -z "$SERVER_URL" ]; then
            print_error "L'URL è obbligatorio"
            continue
        fi

        if ! validate_url "$SERVER_URL"; then
            print_error "URL non valido. Deve iniziare con http:// o https://"
            continue
        fi

        if test_server_connection "$SERVER_URL"; then
            print_success "Server raggiungibile: $SERVER_URL"
            break
        else
            print_warning "Non riesco a raggiungere il server"
            if confirm "Vuoi continuare comunque?"; then
                break
            fi
        fi
    done

    echo ""

    # Appliance ID
    echo -e "${BOLD}3. ID Appliance (UUID)${NC}"
    echo -e "   ${YELLOW}Lo trovi nel pannello Onesiforo quando registri una nuova appliance.${NC}"
    echo -e "   ${YELLOW}Lascia vuoto per generarne uno automaticamente.${NC}"
    read -r -p "   UUID [genera automatico]: " APPLIANCE_ID

    if [ -z "$APPLIANCE_ID" ]; then
        APPLIANCE_ID=$(generate_uuid)
        print_info "UUID generato: $APPLIANCE_ID"
        echo -e "   ${YELLOW}⚠ Copia questo UUID nel pannello Onesiforo per registrare l'appliance!${NC}"
    else
        print_success "UUID: $APPLIANCE_ID"
    fi

    echo ""

    # Token Appliance
    echo -e "${BOLD}4. Token di Autenticazione${NC}"
    echo -e "   ${YELLOW}Il token segreto generato dal server Onesiforo per questa appliance.${NC}"
    echo -e "   ${YELLOW}Lo trovi nella pagina di dettaglio dell'appliance sul pannello.${NC}"
    while true; do
        read -r -s -p "   Token (nascosto): " APPLIANCE_TOKEN
        echo ""

        if [ -z "$APPLIANCE_TOKEN" ]; then
            print_error "Il token è obbligatorio"
            continue
        fi

        if [ ${#APPLIANCE_TOKEN} -lt 20 ]; then
            print_warning "Il token sembra troppo corto. I token Sanctum sono solitamente più lunghi."
            if ! confirm "Vuoi continuare comunque?"; then
                continue
            fi
        fi

        print_success "Token configurato"
        break
    done

    echo ""

    # Impostazioni opzionali
    echo -e "${BOLD}5. Impostazioni Opzionali${NC}"

    read -r -p "   Intervallo polling in secondi [5]: " POLLING_INTERVAL
    POLLING_INTERVAL=${POLLING_INTERVAL:-5}

    read -r -p "   Intervallo heartbeat in secondi [30]: " HEARTBEAT_INTERVAL
    HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL:-30}

    read -r -p "   Volume predefinito 0-100 [80]: " DEFAULT_VOLUME
    DEFAULT_VOLUME=${DEFAULT_VOLUME:-80}

    echo ""

    # Riepilogo
    print_step "Riepilogo Configurazione"

    echo -e "  ${BOLD}Nome dispositivo:${NC}     $DEVICE_NAME"
    echo -e "  ${BOLD}URL Server:${NC}           $SERVER_URL"
    echo -e "  ${BOLD}Appliance ID:${NC}         $APPLIANCE_ID"
    echo -e "  ${BOLD}Token:${NC}                ****${APPLIANCE_TOKEN: -4}"
    echo -e "  ${BOLD}Polling:${NC}              ${POLLING_INTERVAL}s"
    echo -e "  ${BOLD}Heartbeat:${NC}            ${HEARTBEAT_INTERVAL}s"
    echo -e "  ${BOLD}Volume:${NC}               ${DEFAULT_VOLUME}%"
    echo ""

    if ! confirm "Procedere con l'installazione?" "y"; then
        echo -e "\n${YELLOW}Installazione annullata.${NC}\n"
        exit 0
    fi
}

# ============================================================================
# Installazione sistema
# ============================================================================

install_system_packages() {
    print_step "Installazione Pacchetti di Sistema"

    print_info "Aggiornamento sistema..."
    apt update -qq
    apt upgrade -y -qq
    print_success "Sistema aggiornato"

    # Node.js
    print_info "Installazione Node.js 20 LTS..."
    if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt install -y -qq nodejs
    fi
    print_success "Node.js $(node --version) installato"

    # Git
    print_info "Installazione Git..."
    apt install -y -qq git
    print_success "Git installato"

    # Chromium e display
    print_info "Installazione Chromium e dipendenze display..."
    apt install -y -qq \
        chromium-browser \
        xserver-xorg \
        x11-xserver-utils \
        xinit \
        openbox \
        xdotool
    print_success "Chromium e X11 installati"

    # Audio
    print_info "Installazione strumenti audio..."
    apt install -y -qq alsa-utils pulseaudio
    print_success "Strumenti audio installati"

    # Webcam
    print_info "Installazione strumenti webcam..."
    apt install -y -qq v4l-utils
    print_success "Strumenti webcam installati"

    # Utilities
    print_info "Installazione utilities..."
    apt install -y -qq curl wget jq unclutter
    print_success "Utilities installate"
}

# ============================================================================
# Creazione utente e directory
# ============================================================================

setup_user_and_directories() {
    print_step "Configurazione Utente e Directory"

    # Crea utente
    if ! id "$SERVICE_USER" &>/dev/null; then
        print_info "Creazione utente $SERVICE_USER..."
        useradd -m -s /bin/bash "$SERVICE_USER"
        print_success "Utente $SERVICE_USER creato"
    else
        print_info "Utente $SERVICE_USER già esistente"
    fi

    # Aggiungi ai gruppi necessari
    print_info "Configurazione gruppi..."
    usermod -aG video,audio,input,gpio,i2c,spi "$SERVICE_USER" 2>/dev/null || \
    usermod -aG video,audio,input "$SERVICE_USER"
    print_success "Gruppi configurati"

    # Crea directory
    print_info "Creazione directory..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/config"
    mkdir -p "$LOG_DIR"
    print_success "Directory create"

    # Imposta permessi
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"
    print_success "Permessi configurati"
}

# ============================================================================
# Download e installazione applicazione
# ============================================================================

install_application() {
    print_step "Download Applicazione OnesiBox"

    cd "$INSTALL_DIR"

    # Determina la fonte
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [ -f "$SCRIPT_DIR/package.json" ]; then
        # Installazione da directory locale
        print_info "Installazione da directory locale..."
        cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
        cp -r "$SCRIPT_DIR"/.[^.]* "$INSTALL_DIR/" 2>/dev/null || true
    elif [ -d "$INSTALL_DIR/.git" ]; then
        # Aggiornamento repository esistente
        print_info "Aggiornamento repository esistente..."
        git fetch origin
        git reset --hard origin/main
    else
        # Clone da GitHub
        print_info "Download da GitHub..."
        rm -rf "$INSTALL_DIR"/*
        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi

    print_success "Codice sorgente scaricato"

    # Installa dipendenze npm
    print_info "Installazione dipendenze npm..."
    cd "$INSTALL_DIR"
    npm install --production --silent 2>/dev/null || npm install --production
    print_success "Dipendenze npm installate"

    # Imposta permessi
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
}

# ============================================================================
# Creazione file di configurazione
# ============================================================================

create_configuration() {
    print_step "Creazione File di Configurazione"

    print_info "Scrittura config.json..."

    cat > "$CONFIG_FILE" << EOF
{
  "server_url": "$SERVER_URL",
  "appliance_id": "$APPLIANCE_ID",
  "appliance_token": "$APPLIANCE_TOKEN",
  "polling_interval_seconds": $POLLING_INTERVAL,
  "heartbeat_interval_seconds": $HEARTBEAT_INTERVAL,
  "default_volume": $DEFAULT_VOLUME,
  "device_name": "$DEVICE_NAME"
}
EOF

    # Permessi restrittivi per il file con il token
    chmod 600 "$CONFIG_FILE"
    chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"

    print_success "File di configurazione creato"
}

# ============================================================================
# Configurazione servizio systemd
# ============================================================================

setup_systemd_service() {
    print_step "Configurazione Servizio Systemd"

    print_info "Creazione servizio onesibox.service..."

    cat > /etc/systemd/system/onesibox.service << EOF
[Unit]
Description=OnesiBox Client - $DEVICE_NAME
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
ExecStart=/usr/bin/node $INSTALL_DIR/src/main.js
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
Environment=NODE_ENV=production
WorkingDirectory=$INSTALL_DIR

# Sicurezza
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR $LOG_DIR
PrivateTmp=true

[Install]
WantedBy=graphical.target
EOF

    print_success "Servizio systemd creato"

    print_info "Abilitazione servizio..."
    systemctl daemon-reload
    systemctl enable onesibox
    print_success "Servizio abilitato all'avvio"
}

# ============================================================================
# Configurazione auto-login e kiosk mode
# ============================================================================

setup_autologin_and_kiosk() {
    print_step "Configurazione Auto-Login e Modalità Kiosk"

    # Auto-login su TTY1
    print_info "Configurazione auto-login..."
    mkdir -p /etc/systemd/system/getty@tty1.service.d
    cat > /etc/systemd/system/getty@tty1.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $SERVICE_USER --noclear %I \$TERM
EOF
    print_success "Auto-login configurato"

    # Configurazione X autostart
    print_info "Configurazione avvio automatico X..."
    USER_HOME=$(eval echo ~$SERVICE_USER)

    mkdir -p "$USER_HOME/.config/openbox"

    # Script di avvio kiosk
    cat > "$USER_HOME/.config/openbox/autostart" << 'EOF'
#!/bin/bash

# Disabilita screen blanking
xset s off
xset -dpms
xset s noblank

# Nascondi cursore dopo 3 secondi di inattività
unclutter -idle 3 &

# Aspetta che il server Node.js sia pronto
sleep 5

# Avvia Chromium in modalità kiosk
exec chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --enable-features=WebRTCPipeWireCapturer \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --disable-component-update \
  --disable-background-networking \
  --disable-sync \
  --disable-default-apps \
  --no-first-run \
  --start-fullscreen \
  "http://localhost:3000"
EOF

    chmod +x "$USER_HOME/.config/openbox/autostart"

    # Aggiungi startx al login
    if ! grep -q "startx" "$USER_HOME/.bash_profile" 2>/dev/null; then
        echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx' >> "$USER_HOME/.bash_profile"
    fi

    chown -R "$SERVICE_USER:$SERVICE_USER" "$USER_HOME/.config"
    chown "$SERVICE_USER:$SERVICE_USER" "$USER_HOME/.bash_profile"

    print_success "Modalità kiosk configurata"
}

# ============================================================================
# Avvio servizio e test
# ============================================================================

start_and_test() {
    print_step "Avvio e Test del Servizio"

    print_info "Avvio servizio onesibox..."
    systemctl start onesibox

    # Aspetta che il servizio sia attivo
    sleep 3

    if systemctl is-active --quiet onesibox; then
        print_success "Servizio avviato correttamente"

        # Test endpoint locale
        print_info "Test endpoint locale..."
        if curl -sSf "http://localhost:3000/api/status" > /dev/null 2>&1; then
            print_success "Server HTTP locale attivo"
        else
            print_warning "Server HTTP locale non ancora attivo (potrebbe essere in avvio)"
        fi
    else
        print_error "Errore nell'avvio del servizio"
        print_info "Controlla i log con: journalctl -u onesibox -n 50"
    fi
}

# ============================================================================
# Riepilogo finale
# ============================================================================

print_summary() {
    echo -e "\n"
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}║              ✓ INSTALLAZIONE COMPLETATA CON SUCCESSO            ║${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"

    echo -e "\n${BOLD}Riepilogo:${NC}"
    echo -e "  • Nome dispositivo:  ${CYAN}$DEVICE_NAME${NC}"
    echo -e "  • Server:            ${CYAN}$SERVER_URL${NC}"
    echo -e "  • Appliance ID:      ${CYAN}$APPLIANCE_ID${NC}"
    echo -e "  • Directory:         ${CYAN}$INSTALL_DIR${NC}"
    echo -e "  • Log:               ${CYAN}$LOG_DIR${NC}"
    echo -e "  • Utente:            ${CYAN}$SERVICE_USER${NC}"

    echo -e "\n${BOLD}Comandi utili:${NC}"
    echo -e "  • Stato servizio:    ${YELLOW}sudo systemctl status onesibox${NC}"
    echo -e "  • Log in tempo reale:${YELLOW}journalctl -u onesibox -f${NC}"
    echo -e "  • Riavvia servizio:  ${YELLOW}sudo systemctl restart onesibox${NC}"
    echo -e "  • Test locale:       ${YELLOW}curl http://localhost:3000/api/status${NC}"

    echo -e "\n${BOLD}Prossimi passi:${NC}"
    echo -e "  1. ${CYAN}Registra l'appliance nel pannello Onesiforo${NC} se non l'hai già fatto"
    echo -e "     UUID da inserire: ${YELLOW}$APPLIANCE_ID${NC}"
    echo -e "  2. ${CYAN}Riavvia il Raspberry Pi${NC} per attivare la modalità kiosk:"
    echo -e "     ${YELLOW}sudo reboot${NC}"
    echo -e "  3. ${CYAN}Verifica la connessione${NC} dal pannello Onesiforo"

    echo -e "\n${BOLD}Supporto:${NC}"
    echo -e "  • Documentazione: ${CYAN}$INSTALL_DIR/docs/${NC}"
    echo -e "  • Issues: ${CYAN}https://github.com/onesiphorus-team/OnesiBox/issues${NC}"

    echo -e "\n"
}

# ============================================================================
# Main
# ============================================================================

main() {
    clear
    print_banner

    check_prerequisites
    collect_configuration
    install_system_packages
    setup_user_and_directories
    install_application
    create_configuration
    setup_systemd_service
    setup_autologin_and_kiosk
    start_and_test
    print_summary
}

# Esegui solo se non in sourcing
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
