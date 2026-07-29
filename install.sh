#!/bin/bash
# ============================================================================
# OnesiBox - Script di Installazione Interattivo per Raspberry Pi OS / Debian
# ============================================================================
# Questo script guida l'utente attraverso l'installazione completa di OnesiBox
# su un Raspberry Pi con Raspberry Pi OS o Debian ARM64 con Wayland/labwc
#
# Utilizzo:
#   # Installazione interattiva in un solo comando: le domande vengono lette dal
#   # terminale (/dev/tty), perché stdin è occupato dallo script stesso.
#   curl -fsSL https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh | sudo bash
#
#   # Oppure, da una copia locale del repository:
#   sudo ./install.sh
#
#   # Senza domande (automazione, sessioni senza terminale):
#   curl -fsSL https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh \
#     | sudo bash -s -- --non-interactive --token IL_TUO_TOKEN
#
#   sudo ./install.sh --help  per l'elenco completo di opzioni e variabili.
#
# Codici di uscita:
#   0  installazione completata (o annullata su richiesta esplicita)
#   1  prerequisito non soddisfatto (root, rete, spazio disco, sistema)
#   2  errore d'uso: opzione sconosciuta, dati obbligatori mancanti, nessun terminale
#   3  input dell'operatore interrotto (EOF) prima di completare le risposte
#   4  server Onesiforo non raggiungibile in modalità non interattiva
# ============================================================================

set -e

# apt e dpkg, se possono, si fermano a chiedere: il prompt di un file conffile
# modificato, la conferma "Yes, do as I say!" di una rimozione rischiosa. In
# un'installazione automatica non c'è nessuno a rispondere, e la domanda
# verrebbe letta da stdin — che con `curl … | sudo bash` è lo script stesso.
export DEBIAN_FRONTEND=noninteractive

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
CONFIG_FILE="$INSTALL_DIR/config/config.json"
REPO_URL="https://github.com/onesiphorus-team/OnesiBox.git"
RAW_INSTALL_URL="https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh"
DEFAULT_SERVER_URL="https://onesiforo.a80.it"

# Utente che farà autologin (rilevato automaticamente)
KIOSK_USER=""
KIOSK_USER_UID=""

# Directory della copia locale del repository da cui è stato lanciato lo script.
# Va calcolata qui, prima di qualsiasi "cd": con `curl … | bash` lo script non
# esiste su disco (BASH_SOURCE[0] è vuota) e resta volutamente vuota.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# ============================================================================
# Modalità di esecuzione
# ============================================================================

# Modalità non interattiva: nessuna domanda, tutti i dati da opzioni/variabili
NON_INTERACTIVE="${ONESIBOX_NON_INTERACTIVE:-false}"
# Risponde "sì" alle conferme quando non c'è nessuno a rispondere
ASSUME_YES="${ONESIBOX_ASSUME_YES:-false}"
# Da dove vengono lette le risposte dell'operatore (descrizione per i log)
INPUT_SOURCE=""

# Valori pre-impostati da opzioni della riga di comando o variabili d'ambiente
PRESET_DEVICE_NAME="${ONESIBOX_DEVICE_NAME:-}"
PRESET_SERVER_URL="${ONESIBOX_SERVER_URL:-}"
PRESET_APPLIANCE_ID="${ONESIBOX_APPLIANCE_ID:-}"
PRESET_APPLIANCE_TOKEN="${ONESIBOX_APPLIANCE_TOKEN:-}"
PRESET_POLLING_INTERVAL="${ONESIBOX_POLLING_INTERVAL:-}"
PRESET_HEARTBEAT_INTERVAL="${ONESIBOX_HEARTBEAT_INTERVAL:-}"
PRESET_DEFAULT_VOLUME="${ONESIBOX_DEFAULT_VOLUME:-}"
PRESET_AUTO_UPDATES="${ONESIBOX_AUTO_UPDATES:-}"
PRESET_KEEP_CONFIG="${ONESIBOX_KEEP_CONFIG:-}"

# ============================================================================
# Esecuzione dei comandi esterni
# ============================================================================

# Esegue un comando esterno con lo stdin chiuso.
#
# Con `curl … | sudo bash` lo stdin dello script È lo script stesso. Un figlio
# che legge stdin — apt o dpkg su una domanda, npx che chiede "Ok to proceed?",
# git che chiede una credenziale — si mangia le righe non ancora eseguite:
# bash arriva a EOF e termina con codice 0, in silenzio, lasciando la box
# mezza installata. È l'issue #68.
#
# Passare da qui, invece di ricordarsi un `< /dev/null` a ogni chiamata, è ciò
# che il controllo statico in tests/shell/install-sh.test.sh verifica.
#
# Il descrittore 3 non viene toccato: la redirezione vale solo per fd 0 e solo
# per il figlio, quindi ask()/ask_secret() continuano a leggere le risposte
# dell'operatore da /dev/tty.
#
# Non va usato per i comandi che devono davvero leggere da una pipe
# (`… | bash -`, `… | crontab -u root -`): quelli hanno già il loro stdin.
run_system() {
    "$@" < /dev/null
}

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

# ============================================================================
# Opzioni della riga di comando
# ============================================================================

# Interpreta i valori booleani accettati da opzioni e variabili d'ambiente
is_true() {
    case "$1" in
        1|[tT][rR][uU][eE]|[yY]|[yY][eE][sS]|[sS]|[sS][iI]|[oO][nN]) return 0 ;;
        *) return 1 ;;
    esac
}

is_false() {
    case "$1" in
        0|[fF][aA][lL][sS][eE]|[nN]|[nN][oO]|[oO][fF][fF]) return 0 ;;
        *) return 1 ;;
    esac
}

usage() {
    cat << EOF
OnesiBox - Script di installazione

Uso:
  sudo ./install.sh [opzioni]
  curl -fsSL <url>/install.sh | sudo bash
  curl -fsSL <url>/install.sh | sudo bash -s -- [opzioni]

Opzioni:
  --non-interactive       Non porre domande: i dati arrivano da opzioni/variabili
  -y, --yes               Rispondi "sì" alle conferme (serve in --non-interactive
                          per proseguire su sistemi non supportati o server non
                          raggiungibili)
  --name NOME             Nome del dispositivo (default: OnesiBox)
  --server URL            URL del server Onesiforo (default: $DEFAULT_SERVER_URL)
  --appliance-id UUID     UUID dell'appliance (default: generato automaticamente)
  --token TOKEN           Token di autenticazione (obbligatorio con --non-interactive
                          se non esiste già una configurazione da riusare)
  --polling-interval SEC  Intervallo di polling in secondi (default: 5)
  --heartbeat-interval SEC Intervallo di heartbeat in secondi (default: 30)
  --volume 0-100          Volume predefinito (default: 80)
  --auto-updates si|no    Aggiornamenti automatici notturni (default: si)
  --keep-config si|no     Riusa la configurazione esistente, se presente
  -h, --help              Mostra questo messaggio ed esce

Variabili d'ambiente equivalenti:
  ONESIBOX_NON_INTERACTIVE   ONESIBOX_ASSUME_YES        ONESIBOX_DEVICE_NAME
  ONESIBOX_SERVER_URL        ONESIBOX_APPLIANCE_ID      ONESIBOX_APPLIANCE_TOKEN
  ONESIBOX_POLLING_INTERVAL  ONESIBOX_HEARTBEAT_INTERVAL ONESIBOX_DEFAULT_VOLUME
  ONESIBOX_AUTO_UPDATES      ONESIBOX_KEEP_CONFIG

Nota: --token compare nella lista dei processi (ps) e nella cronologia della
shell. Su macchine condivise preferisci ONESIBOX_APPLIANCE_TOKEN.
EOF
}

# Un'opzione che richiede un valore ma non lo riceve è un errore d'uso
require_option_value() {
    local option="$1"
    local value="$2"

    if [ -z "$value" ]; then
        print_error "L'opzione $option richiede un valore" >&2
        exit 2
    fi
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --non-interactive) NON_INTERACTIVE=true ;;
            -y|--yes) ASSUME_YES=true ;;
            --name) require_option_value "$1" "${2:-}"; PRESET_DEVICE_NAME="$2"; shift ;;
            --server) require_option_value "$1" "${2:-}"; PRESET_SERVER_URL="$2"; shift ;;
            --appliance-id) require_option_value "$1" "${2:-}"; PRESET_APPLIANCE_ID="$2"; shift ;;
            --token) require_option_value "$1" "${2:-}"; PRESET_APPLIANCE_TOKEN="$2"; shift ;;
            --polling-interval) require_option_value "$1" "${2:-}"; PRESET_POLLING_INTERVAL="$2"; shift ;;
            --heartbeat-interval) require_option_value "$1" "${2:-}"; PRESET_HEARTBEAT_INTERVAL="$2"; shift ;;
            --volume) require_option_value "$1" "${2:-}"; PRESET_DEFAULT_VOLUME="$2"; shift ;;
            --auto-updates) require_option_value "$1" "${2:-}"; PRESET_AUTO_UPDATES="$2"; shift ;;
            --keep-config) require_option_value "$1" "${2:-}"; PRESET_KEEP_CONFIG="$2"; shift ;;
            -h|--help) usage; exit 0 ;;
            *)
                print_error "Opzione sconosciuta: $1" >&2
                echo "" >&2
                usage >&2
                exit 2
                ;;
        esac
        shift
    done
}

# ============================================================================
# Input dell'operatore
# ============================================================================

# Decide da dove leggere le risposte e prepara il descrittore 3.
#
# Con `curl … | sudo bash` lo stdin dello script È lo script stesso: una `read`
# su stdin consumerebbe il sorgente invece dell'input dell'operatore, tornando
# subito EOF senza nemmeno mostrare il prompt. In quel caso si apre il terminale
# di controllo (/dev/tty) su un descrittore dedicato, lasciando stdin dov'è.
#
# ATTENZIONE: non riassegnare mai il descrittore 0 (né qui né altrove). Quando
# bash legge lo script da stdin, un `exec 0< /dev/null` gli fa perdere le righe
# non ancora lette: lo script terminerebbe a metà, in silenzio e con codice 0.
#
# Ritorna 1 se servono risposte ma non esiste alcun terminale da cui leggerle.
init_input_source() {
    if is_true "$NON_INTERACTIVE"; then
        INPUT_SOURCE="nessuno (modalità non interattiva)"
        return 0
    fi

    if [ -t 0 ]; then
        exec 3<&0
        INPUT_SOURCE="terminale (stdin)"
        return 0
    fi

    # `: < /dev/tty` fallisce senza terminare lo script se non c'è un terminale
    # di controllo; `exec` in quel caso farebbe uscire la shell.
    if { : < /dev/tty; } 2>/dev/null; then
        exec 3< /dev/tty
        INPUT_SOURCE="/dev/tty (stdin occupato dalla pipe)"
        return 0
    fi

    INPUT_SOURCE=""
    return 1
}

# Legge una risposta dell'operatore in una variabile.
# Il prompt è stampato esplicitamente perché `read -p` lo mostra solo quando
# stdin è un terminale, e con `curl … | bash` non lo è.
ask() {
    local __ask_var="$1"
    local __ask_prompt="$2"
    local __ask_reply=""

    if is_true "$NON_INTERACTIVE"; then
        print_error "Domanda inattesa in modalità non interattiva: $__ask_prompt" >&2
        exit 2
    fi

    printf '%s' "$__ask_prompt" >&2

    if ! IFS= read -r __ask_reply <&3; then
        printf '\n' >&2
        print_error "Input dell'operatore interrotto: installazione NON eseguita"
        print_info "Per installare senza domande: ./install.sh --non-interactive --help"
        exit 3
    fi

    printf -v "$__ask_var" '%s' "$__ask_reply"
}

# Come ask(), ma senza eco a schermo (per i segreti)
ask_secret() {
    local __ask_var="$1"
    local __ask_prompt="$2"
    local __ask_reply=""

    if is_true "$NON_INTERACTIVE"; then
        print_error "Domanda inattesa in modalità non interattiva: $__ask_prompt" >&2
        exit 2
    fi

    printf '%s' "$__ask_prompt" >&2

    if ! IFS= read -r -s __ask_reply <&3; then
        printf '\n' >&2
        print_error "Input dell'operatore interrotto: installazione NON eseguita"
        print_info "Per installare senza domande: ./install.sh --non-interactive --help"
        exit 3
    fi
    printf '\n' >&2

    printf -v "$__ask_var" '%s' "$__ask_reply"
}

# Genera UUID v4
generate_uuid() {
    run_system cat /proc/sys/kernel/random/uuid 2>/dev/null || \
    run_system python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || \
    uuidgen 2>/dev/null || \
    echo "$(run_system head -c 16 /dev/urandom | xxd -p | sed 's/\(..\)/\1-/g;s/-$//' | cut -c1-36)"
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
    url="${url%/}"

    print_info "Verifico connessione a $url..."

    if command -v curl &> /dev/null; then
        if run_system curl -sSf --connect-timeout "$timeout" "$url" > /dev/null 2>&1; then
            return 0
        fi
        if run_system curl -sSf --connect-timeout "$timeout" "$url/api/v1" > /dev/null 2>&1; then
            return 0
        fi
    elif command -v wget &> /dev/null; then
        if run_system wget -q --timeout="$timeout" --spider "$url" 2>/dev/null; then
            return 0
        fi
    else
        print_warning "curl/wget non disponibili, test connessione saltato"
        return 0
    fi

    return 1
}

# Chiedi conferma. In modalità non interattiva risponde da sé: "sì" se è stato
# passato --yes, altrimenti il valore predefinito della domanda.
confirm() {
    local prompt="$1"
    local default="${2:-n}"
    local response

    if [[ "$default" == "y" ]]; then
        prompt="$prompt [S/n]: "
    else
        prompt="$prompt [s/N]: "
    fi

    if is_true "$NON_INTERACTIVE"; then
        if is_true "$ASSUME_YES"; then
            response="s"
        else
            response="$default"
        fi
        print_info "${prompt}${response} (modalità non interattiva)"
    else
        ask response "$prompt"
        response=${response:-$default}
    fi

    case "$response" in
        [sS][iI]|[sS]|[yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

# Conferma con risposta eventualmente già decisa da un'opzione/variabile
confirm_preset() {
    local preset="$1"
    local prompt="$2"
    local default="${3:-n}"

    if [ -n "$preset" ]; then
        if is_true "$preset"; then
            print_info "$prompt → sì (pre-impostato)"
            return 0
        fi
        print_info "$prompt → no (pre-impostato)"
        return 1
    fi

    confirm "$prompt" "$default"
}

# Verifica, prima di toccare il sistema, che la modalità non interattiva abbia
# tutti i dati obbligatori: meglio fermarsi subito che a metà installazione.
validate_preset_inputs() {
    local value

    for value in "$PRESET_POLLING_INTERVAL" "$PRESET_HEARTBEAT_INTERVAL" "$PRESET_DEFAULT_VOLUME"; do
        if [ -n "$value" ] && ! [[ "$value" =~ ^[0-9]+$ ]]; then
            print_error "Valore numerico non valido: '$value'" >&2
            exit 2
        fi
    done

    if [ -n "$PRESET_SERVER_URL" ] && ! validate_url "$PRESET_SERVER_URL"; then
        print_error "URL server non valido: '$PRESET_SERVER_URL' (deve iniziare con http:// o https://)" >&2
        exit 2
    fi

    is_true "$NON_INTERACTIVE" || return 0

    # Il token non serve solo se c'è già una configurazione da riusare
    local can_reuse_config=false
    if [ -f "$CONFIG_FILE" ] && ! is_false "$PRESET_KEEP_CONFIG"; then
        can_reuse_config=true
    fi

    if [ -z "$PRESET_APPLIANCE_TOKEN" ] && [ "$can_reuse_config" = false ]; then
        print_error "Modalità non interattiva: manca il token di autenticazione." >&2
        print_info "Passa --token IL_TUO_TOKEN oppure imposta ONESIBOX_APPLIANCE_TOKEN." >&2
        print_info "Il token si ottiene dal pannello Onesiforo, sezione 'Nuova Appliance'." >&2
        exit 2
    fi
}

# ============================================================================
# Rilevamento utente kiosk
# ============================================================================

detect_kiosk_user() {
    print_step "Rilevamento Utente Kiosk"

    # Priorità: admin (RPi OS), pi (vecchio RPi OS), debian, primo utente normale
    if id "admin" &>/dev/null; then
        KIOSK_USER="admin"
    elif id "pi" &>/dev/null; then
        KIOSK_USER="pi"
    elif id "debian" &>/dev/null; then
        KIOSK_USER="debian"
    else
        # Trova il primo utente con UID >= 1000 (utente normale)
        KIOSK_USER=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}')
    fi

    if [ -z "$KIOSK_USER" ]; then
        print_error "Nessun utente kiosk trovato!"
        print_info "Creazione utente 'onesibox'..."
        run_system useradd -m -s /bin/bash onesibox
        KIOSK_USER="onesibox"
    fi

    KIOSK_USER_UID=$(id -u "$KIOSK_USER")
    KIOSK_USER_HOME=$(eval echo "~$KIOSK_USER")

    print_success "Utente kiosk: $KIOSK_USER (UID: $KIOSK_USER_UID)"
    print_info "Home directory: $KIOSK_USER_HOME"
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
            print_warning "Sistema non Raspberry Pi OS/Debian. Alcune funzionalità potrebbero non funzionare."
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
# Verifica installazione esistente
# ============================================================================

check_existing_installation() {
    KEEP_CONFIG=false

    if [ -f "$CONFIG_FILE" ]; then
        print_step "Installazione Esistente Rilevata"

        if ! command -v jq &> /dev/null; then
            print_info "Installazione jq per leggere la configurazione..."
            run_system apt install -y -qq jq
        fi

        print_info "Trovato file di configurazione esistente: $CONFIG_FILE"
        echo ""

        if command -v jq &> /dev/null; then
            EXISTING_NAME=$(run_system jq -r '.device_name // "N/A"' "$CONFIG_FILE" 2>/dev/null)
            EXISTING_SERVER=$(run_system jq -r '.server_url // "N/A"' "$CONFIG_FILE" 2>/dev/null)
            EXISTING_ID=$(run_system jq -r '.appliance_id // "N/A"' "$CONFIG_FILE" 2>/dev/null)
            EXISTING_TOKEN=$(run_system jq -r '.appliance_token // ""' "$CONFIG_FILE" 2>/dev/null)

            echo -e "  ${BOLD}Configurazione attuale:${NC}"
            echo -e "  • Nome:         ${CYAN}$EXISTING_NAME${NC}"
            echo -e "  • Server:       ${CYAN}$EXISTING_SERVER${NC}"
            echo -e "  • Appliance ID: ${CYAN}$EXISTING_ID${NC}"
            echo -e "  • Token:        ${CYAN}****${EXISTING_TOKEN: -4}${NC}"
            echo ""
        fi

        if confirm_preset "$PRESET_KEEP_CONFIG" "Vuoi mantenere la configurazione esistente?" "y"; then
            KEEP_CONFIG=true
            print_success "Configurazione esistente mantenuta"

            if command -v jq &> /dev/null; then
                DEVICE_NAME=$(run_system jq -r '.device_name // "OnesiBox"' "$CONFIG_FILE")
                SERVER_URL=$(run_system jq -r '.server_url // ""' "$CONFIG_FILE")
                APPLIANCE_ID=$(run_system jq -r '.appliance_id // ""' "$CONFIG_FILE")
                APPLIANCE_TOKEN=$(run_system jq -r '.appliance_token // ""' "$CONFIG_FILE")
                POLLING_INTERVAL=$(run_system jq -r '.polling_interval_seconds // 5' "$CONFIG_FILE")
                HEARTBEAT_INTERVAL=$(run_system jq -r '.heartbeat_interval_seconds // 30' "$CONFIG_FILE")
                DEFAULT_VOLUME=$(run_system jq -r '.default_volume // 80' "$CONFIG_FILE")
            else
                print_warning "jq non installato, impossibile leggere configurazione"
                KEEP_CONFIG=false
            fi
        else
            print_info "Verrà richiesta una nuova configurazione"
        fi
    fi
}

# ============================================================================
# Raccolta configurazione (interattivo)
# ============================================================================

collect_configuration() {
    if [ "$KEEP_CONFIG" = true ]; then
        print_step "Configurazione"
        print_success "Utilizzo configurazione esistente"
        return
    fi

    print_step "Configurazione OnesiBox"

    if is_true "$NON_INTERACTIVE"; then
        collect_configuration_from_presets
    else
        collect_configuration_interactive
    fi

    # Riepilogo
    print_step "Riepilogo Configurazione"
    echo -e "  ${BOLD}Nome dispositivo:${NC}     $DEVICE_NAME"
    echo -e "  ${BOLD}URL Server:${NC}           $SERVER_URL"
    echo -e "  ${BOLD}Appliance ID:${NC}         $APPLIANCE_ID"
    echo -e "  ${BOLD}Token:${NC}                ****${APPLIANCE_TOKEN: -4}"
    echo -e "  ${BOLD}Utente kiosk:${NC}         $KIOSK_USER"
    echo ""

    if ! confirm "Procedere con l'installazione?" "y"; then
        echo -e "\n${YELLOW}Installazione annullata.${NC}\n"
        exit 0
    fi
}

# Configurazione raccolta dall'operatore, una domanda alla volta
collect_configuration_interactive() {
    echo -e "${CYAN}Per completare l'installazione, sono necessarie alcune informazioni.${NC}"
    echo -e "${CYAN}Le puoi ottenere dal pannello Onesiforo Web nella sezione 'Nuova Appliance'.${NC}\n"

    # Nome dispositivo
    echo -e "${BOLD}1. Nome del dispositivo${NC} (es: 'Casa Nonna Maria')"
    ask DEVICE_NAME "   Nome [OnesiBox]: "
    DEVICE_NAME=${DEVICE_NAME:-"OnesiBox"}
    print_success "Nome: $DEVICE_NAME"
    echo ""

    # URL Server
    echo -e "${BOLD}2. URL del Server Onesiforo${NC}"
    echo -e "   ${YELLOW}Premi Invio per usare: $DEFAULT_SERVER_URL${NC}"
    while true; do
        ask SERVER_URL "   URL [$DEFAULT_SERVER_URL]: "
        SERVER_URL=${SERVER_URL:-$DEFAULT_SERVER_URL}
        SERVER_URL="${SERVER_URL%/}"

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
    echo -e "   ${YELLOW}Lascia vuoto per generarne uno automaticamente.${NC}"
    ask APPLIANCE_ID "   UUID [genera automatico]: "

    if [ -z "$APPLIANCE_ID" ]; then
        APPLIANCE_ID=$(generate_uuid)
        print_info "UUID generato: $APPLIANCE_ID"
        echo -e "   ${YELLOW}⚠ Copia questo UUID nel pannello Onesiforo!${NC}"
    else
        print_success "UUID: $APPLIANCE_ID"
    fi
    echo ""

    # Token Appliance
    echo -e "${BOLD}4. Token di Autenticazione${NC}"
    while true; do
        ask_secret APPLIANCE_TOKEN "   Token (nascosto): "

        if [ -z "$APPLIANCE_TOKEN" ]; then
            print_error "Il token è obbligatorio"
            continue
        fi

        print_success "Token configurato"
        break
    done
    echo ""

    # Impostazioni opzionali
    echo -e "${BOLD}5. Impostazioni Opzionali${NC}"
    ask POLLING_INTERVAL "   Intervallo polling in secondi [5]: "
    POLLING_INTERVAL=${POLLING_INTERVAL:-5}
    ask HEARTBEAT_INTERVAL "   Intervallo heartbeat in secondi [30]: "
    HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL:-30}
    ask DEFAULT_VOLUME "   Volume predefinito 0-100 [80]: "
    DEFAULT_VOLUME=${DEFAULT_VOLUME:-80}
    echo ""
}

# Configurazione presa da opzioni e variabili d'ambiente, senza domande.
# Ogni dato mancante o non valido ferma l'installazione con un errore parlante:
# non si prosegue mai "a metà".
collect_configuration_from_presets() {
    print_info "Modalità non interattiva: configurazione da opzioni e variabili d'ambiente"

    DEVICE_NAME="${PRESET_DEVICE_NAME:-OnesiBox}"
    SERVER_URL="${PRESET_SERVER_URL:-$DEFAULT_SERVER_URL}"
    SERVER_URL="${SERVER_URL%/}"
    APPLIANCE_ID="$PRESET_APPLIANCE_ID"
    APPLIANCE_TOKEN="$PRESET_APPLIANCE_TOKEN"
    POLLING_INTERVAL="${PRESET_POLLING_INTERVAL:-5}"
    HEARTBEAT_INTERVAL="${PRESET_HEARTBEAT_INTERVAL:-30}"
    DEFAULT_VOLUME="${PRESET_DEFAULT_VOLUME:-80}"

    if ! validate_url "$SERVER_URL"; then
        print_error "URL server non valido: '$SERVER_URL'"
        exit 2
    fi

    if [ -z "$APPLIANCE_TOKEN" ]; then
        print_error "Token di autenticazione mancante (--token / ONESIBOX_APPLIANCE_TOKEN)"
        exit 2
    fi

    if [ -z "$APPLIANCE_ID" ]; then
        APPLIANCE_ID=$(generate_uuid)
        print_warning "UUID generato automaticamente: $APPLIANCE_ID"
        print_warning "Registralo nel pannello Onesiforo, altrimenti la box resterà scollegata."
    fi

    if ! test_server_connection "$SERVER_URL"; then
        print_warning "Server non raggiungibile: $SERVER_URL"
        if ! is_true "$ASSUME_YES"; then
            print_error "Installazione interrotta. Usa --yes per procedere comunque."
            exit 4
        fi
        print_warning "Proseguo su richiesta esplicita (--yes)"
    fi

    print_success "Nome: $DEVICE_NAME"
    print_success "Server: $SERVER_URL"
    print_success "Appliance ID: $APPLIANCE_ID"
    print_success "Token configurato"
}

# ============================================================================
# Installazione pacchetti di sistema
# ============================================================================

install_system_packages() {
    print_step "Installazione Pacchetti di Sistema"

    print_info "Aggiornamento sistema..."
    run_system apt update -qq
    print_success "Lista pacchetti aggiornata"

    # Node.js 20 LTS
    print_info "Installazione Node.js 20 LTS..."
    NODE_VERSION=$(run_system node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')
    NODE_VERSION=${NODE_VERSION:-0}
    if [ "$NODE_VERSION" -lt 20 ]; then
        print_info "Aggiornamento Node.js da v$NODE_VERSION a v20..."
        run_system apt remove -y -qq nodejs npm 2>/dev/null || true
        # `bash -` legge lo script di NodeSource dalla pipe: è il suo stdin,
        # non il nostro, e non va chiuso.
        run_system curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        run_system apt install -y -qq nodejs
    fi
    if ! command -v npm &> /dev/null; then
        run_system apt install -y -qq npm 2>/dev/null || true
    fi
    print_success "Node.js $(run_system node --version) installato"

    # Git
    print_info "Installazione Git..."
    run_system apt install -y -qq git
    print_success "Git installato"

    # Chromium con codec video (H.264/MP4)
    print_info "Installazione Chromium con codec video..."
    run_system apt install -y -qq chromium chromium-codecs-ffmpeg-extra 2>/dev/null || \
    run_system apt install -y -qq chromium-browser chromium-codecs-ffmpeg-extra 2>/dev/null || \
    run_system apt install -y -qq chromium 2>/dev/null || \
    run_system apt install -y -qq chromium-browser 2>/dev/null || true
    # Verifica codec
    if run_system dpkg -l | grep -q "chromium-codecs-ffmpeg-extra"; then
        print_success "Chromium installato con codec H.264"
    else
        print_warning "Codec extra non disponibili, video MP4 potrebbero non funzionare"
    fi

    # labwc e dipendenze Wayland
    print_info "Installazione labwc e dipendenze Wayland..."
    run_system apt install -y -qq labwc seatd 2>/dev/null || true
    print_success "labwc installato"

    # Audio e codec multimediali
    print_info "Installazione strumenti audio e codec..."
    run_system apt install -y -qq alsa-utils pulseaudio
    # Codec video aggiuntivi per compatibilità
    run_system apt install -y -qq ffmpeg gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad 2>/dev/null || true
    print_success "Strumenti audio e codec installati"

    # Utilities
    print_info "Installazione utilities..."
    run_system apt install -y -qq curl wget jq grim webp
    print_success "Utilities installate"
}

# ============================================================================
# Configurazione utente e directory
# ============================================================================

setup_user_and_directories() {
    print_step "Configurazione Utente e Directory"

    # Aggiungi utente ai gruppi necessari
    print_info "Configurazione gruppi per $KIOSK_USER..."
    run_system usermod -aG video,audio,input "$KIOSK_USER" 2>/dev/null || true
    run_system usermod -aG gpio,i2c,spi "$KIOSK_USER" 2>/dev/null || true
    run_system usermod -aG seat "$KIOSK_USER" 2>/dev/null || true
    run_system usermod -aG render "$KIOSK_USER" 2>/dev/null || true
    print_success "Gruppi configurati"

    # Crea directory
    print_info "Creazione directory..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/config"
    mkdir -p "$INSTALL_DIR/data/chromium"
    mkdir -p "$INSTALL_DIR/data/playwright-profile"
    mkdir -p "$KIOSK_USER_HOME/.onesibox-zoom"
    mkdir -p "$LOG_DIR"
    print_success "Directory create"

    # Imposta permessi
    chown -R "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR"
    chown -R "$KIOSK_USER:$KIOSK_USER" "$LOG_DIR"
    chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_USER_HOME/.onesibox-zoom"
    print_success "Permessi configurati"

    # Configura sudoers
    print_info "Configurazione permessi sudo..."
    cat > /etc/sudoers.d/onesibox << EOF
# OnesiBox - permessi per comandi di sistema
$KIOSK_USER ALL=(ALL) NOPASSWD: /sbin/reboot
$KIOSK_USER ALL=(ALL) NOPASSWD: /sbin/shutdown
$KIOSK_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart onesibox
$KIOSK_USER ALL=(ALL) NOPASSWD: /bin/systemctl stop onesibox
$KIOSK_USER ALL=(ALL) NOPASSWD: /bin/systemctl start onesibox
$KIOSK_USER ALL=(ALL) NOPASSWD: /usr/bin/amixer
EOF
    chmod 440 /etc/sudoers.d/onesibox
    print_success "Permessi sudo configurati"
}

# ============================================================================
# Download e installazione applicazione
# ============================================================================

install_application() {
    print_step "Download Applicazione OnesiBox"

    cd "$INSTALL_DIR"

    # SCRIPT_DIR è vuota quando lo script arriva da una pipe (curl … | bash):
    # in quel caso non c'è alcuna copia locale da cui copiare, si scarica.
    if [ -n "$SCRIPT_DIR" ] && [ "$SCRIPT_DIR" != "$INSTALL_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
        print_info "Installazione da directory locale..."
        cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
        cp -r "$SCRIPT_DIR"/.[^.]* "$INSTALL_DIR/" 2>/dev/null || true
    elif [ -d "$INSTALL_DIR/.git" ]; then
        print_info "Aggiornamento repository esistente..."
        run_system git fetch origin
        run_system git reset --hard origin/main
    else
        print_info "Download da GitHub..."
        rm -rf "$INSTALL_DIR"/*
        run_system git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi
    print_success "Codice sorgente scaricato"

    # Installa dipendenze npm
    print_info "Installazione dipendenze npm..."
    cd "$INSTALL_DIR"
    run_system npm install --production --silent 2>/dev/null || run_system npm install --production
    print_success "Dipendenze npm installate"

    # Installa dipendenze e browser Playwright (necessario per Zoom web client)
    # `playwright install-deps` invoca apt a sua volta: DEBIAN_FRONTEND è
    # esportato, quindi la variabile arriva anche a quel apt.
    print_info "Installazione Playwright e dipendenze..."
    run_system sudo -u "$KIOSK_USER" npx playwright install-deps chromium 2>/dev/null || true
    run_system sudo -u "$KIOSK_USER" npx playwright install chromium 2>/dev/null || true
    print_success "Playwright installato (usato per Zoom, Chromium di sistema per video)"

    # Imposta permessi
    chown -R "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true
    print_success "Permessi applicazione configurati"
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

    chmod 600 "$CONFIG_FILE"
    chown "$KIOSK_USER:$KIOSK_USER" "$CONFIG_FILE"
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
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=$KIOSK_USER
ExecStart=/usr/bin/node $INSTALL_DIR/src/main.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=DISPLAY=:0
Environment=WAYLAND_DISPLAY=wayland-0
Environment=XDG_RUNTIME_DIR=/run/user/$KIOSK_USER_UID
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$KIOSK_USER_UID/bus
WorkingDirectory=$INSTALL_DIR

# Sicurezza
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$INSTALL_DIR $LOG_DIR $KIOSK_USER_HOME/.cache $KIOSK_USER_HOME/.config /run/user/$KIOSK_USER_UID $KIOSK_USER_HOME/.onesibox-zoom
PrivateTmp=true

[Install]
WantedBy=graphical.target
EOF

    print_success "Servizio systemd creato"

    print_info "Abilitazione servizio..."
    run_system systemctl daemon-reload
    run_system systemctl enable onesibox
    print_success "Servizio abilitato all'avvio"
}

# ============================================================================
# Configurazione autologin console + labwc
# ============================================================================

setup_kiosk_autologin() {
    print_step "Configurazione Autologin e Kiosk"

    # 1. Disabilita LightDM se presente
    print_info "Disabilitazione display manager..."
    run_system systemctl disable lightdm 2>/dev/null || true
    run_system systemctl disable gdm 2>/dev/null || true
    run_system systemctl disable sddm 2>/dev/null || true
    print_success "Display manager disabilitato"

    # 2. Configura autologin su TTY1
    print_info "Configurazione autologin su TTY1..."
    mkdir -p /etc/systemd/system/getty@tty1.service.d/
    cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
    print_success "Autologin TTY1 configurato"

    # 3. Configura .bash_profile per avviare labwc automaticamente
    print_info "Configurazione avvio automatico labwc..."
    BASH_PROFILE="$KIOSK_USER_HOME/.bash_profile"

    # Rimuovi vecchia configurazione se presente
    if [ -f "$BASH_PROFILE" ]; then
        run_system sed -i '/# Auto-start labwc/,/^fi$/d' "$BASH_PROFILE" 2>/dev/null || true
    fi

    # Aggiungi nuova configurazione
    cat >> "$BASH_PROFILE" << 'EOF'

# Auto-start labwc on TTY1
if [ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec labwc
fi
EOF
    chown "$KIOSK_USER:$KIOSK_USER" "$BASH_PROFILE"
    print_success "Avvio automatico labwc configurato"

    # 4. Configura labwc autostart per OnesiBox
    print_info "Configurazione labwc autostart..."
    LABWC_CONFIG_DIR="$KIOSK_USER_HOME/.config/labwc"
    mkdir -p "$LABWC_CONFIG_DIR"

    cat > "$LABWC_CONFIG_DIR/autostart" << EOF
# OnesiBox labwc autostart
# Export environment variables for Wayland
systemctl --user import-environment WAYLAND_DISPLAY XDG_RUNTIME_DIR 2>/dev/null || true
dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_RUNTIME_DIR 2>/dev/null || true

# Wait for Wayland to be ready, then restart OnesiBox service
sleep 2
sudo systemctl restart onesibox &
EOF

    # Copia rc.xml se esiste
    if [ -f "$INSTALL_DIR/config/labwc/rc.xml" ]; then
        cp "$INSTALL_DIR/config/labwc/rc.xml" "$LABWC_CONFIG_DIR/"
    fi

    chown -R "$KIOSK_USER:$KIOSK_USER" "$LABWC_CONFIG_DIR"
    print_success "labwc autostart configurato"

    print_success "Configurazione kiosk completata!"
    echo ""
    echo -e "  ${CYAN}Al riavvio:${NC}"
    echo -e "  1. Autologin utente ${BOLD}$KIOSK_USER${NC} su TTY1"
    echo -e "  2. Avvio automatico ${BOLD}labwc${NC} (Wayland)"
    echo -e "  3. Avvio automatico ${BOLD}OnesiBox${NC}"
}

# ============================================================================
# Configurazione aggiornamenti automatici
# ============================================================================

setup_auto_updates() {
    print_step "Configurazione Aggiornamenti Automatici"

    # Rendi eseguibili gli script di update
    chmod +x "$INSTALL_DIR/update.sh" 2>/dev/null || true
    chmod +x "$INSTALL_DIR/scripts/cron-update.sh" 2>/dev/null || true
    chmod +x "$INSTALL_DIR/updates/"*.sh 2>/dev/null || true

    # Crea directory per lo stato degli update
    mkdir -p "$INSTALL_DIR/data"
    chown "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR/data"

    # Chiedi se abilitare gli aggiornamenti automatici
    echo -e "${CYAN}Gli aggiornamenti automatici verificano e installano nuove versioni ogni notte.${NC}"
    if confirm_preset "$PRESET_AUTO_UPDATES" "Vuoi abilitare gli aggiornamenti automatici?" "y"; then
        # Installa cron job (usa lo script wrapper con delay random)
        CRON_CMD="0 3 * * * /opt/onesibox/scripts/cron-update.sh"

        # Rimuovi vecchio cron job se presente.
        # Il `crontab -u root -` finale legge la nuova tabella dalla pipe: il
        # suo stdin è già quello giusto e non va chiuso. Solo il `crontab -l`
        # in testa alla pipeline erediterebbe il descrittore 0 dello script.
        run_system crontab -u root -l 2>/dev/null | grep -v "onesibox.*update" | crontab -u root - 2>/dev/null || true

        # Aggiungi nuovo cron job
        (run_system crontab -u root -l 2>/dev/null || true; echo "$CRON_CMD") | crontab -u root -

        print_success "Aggiornamenti automatici abilitati (ogni notte alle 3:00)"
    else
        print_info "Aggiornamenti automatici non abilitati"
        print_info "Puoi aggiornare manualmente con: sudo $INSTALL_DIR/update.sh"
    fi

    # Aggiungi permesso sudo per update senza password
    if ! run_system grep -q "update.sh" /etc/sudoers.d/onesibox 2>/dev/null; then
        echo "$KIOSK_USER ALL=(ALL) NOPASSWD: $INSTALL_DIR/update.sh" >> /etc/sudoers.d/onesibox
    fi
}

# ============================================================================
# Avvio servizio e test
# ============================================================================

start_and_test() {
    print_step "Test dei Servizi"

    print_info "Il servizio verrà avviato automaticamente al prossimo riavvio"
    print_info "Per testare ora, riavvia il sistema con: sudo reboot"
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
    echo -e "  • Utente kiosk:      ${CYAN}$KIOSK_USER${NC} (UID: $KIOSK_USER_UID)"
    echo -e "  • Directory:         ${CYAN}$INSTALL_DIR${NC}"

    echo -e "\n${BOLD}Comandi utili:${NC}"
    echo -e "  • Stato servizio:    ${YELLOW}sudo systemctl status onesibox${NC}"
    echo -e "  • Log in tempo reale:${YELLOW}sudo journalctl -u onesibox -f${NC}"
    echo -e "  • Riavvia servizio:  ${YELLOW}sudo systemctl restart onesibox${NC}"
    echo -e "  • Aggiorna manualmente: ${YELLOW}sudo $INSTALL_DIR/update.sh${NC}"
    echo -e "  • Log aggiornamenti: ${YELLOW}cat $INSTALL_DIR/logs/update.log${NC}"

    echo -e "\n${BOLD}Prossimi passi:${NC}"
    echo -e "  1. ${CYAN}Registra l'appliance nel pannello Onesiforo${NC} se non l'hai già fatto"
    echo -e "     UUID: ${YELLOW}$APPLIANCE_ID${NC}"
    echo -e "  2. ${CYAN}Riavvia il sistema${NC} per attivare la modalità kiosk:"
    echo -e "     ${YELLOW}sudo reboot${NC}"

    echo -e "\n"
}

# ============================================================================
# Main
# ============================================================================

main() {
    parse_args "$@"

    # `clear` fallisce se TERM non è impostato (sessioni non interattive):
    # non è un motivo per interrompere l'installazione.
    clear 2>/dev/null || true
    print_banner

    # Prima di toccare il sistema: i dati passati sono coerenti?
    validate_preset_inputs

    # Prima di toccare il sistema: c'è qualcuno che può rispondere alle domande?
    if ! init_input_source; then
        print_error "Nessun terminale disponibile per le domande dell'installatore."
        echo ""
        print_info "Lo script è stato avviato senza un terminale (stdin non è un tty"
        print_info "e /dev/tty non è accessibile), quindi non può chiedere nulla."
        echo ""
        print_info "Soluzioni:"
        print_info "  1. Esegui l'installazione da una sessione SSH o da un terminale;"
        print_info "  2. oppure usa la modalità non interattiva, per esempio:"
        echo ""
        echo -e "     ${YELLOW}curl -fsSL $RAW_INSTALL_URL \\"
        echo -e "       | sudo bash -s -- --non-interactive --token IL_TUO_TOKEN${NC}"
        echo ""
        print_error "Installazione NON eseguita."
        exit 2
    fi

    if ! is_true "$NON_INTERACTIVE"; then
        print_info "Le risposte verranno lette da: $INPUT_SOURCE"
    fi

    check_prerequisites
    detect_kiosk_user
    check_existing_installation
    collect_configuration
    install_system_packages
    setup_user_and_directories
    install_application
    create_configuration
    setup_systemd_service
    setup_kiosk_autologin
    setup_auto_updates
    start_and_test
    print_summary
}

# Esegue main() sia quando lo script è invocato da file (./install.sh, bash
# install.sh) sia quando bash lo legge da stdin (curl … | sudo bash): in questo
# secondo caso BASH_SOURCE[0] è VUOTA e $0 vale "bash", quindi il confronto
# BASH_SOURCE[0] == $0 da solo era falso e non veniva eseguito nulla, in
# silenzio e con codice di uscita 0.
# Restano esclusi solo i `source install.sh`, dove BASH_SOURCE[0] è il percorso
# del file ma $0 è la shell chiamante.
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
