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
        while IFS= read -r line; do
            [[ -n "$line" ]] && executed+=("$line")
        done < "${STATE_FILE}"
    fi

    # Find and run new migrations (sorted alphabetically)
    local has_new=false
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

        # Execute migration
        if bash "$migration" 2>&1 | while IFS= read -r line; do log "INFO" "  ${line}"; done; then
            # Mark as executed
            echo "$name" >> "${STATE_FILE}"
            log "INFO" "Migration completed: ${name}"
        else
            log "ERROR" "Migration failed: ${name}"
            # Don't continue with other migrations if one fails
            return 1
        fi
    done

    if [[ "$has_new" == "false" ]]; then
        log "INFO" "No new migrations to run"
    fi
}

restart_service() {
    log "INFO" "Restarting ${SERVICE_NAME} service..."

    if command -v systemctl &> /dev/null; then
        if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
            if systemctl restart "${SERVICE_NAME}" 2>/dev/null; then
                log "INFO" "Service restarted successfully"
            else
                log "WARN" "Failed to restart service (run as root?)"
            fi
        else
            log "INFO" "Service not running, starting..."
            systemctl start "${SERVICE_NAME}" 2>/dev/null || \
                log "WARN" "Failed to start service"
        fi
    else
        log "WARN" "systemctl not found, please restart manually"
    fi
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

    # Get current version before pull
    OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    OLD_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")

    log "INFO" "Current version: ${OLD_VERSION} (${OLD_COMMIT:0:7})"

    # Fetch and check for updates
    log "INFO" "Checking for updates..."
    if ! git fetch origin main --quiet 2>/dev/null; then
        log "ERROR" "Failed to fetch from remote"
        exit 1
    fi

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)

    if [[ "$LOCAL" == "$REMOTE" ]]; then
        log "INFO" "Already up to date"

        # Still run pending migrations (in case previous update failed)
        run_pending_migrations
        log "INFO" "=== Update Check Complete ==="
        exit 0
    fi

    # Pull updates
    log "INFO" "Downloading updates..."
    git reset --hard origin/main --quiet 2>/dev/null || git reset --hard origin/master --quiet
    git pull origin main --quiet 2>/dev/null || git pull origin master --quiet

    NEW_COMMIT=$(git rev-parse HEAD)
    NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

    log "INFO" "Updated to version: ${NEW_VERSION} (${NEW_COMMIT:0:7})"

    # Check if package.json changed (need npm install)
    if git diff --name-only "${OLD_COMMIT}" "${NEW_COMMIT}" 2>/dev/null | grep -q "package.json"; then
        log "INFO" "Dependencies changed, running npm install..."
        npm install --production --silent 2>/dev/null || npm install --production
    fi

    # Run migrations
    run_pending_migrations

    # Restart service
    restart_service

    log "INFO" "=== Update Complete ==="
}

# Run main
main "$@"
