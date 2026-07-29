#!/bin/bash
#
# OnesiBox Auto-Update Script
# Pulls latest code and runs versioned migrations
#
# Usage:
#   ./update.sh           # Interactive mode
#   ./update.sh --cron    # Silent mode for cron jobs
#
set -e

# Configuration
INSTALL_DIR="/opt/onesibox"
REPO_DIR="${INSTALL_DIR}"
STATE_FILE="${INSTALL_DIR}/data/.update-state"
LOG_FILE="${INSTALL_DIR}/logs/update.log"
LOCK_FILE="/tmp/onesibox-update.lock"
SERVICE_NAME="onesibox"

# Health check dopo il restart. Con Type=simple l'unità risulta "active"
# appena node viene eseguito, anche se muore un istante dopo: per accorgersi
# di un crash loop bisogna osservarla per una finestra che copra più cicli di
# Restart=always/RestartSec=10 (scripts/onesibox.service).
SERVICE_HEALTH_STABLE_SECS=60
SERVICE_HEALTH_POLL_SECS=5

# Colors (disabled in cron mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
CRON_MODE=false
if [[ "$1" == "--cron" ]]; then
    CRON_MODE=true
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# ============================================================================
# Functions
# ============================================================================

log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Ensure log directory exists
    mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true

    # Always log to file
    echo "[${timestamp}] [${level}] ${message}" >> "${LOG_FILE}"

    # Print to console unless in cron mode
    if [[ "$CRON_MODE" == "false" ]]; then
        case "$level" in
            INFO)  echo -e "${GREEN}[INFO]${NC} ${message}" ;;
            WARN)  echo -e "${YELLOW}[WARN]${NC} ${message}" ;;
            ERROR) echo -e "${RED}[ERROR]${NC} ${message}" ;;
            *)     echo "[${level}] ${message}" ;;
        esac
    fi
}

cleanup() {
    rm -f "${LOCK_FILE}"
}

run_pending_migrations() {
    local migrations_dir="${REPO_DIR}/updates"

    if [[ ! -d "${migrations_dir}" ]]; then
        log "INFO" "No migrations directory found"
        return 0
    fi

    # Ensure state directory exists
    mkdir -p "$(dirname "${STATE_FILE}")" 2>/dev/null || true

    # Load executed migrations
    local executed=()
    if [[ -f "${STATE_FILE}" ]]; then
        # Se il file esiste ma non è leggibile lo si tratterebbe come vuoto,
        # rieseguendo migrazioni già applicate: meglio fermarsi.
        if [[ ! -r "${STATE_FILE}" ]]; then
            log "ERROR" "State file not readable: ${STATE_FILE}"
            return 1
        fi
        while IFS= read -r line; do
            [[ -n "$line" ]] && executed+=("$line")
        done < "${STATE_FILE}"
    fi

    # Find and run new migrations (sorted alphabetically)
    local has_new=false
    local migration_rc=0
    for migration in $(find "${migrations_dir}" -maxdepth 1 -name "*.sh" -type f | sort); do
        [[ -f "$migration" ]] || continue

        local name=$(basename "$migration")

        # Skip README
        [[ "$name" == "README.md" ]] && continue

        # Skip if already executed
        local already_executed=false
        for exec in "${executed[@]}"; do
            if [[ "$exec" == "$name" ]]; then
                already_executed=true
                break
            fi
        done

        if [[ "$already_executed" == "true" ]]; then
            continue
        fi

        has_new=true
        log "INFO" "Running migration: ${name}"

        # Execute migration.
        #
        # L'esito va letto da PIPESTATUS[0]: lo stato di uscita della pipeline
        # è quello del `while`, che riesce sempre, quindi testare direttamente
        # la pipeline marcherebbe come completata anche una migrazione fallita.
        #
        # Volutamente NON si abilita `set -o pipefail` a livello di script:
        # cambierebbe anche `git diff --name-only ... | grep -q` più sotto, dove
        # grep esce al primo match e fa arrivare SIGPIPE a git (stato 141), con
        # il risultato di saltare `npm install` in modo non deterministico.
        bash "$migration" 2>&1 | while IFS= read -r line; do log "INFO" "  ${line}"; done
        migration_rc=${PIPESTATUS[0]}

        if [[ "$migration_rc" -eq 0 ]]; then
            # Mark as executed
            if ! echo "$name" >> "${STATE_FILE}"; then
                log "ERROR" "Cannot record migration state in ${STATE_FILE}"
                return 1
            fi
            log "INFO" "Migration completed: ${name}"
        else
            log "ERROR" "Migration failed: ${name} (exit ${migration_rc})"
            # Don't continue with other migrations if one fails
            return 1
        fi
    done

    if [[ "$has_new" == "false" ]]; then
        log "INFO" "No new migrations to run"
    fi
}

have_systemctl() {
    command -v systemctl &> /dev/null
}

service_is_active() {
    systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null
}

# Numero di riavvii automatici già effettuati da systemd per l'unità.
# Stringa vuota o non numerica se il dato non è disponibile.
service_restart_count() {
    systemctl show -p NRestarts --value "${SERVICE_NAME}" 2>/dev/null || true
}

# `systemctl reset-failed` prima di ogni start/restart: un'unità entrata in
# stato failed per superamento di StartLimitBurst=5 in StartLimitIntervalSec=300
# rifiuta ogni successivo start ("start request repeated too quickly") finché
# il contatore non viene azzerato. Senza questo, una notte storta rende il
# dispositivo non recuperabile da remoto.
restart_service() {
    log "INFO" "Restarting ${SERVICE_NAME} service..."

    if ! have_systemctl; then
        log "WARN" "systemctl not found, please restart manually"
        return 1
    fi

    systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true

    if service_is_active; then
        if systemctl restart "${SERVICE_NAME}" 2>/dev/null; then
            log "INFO" "Restart command accepted"
            return 0
        fi
        log "ERROR" "Failed to restart service (run as root?)"
        return 1
    fi

    log "INFO" "Service not running, starting..."
    if systemctl start "${SERVICE_NAME}" 2>/dev/null; then
        log "INFO" "Start command accepted"
        return 0
    fi
    log "ERROR" "Failed to start service (run as root?)"
    return 1
}

# `systemctl restart` che ritorna 0 dice solo che systemd ha accettato il
# comando. Qui si verifica che il servizio sia davvero rimasto su, osservandolo
# per SERVICE_HEALTH_STABLE_SECS: un crash loop si manifesta come NRestarts che
# cresce o come stato diverso da "active" (durante l'auto-restart l'unità è in
# "activating"). Se systemctl non c'è, l'esito non è verificabile: si segnala
# ma non si considera un guasto, perché un rollback deciso sull'impossibilità
# di misurare sarebbe peggio del problema.
wait_for_healthy_service() {
    local baseline_restarts="$1"
    local elapsed=0
    local state now_restarts

    if ! have_systemctl; then
        log "WARN" "Health check skipped: systemctl not available"
        return 0
    fi

    log "INFO" "Health check: watching ${SERVICE_NAME} for ${SERVICE_HEALTH_STABLE_SECS}s (baseline NRestarts=${baseline_restarts:-n/a})"

    while [[ "$elapsed" -lt "$SERVICE_HEALTH_STABLE_SECS" ]]; do
        sleep "$SERVICE_HEALTH_POLL_SECS"
        elapsed=$(( elapsed + SERVICE_HEALTH_POLL_SECS ))

        if ! service_is_active; then
            state=$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || true)
            log "ERROR" "Health check FAILED after ${elapsed}s: service state is '${state:-unknown}'"
            return 1
        fi

        now_restarts=$(service_restart_count)
        if [[ "$baseline_restarts" =~ ^[0-9]+$ ]] && [[ "$now_restarts" =~ ^[0-9]+$ ]] \
           && [[ "$now_restarts" -gt "$baseline_restarts" ]]; then
            log "ERROR" "Health check FAILED after ${elapsed}s: service restarted $(( now_restarts - baseline_restarts )) time(s) (crash loop)"
            return 1
        fi
    done

    log "INFO" "Health check OK: ${SERVICE_NAME} active and stable for ${elapsed}s"
    return 0
}

# Riporta il dispositivo su OLD_COMMIT, reinstalla le dipendenze di quel
# commit e riavvia. Le migrazioni già eseguite NON vengono annullate: restano
# marcate in data/.update-state e devono essere idempotenti.
rollback_update() {
    local reason="$1"
    local baseline

    log "ERROR" "=== ROLLBACK: ${reason} ==="

    if [[ -z "${OLD_COMMIT}" || "${OLD_COMMIT}" == "unknown" ]]; then
        log "ERROR" "ROLLBACK NOT POSSIBLE: previous commit unknown, device stays on the new code"
        return 1
    fi

    log "WARN" "Restoring previous commit ${OLD_COMMIT:0:7} (${OLD_VERSION})"
    if ! git reset --hard "${OLD_COMMIT}" --quiet 2>/dev/null; then
        log "ERROR" "ROLLBACK FAILED: git reset --hard ${OLD_COMMIT:0:7} did not succeed"
        return 1
    fi

    # node_modules può essere rimasto a metà dall'install fallito: si
    # reinstalla sempre, anche se il rollback non è stato causato da npm.
    log "WARN" "Reinstalling dependencies for the restored commit..."
    if ! npm install --production --silent 2>/dev/null; then
        if ! npm install --production; then
            log "ERROR" "ROLLBACK INCOMPLETE: code restored but npm install failed, node_modules may be inconsistent"
        fi
    fi

    if ! restart_service; then
        log "ERROR" "ROLLBACK INCOMPLETE: code restored but the service could not be restarted"
        return 1
    fi

    baseline=$(service_restart_count)
    if wait_for_healthy_service "${baseline}"; then
        log "WARN" "ROLLBACK SUCCEEDED: device back on ${OLD_VERSION} (${OLD_COMMIT:0:7}), service active"
        log "WARN" "Already applied migrations were NOT reverted, check data/.update-state"
        return 0
    fi

    log "ERROR" "ROLLBACK DONE BUT SERVICE STILL UNHEALTHY: manual intervention required"
    return 1
}

# ============================================================================
# Main
# ============================================================================

main() {
    trap cleanup EXIT

    # Check if already running
    if [[ -f "${LOCK_FILE}" ]]; then
        pid=$(cat "${LOCK_FILE}" 2>/dev/null || echo "")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            log "WARN" "Update already in progress (PID: ${pid})"
            exit 0
        fi
    fi
    echo $$ > "${LOCK_FILE}"

    # Create directories if needed
    mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
    mkdir -p "$(dirname "${STATE_FILE}")" 2>/dev/null || true

    log "INFO" "=== OnesiBox Update Started ==="

    # Check if running as root (required for service restart)
    if [[ $EUID -ne 0 ]]; then
        log "WARN" "Running without root privileges. Service restart may fail."
    fi

    # Navigate to repo
    if [[ ! -d "${REPO_DIR}" ]]; then
        log "ERROR" "Repository not found at ${REPO_DIR}"
        exit 1
    fi
    cd "${REPO_DIR}"

    # Check if this is a git repo
    if [[ ! -d ".git" ]]; then
        log "ERROR" "Not a git repository: ${REPO_DIR}"
        exit 1
    fi

    # Get current version before pull. OLD_COMMIT è il bersaglio del rollback:
    # va letto prima di qualunque modifica al working tree.
    OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    # Match the client's own getAppVersion() source so the log reports the
    # same version the dashboard sees (git tag), falling back to package.json.
    OLD_VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)
    OLD_VERSION=${OLD_VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")}

    log "INFO" "Current version: ${OLD_VERSION} (${OLD_COMMIT:0:7})"

    if [[ "${OLD_COMMIT}" == "unknown" ]]; then
        log "WARN" "Cannot determine the current commit: this update will NOT be rollback-able"
    fi

    # Stato del servizio prima di toccare qualsiasi cosa. Se era già giù, un
    # health check negativo dopo l'update non dimostra che sia colpa
    # dell'update: in quel caso non si fa rollback, per non riportare il
    # dispositivo su un codice vecchio altrettanto rotto ogni notte.
    SERVICE_WAS_ACTIVE=false
    if have_systemctl && service_is_active; then
        SERVICE_WAS_ACTIVE=true
    fi
    log "INFO" "Service state before update: $([[ "$SERVICE_WAS_ACTIVE" == "true" ]] && echo "active" || echo "not active")"

    # Fetch and check for updates
    log "INFO" "Checking for updates..."
    # --tags ensures release tags (used by getAppVersion → git describe) are synced;
    # --force keeps tag refs aligned if they were moved upstream.
    if ! git fetch origin main --tags --force --quiet 2>/dev/null; then
        log "ERROR" "Failed to fetch from remote"
        exit 1
    fi

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)

    if [[ "$LOCAL" == "$REMOTE" ]]; then
        log "INFO" "Already up to date"

        # Still run pending migrations (in case previous update failed)
        if ! run_pending_migrations; then
            log "ERROR" "=== Update Check FAILED: pending migrations not applied ==="
            exit 1
        fi
        log "INFO" "=== Update Check Complete ==="
        exit 0
    fi

    # Pull updates
    log "INFO" "Downloading updates..."
    if ! git reset --hard origin/main --quiet 2>/dev/null && ! git reset --hard origin/master --quiet; then
        log "ERROR" "Failed to check out the fetched revision, nothing was changed"
        exit 1
    fi
    # Ridondante dopo il reset sul ref appena fetchato, ma un suo fallimento
    # non deve far abortire lo script con `set -e`: il working tree è già
    # cambiato e uscire qui lascerebbe codice nuovo senza npm install,
    # senza migrazioni e senza restart.
    git pull origin main --quiet 2>/dev/null || git pull origin master --quiet 2>/dev/null || \
        log "WARN" "git pull returned an error after the reset, continuing on the fetched revision"

    NEW_COMMIT=$(git rev-parse HEAD)
    NEW_VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)
    NEW_VERSION=${NEW_VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")}

    log "INFO" "Updated to version: ${NEW_VERSION} (${NEW_COMMIT:0:7})"

    # Da qui in poi il working tree è cambiato: ogni fallimento deve riportare
    # il dispositivo su OLD_COMMIT, altrimenti resta codice nuovo su disco con
    # il processo vecchio ancora vivo in RAM, e il guasto esplode al riavvio.

    # Check if dependency manifests changed (need npm install).
    #
    # Il pattern precedente, `grep -q "package.json"`, NON matcha
    # "package-lock.json": "package" seguito da un carattere qualsiasi e da
    # "json" non compare in quella stringa. Un rilascio che tocca solo il
    # lockfile — come v0.12.0 — saltava quindi npm install.
    #
    # Se il diff non è calcolabile si esegue npm install comunque: sbagliare
    # per eccesso costa qualche minuto, sbagliare per difetto lascia il
    # dispositivo con node_modules disallineato dal codice.
    CHANGED_FILES=$(git diff --name-only "${OLD_COMMIT}" "${NEW_COMMIT}" 2>/dev/null || true)
    if [[ -z "${CHANGED_FILES}" ]]; then
        log "WARN" "Cannot list changed files between ${OLD_COMMIT:0:7} and ${NEW_COMMIT:0:7}, running npm install anyway"
    fi
    if [[ -z "${CHANGED_FILES}" ]] || printf '%s\n' "${CHANGED_FILES}" | grep -Eq '(^|/)package(-lock)?\.json$'; then
        log "INFO" "Dependencies changed, running npm install..."
        if ! npm install --production --silent 2>/dev/null; then
            if ! npm install --production; then
                log "ERROR" "npm install failed on ${NEW_COMMIT:0:7}"
                rollback_update "npm install failed while updating to ${NEW_VERSION}" || true
                log "ERROR" "=== Update FAILED ==="
                exit 1
            fi
        fi
    fi

    # Run migrations
    if ! run_pending_migrations; then
        rollback_update "migration failed while updating to ${NEW_VERSION}" || true
        log "ERROR" "=== Update FAILED: migration error on ${NEW_COMMIT:0:7} ==="
        exit 1
    fi

    # Restart service
    if ! restart_service; then
        rollback_update "service restart failed after updating to ${NEW_VERSION}" || true
        log "ERROR" "=== Update FAILED ==="
        exit 1
    fi

    # Il restart accettato non basta: si verifica che il servizio regga.
    HEALTH_BASELINE=$(service_restart_count)
    if ! wait_for_healthy_service "${HEALTH_BASELINE}"; then
        if [[ "$SERVICE_WAS_ACTIVE" == "true" ]]; then
            rollback_update "service did not stay up after updating to ${NEW_VERSION}" || true
        else
            log "WARN" "No rollback: the service was already down before this update, ${NEW_VERSION} is not proven to be the cause"
            log "ERROR" "Device left on ${NEW_VERSION} (${NEW_COMMIT:0:7}) with an unhealthy service: manual intervention required"
        fi
        log "ERROR" "=== Update FAILED ==="
        exit 1
    fi

    log "INFO" "=== Update Complete ==="
}

# Run main
main "$@"
