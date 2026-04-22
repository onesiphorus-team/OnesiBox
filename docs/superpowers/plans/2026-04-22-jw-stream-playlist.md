# JW Stream Playlist Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supportare la riproduzione del video N-esimo di una playlist `stream.jw.org` tramite nuovo comando `play_stream_item {url, ordinal}` che fa DOM automation Playwright sulla SPA ufficiale.

**Architecture:** Un nuovo handler `src/commands/handlers/stream-playlist.js` orchestra navigazione → dismiss cookie banner → click del tile N-esimo → hook di fine video sul `<video>` HTML5 → riuso del poller esistente `startVideoEndedDetection` di `media.js`. Zero dipendenze nuove.

**Tech Stack:** Node.js 20, Jest 30, Playwright 1.52 (già in uso), Chromium di sistema.

**Spec:** `docs/superpowers/specs/2026-04-22-jw-stream-playlist-design.md`

---

## File structure

- **Create**: `src/commands/handlers/stream-playlist.js` — nuovo handler
- **Create**: `tests/unit/commands/stream-playlist.test.js` — unit test del nuovo handler
- **Modify**: `src/commands/validator.js` — aggiungere `isStreamJwUrl`, `stream.jw.org` in whitelist, `play_stream_item` in `COMMAND_TYPES`, case in `validateCommand`, codici E110-E113
- **Modify**: `tests/unit/commands/validator.test.js` — coprire le estensioni di cui sopra
- **Modify**: `src/main.js` — registrare `play_stream_item` handler e iniettare apiClient
- **Modify**: `docs/dev-macos.md` — aggiungere sezione smoke test del nuovo comando

---

## Task 1: Validator — `isStreamJwUrl` helper

**Files:**
- Modify: `src/commands/validator.js`
- Test: `tests/unit/commands/validator.test.js`

- [ ] **Step 1: Aggiungere i test falliti per `isStreamJwUrl`**

Aggiungi al file `tests/unit/commands/validator.test.js`, dopo il blocco `describe('isZoomUrl', ...)`:

```javascript
const { isStreamJwUrl } = require('../../../src/commands/validator');

describe('isStreamJwUrl', () => {
  it('should accept stream.jw.org share link', () => {
    expect(isStreamJwUrl('https://stream.jw.org/6311-4713-5379-2156')).toBe(true);
  });

  it('should accept stream.jw.org /home paths', () => {
    expect(isStreamJwUrl('https://stream.jw.org/home')).toBe(true);
    expect(isStreamJwUrl('https://stream.jw.org/home?playerOpen=true')).toBe(true);
  });

  it('should accept valid subdomains of stream.jw.org', () => {
    expect(isStreamJwUrl('https://www.stream.jw.org/x')).toBe(true);
  });

  it('should reject HTTP (no TLS)', () => {
    expect(isStreamJwUrl('http://stream.jw.org/x')).toBe(false);
  });

  it('should reject subdomain-injection attempts', () => {
    expect(isStreamJwUrl('https://stream.jw.org.evil.com/x')).toBe(false);
    expect(isStreamJwUrl('https://fake-stream.jw.org/x')).toBe(false);
  });

  it('should reject non-standard ports', () => {
    expect(isStreamJwUrl('https://stream.jw.org:9999/x')).toBe(false);
  });

  it('should reject invalid URLs', () => {
    expect(isStreamJwUrl('not-a-url')).toBe(false);
    expect(isStreamJwUrl('')).toBe(false);
    expect(isStreamJwUrl(null)).toBe(false);
  });

  it('should reject URLs exceeding max length', () => {
    const longPath = 'a'.repeat(3000);
    expect(isStreamJwUrl(`https://stream.jw.org/${longPath}`)).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il fallimento**

Run: `npx jest tests/unit/commands/validator.test.js -t isStreamJwUrl`
Expected: FAIL con `TypeError: isStreamJwUrl is not a function` (non ancora esportato).

- [ ] **Step 3: Implementare `isStreamJwUrl` in `src/commands/validator.js`**

Aggiungi subito dopo la funzione `isZoomUrl` (prima di `validateCommand`):

```javascript
/**
 * Check if a URL is a valid stream.jw.org URL.
 *
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is a valid stream.jw.org URL
 */
function isStreamJwUrl(url) {
  try {
    if (!url || url.length > MAX_URL_LENGTH) {
      return false;
    }

    const { hostname, protocol, port } = new URL(url);

    if (protocol !== 'https:') {
      return false;
    }

    if (port && port !== '443') {
      return false;
    }

    const normalizedHostname = hostname.toLowerCase();

    return normalizedHostname === 'stream.jw.org' ||
           (normalizedHostname.endsWith('.stream.jw.org') &&
            isValidSubdomainPart(normalizedHostname.slice(0, -'.stream.jw.org'.length)));
  } catch {
    return false;
  }
}
```

E aggiungi `isStreamJwUrl` all'oggetto `module.exports` in fondo al file:

```javascript
module.exports = {
  isUrlAllowed,
  isZoomUrl,
  isStreamJwUrl,
  validateCommand,
  getErrorCodeForValidation,
  getErrorCodeForCommandType,
  COMMAND_TYPES,
  ERROR_CODES,
  MAX_URL_LENGTH
};
```

- [ ] **Step 4: Eseguire i test per confermare il passaggio**

Run: `npx jest tests/unit/commands/validator.test.js -t isStreamJwUrl`
Expected: PASS su tutti i test del describe.

- [ ] **Step 5: Commit**

```bash
git add src/commands/validator.js tests/unit/commands/validator.test.js
git commit -m "feat(validator): add isStreamJwUrl helper for stream.jw.org URLs"
```

---

## Task 2: Validator — codici di errore E110-E113

**Files:**
- Modify: `src/commands/validator.js`
- Test: `tests/unit/commands/validator.test.js`

- [ ] **Step 1: Aggiungere i test falliti per i nuovi codici di errore**

Aggiungi un nuovo blocco in `tests/unit/commands/validator.test.js` alla fine del file:

```javascript
describe('Stream Playback Error Codes', () => {
  const { ERROR_CODES } = require('../../../src/commands/validator');

  it('should expose E110 STREAM_NAV_FAILED', () => {
    expect(ERROR_CODES.STREAM_NAV_FAILED).toBe('E110');
  });

  it('should expose E111 PLAYLIST_LOAD_FAILED', () => {
    expect(ERROR_CODES.PLAYLIST_LOAD_FAILED).toBe('E111');
  });

  it('should expose E112 ORDINAL_OUT_OF_RANGE', () => {
    expect(ERROR_CODES.ORDINAL_OUT_OF_RANGE).toBe('E112');
  });

  it('should expose E113 VIDEO_START_FAILED', () => {
    expect(ERROR_CODES.VIDEO_START_FAILED).toBe('E113');
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il fallimento**

Run: `npx jest tests/unit/commands/validator.test.js -t "Stream Playback Error"`
Expected: FAIL — `expect(undefined).toBe('E110')`.

- [ ] **Step 3: Aggiungere i codici all'enum in `src/commands/validator.js`**

Modifica l'oggetto `ERROR_CODES`, aggiungendo le 4 nuove chiavi dopo `INVALID_PAYLOAD`:

```javascript
const ERROR_CODES = {
  // Standard codes (aligned with server spec)
  COMMAND_EXPIRED: 'E004',
  URL_NOT_WHITELISTED: 'E005',
  UNKNOWN_COMMAND_TYPE: 'E006',
  INTERNAL_ERROR: 'E009',
  EXECUTION_TIMEOUT: 'E010',

  // Client-specific handler errors (E1xx range)
  MEDIA_HANDLER_FAILED: 'E101',
  ZOOM_HANDLER_FAILED: 'E102',
  VOLUME_HANDLER_FAILED: 'E103',
  SYSTEM_HANDLER_FAILED: 'E104',
  DIAGNOSTICS_HANDLER_FAILED: 'E105',
  SERVICE_HANDLER_FAILED: 'E106',
  INVALID_COMMAND_STRUCTURE: 'E107',
  INVALID_PAYLOAD: 'E108',

  // Stream playlist errors
  STREAM_NAV_FAILED: 'E110',
  PLAYLIST_LOAD_FAILED: 'E111',
  ORDINAL_OUT_OF_RANGE: 'E112',
  VIDEO_START_FAILED: 'E113'
};
```

- [ ] **Step 4: Eseguire i test per confermare il passaggio**

Run: `npx jest tests/unit/commands/validator.test.js -t "Stream Playback Error"`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/commands/validator.js tests/unit/commands/validator.test.js
git commit -m "feat(validator): add E110-E113 stream playlist error codes"
```

---

## Task 3: Validator — `play_stream_item` command type e whitelist

**Files:**
- Modify: `src/commands/validator.js`
- Test: `tests/unit/commands/validator.test.js`

- [ ] **Step 1: Aggiungere i test falliti per `validateCommand('play_stream_item', ...)`**

Aggiungi dentro il `describe('Command Validator', ...)` esistente, in coda:

```javascript
describe('validateCommand — play_stream_item', () => {
  const baseCmd = () => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'play_stream_item',
    payload: {
      url: 'https://stream.jw.org/6311-4713-5379-2156',
      ordinal: 1
    }
  });

  it('should accept a valid play_stream_item command', () => {
    const result = validateCommand(baseCmd());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing url', () => {
    const cmd = baseCmd();
    delete cmd.payload.url;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item requires url in payload');
  });

  it('should reject non-stream.jw.org url', () => {
    const cmd = baseCmd();
    cmd.payload.url = 'https://www.jw.org/en/library/';
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item url must be a stream.jw.org URL');
  });

  it('should reject missing ordinal', () => {
    const cmd = baseCmd();
    delete cmd.payload.ordinal;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
  });

  it('should reject ordinal = 0', () => {
    const cmd = baseCmd();
    cmd.payload.ordinal = 0;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
  });

  it('should reject ordinal > 50', () => {
    const cmd = baseCmd();
    cmd.payload.ordinal = 51;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
  });

  it('should reject non-integer ordinal', () => {
    const cmd = baseCmd();
    cmd.payload.ordinal = 1.5;
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
  });

  it('should reject string ordinal', () => {
    const cmd = baseCmd();
    cmd.payload.ordinal = '1';
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il fallimento**

Run: `npx jest tests/unit/commands/validator.test.js -t "play_stream_item"`
Expected: FAIL — `Unknown command type: play_stream_item` per il happy path.

- [ ] **Step 3: Estendere `ALLOWED_DOMAINS`, `COMMAND_TYPES` e `validateCommand`**

In `src/commands/validator.js`:

**3a.** Aggiungi `'stream.jw.org'` a `ALLOWED_DOMAINS` (ora 5 domini):

```javascript
const ALLOWED_DOMAINS = [
  'jw.org',
  'www.jw.org',
  'wol.jw.org',
  'stream.jw.org',
  'download-a.akamaihd.net'
];
```

**3b.** Aggiungi `'play_stream_item'` a `COMMAND_TYPES` subito dopo `'play_media'`:

```javascript
const COMMAND_TYPES = [
  'play_media',
  'play_stream_item',
  'stop_media',
  'pause_media',
  'resume_media',
  'set_volume',
  'join_zoom',
  'leave_zoom',
  'reboot',
  'shutdown',
  'restart_service',
  'get_system_info',
  'get_logs'
];
```

**3c.** Aggiungi il nuovo `case` nello switch dentro `validateCommand`, subito dopo il `case 'play_media':` (prima del `case 'set_volume':`):

```javascript
case 'play_stream_item':
  if (!command.payload?.url) {
    errors.push('play_stream_item requires url in payload');
  } else if (!isStreamJwUrl(command.payload.url)) {
    errors.push('play_stream_item url must be a stream.jw.org URL');
  }
  if (!Number.isInteger(command.payload?.ordinal) ||
      command.payload.ordinal < 1 ||
      command.payload.ordinal > 50) {
    errors.push('play_stream_item ordinal must be integer 1-50');
  }
  break;
```

**3d.** Aggiungi `play_stream_item` allo switch in `getErrorCodeForCommandType`, accanto agli altri media:

```javascript
case 'play_media':
case 'play_stream_item':
case 'stop_media':
case 'pause_media':
case 'resume_media':
  return ERROR_CODES.MEDIA_HANDLER_FAILED;
```

- [ ] **Step 4: Eseguire i test per confermare il passaggio**

Run: `npx jest tests/unit/commands/validator.test.js -t "play_stream_item"`
Expected: PASS 8/8.

Run: `npx jest tests/unit/commands/validator.test.js`
Expected: tutti i test del file passano (nessuna regressione).

- [ ] **Step 5: Commit**

```bash
git add src/commands/validator.js tests/unit/commands/validator.test.js
git commit -m "feat(validator): register play_stream_item command type"
```

---

## Task 4: Stream playlist handler — skeleton e happy path

**Files:**
- Create: `src/commands/handlers/stream-playlist.js`
- Test: `tests/unit/commands/stream-playlist.test.js`

- [ ] **Step 1: Scrivere il test fallito per il happy path**

Crea `tests/unit/commands/stream-playlist.test.js`:

```javascript
const streamPlaylist = require('../../../src/commands/handlers/stream-playlist');
const { stateManager, STATUS } = require('../../../src/state/state-manager');
const mediaHandler = require('../../../src/commands/handlers/media');

describe('stream-playlist handler', () => {
  let mockBrowserController;
  let mockApiClient;

  beforeEach(() => {
    jest.spyOn(mediaHandler, 'stopVideoEndedDetection').mockImplementation(() => {});
    jest.spyOn(mediaHandler, 'startVideoEndedDetection').mockImplementation(() => {});
    jest.spyOn(mediaHandler, 'stopMedia').mockImplementation(async () => {});

    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
    stateManager.isPaused = false;

    mockApiClient = {
      reportPlaybackEvent: jest.fn().mockResolvedValue({})
    };
    streamPlaylist.setApiClient(mockApiClient);

    mockBrowserController = {
      navigateTo: jest.fn().mockResolvedValue(),
      goToStandby: jest.fn().mockResolvedValue(),
      _executeScript: jest.fn()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
    if (stateManager.errorRecoveryTimer) {
      clearTimeout(stateManager.errorRecoveryTimer);
      stateManager.errorRecoveryTimer = null;
    }
  });

  describe('playStreamItem — happy path', () => {
    it('should navigate, click nth tile, start playback and report started', async () => {
      mockBrowserController._executeScript
        .mockResolvedValueOnce({ dismissed: true })          // dismiss cookie banner
        .mockResolvedValueOnce({ ok: true, tileCount: 4 })   // wait tiles
        .mockResolvedValueOnce({ clicked: true })            // click tile
        .mockResolvedValueOnce({ ok: true, readyState: 4, duration: 4697 })  // wait video
        .mockResolvedValueOnce({ hooksInstalled: true });    // inject ended hooks

      const command = {
        id: 'cmd-1',
        type: 'play_stream_item',
        payload: {
          url: 'https://stream.jw.org/6311-4713-5379-2156',
          ordinal: 2,
          session_id: 'session-abc'
        }
      };

      await streamPlaylist.playStreamItem(command, mockBrowserController);

      expect(mockBrowserController.navigateTo).toHaveBeenCalledWith(
        'https://stream.jw.org/6311-4713-5379-2156'
      );
      expect(mockBrowserController._executeScript).toHaveBeenCalledTimes(5);
      expect(stateManager.status).toBe(STATUS.PLAYING);
      expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'started',
          media_url: 'https://stream.jw.org/6311-4713-5379-2156',
          session_id: 'session-abc'
        })
      );
      expect(mediaHandler.startVideoEndedDetection).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il fallimento**

Run: `npx jest tests/unit/commands/stream-playlist.test.js`
Expected: FAIL con `Cannot find module '../../../src/commands/handlers/stream-playlist'`.

- [ ] **Step 3: Creare il file handler `src/commands/handlers/stream-playlist.js`**

Scrivi il contenuto completo del file:

```javascript
const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const mediaHandler = require('./media');
const { ERROR_CODES } = require('../validator');

let apiClient = null;

const TILE_SELECTOR = 'button.MuiCardActionArea-root';
const WAIT_TILES_TIMEOUT_MS = 15000;
const WAIT_VIDEO_TIMEOUT_MS = 15000;

function setApiClient(client) {
  apiClient = client;
}

async function reportPlaybackEvent(event, mediaInfo, extra = {}) {
  if (!apiClient) {
    logger.warn('Cannot report stream playback event: apiClient not set');
    return;
  }
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    media_url: mediaInfo.url,
    media_type: 'video',
    position: 0,
    ordinal: mediaInfo.ordinal,
    ...extra
  };
  if (mediaInfo.session_id) payload.session_id = mediaInfo.session_id;
  try {
    await apiClient.reportPlaybackEvent(payload);
    logger.info('Stream playback event reported', {
      event, media_url: payload.media_url, ordinal: payload.ordinal, session_id: payload.session_id || null
    });
  } catch (error) {
    logger.error('Failed to report stream playback event', { event, error: error.message });
  }
}

async function _dismissCookieBanner(browserController) {
  try {
    const result = await browserController._executeScript(`
      const reject = Array.from(document.querySelectorAll('button'))
        .find(b => /rifiuta|reject/i.test(b.textContent || ''));
      if (reject) { reject.click(); return { dismissed: true }; }
      return { dismissed: false };
    `);
    logger.debug('Cookie banner dismiss', result || {});
  } catch (error) {
    logger.debug('Cookie banner dismiss skipped (script error)', { error: error.message });
  }
}

async function _waitForTiles(browserController, ordinal) {
  return browserController._executeScript(`
    return new Promise((resolve) => {
      const deadline = Date.now() + ${WAIT_TILES_TIMEOUT_MS};
      const check = () => {
        const n = document.querySelectorAll(${JSON.stringify(TILE_SELECTOR)}).length;
        if (n >= ${ordinal}) return resolve({ ok: true, tileCount: n });
        if (Date.now() >= deadline) return resolve({ ok: false, tileCount: n, finalUrl: location.href });
        setTimeout(check, 250);
      };
      check();
    });
  `);
}

async function _clickNthTile(browserController, ordinal) {
  return browserController._executeScript(`
    const tiles = document.querySelectorAll(${JSON.stringify(TILE_SELECTOR)});
    if (!tiles[${ordinal - 1}]) return { clicked: false };
    tiles[${ordinal - 1}].click();
    return { clicked: true };
  `);
}

async function _waitForVideo(browserController) {
  return browserController._executeScript(`
    return new Promise((resolve) => {
      const deadline = Date.now() + ${WAIT_VIDEO_TIMEOUT_MS};
      const check = () => {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && isFinite(v.duration)) {
          return resolve({ ok: true, readyState: v.readyState, duration: v.duration });
        }
        if (Date.now() >= deadline) {
          return resolve({ ok: false, readyState: v ? v.readyState : null });
        }
        setTimeout(check, 250);
      };
      check();
    });
  `);
}

async function _injectEndedHooks(browserController) {
  return browserController._executeScript(`
    const v = document.querySelector('video');
    if (!v) return { hooksInstalled: false };
    window.__onesiboxVideoEnded = false;
    window.__onesiboxVideoError = false;
    v.addEventListener('ended', () => { window.__onesiboxVideoEnded = true; });
    v.addEventListener('error', () => { window.__onesiboxVideoError = true; });
    return { hooksInstalled: true };
  `);
}

async function _abortWithError(browserController, mediaInfo, errorCode, errorMessage) {
  logger.error('play_stream_item failed', { error_code: errorCode, error: errorMessage, ...mediaInfo });
  if (stateManager.getState().status === STATUS.PLAYING) {
    stateManager.stopPlaying();
  }
  try {
    await browserController.goToStandby();
  } catch (error) {
    logger.warn('goToStandby failed after stream error', { error: error.message });
  }
  await reportPlaybackEvent('error', mediaInfo, { error_code: errorCode, error_message: errorMessage });
  const err = new Error(errorMessage);
  err.code = errorCode;
  throw err;
}

async function playStreamItem(command, browserController) {
  const { url, ordinal, session_id = null } = command.payload;
  const mediaInfo = { url, ordinal, session_id };

  logger.info('Playing stream item', { url, ordinal, session_id });

  if (stateManager.getState().status === STATUS.PLAYING) {
    await mediaHandler.stopMedia(command, browserController);
  }

  try {
    await browserController.navigateTo(url);
  } catch (error) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.STREAM_NAV_FAILED,
      `Navigation failed: ${error.message}`);
    return;
  }

  await _dismissCookieBanner(browserController);

  const tilesResult = await _waitForTiles(browserController, ordinal);
  if (!tilesResult || !tilesResult.ok) {
    const tileCount = tilesResult?.tileCount ?? 0;
    if (tileCount === 0) {
      await _abortWithError(browserController, mediaInfo, ERROR_CODES.PLAYLIST_LOAD_FAILED,
        `No tiles found after ${WAIT_TILES_TIMEOUT_MS}ms (final URL: ${tilesResult?.finalUrl || 'unknown'})`);
    } else {
      await _abortWithError(browserController, mediaInfo, ERROR_CODES.ORDINAL_OUT_OF_RANGE,
        `Ordinal ${ordinal} exceeds playlist length ${tileCount}`);
    }
    return;
  }

  const clickResult = await _clickNthTile(browserController, ordinal);
  if (!clickResult || !clickResult.clicked) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.VIDEO_START_FAILED,
      `Failed to click tile ${ordinal}`);
    return;
  }

  const videoResult = await _waitForVideo(browserController);
  if (!videoResult || !videoResult.ok) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.VIDEO_START_FAILED,
      `Video did not start within ${WAIT_VIDEO_TIMEOUT_MS}ms (readyState: ${videoResult?.readyState})`);
    return;
  }

  await _injectEndedHooks(browserController);

  if (stateManager.getState().status === STATUS.PLAYING) {
    logger.info('Stream item aborted before start (state no longer IDLE)');
    return;
  }

  stateManager.setPlaying({ url, media_type: 'video' });

  await reportPlaybackEvent('started', mediaInfo);

  mediaHandler.startVideoEndedDetection(browserController, {
    url,
    media_type: 'video',
    session_id
  });
}

module.exports = {
  playStreamItem,
  setApiClient
};
```

- [ ] **Step 4: Eseguire il test del happy path**

Run: `npx jest tests/unit/commands/stream-playlist.test.js -t "happy path"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/handlers/stream-playlist.js tests/unit/commands/stream-playlist.test.js
git commit -m "feat: add stream-playlist handler with happy path"
```

---

## Task 5: Stream playlist handler — casi di errore E111 e E112

**Files:**
- Test: `tests/unit/commands/stream-playlist.test.js`

- [ ] **Step 1: Aggiungere i test per PLAYLIST_LOAD_FAILED e ORDINAL_OUT_OF_RANGE**

Aggiungi dentro `describe('stream-playlist handler', ...)`, dopo il `describe('playStreamItem — happy path', ...)`:

```javascript
describe('playStreamItem — error paths', () => {
  const command = {
    id: 'cmd-err',
    type: 'play_stream_item',
    payload: {
      url: 'https://stream.jw.org/6311-4713-5379-2156',
      ordinal: 3,
      session_id: 'session-err'
    }
  };

  it('should report E111 PLAYLIST_LOAD_FAILED when no tiles render', async () => {
    mockBrowserController._executeScript
      .mockResolvedValueOnce({ dismissed: false })
      .mockResolvedValueOnce({ ok: false, tileCount: 0, finalUrl: 'https://stream.jw.org/home' });

    await expect(streamPlaylist.playStreamItem(command, mockBrowserController))
      .rejects.toMatchObject({ code: 'E111' });

    expect(mockBrowserController.goToStandby).toHaveBeenCalled();
    expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'error',
        error_code: 'E111'
      })
    );
    expect(mediaHandler.startVideoEndedDetection).not.toHaveBeenCalled();
  });

  it('should report E112 ORDINAL_OUT_OF_RANGE when tiles fewer than ordinal', async () => {
    mockBrowserController._executeScript
      .mockResolvedValueOnce({ dismissed: true })
      .mockResolvedValueOnce({ ok: false, tileCount: 2, finalUrl: 'https://stream.jw.org/home' });

    await expect(streamPlaylist.playStreamItem(command, mockBrowserController))
      .rejects.toMatchObject({ code: 'E112' });

    expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'error',
        error_code: 'E112',
        error_message: expect.stringContaining('Ordinal 3 exceeds playlist length 2')
      })
    );
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare che passano (il codice esiste già dal Task 4)**

Run: `npx jest tests/unit/commands/stream-playlist.test.js -t "error paths"`
Expected: PASS 2/2.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/commands/stream-playlist.test.js
git commit -m "test: cover E111/E112 error paths for stream-playlist handler"
```

---

## Task 6: Stream playlist handler — casi di errore E110 e E113

**Files:**
- Test: `tests/unit/commands/stream-playlist.test.js`

- [ ] **Step 1: Aggiungere i test per STREAM_NAV_FAILED e VIDEO_START_FAILED**

Aggiungi dentro `describe('playStreamItem — error paths', ...)`, dopo il test E112:

```javascript
it('should report E110 STREAM_NAV_FAILED when navigateTo throws', async () => {
  mockBrowserController.navigateTo.mockRejectedValueOnce(new Error('DNS timeout'));

  await expect(streamPlaylist.playStreamItem(command, mockBrowserController))
    .rejects.toMatchObject({ code: 'E110' });

  expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'error',
      error_code: 'E110',
      error_message: expect.stringContaining('DNS timeout')
    })
  );
  expect(mockBrowserController._executeScript).not.toHaveBeenCalled();
});

it('should report E113 VIDEO_START_FAILED when video never becomes ready', async () => {
  mockBrowserController._executeScript
    .mockResolvedValueOnce({ dismissed: true })
    .mockResolvedValueOnce({ ok: true, tileCount: 4 })
    .mockResolvedValueOnce({ clicked: true })
    .mockResolvedValueOnce({ ok: false, readyState: 0 });

  await expect(streamPlaylist.playStreamItem(command, mockBrowserController))
    .rejects.toMatchObject({ code: 'E113' });

  expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'error',
      error_code: 'E113'
    })
  );
  expect(mediaHandler.startVideoEndedDetection).not.toHaveBeenCalled();
});

it('should report E113 VIDEO_START_FAILED when click returns clicked=false', async () => {
  mockBrowserController._executeScript
    .mockResolvedValueOnce({ dismissed: true })
    .mockResolvedValueOnce({ ok: true, tileCount: 4 })
    .mockResolvedValueOnce({ clicked: false });

  await expect(streamPlaylist.playStreamItem(command, mockBrowserController))
    .rejects.toMatchObject({ code: 'E113' });
});
```

- [ ] **Step 2: Eseguire i test per confermare il passaggio**

Run: `npx jest tests/unit/commands/stream-playlist.test.js -t "error paths"`
Expected: PASS 5/5 (i 2 precedenti + i 3 nuovi).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/commands/stream-playlist.test.js
git commit -m "test: cover E110/E113 error paths for stream-playlist handler"
```

---

## Task 7: Stream playlist handler — interazione con `stopMedia` e race con `stop_media`

**Files:**
- Test: `tests/unit/commands/stream-playlist.test.js`

- [ ] **Step 1: Aggiungere i test di integrazione con `stopMedia` esistente**

Aggiungi dentro `describe('stream-playlist handler', ...)`, dopo il blocco `describe('playStreamItem — error paths', ...)`:

```javascript
describe('playStreamItem — integration with media handler', () => {
  const command = {
    id: 'cmd-int',
    type: 'play_stream_item',
    payload: {
      url: 'https://stream.jw.org/6311-4713-5379-2156',
      ordinal: 1,
      session_id: 'session-int'
    }
  };

  it('should call mediaHandler.stopMedia if status is PLAYING at entry', async () => {
    stateManager.currentMedia = {
      url: 'https://www.jw.org/previous',
      media_type: 'video'
    };
    stateManager.status = STATUS.PLAYING;

    mockBrowserController._executeScript
      .mockResolvedValueOnce({ dismissed: true })
      .mockResolvedValueOnce({ ok: true, tileCount: 4 })
      .mockResolvedValueOnce({ clicked: true })
      .mockResolvedValueOnce({ ok: true, readyState: 4, duration: 1000 })
      .mockResolvedValueOnce({ hooksInstalled: true });

    await streamPlaylist.playStreamItem(command, mockBrowserController);

    expect(mediaHandler.stopMedia).toHaveBeenCalledTimes(1);
    expect(mediaHandler.stopMedia).toHaveBeenCalledWith(command, mockBrowserController);
  });

  it('should NOT call mediaHandler.stopMedia if status is already IDLE', async () => {
    mockBrowserController._executeScript
      .mockResolvedValueOnce({ dismissed: true })
      .mockResolvedValueOnce({ ok: true, tileCount: 4 })
      .mockResolvedValueOnce({ clicked: true })
      .mockResolvedValueOnce({ ok: true, readyState: 4, duration: 1000 })
      .mockResolvedValueOnce({ hooksInstalled: true });

    await streamPlaylist.playStreamItem(command, mockBrowserController);

    expect(mediaHandler.stopMedia).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il passaggio**

Run: `npx jest tests/unit/commands/stream-playlist.test.js -t "integration with media"`
Expected: PASS 2/2.

- [ ] **Step 3: Eseguire l'intera suite unit per confermare nessuna regressione**

Run: `npx jest tests/unit/`
Expected: tutti i test passano.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/commands/stream-playlist.test.js
git commit -m "test: cover stream-playlist integration with media stopMedia"
```

---

## Task 8: Main.js — registrare il nuovo handler

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Importare il nuovo handler e iniettare apiClient**

In `src/main.js`, funzione `registerHandlers()`, aggiungere subito dopo `const logsHandler = require('./commands/handlers/logs');`:

```javascript
  const streamPlaylistHandler = require('./commands/handlers/stream-playlist');
```

E subito dopo `mediaHandler.setApiClient(apiClient);` aggiungere:

```javascript
  streamPlaylistHandler.setApiClient(apiClient);
```

- [ ] **Step 2: Registrare il command handler**

In `src/main.js`, funzione `registerHandlers()`, dopo la riga:
```javascript
  commandManager.registerHandler('play_media', mediaHandler.playMedia);
```
aggiungere:
```javascript
  commandManager.registerHandler('play_stream_item', streamPlaylistHandler.playStreamItem);
```

- [ ] **Step 3: Avviare il processo in modalità dev per verificare lo startup**

Prerequisito: `config/config.json` locale già configurato per `dev:mac` (vedi `docs/dev-macos.md`) e backend Onesiforo attivo su `onesiforo.test`.

Run: `npm run dev:mac`

Expected (primi log dopo l'avvio, entro 5 s):
- `info: Configuration loaded successfully`
- `info: HTTP server started { port: 3000 }`
- `info: Browser controller initialized { mode: 'playwright' }`
- Nessun errore su `play_stream_item` o `streamPlaylistHandler`.

Interrompere con Ctrl+C. Expected: `info: Shutting down { signal: 'SIGINT' }` senza stack trace.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: register play_stream_item handler in main"
```

---

## Task 9: Documentazione smoke test in `docs/dev-macos.md`

**Files:**
- Modify: `docs/dev-macos.md`

- [ ] **Step 1: Aggiungere una nuova sottosezione dopo `## Smoke test manuale`**

Apri `docs/dev-macos.md`. Individua la sezione `## Smoke test manuale` e, subito dopo il blocco esistente (prima della sezione `## Troubleshooting`), aggiungi:

````markdown
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

### Cosa NON funziona

Oltre a quanto già elencato in questo documento, `play_stream_item` è soggetto a:

- **DOM changes di JW Stream**: se JW ridisegna la SPA togliendo la classe `MuiCardActionArea-root`, il comando fallisce con `E111 PLAYLIST_LOAD_FAILED`. Richiede aggiornamento firmware.
- **Share link privati**: URL che richiedono login JW (account personale) non sono supportati. Questo design copre solo link di condivisione pubblica.
````

- [ ] **Step 2: Verificare che il markdown sia ben formato**

Run: `npx markdownlint docs/dev-macos.md 2>&1 || true`
(Se markdownlint non è installato, è ok: è un check opzionale.)

Apri il file e controlla visivamente che non ci siano errori di indentazione o blocchi code non chiusi.

- [ ] **Step 3: Commit**

```bash
git add docs/dev-macos.md
git commit -m "docs: add smoke test procedure for play_stream_item"
```

---

## Task 10: Smoke test manuale end-to-end

**Files:** nessuna modifica di file — verifica funzionale.

Prerequisito: backend Onesiforo Web attivo su `onesiforo.test` con endpoint per inviare comandi `play_stream_item` (potrebbe richiedere aggiornamento lato server — coordinare con `onesiforo-web`).

- [ ] **Step 1: Avviare OnesiBox in dev mode**

Run: `npm run dev:mac`

Attendi che compaia `info: OnesiBox ready`.

- [ ] **Step 2: Eseguire il flusso completo documentato in `docs/dev-macos.md`**

Segui tutti e 7 i passi della sezione "Smoke test `play_stream_item`" appena aggiunta. Per ciascuno: verifica che log e UI corrispondano a quanto atteso.

- [ ] **Step 3: Annotare eventuali problemi**

Se uno dei passi non funziona:
- Se è un bug nel handler → fix + test aggiuntivo in `stream-playlist.test.js` + nuovo commit.
- Se è un problema di DOM imprevisto (es. selettore non trova i tile) → dump della pagina via `document.body.innerHTML.slice(0, 2000)` dalla DevTools, analisi, fix.
- Se è lato backend (manca un endpoint per inviare il comando) → non è bloccante per questo PR, ma da tracciare per il team `onesiforo-web`.

- [ ] **Step 4: Se tutto passa, nessun commit aggiuntivo**

Se l'handler funziona senza modifiche, chiudere questo task senza altro commit.

---

## Self-review notes (completata prima del commit del plan)

- Copertura spec: ogni sezione del design doc ha almeno un task (contratto/whitelist → Task 1/3, architettura/handler → Task 4/8, data flow happy path → Task 4, error handling → Task 5/6, testing → Task 4-7, smoke test → Task 9/10).
- Placeholder: nessun "TBD", "implementa dopo", o step senza codice concreto.
- Coerenza dei nomi: `playStreamItem`, `setApiClient`, `stream-playlist.js`, `TILE_SELECTOR = button.MuiCardActionArea-root`, codici E110-E113 → usati consistentemente tra validator, handler, test, docs.
