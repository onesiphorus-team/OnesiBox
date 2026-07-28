/**
 * Flag Chromium condivisi fra il browser di kiosk (browser/controller.js) e
 * quello usato per Zoom (commands/handlers/zoom.js).
 *
 * IMPORTANTE: Chromium tiene solo l'ULTIMA occorrenza di uno switch duplicato.
 * Playwright antepone i suoi argomenti ai nostri, quindi il nostro
 * --disable-features sovrascrive quello di Playwright: la lista qui sotto deve
 * essere autosufficiente, non un'aggiunta. Per lo stesso motivo va passata una
 * sola volta per processo.
 */

// Traduzione automatica: senza questi Chromium mostra la bolla "Traduci questa
// pagina" sopra la UI in kiosk, dove nessuno può chiuderla.
// `Translate` e' il nome corrente, `TranslateUI` quello storico: teniamo
// entrambi per coprire le versioni di Chromium in giro sulle box.
const DISABLED_FEATURES = [
  'Translate',
  'TranslateUI',
];

// Wayland: unico --enable-features del processo, vedi nota sui duplicati.
const ENABLED_FEATURES_WAYLAND = [
  'UseOzonePlatform',
];

/**
 * Impedisce a Chromium di usare gnome-keyring/kwallet. Il prompt di sblocco del
 * keyring e' modale e blocca l'avvio del browser finche' qualcuno non lo chiude:
 * su una box in kiosk non c'e' nessuno che possa farlo, e Playwright va in
 * timeout aspettando la connessione CDP.
 */
const NO_KEYRING_ARGS = [
  '--password-store=basic',
  '--use-mock-keychain',
];

/** Argomenti comuni a tutti i processi Chromium avviati dalla box. */
const COMMON_ARGS = [
  '--noerrdialogs',
  '--disable-infobars',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-session-crashed-bubble',
  `--disable-features=${DISABLED_FEATURES.join(',')}`,
  '--check-for-update-interval=31536000',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  ...NO_KEYRING_ARGS,
];

/** Flag aggiuntivi quando il display server e' Wayland. */
const WAYLAND_ARGS = [
  '--ozone-platform=wayland',
  `--enable-features=${ENABLED_FEATURES_WAYLAND.join(',')}`,
];

module.exports = {
  DISABLED_FEATURES,
  ENABLED_FEATURES_WAYLAND,
  NO_KEYRING_ARGS,
  COMMON_ARGS,
  WAYLAND_ARGS,
};
