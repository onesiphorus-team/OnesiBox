# Dev mode macOS — Design

**Data**: 2026-04-21
**Stato**: approvato
**Scope**: permettere lo sviluppo e test di OnesiBox su macOS puntando a un server Onesiforo locale (`https://onesiforo.test` via Herd), inclusi comunicazione HTTP/WS e playback media in un browser visibile in finestra.

## Obiettivo

OnesiBox è nato per girare su Raspberry Pi con Chromium in kiosk, controllato da un servizio systemd. Per iterare rapidamente su feature che coinvolgono la comunicazione con il server Onesiforo Web e il playback media, è utile poterlo avviare su macOS senza toccare il comportamento di produzione.

**In scope**
- Comunicazione HTTP (polling, heartbeat, ACK comandi) verso `https://onesiforo.test`.
- WebSocket Reverb verso lo stesso host.
- Playback media (video/audio JW.org, pagina standby) in un browser Chromium visibile in finestra normale, non kiosk, con DevTools disponibili.

**Out of scope**
- Zoom (richiede setup audio/video nativi su macOS, trattato separatamente).
- Comandi di sistema (`reboot`, `shutdown`, `set_volume`, `restart_service`) — se arrivano falliscono con log, ma non sono nel flusso di test comune.
- Supporto Windows.

## Vincoli e non-requisiti

- Il comportamento in produzione (Raspberry Pi OS) non deve cambiare. Quando le env var di dev non sono settate, il codice segue lo stesso path di oggi.
- Non vanno aggiunte nuove dipendenze npm.
- Nessun nuovo entry point: si parte sempre da `src/main.js`.
- Le credenziali locali vivono in `config/config.json` (già gitignored), non in codice.

## Ostacoli identificati (solo fatti, non soluzioni)

1. **TLS self-signed di Herd** — axios usa il CA bundle di Node, che non include il CA locale di Herd. Le richieste HTTPS falliscono con `UNABLE_TO_VERIFY_LEAF_SIGNATURE` o simili.
2. **Browser args kiosk** — `src/browser/controller.js` passa sempre `--kiosk`, `--start-fullscreen`, `--no-sandbox`. Su macOS questo mangia l'intero schermo e `--no-sandbox` è sia inutile sia sconsigliato.
3. **`findChromiumPath()`** — cerca solo path Linux (`/usr/bin/chromium`, ecc.). Su macOS ritorna `null`, e il fallback Playwright usa il Chromium bundled, che **non include i codec proprietari H.264/MP4** usati da JW.org. Risultato: i video potrebbero non partire.
4. **`DATA_DIR`** — default `/opt/onesibox/data` (non esiste su macOS). È già overridabile via `ONESIBOX_DATA_DIR`.
5. **Watchdog systemd / `reboot`, `shutdown`, `set_volume`** — già si autodisabilitano quando `NOTIFY_SOCKET` non è settato o i comandi nativi mancano. Nessuna azione richiesta.
6. **Validazione `server_url`** — richiede HTTPS. Herd serve HTTPS per default con `herd secure`, quindi OK.

## Approccio scelto — Dev mode via env vars

Un flag `ONESIBOX_DEV_MODE=1` letto in 2 punti del codice per alterare il comportamento platform-specific. Nessuna logica di dominio nuova: si sfrutta il pattern `ONESIBOX_*` già usato dal loader di config.

Il cert TLS di Herd viene fornito a Node via `NODE_EXTRA_CA_CERTS`, che è il meccanismo standard e non richiede modifiche di codice.

### Componenti che cambiano

#### 1. `package.json` — nuovo script `dev:mac`

```json
"dev:mac": "ONESIBOX_DEV_MODE=1 ONESIBOX_DATA_DIR=./.dev-data NODE_EXTRA_CA_CERTS=$HOME/Library/Application\\ Support/Herd/config/valet/CA/HerdCASelfSigned.pem node src/main.js"
```

- `ONESIBOX_DEV_MODE=1`: attiva i rami dev nel controller del browser.
- `ONESIBOX_DATA_DIR=./.dev-data`: profilo browser e dati locali restano nel repo (da aggiungere a `.gitignore`).
- `NODE_EXTRA_CA_CERTS=<path al CA di Herd>`: Node accetta il cert senza che axios debba disabilitare la validazione TLS.

Il path del CA Herd va verificato: Herd Pro mantiene il CA in `~/Library/Application Support/Herd/config/valet/CA/HerdCASelfSigned.pem`. Se la posizione è diversa sulla macchina dell'utente, lo script va adattato oppure si punta a un symlink in `~/.onesibox-dev-ca.pem`.

#### 2. `src/browser/controller.js`

**In `findChromiumPath()`** — aggiungere path macOS in fondo alla lista, così che:
- Su Linux il comportamento resta identico (i path macOS non esistono, vengono saltati).
- Su macOS viene trovato Chrome di sistema, che ha i codec proprietari.

Path da aggiungere:
- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `/Applications/Chromium.app/Contents/MacOS/Chromium`
- `/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`

**In `initialize()`** — nel blocco che costruisce `this.launchArgs`:
- Se `process.env.ONESIBOX_DEV_MODE === '1'`, partire da un set ridotto di args che omette `--kiosk`, `--start-fullscreen`, `--no-sandbox`. Mantenere gli args utili (`--noerrdialogs`, `--autoplay-policy=no-user-gesture-required`, ecc.).
- In `_initPlaywright()`, se in dev mode, impostare `viewport: { width: 1280, height: 800 }` invece di `viewport: null`.

Nessuna modifica a `_launchBrowserDirect` o al fallback spawn: la modalità Playwright è quella che useremo su macOS.

#### 3. `src/communication/api-client.js`

Nessuna modifica se `NODE_EXTRA_CA_CERTS` funziona. Come escape-hatch opzionale, documentare che settando `ONESIBOX_DEV_TLS_INSECURE=1` si può disabilitare la verifica TLS — ma NON implementiamo l'escape-hatch adesso: lo aggiungiamo solo se `NODE_EXTRA_CA_CERTS` si rivela insufficiente in pratica. Evitare di introdurre codice non necessario.

#### 4. `.gitignore`

Aggiungere `.dev-data/` alla lista di exclusion (è la cartella dove finiranno profilo Playwright e dati locali durante i test).

#### 5. `config/config.json` (locale, gitignored — l'utente lo crea)

Template documentato (non committato):

```json
{
  "server_url": "https://onesiforo.test",
  "appliance_id": "<dal server>",
  "appliance_token": "<dal server>",
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

#### 6. Nuovo `docs/dev-macos.md`

Una guida breve che copre:
- Prerequisiti: Herd (o Valet) con `onesiforo.test` secured in HTTPS; Google Chrome installato in `/Applications`; server Onesiforo Web + Reverb attivi.
- Come ricavare `appliance_id` / `appliance_token` / `reverb_key` dal backend.
- Come individuare il path del CA Herd e adattarlo nello script se necessario.
- Come avviare: `npm install && npm run dev:mac`.
- Smoke test manuale: standby visibile → server emette `play_media` → video parte → `stop_media` → torna a standby.
- Troubleshooting (errori TLS, codec mancanti, WebSocket disconnesso).

## Data flow (invariato rispetto a prod)

Il client fa esattamente le stesse operazioni della produzione: polling `/api/v1/appliances/commands`, heartbeat periodico, ACK con risultato, subscribe al canale `private-appliance.{appliance_id}`. Cambia solo **come** viene aperto il browser e **dove** vengono scritti i file locali. Nessuna divergenza di protocollo tra dev e prod.

## Error handling

- **CA non trovato**: Node fallirà da solo con errore TLS chiaro nelle prime richieste axios. Il log di `api-client.js` già riporta il messaggio dell'errore. La guida di troubleshooting indica come risolvere.
- **Chrome non installato**: `findChromiumPath()` ritorna `null`, Playwright cade sul Chromium bundled (che però potrebbe non avere i codec). Il warn esistente in `_initPlaywright()` è sufficiente.
- **Reverb non raggiungibile**: il `WebSocketManager` già gestisce retry/disconnessione. Polling continua come fallback.
- **`server_url` non HTTPS**: la validazione esistente in `config.js` blocca l'avvio con messaggio chiaro.

## Testing

Nessun test automatizzato nuovo per questa feature: il dev mode è un'infrastruttura di sviluppo, non un requisito funzionale del prodotto.

Smoke test manuale post-implementazione (documentato in `docs/dev-macos.md`):
1. `npm install` e `npm run dev:mac`.
2. Verificare log: `OnesiBox ready`, `HTTP server started`, `WebSocket connected`.
3. Aprire http://localhost:3000 nel browser del sistema (separato da quello pilotato da Playwright) e verificare `/api/status`.
4. Dal backend Onesiforo, emettere un comando `play_media` con URL JW.org.
5. Verificare che il Chromium pilotato da Playwright (finestra normale) vada all'URL e parta il video.
6. Emettere `stop_media` e verificare ritorno a standby.
7. Chiudere con Ctrl+C e verificare shutdown pulito.

## Decisioni esplicite

- **No refactor del watchdog**: già gestisce macOS (nessun `NOTIFY_SOCKET`).
- **No gestione platform-specific di `reboot`/`shutdown`/`set_volume`**: fuori scope.
- **No nuove dipendenze npm** (niente `dotenv`, ecc.): il pattern env-var già esiste nel progetto.
- **No file di config dev separato**: `config/config.json` (gitignored) + env vars sono sufficienti.
- **No escape-hatch `ONESIBOX_DEV_TLS_INSECURE` in prima implementazione**: aggiungere solo se `NODE_EXTRA_CA_CERTS` si rivela insufficiente sulla macchina di sviluppo.

## File toccati

| File | Tipo di modifica |
|------|------------------|
| `package.json` | + script `dev:mac` |
| `src/browser/controller.js` | path macOS in `findChromiumPath`; branch dev in `initialize` / `_initPlaywright` |
| `.gitignore` | + `.dev-data/` |
| `docs/dev-macos.md` | nuovo file, guida |

Nessun file viene eliminato o riorganizzato.
