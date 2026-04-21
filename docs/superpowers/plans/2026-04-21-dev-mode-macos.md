# Dev mode macOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable running OnesiBox on macOS for local development and testing against `https://onesiforo.test` (served by Herd), covering both communication flows (HTTP polling, heartbeat, ACK, Reverb WebSocket) and media playback in a windowed (non-kiosk) Chromium.

**Architecture:** Additive-only changes gated by a new env var `ONESIBOX_DEV_MODE=1`. When unset, behavior is identical to current production. `NODE_EXTRA_CA_CERTS` is used as the TLS-trust mechanism (no code changes in axios). Chromium path lookup is extended with macOS locations. Browser launch args branch on dev mode to remove kiosk/fullscreen/no-sandbox.

**Tech Stack:** Node.js 20, Playwright 1.52, Chromium (system on macOS). No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-04-21-dev-mode-macos-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `.gitignore` | Add `.dev-data/` |
| `src/browser/controller.js` | Extend `findChromiumPath()` with macOS paths; branch `initialize()` / `_initPlaywright()` on `ONESIBOX_DEV_MODE` |
| `package.json` | Add `dev:mac` script |
| `docs/dev-macos.md` | New file — setup and troubleshooting guide |

Total: 3 modified files + 1 new doc file. No test files added per design decision ("Nessun test automatizzato nuovo"). Validation is via manual smoke test documented in the doc.

---

## Task 1: Ignore local dev data directory

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read current `.gitignore`**

Run: `cat .gitignore` (or use Read tool on `.gitignore`)

Expected: contains `config/config.json`, `node_modules/`, `logs/`, `.env.*` — does NOT contain `.dev-data/`.

- [ ] **Step 2: Append `.dev-data/` under the `# Dependencies` / `# Build outputs` area**

Add the following line at the end of the `# Build outputs` block (after `build/`):

```
.dev-data/
```

The final relevant section should look like:

```
# Build outputs
dist/
build/
.dev-data/
```

- [ ] **Step 3: Verify the change**

Run: `git diff .gitignore`

Expected: one `+.dev-data/` line added in the Build outputs block.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore local dev data directory"
```

---

## Task 2: Extend `findChromiumPath()` with macOS locations

**Files:**
- Modify: `src/browser/controller.js` (lines 14-42, function `findChromiumPath`)

**Context:** The current function checks `CHROMIUM_BIN` env var, then a hardcoded list of Linux paths. On macOS none of these exist, so it returns `null` and Playwright falls back to its bundled Chromium (which lacks proprietary codecs, blocking JW.org MP4 playback). Adding macOS paths at the end of the list preserves Linux behavior (Linux paths checked first) while enabling codec-supporting Chrome on macOS.

- [ ] **Step 1: Open `src/browser/controller.js` and locate the `paths` array in `findChromiumPath`**

The current array (around line 24-30):

```javascript
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
```

- [ ] **Step 2: Add macOS paths at the end of the array**

Replace the array with:

```javascript
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ];
```

Order matters: Linux paths first means production Raspberry Pi behavior is unchanged (first Linux hit wins). On macOS, Linux paths all fail `fs.accessSync` and the first macOS hit wins.

- [ ] **Step 3: Verify syntax is valid**

Run: `node -c src/browser/controller.js`

Expected: no output (file is syntactically valid).

- [ ] **Step 4: Sanity check — lint passes**

Run: `npm run lint`

Expected: exits 0 (no new warnings/errors from this change).

- [ ] **Step 5: Commit**

```bash
git add src/browser/controller.js
git commit -m "feat(browser): extend Chromium path lookup with macOS locations"
```

---

## Task 3: Add dev-mode branch for browser launch args

**Files:**
- Modify: `src/browser/controller.js` (method `initialize`, approx. lines 72-128; method `_initPlaywright`, approx. lines 134-168)

**Context:** The `initialize()` method builds `this.launchArgs` with `--kiosk`, `--start-fullscreen`, `--no-sandbox`, which are wrong for macOS dev (take over screen, sandbox flag is unsafe and unnecessary). We introduce a dev-mode branch that builds a smaller args set. `_initPlaywright()` also needs a defined viewport when in dev mode (instead of `null`, which inherits the full display).

- [ ] **Step 1: Locate the current `launchArgs` definition in `initialize()`**

Currently (around line 85-100):

```javascript
    // Common browser arguments
    this.launchArgs = [
      '--kiosk',
      '--noerrdialogs',
      '--disable-infobars',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-session-crashed-bubble',
      '--disable-features=TranslateUI',
      '--check-for-update-interval=31536000',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-default-apps',
      '--start-fullscreen',
      '--no-sandbox',
    ];
```

- [ ] **Step 2: Add a dev-mode detection constant near the top of the file**

At the top of `src/browser/controller.js`, after the existing constants block (around line 11, after `DATA_DIR`), add:

```javascript
const IS_DEV_MODE = process.env.ONESIBOX_DEV_MODE === '1';
```

Final constants block should look like:

```javascript
const LOCAL_PORT = process.env.PORT || 3000;
const STANDBY_URL = `http://localhost:${LOCAL_PORT}`;
const LOCAL_URL_PREFIX = `http://localhost:${LOCAL_PORT}/`;
const DATA_DIR = process.env.ONESIBOX_DATA_DIR || '/opt/onesibox/data';
const IS_DEV_MODE = process.env.ONESIBOX_DEV_MODE === '1';
```

- [ ] **Step 3: Replace the `launchArgs` assignment with a dev-mode branch**

Replace the block from `// Common browser arguments` up to and including the closing `];` (the one just before `if (isWayland) {`):

```javascript
    // Common browser arguments
    if (IS_DEV_MODE) {
      // Dev mode (macOS/local): windowed, no kiosk, no sandbox flag.
      // Keep the args that only affect behavior (no UI takeover).
      this.launchArgs = [
        '--noerrdialogs',
        '--disable-infobars',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-session-crashed-bubble',
        '--disable-features=TranslateUI',
        '--check-for-update-interval=31536000',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
      ];
      logger.info('Dev mode: using windowed browser args (no kiosk/fullscreen/no-sandbox)');
    } else {
      this.launchArgs = [
        '--kiosk',
        '--noerrdialogs',
        '--disable-infobars',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-session-crashed-bubble',
        '--disable-features=TranslateUI',
        '--check-for-update-interval=31536000',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--start-fullscreen',
        '--no-sandbox',
      ];
    }
```

- [ ] **Step 4: Update `_initPlaywright()` to set a fixed viewport in dev mode**

Locate (around line 139-145):

```javascript
    const launchOptions = {
      headless: false,
      args: this.launchArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: null,
      ignoreHTTPSErrors: true,
    };
```

Replace with:

```javascript
    const launchOptions = {
      headless: false,
      args: this.launchArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: IS_DEV_MODE ? { width: 1280, height: 800 } : null,
      ignoreHTTPSErrors: true,
    };
```

- [ ] **Step 5: Verify syntax**

Run: `node -c src/browser/controller.js`

Expected: no output.

- [ ] **Step 6: Verify lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 7: Manual smoke check that prod path is unchanged**

Inspect the diff:

Run: `git diff src/browser/controller.js`

Expected: the dev-mode branch is additive; the Linux/prod `else` branch contains the original args verbatim (`--kiosk`, `--start-fullscreen`, `--no-sandbox` all still present). No args were removed from the prod path.

- [ ] **Step 8: Commit**

```bash
git add src/browser/controller.js
git commit -m "feat(browser): add dev-mode branch for windowed browser launch"
```

---

## Task 4: Add `dev:mac` npm script

**Files:**
- Modify: `package.json` (scripts block, lines 6-12)

**Context:** The script sets three env vars and starts the app:
- `ONESIBOX_DEV_MODE=1` — activates the browser branch from Task 3.
- `ONESIBOX_DATA_DIR=./.dev-data` — stores Playwright profile inside the repo (gitignored).
- `NODE_EXTRA_CA_CERTS=...` — points Node to Herd's self-signed CA so axios TLS validation passes without weakening it.

- [ ] **Step 1: Read current scripts block**

Read `package.json`, locate the `"scripts"` object (lines 6-12).

Current content:

```json
  "scripts": {
    "start": "node src/main.js",
    "dev": "NODE_ENV=development node src/main.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/"
  },
```

- [ ] **Step 2: Add the `dev:mac` entry after `dev`**

Replace the scripts block with:

```json
  "scripts": {
    "start": "node src/main.js",
    "dev": "NODE_ENV=development node src/main.js",
    "dev:mac": "ONESIBOX_DEV_MODE=1 ONESIBOX_DATA_DIR=./.dev-data NODE_EXTRA_CA_CERTS=\"$HOME/Library/Application Support/Herd/config/valet/CA/HerdCASelfSigned.pem\" node src/main.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/"
  },
```

Notes on quoting:
- JSON string: outer `"..."` with inner `\"...\"` to escape quotes that wrap `$HOME/...` (needed because the expanded path contains a space in `Application Support`).
- npm invokes the script via the shell, which expands `$HOME`. Do NOT hardcode `/Users/<name>` — keep `$HOME`.

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json'))"`

Expected: no output (valid JSON). If you see a SyntaxError, re-check quote escaping.

- [ ] **Step 4: Verify npm recognizes the new script**

Run: `npm run`

Expected: the output lists `dev:mac` among available scripts.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat: add dev:mac npm script"
```

---

## Task 5: Write `docs/dev-macos.md`

**Files:**
- Create: `docs/dev-macos.md`

**Context:** Single entry-point doc for onboarding someone to the macOS dev flow. Must be complete enough that a developer without prior context can go from zero to working smoke test.

- [ ] **Step 1: Create `docs/dev-macos.md` with the following content**

```markdown
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
```

- [ ] **Step 2: Verify the file**

Read: `docs/dev-macos.md`

Expected: file exists, contains the sections Prerequisiti / Configurazione / Avvio / Smoke test / Troubleshooting. No TBD/TODO markers.

- [ ] **Step 3: Commit**

```bash
git add docs/dev-macos.md
git commit -m "docs: add macOS dev mode setup guide"
```

---

## Task 6: Cross-reference from `README.md`

**Files:**
- Modify: `README.md` (find the "Installazione Sviluppo" section)

**Context:** The README already has a dev install section that says "npm run dev" for Linux. Add a one-liner pointer to the new macOS guide so developers find it.

- [ ] **Step 1: Locate the "Installazione Sviluppo" section in `README.md` (around lines 33-49)**

Current content:

```markdown
### Installazione Sviluppo

```bash
# Clona il repository
git clone https://github.com/onesiphorus-team/onesibox-client.git
cd onesibox-client

# Installa le dipendenze
npm install

# Configura
cp config/config.json.example config/config.json
# Modifica config.json con i tuoi valori

# Avvia in modalità sviluppo
npm run dev
```
```

- [ ] **Step 2: Append a note after the code block, before the next section**

Add the following lines immediately after the closing ` ``` ` of the install code block:

```markdown

> **Sviluppo su macOS**: per testare contro un server Onesiforo locale servito da Herd (`https://onesiforo.test`) con browser in finestra, vedi [`docs/dev-macos.md`](docs/dev-macos.md) e usa `npm run dev:mac`.
```

- [ ] **Step 3: Verify the edit**

Run: `git diff README.md`

Expected: one additive block (the note about macOS dev) after the install code block. No existing content removed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link to macOS dev guide from README"
```

---

## Task 7: End-to-end smoke validation (manual)

**Files:** none modified — this is a verification task.

**Context:** Run through the smoke test end-to-end on the actual dev machine to confirm the implementation works. This is NOT a skippable "trust me it works" step — previous tasks only verify syntactic/static correctness.

- [ ] **Step 1: Ensure prerequisites**

Verify in the shell:
```bash
node --version         # → v20.x.x
ls /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome   # should exist
ls "$HOME/Library/Application Support/Herd/config/valet/CA/HerdCASelfSigned.pem"   # should exist
curl -sI https://onesiforo.test | head -n1   # → HTTP/2 200 (or similar)
```

If any of these fails, fix the prerequisite before continuing (refer to `docs/dev-macos.md` Troubleshooting).

- [ ] **Step 2: Create a minimal `config/config.json`**

If one doesn't exist yet, create it with real values from the backend. Do NOT commit this file (it's gitignored).

- [ ] **Step 3: Run the dev server**

```bash
npm run dev:mac
```

Expected within ~10 seconds:
- log `Dev mode: using windowed browser args` appears
- log `Using system Chromium for codec support { path: '/Applications/Google Chrome.app/...' }` appears
- log `OnesiBox ready` appears
- a Chrome window opens showing the standby page

If the browser log says `Playwright failed, falling back to direct spawn`, investigate: on macOS the fallback spawn path is untested and likely unsuitable.

- [ ] **Step 4: Verify local HTTP endpoint**

In a second terminal:

```bash
curl http://localhost:3000/api/status
```

Expected: JSON response with `status`, `connectionStatus`, `volume` fields.

- [ ] **Step 5: Verify communication with backend**

Check the Onesiforo admin panel: the device should appear online, with a recent heartbeat (within the last 30s).

- [ ] **Step 6: Trigger `play_media` from backend**

Send a `play_media` command with a valid JW.org media URL.

Expected:
- log `Received commands { count: 1 }` or WebSocket event log
- log `Navigating to URL { url: '...' }`
- Chrome window navigates to the URL and starts playing video with audio

If video shows a black screen or "Video non disponibile": Chrome system is not being used (codec issue). Re-verify Task 2 and the Chrome installation.

- [ ] **Step 7: Trigger `stop_media` from backend**

Expected:
- log `Going to standby`
- Chrome window returns to standby page
- video audio stops

- [ ] **Step 8: Clean shutdown**

Ctrl+C in the `npm run dev:mac` terminal.

Expected:
- log `Shutting down { signal: 'SIGINT' }`
- process exits within 2-3 seconds
- no zombie Chrome processes left: `pgrep -fl 'Google Chrome.*onesi'` returns nothing

- [ ] **Step 9: Record results**

If all steps passed, the dev-mode macOS feature is complete. Open a PR with the commits from Tasks 1-6.

If any step failed, stop here and diagnose. Do NOT mark the plan complete.

---

## Self-review checklist (already applied)

- **Spec coverage**: every spec section has a corresponding task. The 5 "Componenti che cambiano" map to Tasks 1-5 (gitignore, browser controller split into Tasks 2-3, package.json, dev-macos.md). Task 6 adds README cross-ref for discoverability. Task 7 covers the "smoke test manuale" mentioned in spec Testing.
- **Placeholder scan**: no TBD/TODO in the plan. Placeholders like `<serial_number>` inside the JSON template are user-supplied values explicitly documented in the "Dove prendere i valori" subsection.
- **Type consistency**: the env var name `ONESIBOX_DEV_MODE` and constant `IS_DEV_MODE` are consistent across Task 3 steps. Paths in `findChromiumPath` array match between Task 2 and the troubleshooting guide in Task 5.
- **Production safety**: Task 3 Step 7 explicitly verifies via `git diff` that the prod (non-dev) branch retains `--kiosk`, `--start-fullscreen`, `--no-sandbox` unchanged.
