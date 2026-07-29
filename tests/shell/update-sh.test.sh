#!/bin/bash
# ============================================================================
# Test di update.sh — percorsi di fallimento e rollback
# ============================================================================
# Protegge dalle regressioni descritte nell'issue #62:
#   A) l'esito di una migrazione veniva letto dallo stato della pipeline
#      `bash "$migration" | while read …`, che è quello del `while` e vale
#      sempre 0: ogni migrazione fallita veniva marcata come completata;
#   B) nessun rollback né health-check dopo l'aggiornamento: un update fallito
#      a metà lasciava codice nuovo su disco con il processo vecchio in RAM;
#   C) `grep -q "package.json"` non matcha "package-lock.json", quindi un
#      rilascio che tocca solo il lockfile saltava `npm install`.
#
# Uso:  bash tests/shell/update-sh.test.sh      (oppure: npm run test:shell)
#
# I test NON eseguono mai un aggiornamento reale. Ogni scenario gira in una
# sandbox temporanea con un repository git usa-e-getta, `systemctl` e `npm`
# stubbati nel PATH, e una copia di update.sh in cui INSTALL_DIR, LOCK_FILE e
# i tempi dell'health-check sono riscritti sulla sandbox. Se quella riscrittura
# non va a buon fine i test si fermano prima di eseguire qualsiasi cosa,
# perché uno script non riscritto lavorerebbe su /opt/onesibox.
# ============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UPDATE_SH="$REPO_ROOT/update.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0

pass() { PASSED=$((PASSED + 1)); echo -e "  ${GREEN}✓${NC} $1"; }
skip() { SKIPPED=$((SKIPPED + 1)); echo -e "  ${YELLOW}−${NC} $1 (saltato: $2)"; }
fail() {
    FAILED=$((FAILED + 1))
    echo -e "  ${RED}✗${NC} $1"
    shift
    local line
    for line in "$@"; do
        echo "      $line"
    done
}

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    echo -e "${RED}Non eseguire questi test come root:${NC} update.sh riavvia servizi." >&2
    exit 1
fi

if [ ! -f "$UPDATE_SH" ]; then
    echo "update.sh non trovato in $REPO_ROOT" >&2
    exit 1
fi

if ! command -v git > /dev/null 2>&1; then
    echo "git non disponibile: i test di update.sh richiedono un git funzionante" >&2
    exit 1
fi

TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/onesibox-update-test.XXXXXX")"
cleanup_tmproot() { rm -rf "$TMPROOT"; }
trap cleanup_tmproot EXIT

# ============================================================================
# Sandbox
# ============================================================================

# Variabili popolate da sandbox_create.
SBX=""           # radice della sandbox
SBX_INSTALL=""   # finto /opt/onesibox
SBX_WORK=""      # clone di lavoro dove si prepara il "nuovo rilascio"
SBX_SUT=""       # copia di update.sh riscritta sulla sandbox
SBX_STATE=""     # stato del finto systemd
SBX_NPM_LOG=""
SBX_SYSTEMCTL_LOG=""

SANDBOX_SEQ=0

# Crea gli stub di systemctl e npm. Lo stato del servizio vive in un file di
# coppie chiave=valore; il comportamento dipende da un marcatore nel codice
# effettivamente in checkout, così un rollback riporta davvero l'unità in
# salute come farebbe systemd rieseguendo il codice vecchio.
write_stubs() {
    local bin="$SBX/bin"
    mkdir -p "$bin"

    cat > "$bin/systemctl" <<'STUB'
#!/bin/bash
# Stub di systemd: ActiveState, NRestarts e il rate-limit di
# StartLimitBurst=5 / StartLimitIntervalSec=300 (scripts/onesibox.service).
set -u
STATE="$ONESIBOX_TEST_STATE"
echo "systemctl $*" >> "$ONESIBOX_TEST_SYSTEMCTL_LOG"

get() { sed -n "s/^$1=//p" "$STATE" | tail -1; }
put() {
    local rest
    rest=$(grep -v "^$1=" "$STATE" 2>/dev/null)
    { [ -n "$rest" ] && printf '%s\n' "$rest"; printf '%s=%s\n' "$1" "$2"; } > "$STATE.new"
    mv "$STATE.new" "$STATE"
}

# Marcatore piazzato dal test nel codice del "nuovo rilascio".
code_marker() {
    if grep -q 'ONESIBOX_TEST_CRASH_IMMEDIATE' "$ONESIBOX_TEST_INSTALL_DIR/src/main.js" 2>/dev/null; then
        echo immediate
    elif grep -q 'ONESIBOX_TEST_CRASH_FLAP' "$ONESIBOX_TEST_INSTALL_DIR/src/main.js" 2>/dev/null; then
        echo flap
    else
        echo healthy
    fi
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
    is-active)
        [ "${1:-}" = "--quiet" ] && shift
        st=$(get active_state)
        [ "${1:-}" != "--quiet" ] && echo "$st"
        [ "$st" = "active" ] && exit 0
        exit 3
        ;;
    show)
        # systemctl show -p NRestarts --value NAME
        if printf '%s\n' "$@" | grep -q NRestarts; then
            n=$(get nrestarts)
            # In "flap" l'unità resta formalmente attiva ma systemd la riavvia:
            # è il caso Type=simple in cui il poll cade mentre node è vivo.
            if [ "$(get crash_mode)" = "flap" ]; then
                n=$((n + 1))
                put nrestarts "$n"
            fi
            echo "$n"
        fi
        exit 0
        ;;
    reset-failed)
        put rate_limited 0
        put nrestarts 0
        [ "$(get active_state)" = "failed" ] && put active_state inactive
        exit 0
        ;;
    restart|start)
        if [ "$(get rate_limited)" = "1" ]; then
            echo "Job for onesibox.service failed: start request repeated too quickly" >&2
            exit 1
        fi
        mode=$(code_marker)
        put crash_mode "$mode"
        put nrestarts 0
        case "$mode" in
            # il servizio non si stabilizza mai: resta in auto-restart
            immediate) put active_state activating ;;
            *)         put active_state active ;;
        esac
        exit 0
        ;;
    *)
        exit 0
        ;;
esac
STUB

    cat > "$bin/npm" <<'STUB'
#!/bin/bash
echo "npm $*" >> "$ONESIBOX_TEST_NPM_LOG"
if [ "${ONESIBOX_TEST_NPM_FAIL:-0}" = "1" ]; then
    echo "npm ERR! ENOSPC: no space left on device" >&2
    exit 1
fi
exit 0
STUB

    chmod +x "$bin/systemctl" "$bin/npm"
}

# Riscrive INSTALL_DIR, LOCK_FILE e i tempi dell'health-check sulla sandbox.
# Ogni sostituzione è verificata: se una fallisce lo script sotto test
# lavorerebbe su /opt/onesibox, quindi si esce senza eseguire nulla.
write_sut() {
    SBX_SUT="$SBX/update.sh"
    sed -e "s#^INSTALL_DIR=\"/opt/onesibox\"\$#INSTALL_DIR=\"$SBX_INSTALL\"#" \
        -e "s#^LOCK_FILE=\"/tmp/onesibox-update.lock\"\$#LOCK_FILE=\"$SBX/update.lock\"#" \
        -e "s#^SERVICE_HEALTH_STABLE_SECS=.*\$#SERVICE_HEALTH_STABLE_SECS=2#" \
        -e "s#^SERVICE_HEALTH_POLL_SECS=.*\$#SERVICE_HEALTH_POLL_SECS=1#" \
        "$UPDATE_SH" > "$SBX_SUT"

    local expected
    for expected in \
        "INSTALL_DIR=\"$SBX_INSTALL\"" \
        "LOCK_FILE=\"$SBX/update.lock\"" \
        "SERVICE_HEALTH_STABLE_SECS=2" \
        "SERVICE_HEALTH_POLL_SECS=1"
    do
        if ! grep -qxF "$expected" "$SBX_SUT"; then
            echo "" >&2
            echo -e "${RED}INTERROTTO:${NC} non riesco a puntare update.sh sulla sandbox." >&2
            echo "Manca la riga attesa: $expected" >&2
            echo "Le costanti di configurazione in update.sh sono cambiate: aggiorna write_sut()" >&2
            echo "in questo test. Non eseguo nulla, per non lavorare su /opt/onesibox." >&2
            exit 1
        fi
    done

    # Nessuna costante deve puntare a un percorso assoluto reale. L'ancoraggio
    # sulla virgoletta è necessario: la sandbox stessa contiene "opt/onesibox".
    if grep -nE '^[A-Z_]+="(/opt/onesibox|/tmp/onesibox)' "$SBX_SUT" > /dev/null; then
        echo -e "${RED}INTERROTTO:${NC} la copia sotto test punta ancora a percorsi reali." >&2
        grep -nE '^[A-Z_]+="(/opt/onesibox|/tmp/onesibox)' "$SBX_SUT" >&2
        exit 1
    fi
}

# sandbox_create — repository finto con un commit "vecchio" già in checkout.
sandbox_create() {
    SANDBOX_SEQ=$((SANDBOX_SEQ + 1))
    SBX="$TMPROOT/sbx-$SANDBOX_SEQ"
    SBX_INSTALL="$SBX/opt/onesibox"
    SBX_WORK="$SBX/work"
    SBX_STATE="$SBX/systemctl.state"
    SBX_NPM_LOG="$SBX/npm.calls"
    SBX_SYSTEMCTL_LOG="$SBX/systemctl.calls"
    mkdir -p "$SBX"

    write_stubs

    git init --quiet --bare "$SBX/origin.git"
    git clone --quiet "$SBX/origin.git" "$SBX_WORK" 2>/dev/null
    (
        cd "$SBX_WORK" || exit 1
        git config user.email test@example.invalid
        git config user.name test
        git config commit.gpgsign false
        mkdir -p updates src
        printf '{ "name": "onesibox", "version": "0.11.0" }\n' > package.json
        printf '{ "lockfileVersion": 3, "packages": {} }\n' > package-lock.json
        printf '#!/bin/bash\necho "migrazione 001 ok"\nexit 0\n' > updates/001-ok.sh
        chmod +x updates/001-ok.sh
        printf "console.log('v0.11.0')\n" > src/main.js
        git add -A
        git commit --quiet -m "v0.11.0"
        git tag v0.11.0
        git push --quiet origin HEAD:main --tags
    ) || return 1

    git clone --quiet --branch main "$SBX/origin.git" "$SBX_INSTALL"
    (
        cd "$SBX_INSTALL" || exit 1
        git config user.email test@example.invalid
        git config user.name test
        mkdir -p data logs
    ) || return 1

    OLD_HEAD=$(cd "$SBX_INSTALL" && git rev-parse HEAD)

    printf 'active_state=active\nnrestarts=0\nrate_limited=0\ncrash_mode=healthy\n' > "$SBX_STATE"

    write_sut
}

# sandbox_publish — pubblica il contenuto corrente di $SBX_WORK come v0.12.0.
sandbox_publish() {
    (
        cd "$SBX_WORK" || exit 1
        git add -A
        git commit --quiet -m "v0.12.0"
        git tag v0.12.0
        git push --quiet origin HEAD:main --tags
    )
}

# sandbox_service_failed — l'unità è già in failed per rate-limit.
sandbox_service_failed() {
    printf 'active_state=failed\nnrestarts=5\nrate_limited=1\ncrash_mode=healthy\n' > "$SBX_STATE"
}

# run_update — esegue la copia sotto test e popola RC, LOG, HEAD_AFTER,
# NPM_CALLS, SYSTEMCTL_CALLS, MIGRATION_STATE.
run_update() {
    local npm_fail="${1:-0}"
    (
        cd "$SBX_INSTALL" || exit 1
        env PATH="$SBX/bin:$PATH" \
            ONESIBOX_TEST_STATE="$SBX_STATE" \
            ONESIBOX_TEST_NPM_LOG="$SBX_NPM_LOG" \
            ONESIBOX_TEST_SYSTEMCTL_LOG="$SBX_SYSTEMCTL_LOG" \
            ONESIBOX_TEST_INSTALL_DIR="$SBX_INSTALL" \
            ONESIBOX_TEST_NPM_FAIL="$npm_fail" \
            bash "$SBX_SUT" --cron > /dev/null 2>&1
    )
    RC=$?
    LOG=$(cat "$SBX_INSTALL/logs/update.log" 2>/dev/null)
    HEAD_AFTER=$(cd "$SBX_INSTALL" && git rev-parse HEAD 2>/dev/null)
    NPM_CALLS=$(cat "$SBX_NPM_LOG" 2>/dev/null)
    SYSTEMCTL_CALLS=$(cat "$SBX_SYSTEMCTL_LOG" 2>/dev/null)
    MIGRATION_STATE=$(cat "$SBX_INSTALL/data/.update-state" 2>/dev/null)
}

echo ""
echo "update.sh — percorsi di fallimento e rollback"
echo ""

# --- 1. Sintassi ------------------------------------------------------------
if bash -n "$UPDATE_SH" 2>/dev/null; then
    pass "sintassi valida (bash -n)"
else
    fail "sintassi valida (bash -n)" "$(bash -n "$UPDATE_SH" 2>&1)"
fi

# --- 2. Nessun `set -o pipefail` globale ------------------------------------
# Tripwire sulla scelta deliberata di leggere l'esito delle migrazioni da
# PIPESTATUS[0] invece di abilitare pipefail per tutto lo script. Il motivo è
# la pipeline che cerca i manifest delle dipendenze: `grep -q` esce al primo
# match, il produttore riceve SIGPIPE e con pipefail la pipeline vale 141,
# quindi `npm install` verrebbe saltato. Il test 9 lo verifica nei fatti.
GLOBAL_PIPEFAIL=$(grep -nE '^set[[:space:]]+[^#]*pipefail' "$UPDATE_SH" || true)
if [ -z "$GLOBAL_PIPEFAIL" ]; then
    pass "nessun 'set -o pipefail' globale"
else
    fail "nessun 'set -o pipefail' globale" \
         "su un diff più grande del buffer della pipe (64 KB) il produttore muore" \
         "di SIGPIPE, la pipeline vale 141 e npm install viene saltato in silenzio." \
         "L'esito delle migrazioni va letto da PIPESTATUS[0], non da pipefail." \
         "$GLOBAL_PIPEFAIL"
fi

# --- 3. Una migrazione che fallisce viene rilevata e NON marcata completata --
# È il difetto A: prima veniva scritta in data/.update-state e mai più ritentata.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf '#!/bin/bash\necho "apt-get non raggiungibile"\nexit 1\n' > "$SBX_WORK/updates/002-broken.sh"
    chmod +x "$SBX_WORK/updates/002-broken.sh"
    sandbox_publish
    run_update

    if grep -q "002-broken.sh" <<< "$MIGRATION_STATE"; then
        fail "migrazione fallita: non marcata come completata" \
             "002-broken.sh è finita in data/.update-state e non verrà mai più ritentata" \
             "stato: $MIGRATION_STATE"
    elif ! grep -q "Migration failed: 002-broken.sh" <<< "$LOG"; then
        fail "migrazione fallita: non marcata come completata" \
             "il log non riporta il fallimento della migrazione" \
             "$(tail -5 <<< "$LOG")"
    elif [ "$RC" -eq 0 ]; then
        fail "migrazione fallita: non marcata come completata" \
             "update.sh è uscito con 0 nonostante la migrazione fallita"
    else
        pass "migrazione fallita: rilevata, non marcata come completata (exit $RC)"
    fi

    # La migrazione riuscita prima di quella rotta deve invece restare registrata.
    if grep -q "001-ok.sh" <<< "$MIGRATION_STATE"; then
        pass "migrazione riuscita: registrata in data/.update-state"
    else
        fail "migrazione riuscita: registrata in data/.update-state" \
             "stato: ${MIGRATION_STATE:-<vuoto>}"
    fi

    # …e l'aggiornamento fallito deve riportare il dispositivo indietro.
    if [ "$HEAD_AFTER" = "$OLD_HEAD" ] && grep -q "ROLLBACK SUCCEEDED" <<< "$LOG"; then
        pass "migrazione fallita: rollback sul commit precedente"
    else
        fail "migrazione fallita: rollback sul commit precedente" \
             "HEAD=$HEAD_AFTER atteso=$OLD_HEAD" \
             "$(grep -i rollback <<< "$LOG" | head -3)"
    fi
fi

# --- 4. npm install che fallisce → rollback su OLD_COMMIT -------------------
# È lo scenario peggiore del difetto B: prima restava codice nuovo su disco,
# node_modules a metà e il processo vecchio ancora vivo, senza alcun restart.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf '{ "name": "onesibox", "version": "0.12.0", "dependencies": { "nuovo": "^1.0.0" } }\n' \
        > "$SBX_WORK/package.json"
    sandbox_publish
    run_update 1

    if [ "$HEAD_AFTER" != "$OLD_HEAD" ]; then
        fail "npm install fallito: rollback su OLD_COMMIT" \
             "il dispositivo è rimasto sul commit nuovo ($HEAD_AFTER)" \
             "$(tail -5 <<< "$LOG")"
    elif ! grep -q "=== ROLLBACK:" <<< "$LOG"; then
        fail "npm install fallito: rollback su OLD_COMMIT" \
             "nessun rollback registrato nel log" \
             "$(tail -5 <<< "$LOG")"
    elif [ "$RC" -eq 0 ]; then
        fail "npm install fallito: rollback su OLD_COMMIT" \
             "update.sh è uscito con 0 dopo un aggiornamento fallito"
    else
        pass "npm install fallito: rollback su OLD_COMMIT (exit $RC)"
    fi

    # Il servizio va comunque riavviato: lasciarlo sul codice nuovo in RAM
    # è esattamente la bomba a orologeria descritta nell'issue.
    if grep -qE '^systemctl (restart|start) ' <<< "$SYSTEMCTL_CALLS"; then
        pass "npm install fallito: il servizio viene riavviato sul codice ripristinato"
    else
        fail "npm install fallito: il servizio viene riavviato sul codice ripristinato" \
             "systemctl invocato: ${SYSTEMCTL_CALLS:-<mai>}"
    fi
fi

# --- 5. Servizio che non torna sano dopo il restart → rollback --------------
# `systemctl restart` che ritorna 0 non dice che il servizio sia rimasto su.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf "console.log('v0.12.0') // ONESIBOX_TEST_CRASH_IMMEDIATE\n" > "$SBX_WORK/src/main.js"
    sandbox_publish
    run_update

    if [ "$HEAD_AFTER" != "$OLD_HEAD" ]; then
        fail "servizio non sano: rollback" \
             "il dispositivo è rimasto sul commit nuovo ($HEAD_AFTER)" \
             "$(tail -6 <<< "$LOG")"
    elif ! grep -q "Health check FAILED" <<< "$LOG"; then
        fail "servizio non sano: rollback" \
             "l'health-check non ha rilevato il servizio non attivo" \
             "$(tail -6 <<< "$LOG")"
    elif ! grep -q "ROLLBACK SUCCEEDED" <<< "$LOG"; then
        fail "servizio non sano: rollback" \
             "il rollback non ha riportato il servizio in salute" \
             "$(grep -i rollback <<< "$LOG" | head -3)"
    else
        pass "servizio non sano dopo il restart: rollback e servizio recuperato (exit $RC)"
    fi
fi

# --- 6. Crash loop con unità formalmente attiva (ramo NRestarts) ------------
# Con Type=simple l'unità risulta "active" appena node parte: se il poll cade
# mentre il processo è vivo, l'unico segnale è NRestarts che cresce.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf "console.log('v0.12.0') // ONESIBOX_TEST_CRASH_FLAP\n" > "$SBX_WORK/src/main.js"
    sandbox_publish
    run_update

    if ! grep -q "crash loop" <<< "$LOG"; then
        fail "crash loop rilevato via NRestarts" \
             "l'health-check non ha guardato NRestarts: l'unità risultava attiva" \
             "$(tail -6 <<< "$LOG")"
    elif [ "$HEAD_AFTER" != "$OLD_HEAD" ]; then
        fail "crash loop rilevato via NRestarts" \
             "rilevato ma senza rollback: HEAD=$HEAD_AFTER atteso=$OLD_HEAD"
    else
        pass "crash loop con unità attiva: rilevato via NRestarts e rollback (exit $RC)"
    fi
fi

# --- 7. reset-failed prima di ogni start/restart ----------------------------
# Un'unità in failed per StartLimitBurst rifiuta ogni start finché il contatore
# non viene azzerato: senza reset-failed la box non riparte più.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    sandbox_service_failed
    printf "console.log('v0.12.0')\n" > "$SBX_WORK/src/main.js"
    sandbox_publish
    run_update

    FIRST_LIFECYCLE=$(grep -nE '^systemctl (reset-failed|restart|start) ' <<< "$SYSTEMCTL_CALLS" | head -1)
    if ! grep -q "reset-failed" <<< "$SYSTEMCTL_CALLS"; then
        fail "reset-failed prima di start/restart" \
             "systemctl reset-failed non è mai stato invocato" \
             "systemctl invocato: ${SYSTEMCTL_CALLS:-<mai>}"
    elif ! grep -q "reset-failed" <<< "$FIRST_LIFECYCLE"; then
        fail "reset-failed prima di start/restart" \
             "il primo comando di ciclo di vita non è reset-failed: $FIRST_LIFECYCLE" \
             "systemctl invocato: $SYSTEMCTL_CALLS"
    else
        pass "reset-failed invocato prima di start/restart"
    fi

    # …e l'unità in rate-limit deve effettivamente ripartire.
    if [ "$RC" -eq 0 ] && grep -q "Health check OK" <<< "$LOG"; then
        pass "unità in failed per rate-limit: sbloccata e riavviata (exit $RC)"
    else
        fail "unità in failed per rate-limit: sbloccata e riavviata" \
             "exit=$RC" "$(tail -5 <<< "$LOG")"
    fi
fi

# --- 8. package-lock.json fa scattare npm install ---------------------------
# È il difetto C: `grep -q "package.json"` non matcha "package-lock.json",
# quindi v0.12.0 — che cambiava solo il lockfile — saltava npm install.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf '{ "lockfileVersion": 3, "packages": { "node_modules/nuovo": {} } }\n' \
        > "$SBX_WORK/package-lock.json"
    sandbox_publish
    run_update

    if grep -q "npm install" <<< "$NPM_CALLS"; then
        pass "solo package-lock.json cambiato: npm install viene eseguito"
    else
        fail "solo package-lock.json cambiato: npm install viene eseguito" \
             "npm non è mai stato invocato: node_modules resterebbe disallineato" \
             "log: $(grep -i depend <<< "$LOG" | head -2)"
    fi
fi

# --- 9. Diff grande: npm install non deve essere saltato --------------------
# Verifica nei fatti la conseguenza di `set -o pipefail` globale. `grep -q`
# esce al primo match e chiude la pipe: se il produttore ha ancora dati da
# scrivere riceve SIGPIPE e termina con 141, che con pipefail diventa l'esito
# dell'intera pipeline — e `npm install` viene saltato.
#
# Il fenomeno compare solo quando l'elenco dei file supera il buffer della
# pipe (64 KB su Linux e macOS): il diff va quindi dimensionato sopra quella
# soglia, altrimenti il produttore finisce di scrivere prima che grep esca e
# il test non discrimina. Qui: 2000 percorsi lunghi ≈ 260 KB, ~4× il buffer.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf '{ "name": "onesibox", "version": "0.12.0", "dependencies": { "nuovo": "^1.0.0" } }\n' \
        > "$SBX_WORK/package.json"
    mkdir -p "$SBX_WORK/src/bulk"
    LONG_NAME=$(printf 'a%.0s' $(seq 1 120))
    i=1
    while [ "$i" -le 2000 ]; do
        : > "$SBX_WORK/src/bulk/${LONG_NAME}_$i.js"
        i=$((i + 1))
    done
    sandbox_publish

    DIFF_BYTES=$(cd "$SBX_WORK" && git diff --name-only HEAD~1 HEAD | wc -c | tr -d ' ')
    if [ "$DIFF_BYTES" -lt 131072 ]; then
        fail "diff grande: il caso di prova supera il buffer della pipe" \
             "l'elenco dei file è di soli ${DIFF_BYTES} byte: sotto i 64 KB il test" \
             "resterebbe verde anche con pipefail globale, quindi non proverebbe nulla."
    fi

    run_update

    if grep -q "npm install" <<< "$NPM_CALLS"; then
        pass "diff da ${DIFF_BYTES} byte: npm install viene comunque eseguito"
    else
        fail "diff da ${DIFF_BYTES} byte: npm install viene comunque eseguito" \
             "la pipeline che cerca i manifest ha restituito lo stato del produttore" \
             "ucciso da SIGPIPE (sintomo di 'set -o pipefail' abilitato globalmente)"
    fi
fi

# --- 10. Aggiornamento sano: nessun rollback --------------------------------
# Il contrappeso ai test precedenti: le protezioni non devono scattare a vuoto.
if ! sandbox_create; then
    fail "preparazione sandbox" "sandbox_create non riuscita"
else
    printf '#!/bin/bash\necho "migrazione 002 ok"\nexit 0\n' > "$SBX_WORK/updates/002-ok.sh"
    chmod +x "$SBX_WORK/updates/002-ok.sh"
    printf '{ "name": "onesibox", "version": "0.12.0", "dependencies": { "nuovo": "^1.0.0" } }\n' \
        > "$SBX_WORK/package.json"
    printf "console.log('v0.12.0')\n" > "$SBX_WORK/src/main.js"
    sandbox_publish
    run_update

    if [ "$RC" -ne 0 ]; then
        fail "aggiornamento sano: nessun rollback" "exit=$RC" "$(tail -5 <<< "$LOG")"
    elif grep -q "ROLLBACK" <<< "$LOG"; then
        fail "aggiornamento sano: nessun rollback" "rollback scattato senza motivo" \
             "$(grep -i rollback <<< "$LOG" | head -3)"
    elif [ "$HEAD_AFTER" = "$OLD_HEAD" ]; then
        fail "aggiornamento sano: nessun rollback" "il dispositivo non è stato aggiornato"
    elif ! grep -q "=== Update Complete ===" <<< "$LOG"; then
        fail "aggiornamento sano: nessun rollback" "manca la riga finale di successo" \
             "$(tail -3 <<< "$LOG")"
    else
        pass "aggiornamento sano: applicato, migrazioni registrate, nessun rollback"
    fi
fi

# --- Riepilogo --------------------------------------------------------------
echo ""
echo "  $PASSED superati, $FAILED falliti, $SKIPPED saltati"
echo ""

[ "$FAILED" -eq 0 ]
