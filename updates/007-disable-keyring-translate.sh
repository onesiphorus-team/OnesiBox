#!/bin/bash
#
# Migration 007: Disabilita gnome-keyring e la traduzione automatica di Chromium.
#
# Perche':
# - gnome-keyring parte con la sessione utente e Chromium, se ci parla, mostra un
#   prompt modale di sblocco. In kiosk non c'e' nessuno che possa chiuderlo:
#   il browser resta bloccato e Playwright va in timeout dopo 180s.
# - La bolla "Traduci questa pagina" compare sopra la UI in kiosk e resta li'.
#
# I flag da riga di comando (src/browser/chromium-args.js) coprono i processi
# lanciati da OnesiBox; la policy di sistema copre anche eventuali avvii manuali
# e sopravvive a un flag perso o sovrascritto.
#
# Idempotente: puo' essere rieseguita senza effetti collaterali.
#

set -e

SERVICE_FILE="/etc/systemd/system/onesibox.service"

# ---------------------------------------------------------------------------
# 1. Policy di sistema per Chromium
# ---------------------------------------------------------------------------

echo "Configurazione policy Chromium..."

POLICY_WRITTEN=false
for policy_base in /etc/chromium /etc/chromium-browser /etc/opt/chrome; do
    [[ -d "${policy_base}" ]] || continue

    mkdir -p "${policy_base}/policies/managed"
    cat > "${policy_base}/policies/managed/onesibox.json" << 'EOF'
{
  "TranslateEnabled": false,
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "DefaultNotificationsSetting": 2,
  "PromptForDownloadLocation": false
}
EOF
    chmod 644 "${policy_base}/policies/managed/onesibox.json"
    echo "  policy scritta in ${policy_base}/policies/managed/onesibox.json"
    POLICY_WRITTEN=true
done

if [[ "${POLICY_WRITTEN}" == "false" ]]; then
    echo "  ATTENZIONE: nessuna directory di policy Chromium trovata, salto"
fi

# ---------------------------------------------------------------------------
# 2. Disattivazione gnome-keyring
# ---------------------------------------------------------------------------

echo "Disattivazione gnome-keyring..."

# Unit utente: --global vale per tutti gli utenti e non richiede il bus di sessione
for unit in gnome-keyring-daemon.service gnome-keyring-daemon.socket; do
    if systemctl --global mask "${unit}" 2>/dev/null; then
        echo "  ${unit} mascherata"
    else
        echo "  ${unit} non presente, salto"
    fi
done

# Autostart XDG: override nella home dell'utente kiosk, cosi' un aggiornamento
# del pacchetto gnome-keyring non le ripristina.
KIOSK_USER=""
if [[ -f "${SERVICE_FILE}" ]]; then
    KIOSK_USER=$(grep "^User=" "${SERVICE_FILE}" | cut -d= -f2)
fi

if [[ -n "${KIOSK_USER}" ]] && id "${KIOSK_USER}" &>/dev/null; then
    KIOSK_HOME=$(getent passwd "${KIOSK_USER}" | cut -d: -f6)
    AUTOSTART_DIR="${KIOSK_HOME}/.config/autostart"
    mkdir -p "${AUTOSTART_DIR}"

    for desktop in gnome-keyring-pkcs11 gnome-keyring-secrets gnome-keyring-ssh; do
        [[ -f "/etc/xdg/autostart/${desktop}.desktop" ]] || continue
        cat > "${AUTOSTART_DIR}/${desktop}.desktop" << EOF
[Desktop Entry]
Type=Application
Name=${desktop} (disabilitato da OnesiBox)
Exec=/bin/true
Hidden=true
X-GNOME-Autostart-enabled=false
EOF
        echo "  autostart ${desktop} disabilitato"
    done

    chown -R "${KIOSK_USER}:${KIOSK_USER}" "${AUTOSTART_DIR}"

    # Ferma le istanze gia' in esecuzione: senza questo il keyring resta attivo
    # fino al prossimo reboot.
    if pkill -u "${KIOSK_USER}" -f gnome-keyring-daemon 2>/dev/null; then
        echo "  istanze gnome-keyring-daemon terminate"
    else
        echo "  nessuna istanza gnome-keyring-daemon in esecuzione"
    fi
else
    echo "  ATTENZIONE: utente kiosk non determinabile, salto autostart e kill"
fi

echo "Done"
