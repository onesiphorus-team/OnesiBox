#!/bin/bash
# ============================================================================
# Test di install.sh — avvio e raccolta input
# ============================================================================
# Protegge dalla regressione descritta nell'issue #61: con
# `curl … | sudo bash` lo script usciva con codice 0 senza stampare né fare
# nulla, perché la guardia finale confrontava BASH_SOURCE[0] (vuota quando bash
# legge da stdin) con $0 ("bash").
#
# Uso:  bash tests/shell/install-sh.test.sh      (oppure: npm run test:shell)
#
# I test NON eseguono un'installazione reale: senza privilegi di root lo script
# si ferma alla verifica dei prerequisiti prima di toccare il sistema. Per
# questo motivo il test si rifiuta di girare come root.
# ============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_SH="$REPO_ROOT/install.sh"

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
    echo -e "${RED}Non eseguire questi test come root:${NC} install.sh installerebbe davvero." >&2
    exit 1
fi

if [ ! -f "$INSTALL_SH" ]; then
    echo "install.sh non trovato in $REPO_ROOT" >&2
    exit 1
fi

# Esegue install.sh e popola OUT (stdout+stderr) e RC (codice di uscita).
# $1 = "pipe" (bash legge lo script da stdin, come curl … | sudo bash)
#      oppure "file" (bash install.sh)
run_install() {
    local mode="$1"
    shift
    if [ "$mode" = "pipe" ]; then
        OUT=$(cat "$INSTALL_SH" | bash -s -- "$@" 2>&1)
    else
        OUT=$(bash "$INSTALL_SH" "$@" 2>&1)
    fi
    RC=$?
}

echo ""
echo "install.sh — test di avvio e input"
echo ""

# --- 1. Sintassi -----------------------------------------------------------
if bash -n "$INSTALL_SH" 2>/dev/null; then
    pass "sintassi valida (bash -n)"
else
    fail "sintassi valida (bash -n)" "$(bash -n "$INSTALL_SH" 2>&1)"
fi

# --- 2. La guardia esegue main() anche quando lo script arriva da una pipe ---
# È il cuore dell'issue #61: prima, questo caso usciva 0 senza output.
run_install pipe --non-interactive --token token-di-test
if [ "$RC" -eq 0 ]; then
    fail "pipe: main() viene eseguito" "atteso codice ≠ 0, ottenuto 0" "output: ${OUT:-<vuoto>}"
elif [ -z "$OUT" ]; then
    fail "pipe: main() viene eseguito" "nessun output stampato (fallimento silenzioso)"
elif ! grep -q "root" <<< "$OUT"; then
    fail "pipe: main() viene eseguito" "atteso il messaggio sui permessi di root" "output: $OUT"
else
    pass "pipe: main() viene eseguito e si ferma sui prerequisiti (exit $RC)"
fi

# --- 3. Stesso comportamento eseguendo il file ------------------------------
run_install file --non-interactive --token token-di-test
if [ "$RC" -ne 0 ] && [ -n "$OUT" ] && grep -q "root" <<< "$OUT"; then
    pass "file: main() viene eseguito e si ferma sui prerequisiti (exit $RC)"
else
    fail "file: main() viene eseguito" "exit=$RC" "output: ${OUT:-<vuoto>}"
fi

# --- 4. Modalità non interattiva senza dati obbligatori ---------------------
run_install pipe --non-interactive
if [ "$RC" -eq 0 ]; then
    fail "non interattiva senza token: errore parlante" "atteso codice ≠ 0, ottenuto 0"
elif ! grep -q "ONESIBOX_APPLIANCE_TOKEN" <<< "$OUT"; then
    fail "non interattiva senza token: errore parlante" "il messaggio non spiega come passare il token" "output: $OUT"
else
    pass "non interattiva senza token: si ferma con errore parlante (exit $RC)"
fi

# --- 5. Opzioni ------------------------------------------------------------
run_install file --opzione-inesistente
if [ "$RC" -ne 0 ] && grep -q "Opzione sconosciuta" <<< "$OUT"; then
    pass "opzione sconosciuta: rifiutata (exit $RC)"
else
    fail "opzione sconosciuta: rifiutata" "exit=$RC" "output: $OUT"
fi

run_install file --help
if [ "$RC" -eq 0 ] && grep -q "Uso:" <<< "$OUT"; then
    pass "--help: stampa l'uso ed esce 0"
else
    fail "--help: stampa l'uso ed esce 0" "exit=$RC" "output: $OUT"
fi

run_install file --non-interactive --token t --volume non-numerico
if [ "$RC" -ne 0 ]; then
    pass "valore numerico non valido: rifiutato (exit $RC)"
else
    fail "valore numerico non valido: rifiutato" "exit=0"
fi

# --- 6. Interattivo senza alcun terminale ----------------------------------
# Deve fallire rumorosamente, non proseguire con risposte vuote.
if { : < /dev/tty; } 2>/dev/null; then
    skip "senza terminale: si ferma con errore" "questa sessione ha un /dev/tty"
else
    run_install pipe
    if [ "$RC" -ne 0 ] && grep -q "NON eseguita" <<< "$OUT"; then
        pass "senza terminale: si ferma con errore, non installa (exit $RC)"
    else
        fail "senza terminale: si ferma con errore" "exit=$RC" "output: ${OUT:-<vuoto>}"
    fi
fi

# --- 7. Con un terminale, l'input arriva da /dev/tty ------------------------
if ! command -v python3 > /dev/null 2>&1; then
    skip "pipe + terminale: le risposte vengono lette da /dev/tty" "python3 non disponibile"
else
    PTY_OUT=$(python3 - "$INSTALL_SH" <<'PYEOF' 2>&1
import os, pty, select, shlex, sys, time

install_sh = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-c", "cat %s | bash" % shlex.quote(install_sh)])

out = b""
deadline = time.time() + 30
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.5)
    if not r:
        if os.waitpid(pid, os.WNOHANG)[0]:
            break
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    out += chunk

sys.stdout.write(out.decode(errors="replace"))
PYEOF
)
    if grep -q "/dev/tty" <<< "$PTY_OUT"; then
        pass "pipe + terminale: le risposte vengono lette da /dev/tty"
    else
        fail "pipe + terminale: le risposte vengono lette da /dev/tty" "output: ${PTY_OUT:-<vuoto>}"
    fi
fi

# --- 8. Controlli statici ---------------------------------------------------
# Ogni lettura deve passare da ask()/ask_secret(), che leggono dal descrittore 3.
STRAY_READS=$(grep -nE '(^|[[:space:]]|;|\|)read[[:space:]]' "$INSTALL_SH" | grep -v '^[0-9]*: *#' | grep -v '<&3' || true)
if [ -z "$STRAY_READS" ]; then
    pass "nessuna read fuori da ask()/ask_secret()"
else
    fail "nessuna read fuori da ask()/ask_secret()" \
         "queste letture userebbero stdin, che con la pipe è lo script stesso:" \
         "$STRAY_READS"
fi

# Riassegnare il descrittore 0 fa perdere a bash le righe non ancora lette
# quando lo script arriva da una pipe: lo script morirebbe a metà, in silenzio.
STDIN_REDIR=$(grep -n '^[^#]*exec[[:space:]]\+0[<>]' "$INSTALL_SH" || true)
if [ -z "$STDIN_REDIR" ]; then
    pass "nessuna riassegnazione del descrittore 0"
else
    fail "nessuna riassegnazione del descrittore 0" "$STDIN_REDIR"
fi

# --- Riepilogo --------------------------------------------------------------
echo ""
echo "  $PASSED superati, $FAILED falliti, $SKIPPED saltati"
echo ""

[ "$FAILED" -eq 0 ]
