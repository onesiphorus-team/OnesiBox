# Sviluppo e test di OnesiBox su macOS

Questa guida descrive come avviare OnesiBox localmente su macOS puntando a un server Onesiforo Web locale servito da [Herd](https://herd.laravel.com/) su `https://onesiforo.test`. È pensata per iterare rapidamente su flussi di comunicazione (polling, heartbeat, ACK, WebSocket Reverb) e playback media, senza deployare su Raspberry Pi.

> **Scope**: comunicazione HTTP/WebSocket e playback media JW.org. Non copre Zoom né i comandi di sistema (`reboot`, `shutdown`, `set_volume`, `restart_service`): su macOS falliscono con log e non sono supportati in dev mode.

## Prerequisiti

1. **Node.js 20 LTS** installato (`node --version` → `v20.x`).
2. **Herd** (o Laravel Valet) con il sito `onesiforo.test` configurato e *secured* in HTTPS. Per Herd: Sites → il tuo sito → toggle Secure. Per Valet: `valet secure onesiforo.test`.
3. **Google Chrome** installato in `/Applications/Google Chrome.app` (serve per i codec proprietari H.264/MP4 usati da JW.org; il Chromium bundled di Playwright ne è privo).
4. **Server Onesiforo Web attivo** con il suo `php artisan serve` / Herd PHP + `php artisan reverb:start` attivo se vuoi testare il WebSocket.

## Configurazione

### 1. `config/config.json` locale

Crea `config/config.json` (è già gitignored) con i valori della tua installazione:

```json
{
  "server_url": "https://onesiforo.test",
  "appliance_id": "<serial_number dal record OnesiBox nel backend>",
  "appliance_token": "<token Sanctum generato dal backend>",
  "polling_interval_seconds": 5,
  "heartbeat_interval_seconds": 30,
  "default_volume": 80,
  "websocket_enabled": true,
  "reverb_key": "<REVERB_APP_KEY dal .env del server>",
  "reverb_host": "onesiforo.test",
  "reverb_port": 8080,
  "reverb_scheme": "https",
  "ws_fallback_polling_seconds": 30
}
```

**Dove prendere i valori:**
- `appliance_id` / `appliance_token`: dal pannello admin del server Onesiforo, oppure via tinker:
  `php artisan tinker` → `\App\Models\OnesiBox::first()` per ottenere `serial_number` e un token generato.
- `reverb_key`, `reverb_port`: dal `.env` del server Onesiforo (chiavi `REVERB_APP_KEY`, `REVERB_PORT`).
- `reverb_scheme`: `https` se Reverb è servito tramite Herd/nginx con TLS; `http` se gira in chiaro.

### 2. Certificato CA di Herd

Lo script `npm run dev:mac` punta di default al CA di Herd Pro:
```
$HOME/Library/Application Support/Herd/config/valet/CA/HerdCASelfSigned.pem
```

Verifica che esista:

```bash
ls -la "$HOME/Library/Application Support/Herd/config/valet/CA/"
```

Se il path è diverso sulla tua macchina (Herd free, Valet standalone, versione Herd differente), hai due opzioni:

**A.** Modifica `package.json` (script `dev:mac`) per puntare al path corretto.

**B.** Crea un symlink stabile:

```bash
ln -s "/path/al/tuo/CA.pem" "$HOME/.onesibox-dev-ca.pem"
```

e aggiorna lo script in `package.json` sostituendo il path con `$HOME/.onesibox-dev-ca.pem`.

## Avvio

```bash
npm install
npm run dev:mac
```

Al primo avvio Playwright potrebbe scaricare il Chromium bundled: non lo useremo (`findChromiumPath` sceglie Chrome system), ma il download avviene comunque.

Output atteso (log Winston):

```
info: OnesiBox starting...
info: Configuration loaded successfully { server_url: 'https://onesiforo.test', ... }
info: HTTP server started { port: 3000 }
info: Initializing browser...
info: Initializing browser controller
info: Dev mode: using windowed browser args (no kiosk/fullscreen/no-sandbox)
info: Using system Chromium for codec support { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
info: Browser controller initialized { mode: 'playwright' }
info: Heartbeat sent { ... }
info: WebSocket manager initialized
info: OnesiBox ready
```

Si apre una finestra Chrome "pilotata da Playwright" sulla pagina standby locale (`http://localhost:3000`).

## Smoke test manuale

Verifica end-to-end che il dev mode sia funzionante:

1. **UI standby visibile** — la finestra Chrome mostra la schermata standby di OnesiBox.
2. **Stato locale** — in un altro terminale: `curl http://localhost:3000/api/status` → JSON con `status`, `connectionStatus`, `volume`.
3. **Heartbeat ricevuto dal server** — nel pannello admin del backend, il dispositivo risulta `online` e la data "ultimo heartbeat" si aggiorna ogni 30 secondi.
4. **Comando `play_media`** — dal backend (via UI admin, API, o tinker) invia un comando `play_media` con un URL JW.org valido (es. `https://www.jw.org/finder?...`).
   - Attesa (polling o WS): la finestra Playwright naviga all'URL e il video parte.
   - Log: `info: Navigating to URL { url: '...' }` e `info: Navigation successful`.
5. **Comando `stop_media`** — invia `stop_media`.
   - La finestra torna alla schermata standby locale.
   - Log: `info: Going to standby` e `info: Navigated to standby successfully`.
6. **Shutdown pulito** — Ctrl+C nel terminale di `npm run dev:mac`.
   - Log: `info: Shutting down { signal: 'SIGINT' }` e il processo esce senza errori.

### Smoke test `play_stream_item` (playlist JW Stream)

1. Con `npm run dev:mac` attivo, invia dal backend Onesiforo il comando:
   ```json
   {
     "type": "play_stream_item",
     "payload": {
       "url": "https://stream.jw.org/6311-4713-5379-2156",
       "ordinal": 1,
       "session_id": "smoke-test"
     }
   }
   ```

2. Log attesi (Winston):
   - `info: Playing stream item { url: 'https://stream.jw.org/...', ordinal: 1 }`
   - `info: Navigating to URL { url: 'https://stream.jw.org/...' }`
   - `info: Navigation successful`
   - `info: Stream playback event reported { event: 'started', ordinal: 1 }`
   - `info: Starting video ended detection`

3. Finestra Chrome: redirect automatico a `/home`, il cookie banner appare brevemente e viene dismisso (o non intercetta il click), Video.js parte in fullscreen con la Parte 1.

4. Inviare un secondo comando con `"ordinal": 2`, stesso URL: il primo video si ferma, la pagina ri-naviga, parte la Parte 2.

5. Inviare `"ordinal": 99`: il comando fallisce pulito con:
   - `error: play_stream_item failed { error_code: 'E112', ... }`
   - `info: Stream playback event reported { event: 'error' }`
   - La UI torna in standby.

6. Inviare `stop_media` durante la riproduzione di un item: standby + evento `stopped`.

7. Far terminare naturalmente il video (per un test rapido: da DevTools di Chrome `document.querySelector('video').currentTime = document.querySelector('video').duration - 2`): entro 2-4 s partono `completed` e standby.

## Troubleshooting

### `UNABLE_TO_VERIFY_LEAF_SIGNATURE` o errori TLS su polling/heartbeat

Il CA di Herd non è caricato in Node. Controlla:

```bash
ls -la "$HOME/Library/Application Support/Herd/config/valet/CA/"
```

Se il file `HerdCASelfSigned.pem` non esiste, cerca altri `.pem`/`.crt` nella cartella `CA/` o verifica che `onesiforo.test` sia effettivamente secured (apri il sito in Safari: se mostra il lucchetto, il CA esiste).

Per Valet standalone, il CA è di solito in `~/.config/valet/CA/LaravelValetCASelfSigned.pem`.

### Il video non parte, log mostra `Playwright failed` o codec errors

Chrome system non è stato trovato. Controlla:

```bash
ls -la /Applications/Google\ Chrome.app/Contents/MacOS/
```

Se Chrome non è installato, installalo da https://www.google.com/chrome/. Il Chromium bundled di Playwright non riproduce MP4/H.264.

### WebSocket disconnesso ("WebSocket disconnected, restoring polling")

1. Verifica che `php artisan reverb:start` sia in esecuzione lato server.
2. Controlla `reverb_host`, `reverb_port`, `reverb_scheme`, `reverb_key` in `config/config.json` contro il `.env` del server.
3. Il polling continua a funzionare come fallback: se vedi comandi eseguiti via polling, la comunicazione base è OK e il problema è solo su Reverb.

### `appliance_id` / `appliance_token` errati → 401/403

Il client entra in "dormant state" e smette di pollare. I log mostrano `Authentication/authorization failure`. Correggi `config/config.json` e riavvia.

### Browser non si apre, log mostra `Could not initialize browser at startup`

- Chrome potrebbe non essere autorizzato da macOS. Apri Chrome manualmente una volta per accettare il dialogo Gatekeeper.
- Verifica che `.dev-data/` sia scrivibile (`ls -la .dev-data/`). Se corrotto, rimuovilo: `rm -rf .dev-data/`.

## Cosa NON funziona in dev mode

Intenzionalmente:

- **Zoom**: richiede configurazione audio/video macOS-specifica non trattata qui.
- **`reboot` / `shutdown` / `restart_service`**: se ricevuti, falliscono con log. Test fine-grained solo su Raspberry Pi.
- **`set_volume`**: il comando `amixer` non esiste su macOS, il comando fallirà con log e non cambierà il volume.
- **Systemd watchdog**: disabilitato quando `NOTIFY_SOCKET` non è settato (macOS). Normale.
- **DOM changes di JW Stream**: se JW ridisegna la SPA togliendo la classe `MuiCardActionArea-root`, `play_stream_item` fallisce con `E111 PLAYLIST_LOAD_FAILED`. Richiede aggiornamento firmware.
- **Share link privati JW Stream**: URL che richiedono login JW (account personale) non sono supportati. Questo design copre solo link di condivisione pubblica.
