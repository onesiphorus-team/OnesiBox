# JW Stream Playlist Playback — Design Spec

**Status:** Draft
**Date:** 2026-04-22
**Author:** m.dangelo@oltrematica.it (pairing with Claude)

## Goal

Aggiungere a OnesiBox la capacità di riprodurre il video **N-esimo di una playlist su `stream.jw.org`** (assemblee, convegni) ricevendo dal backend Onesiforo un singolo comando con `url` (share link) e `ordinal` (1-indexed). La SPA di JW Stream non espone deep-link per item né MP4 diretti: il flusso è DOM-automation Playwright contro il player ufficiale della SPA.

## Context

### Cosa esiste già

Il branch `010-timed-playlist-sessions` (PR #27) introduce il concetto di "playlist session" **orchestrata server-side**: il backend invia N comandi `play_media` consecutivi, uno per video, tutti con lo stesso `session_id`. Il client riporta `completed` → il backend invia il successivo. Questo modello funziona SOLO perché `play_media` riceve URL canonici di `www.jw.org` (pattern `#xx/mediaitems/...` o `*_VIDEO`), estrae il `mediaId`, chiama il proxy server-side `/api/jw-media`, ottiene un MP4 diretto e lo riproduce nel player locale `web/player.html`.

### Perché non basta estendere `play_media`

L'URL `https://stream.jw.org/6311-4713-5379-2156` appartiene a un prodotto diverso (JW Stream, streaming assemblee). Dal reconnaissance del 2026-04-22:

- Il "token" nell'URL è in realtà un **share link**: la prima visita chiama `POST /api/v1/auth/login/share` e stabilisce una sessione cookie-based; l'URL fa poi redirect a `/home`.
- La playlist è una lista di 4 tile (button Material-UI `button.MuiCardActionArea-root`) renderizzati dalla SPA.
- **Non esiste deep-link per item**: cliccando un tile, l'URL diventa solo `?playerOpen=true`, nessun identificativo item nel path/query.
- Il player è **Video.js + HLS over MSE**: manifest `master.m3u8` firmato CloudFront, segmenti `.ts`, sorgente esposta come `blob:`. Nessun MP4 diretto estraibile.
- Esiste un'API REST non documentata (`/api/v1/libraryBranch/library/link/{token}`, `.../vodProgram/specialty/{guid}`, `/program/getByGuidForHome/{guid}?programType=vod`) ma non la usiamo (vedi sezione "Alternative considerate").

La differenza è strutturale: `play_media` assume flusso "URL → MP4 diretto → player locale". JW Stream richiede flusso "URL → apri SPA → interagisci col DOM → lascia riprodurre il player della SPA". Meritano handler separati.

## Requirements

### Functional

1. **Nuovo comando** `play_stream_item` con payload `{url, ordinal, session_id?}`.
2. `ordinal` è **1-indexed**, intero ∈ [1, 50].
3. `url` deve essere un URL `https://stream.jw.org/...` validato contro una whitelist.
4. Al comando:
   - Se è già in corso un playback, OnesiBox lo interrompe (come fa `play_media`).
   - Naviga all'URL del share link (la SPA redirige a `/home` e autentica la sessione via share token).
   - Sopprime il cookie banner (OneTrust) preemptivamente.
   - Attende il rendering dei tile della playlist (fino a 15 s).
   - Clicca il tile N-esimo (`ordinal - 1` in 0-indexed).
   - Attende che il `<video>` HTML5 sia in stato `readyState ≥ 2` (fino a 15 s).
   - Inietta listener `ended` ed `error` sul `<video>` → flag `window.__onesiboxVideoEnded` / `window.__onesiboxVideoError`.
   - Aggiorna `stateManager` a `PLAYING`.
   - Riporta evento `started`.
   - Avvia il poller `startVideoEndedDetection` esistente (interroga ogni 2 s i flag window).
5. Al termine del video: il poller rileva `__onesiboxVideoEnded`, invoca `handleVideoEnd` esistente → standby + evento `completed`.
6. I comandi esistenti `stop_media`, `pause_media`, `resume_media` funzionano senza modifiche anche durante un `play_stream_item` (lo stato interno è `PLAYING` in entrambi i casi; `pause`/`resume` del `browserController` agiscono sul `<video>` HTML5 standard).

### Non-functional

- Timeout globale del comando: 30 s (da `navigateTo` a `started`).
- Comando idempotente rispetto a retry: uno `stop_media` in-flight durante l'avvio abortisce senza lasciare lo stato sporco.
- Nessuna dipendenza nuova (niente `hls.js`, niente client API custom). Solo Playwright/Chromium già in uso.

### Out of scope

- Playlist con più di 50 item (cap di validazione).
- Share link che richiedono login JW personale (abbiamo confermato che il token 4x4-cifre è pubblico per i contenuti in oggetto).
- API REST dirette su `stream.jw.org` (vedi "Alternative considerate").
- Playlist non-JW (es. YouTube playlist). Fuori scope di questa iterazione.
- UI/pannello admin del backend Onesiforo per invocare il comando: competenza del repo `onesiforo-web`, non di questa spec.

## Architecture

### Nuovo modulo

`src/commands/handlers/stream-playlist.js` (~120 LOC):

```
playStreamItem(command, browserController)    ← handler esportato al dispatcher
setApiClient(client)                           ← stesso pattern di media.js, per reportPlaybackEvent
_navigateAndWaitTiles(browserController, url)  ← navigazione + attesa DOM tile
_dismissCookieBanner(browserController)        ← click "Rifiuta" se presente (best-effort)
_clickNthTileAndWaitVideo(browserController, ordinal)   ← click + attesa <video> readyState
_injectVideoEndHooks(browserController)        ← addEventListener ended/error
```

### Moduli esistenti riusati senza modifiche

- `src/state/state-manager.js`: `setPlaying`, `stopPlaying`, `getState`, `STATUS`.
- `src/commands/handlers/media.js`:
  - `reportPlaybackEvent` (già esportato)
  - `startVideoEndedDetection`, `stopVideoEndedDetection` (già esportati)
  - `handleVideoEnd` è interno a `media.js` — va **esportato** per poterlo riusare. Piccola modifica non invasiva.
- `src/browser/controller.js`: `navigateTo`, `goToStandby`, `pause`, `resume`, `_executeScript`. Nessuna modifica.

### Modifiche a `src/commands/validator.js`

```js
const ALLOWED_DOMAINS = [
  'jw.org',
  'www.jw.org',
  'wol.jw.org',
  'stream.jw.org',         // NUOVO
  'download-a.akamaihd.net'
];

const COMMAND_TYPES = [
  'play_media',
  'play_stream_item',       // NUOVO
  'stop_media',
  // ...
];

const ERROR_CODES = {
  // esistenti...
  STREAM_NAV_FAILED: 'E110',           // NUOVO
  PLAYLIST_LOAD_FAILED: 'E111',        // NUOVO
  ORDINAL_OUT_OF_RANGE: 'E112',        // NUOVO
  VIDEO_START_FAILED: 'E113'           // NUOVO
};

function isStreamJwUrl(url) { /* analogo a isZoomUrl, hostname = stream.jw.org + sottodomini */ }

// in validateCommand:
case 'play_stream_item':
  if (!command.payload?.url) errors.push('play_stream_item requires url in payload');
  else if (!isStreamJwUrl(command.payload.url)) errors.push('url must be a stream.jw.org URL');
  if (!Number.isInteger(command.payload?.ordinal) ||
      command.payload.ordinal < 1 || command.payload.ordinal > 50)
    errors.push('ordinal must be integer 1-50');
  break;

// in getErrorCodeForCommandType:
case 'play_stream_item':
  return ERROR_CODES.MEDIA_HANDLER_FAILED;  // coarse code per ACK; handler usa E110-E113 per playback events
```

### Modifiche al command dispatcher

I comandi sono instradati tramite `commandManager.registerHandler(type, handler)` in `src/main.js`. Aggiungere accanto alle registrazioni media esistenti:

```js
// src/main.js, dopo la registrazione di play_media
commandManager.registerHandler('play_stream_item', streamPlaylistHandler.playStreamItem);
```

Richiede anche l'import del nuovo handler in cima a `main.js`:
```js
const streamPlaylistHandler = require('./commands/handlers/stream-playlist');
```

E l'iniezione dell'API client:
```js
streamPlaylistHandler.setApiClient(apiClient);
```

analoga a quella già presente per `mediaHandler`.

### Whitelist e cookie banner

Il cookie banner di `stream.jw.org` è OneTrust. Pre-popolando nel `BrowserContext` di Playwright il cookie:

```js
await context.addCookies([{
  name: 'OptanonAlertBoxClosed',
  value: new Date().toISOString(),
  domain: '.jw.org',
  path: '/'
}]);
```

il banner non viene mostrato al primo paint. È possibile che OneTrust usi anche `OptanonConsent` per memorizzare scelte granulari: se il banner riappare in smoke test, aggiungere anche quello con valore `groups=C0001:1,C0002:0,...` (rifiuta tutto tranne "necessari"). Fallback runtime: se il banner è presente dopo navigazione, click sul button "Rifiuta" via selettore testuale (tollerante a fallimento).

### Flow diagram

```
Backend --play_stream_item{url,ordinal,session_id}-->
  Dispatcher --> validator
                    |
                    +-- KO --> ACK error (E005/E006/validation)
                    |
                    +-- OK --> streamPlaylistHandler.playStreamItem
                                |
                                +-- stopMedia() se PLAYING
                                +-- preemptive addCookies OneTrust
                                +-- browserController.navigateTo(url)
                                    (SPA redirect a /home, login share)
                                +-- wait button.MuiCardActionArea-root count >= ordinal (15s)
                                    |
                                    +-- timeout --> E111 PLAYLIST_LOAD_FAILED
                                    +-- count < ordinal --> E112 ORDINAL_OUT_OF_RANGE
                                    |
                                +-- dismiss cookie banner (best-effort click "Rifiuta")
                                +-- click tile[ordinal-1]
                                +-- wait <video> readyState >= 2 (15s)
                                    |
                                    +-- timeout --> E113 VIDEO_START_FAILED
                                    |
                                +-- inject listener ended/error sul <video>
                                +-- stateManager.setPlaying({url, media_type:'video', ordinal})
                                +-- reportPlaybackEvent('started', {url, ordinal, session_id})
                                +-- startVideoEndedDetection (riuso poller esistente)

[durante playback]
  Poller ogni 2s controlla window.__onesiboxVideoEnded / __onesiboxVideoError / URL standby

[fine video naturale]
  Poller rileva ended=true --> handleVideoEnd --> goToStandby + reportPlaybackEvent('completed')
  --> Backend può inviare play_stream_item con ordinal=N+1
```

## Data flow (dettaglio sequenziale)

Vedi "Flow diagram" sopra. Passi testuali:

1. Backend invia `{type:"play_stream_item", payload:{url:"https://stream.jw.org/6311-4713-5379-2156", ordinal:1, session_id:"uuid"}}`.
2. Validator accetta.
3. `playStreamItem`: se PLAYING, `stopMedia()` preliminare.
4. `context.addCookies(OptanonAlertBoxClosed)`.
5. `browserController.navigateTo("https://stream.jw.org/6311-4713-5379-2156")`. La SPA:
   - Chiama `POST /api/v1/auth/login/share` (cookie sessione).
   - Chiama `GET /api/v1/libraryBranch/library/link/6311-4713-5379-2156`.
   - Redirect a `/home`.
   - Renderizza i tile.
6. Polling DOM su `button.MuiCardActionArea-root` (15 s max).
7. Se il banner è ancora presente, click "Rifiuta" (best-effort, non fatal).
8. `tiles[ordinal-1].click()`. URL diventa `?playerOpen=true`, Video.js crea `<video src="blob:...">`.
9. Polling DOM su `document.querySelector('video')?.readyState >= 2` (15 s max).
10. Inject listener ended/error sul video element.
11. `stateManager.setPlaying(...)` + `reportPlaybackEvent('started', ...)`.
12. `startVideoEndedDetection(...)`: polling esistente ogni 2 s.
13. Al video end naturale, evento `completed` → standby.

### Scenari paralleli

- **Doppio comando in volo**: il secondo comando chiama `stopMedia()` che pulisce il poller, poi procede. Nessuna race su state-manager perché l'handler è sincrono-awaited.
- **Stop-media durante navigazione**: prima di chiamare `setPlaying` al passo 11, controllare se lo stato è ancora compatibile. Se `getState().status !== STATUS.STANDBY` (qualcuno ha interrotto), abort silenzioso.
- **Video mai parte**: timeout al passo 9 → E113 → standby → report error.

## Error handling

| Codice | Scenario | Reazione |
|---|---|---|
| `E005 URL_NOT_WHITELISTED` | Validator: dominio non in whitelist | ACK errore, niente side effect |
| `E006 UNKNOWN_COMMAND_TYPE` | Validator: comando `play_stream_item` sconosciuto (backend non aggiornato a OnesiBox nuovo firmware? improbabile) | ACK errore |
| `E110 STREAM_NAV_FAILED` | `navigateTo` lancia eccezione (DNS, TLS, 5xx persistente) | standby + event `error` + ACK errore |
| `E111 PLAYLIST_LOAD_FAILED` | Dopo 15 s nessun tile trovato nel DOM | standby + event `error` con log dell'URL finale raggiunto (permette di capire se c'è stato redirect a login page, pagina 404, ecc.) |
| `E112 ORDINAL_OUT_OF_RANGE` | `tileCount < ordinal` | standby + event `error` con payload `{ordinal_requested, tile_count_found}` — il backend può mostrare un messaggio chiaro all'operatore |
| `E113 VIDEO_START_FAILED` | Dopo click del tile, `<video>` non arriva a `readyState ≥ 2` entro 15 s | standby + event `error` |
| `E010 EXECUTION_TIMEOUT` | L'intero handler supera 30 s | standby + event `error` |

**Best-effort, non fatal**:
- Cookie banner dismiss fallito (addCookies + click "Rifiuta" entrambi falliti): log warning, procedi. Se poi il click sul tile fallisce per overlay, diventa `VIDEO_START_FAILED`.
- `goToStandby()` fallisce dopo un errore: log warning, l'evento `error` viene comunque riportato.

**Degradazione se la SPA cambia DOM**: selettore `button.MuiCardActionArea-root` è Material-UI componente-class, ragionevolmente stabile. Se JW rifà la SPA, `PLAYLIST_LOAD_FAILED` ripetuto. Il backend vede il pattern e può alertare per aggiornamento firmware. **Non progettiamo fallback automatico**: aumenterebbe complessità per scenario raro, e un fallback "silenzioso" che clicca il tile sbagliato è peggio di un errore pulito.

## Testing

### Unit test (Jest)

**`tests/commands/validator.test.js`** (estensione):

- `isStreamJwUrl`:
  - accetta `https://stream.jw.org/6311-4713-5379-2156`
  - accetta `https://stream.jw.org/home?playerOpen=true`
  - rifiuta `http://stream.jw.org/x` (non HTTPS)
  - rifiuta `https://stream.jw.org.evil.com/x` (subdomain attack)
  - rifiuta `https://stream.jw.org:9999/x` (porta non-standard)
  - rifiuta `https://fake-stream.jw.org/x` (non esatto né sottodominio)
- `validateCommand({type: 'play_stream_item', ...})`:
  - happy path con url e ordinal validi
  - url mancante → error
  - ordinal mancante → error
  - ordinal = 0 → error
  - ordinal = 51 → error
  - ordinal = 1.5 → error
  - ordinal = "1" (string) → error
  - url non-stream.jw.org → error

**`tests/commands/handlers/stream-playlist.test.js`** (nuovo):

- Happy path: verifica sequenza `navigateTo → waitTiles → dismissCookieBanner → clickNthTile → waitVideo → injectHooks → setPlaying → reportPlaybackEvent('started') → startVideoEndedDetection`. Mock `browserController._executeScript` con valori attesi; mock `apiClient.reportPlaybackEvent`.
- `PLAYLIST_LOAD_FAILED`: `_executeScript` per wait-tiles ritorna `{ok: false, tileCount: 0}` dopo timeout → `stopPlaying`, `goToStandby`, `reportPlaybackEvent('error', {error_code: 'E111'})`, no `setPlaying`.
- `ORDINAL_OUT_OF_RANGE`: tile-count = 3, ordinal = 5 → `E112`, payload contiene `{ordinal_requested:5, tile_count_found:3}`.
- `VIDEO_START_FAILED`: `_executeScript` per wait-video ritorna `{readyState: 0}` dopo timeout → `E113`.
- Race stop-during-navigation: mentre l'handler fa `navigateTo`, il mock di `stateManager.getState()` ritorna `STANDBY` al check finale → handler esce senza `setPlaying` né `reportPlaybackEvent('started')`.
- Interazione con `stopMedia` esistente: se `playStreamItem` è invocato mentre `status=PLAYING`, chiama internamente `stopMedia` una sola volta prima di procedere (spy su `media.stopMedia`).

### Nessun E2E automatico

Non scriviamo test E2E contro `stream.jw.org` reale: contenuti live/scadenti, token che espirano, API non documentate → flakiness e falsi positivi. Si copre il rischio con smoke test manuale.

### Smoke test manuale (dev:mac)

Documentato in `docs/dev-macos.md` come nuova sottosezione "Testare play_stream_item":

1. `npm run dev:mac` con `config/config.json` locale.
2. Dal backend Onesiforo (tinker o UI admin), inviare `{type:"play_stream_item", payload:{url:"<share-url>", ordinal:1}}`.
3. Verificare:
   - Log OnesiBox: `Navigating to URL`, `Playlist tiles loaded { count: 4 }`, `Clicking tile { ordinal: 1 }`, `Video started { readyState: 4 }`, `Playback event reported { event: 'started', ordinal: 1 }`.
   - Finestra Chrome: redirect a `/home`, cookie banner NON visibile (addCookies ha funzionato), Video.js fullscreen con la Parte 1.
4. Inviare `ordinal: 2`, stesso URL: il primo video si ferma, nuova navigazione, parte la Parte 2.
5. Inviare `ordinal: 99`: log `Ordinal out of range { requested: 99, found: 4 }`, evento `error` con code E112.
6. Inviare `stop_media` durante playback: standby + evento `stopped`.
7. Far terminare il video fino al suo naturale completamento (o simulare con `document.querySelector('video').currentTime = video.duration` nella DevTools): dopo ≤ 2 s di polling, evento `completed`.

### Linting e type-check

Il nuovo file segue `eslint.config.js` esistente. Nessuna nuova regola.

## Alternative considerate

**API-direct (Approccio 2 scartato)**: chiamare le API REST di `stream.jw.org` direttamente da OnesiBox (token → library → programs → m3u8). Scartato perché:
- API non documentate → rischio di break silenzioso in futuro (non meglio del DOM).
- Avrebbe richiesto `hls.js` nel player locale (+80KB) → serve meno un player custom.
- La SPA di JW gestisce già tutto correttamente (HLS, ABR, fullscreen, error UI).

**Hybrid (Approccio 3 scartato)**: Playwright intercetta la richiesta `master.m3u8` dopo che la SPA l'ha emessa, poi la carica in un player nostro. Scartato perché combina gli svantaggi di entrambi senza benefici tangibili rispetto all'Approccio 1.

**Estensione di `play_media` (scartato)**: overload con nuovo `media_type: "stream_playlist_item"` + campo `ordinal`. Scartato perché mescolare "URL → MP4 locale" con "URL → SPA DOM" nel medesimo handler confonde il codice e complica il testing.

**Deep-link per item (impossibile)**: la SPA non espone deep-link — cliccare un tile produce solo `?playerOpen=true`. Non abbiamo alternative al click del tile.

## Open questions

Nessuna rimasta al momento della stesura. Tutte le decisioni progettuali sono state validate durante il brainstorming del 2026-04-22.
