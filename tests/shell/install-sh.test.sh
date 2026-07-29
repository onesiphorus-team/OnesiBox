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

# Senza DEBIAN_FRONTEND, apt e dpkg possono aprire una domanda debconf (il
# prompt conffile, la conferma "Yes, do as I say!") e leggerla da stdin.
if grep -qE '^[[:space:]]*export[[:space:]]+DEBIAN_FRONTEND=noninteractive' "$INSTALL_SH"; then
    pass "DEBIAN_FRONTEND=noninteractive esportato"
else
    fail "DEBIAN_FRONTEND=noninteractive esportato" \
         "senza di esso apt/dpkg possono fermarsi a chiedere conferma"
fi

# Il wrapper deve davvero chiudere lo stdin: se diventasse un `"$@"` e basta,
# il controllo qui sotto resterebbe verde mentre il difetto tornerebbe.
RUN_SYSTEM_BODY=$(awk '/^run_system\(\)/,/^}/' "$INSTALL_SH")
if grep -qE '"\$@".*[[:space:]]0?<[[:space:]]*/dev/null' <<< "$RUN_SYSTEM_BODY"; then
    pass "run_system() esegue il comando con lo stdin chiuso"
else
    fail "run_system() esegue il comando con lo stdin chiuso" \
         "corpo trovato: ${RUN_SYSTEM_BODY:-<funzione non definita>}"
fi

# --- 9. Nessun comando esterno eredita il descrittore 0 ---------------------
# È il cuore dell'issue #68. Con `curl … | sudo bash` lo stdin di bash È lo
# script: un figlio che legge stdin consuma le righe non ancora eseguite e
# bash chiude con 0, in silenzio, a metà installazione.
#
# Lo scanner segnala ogni comando in posizione di comando che non passa da
# run_system(). Sono esenti, perché il loro stdin non è lo script:
#   • i comandi alimentati da una pipe (`… | bash -`, `… | crontab -u root -`);
#   • i comandi con una redirezione esplicita di fd 0 (compresi gli heredoc);
#   • i costrutti di shell e le funzioni definite in install.sh;
#   • i comandi elencati in NO_STDIN, che non leggono mai lo standard input
#     qualunque siano i loro argomenti.
# Tutto il resto va segnalato: la lista da mantenere è quella dei comandi
# innocui, così un comando nuovo è sospetto per difetto e non per svista.
NO_STDIN="mkdir chown chmod cp mv rm ln touch id uname uuidgen ping clear dirname basename getent df"
SHELL_WORDS="if then else elif fi for while until do done case esac in function time return break continue exit local export unset shift set eval exec read source command test true false printf echo cd pwd trap wait declare typeset let getopts hash type umask"
INSTALL_FUNCS=$(grep -oE '^[a-zA-Z_][a-zA-Z0-9_]*\(\)' "$INSTALL_SH" | tr -d '()' | tr '\n' ' ')

UNGUARDED=$(awk \
    -v ALLOW="$NO_STDIN $SHELL_WORDS" \
    -v FUNCS="$INSTALL_FUNCS" \
    "$(cat << 'AWKEOF'
# Svuota le stringhe quotate, che altrimenti verrebbero spezzate come se
# fossero codice. Quelle che contengono una sostituzione di comando restano
# intatte: dentro c'è un comando vero, da controllare.
function strip_strings(t,   out, buf, i, c, q) {
    out = ""; buf = ""; q = ""
    for (i = 1; i <= length(t); i++) {
        c = substr(t, i, 1)
        if (q == "") {
            if (c == "\"" || c == "'") { q = c; buf = c; continue }
            out = out c
        } else {
            buf = buf c
            if (c == q) {
                if (index(buf, "$(") || index(buf, "`")) out = out buf
                else out = out " "
                q = ""; buf = ""
            }
        }
    }
    return out buf
}

BEGIN {
    n = split(ALLOW, a, " ")
    for (i = 1; i <= n; i++) allow[a[i]] = 1
    n = split(FUNCS, a, " ")
    for (i = 1; i <= n; i++) allow[a[i]] = 1
}

# Corpo di un heredoc: sono dati scritti su un file, non comandi eseguiti.
hd != "" {
    t = $0
    sub(/^[ \t]+/, "", t)
    if (t == hd) hd = ""
    next
}

{
    line = $0
    if (line ~ /^[ \t]*#/) next
    sub(/[ \t]#.*$/, "", line)

    if (match(line, /<<-?[ \t]*("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*)/)) {
        d = substr(line, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", d)
        gsub(/["']/, "", d)
        next_hd = d
    } else {
        next_hd = ""
    }

    s = strip_strings(line)
    gsub(/\|\|/, "\n", s)
    gsub(/&&/, "\n", s)
    gsub(/\|/, "\n|", s)
    gsub(/;/, "\n", s)
    gsub(/\$\(/, "\n", s)
    gsub(/[()`]/, "\n", s)
    gsub(/(^|[ \t])[{}]([ \t]|$)/, "\n", s)

    m = split(s, parts, "\n")
    for (i = 1; i <= m; i++) {
        f = parts[i]

        piped = 0
        if (f ~ /^\|/) { piped = 1; sub(/^\|/, "", f) }
        sub(/^[ \t]+/, "", f)

        while (f ~ /^(!|if|then|elif|else|while|until|do|time)[ \t]+/)
            sub(/^[^ \t]+[ \t]+/, "", f)
        while (f ~ /^[A-Za-z_][A-Za-z0-9_]*=[^ \t]*[ \t]+[^ \t]/)
            sub(/^[^ \t]+[ \t]+/, "", f)

        if (!match(f, /^[^ \t]+/)) continue
        cmd = substr(f, RSTART, RLENGTH)
        rest = substr(f, RSTART + RLENGTH)

        if (cmd == "run_system") continue

        # Non è un nome di comando: redirezioni, pattern di case, operandi.
        if (cmd !~ /^[A-Za-z0-9_.\/+-]+$/) continue
        if (cmd ~ /^-/) continue
        sub(/^.*\//, "", cmd)
        if (cmd !~ /[A-Za-z]/) continue
        if (cmd in allow) continue

        if (piped) continue
        if (rest ~ /(^|[ \t])0?<[ \t]*[^ \t&]/) continue

        printf "riga %d: %s\n", NR, cmd
    }

    hd = next_hd
}
AWKEOF
)" "$INSTALL_SH")

if [ -z "$UNGUARDED" ]; then
    pass "nessun comando esterno eredita il descrittore 0"
else
    UNGUARDED_LINES=()
    while IFS= read -r unguarded_line; do
        UNGUARDED_LINES+=("  $unguarded_line")
    done <<< "$UNGUARDED"
    fail "nessun comando esterno eredita il descrittore 0" \
         "con la pipe questi comandi si mangiano il resto dello script:" \
         "${UNGUARDED_LINES[@]}"
fi

# --- 10. Riproduzione dell'issue #68 con stub -------------------------------
# Un comando esterno che legge stdin fino a EOF — è ciò che fa dpkg davanti a
# una domanda conffile — non deve più consumare il sorgente dello script.
#
# Gli stub sostituiscono i comandi di sistema: nessuna installazione reale.
# install.sh viene caricato con `source` (la guardia finale non esegue main),
# ma l'harness che lo carica è a sua volta letto da bash via pipe: è la stessa
# condizione di `curl … | sudo bash`.
STUB_DIR=$(mktemp -d)
if [ -z "$STUB_DIR" ] || [ ! -d "$STUB_DIR" ]; then
    echo "impossibile creare la directory temporanea per gli stub" >&2
    exit 1
fi
trap 'rm -rf "$STUB_DIR"' EXIT

mkdir -p "$STUB_DIR/bin"

# apt e dpkg leggono stdin fino a EOF, come su un prompt debconf
for stub in apt dpkg; do
    cat > "$STUB_DIR/bin/$stub" << 'STUBEOF'
#!/bin/bash
cat > /dev/null
exit 0
STUBEOF
done

cat > "$STUB_DIR/bin/curl" << 'STUBEOF'
#!/bin/bash
exit 0
STUBEOF

# Una v18 forza il ramo che rimuove nodejs/npm: è il caso peggiore dell'issue
cat > "$STUB_DIR/bin/node" << 'STUBEOF'
#!/bin/bash
echo "v18.0.0"
STUBEOF

cat > "$STUB_DIR/bin/npm" << 'STUBEOF'
#!/bin/bash
exit 0
STUBEOF

chmod +x "$STUB_DIR/bin/"*

echo "risposta-operatore" > "$STUB_DIR/risposte.txt"

cat > "$STUB_DIR/harness.sh" << HARNESSEOF
source "$INSTALL_SH"
exec 3< "$STUB_DIR/risposte.txt"
echo "MARCATORE-PRIMA"
install_system_packages > /dev/null 2>&1
ask RISPOSTA "domanda: " 2> /dev/null
echo "RISPOSTA=[\$RISPOSTA]"
echo "MARCATORE-DOPO"
HARNESSEOF

STUB_OUT=$(PATH="$STUB_DIR/bin:$PATH" bash -c 'cat "$1" | bash' _ "$STUB_DIR/harness.sh" 2>&1)

if grep -q "MARCATORE-DOPO" <<< "$STUB_OUT"; then
    pass "pipe: un comando esterno che legge stdin non consuma lo script"
else
    fail "pipe: un comando esterno che legge stdin non consuma lo script" \
         "lo script è morto a metà, in silenzio: l'installazione resterebbe incompleta" \
         "output: ${STUB_OUT:-<vuoto>}"
fi

# Il descrittore 3 è il meccanismo con cui ask()/ask_secret() leggono le
# risposte sotto pipe: chiudere lo stdin dei figli non deve toccarlo.
if grep -q "RISPOSTA=\[risposta-operatore\]" <<< "$STUB_OUT"; then
    pass "il descrittore 3 continua a servire ask() dopo i comandi esterni"
else
    fail "il descrittore 3 continua a servire ask() dopo i comandi esterni" \
         "output: ${STUB_OUT:-<vuoto>}"
fi

# --- Riepilogo --------------------------------------------------------------
echo ""
echo "  $PASSED superati, $FAILED falliti, $SKIPPED saltati"
echo ""

[ "$FAILED" -eq 0 ]
