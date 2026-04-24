# OnesiBox Diagnostic Screenshots — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il lato client (Node.js daemon su Raspberry Pi) della diagnostica screenshot: cattura Wayland via `grim | cwebp`, scheduler autonomo pilotato dalla response heartbeat, upload WebP al server come multipart.

**Architecture:** Terzo `setInterval` (oltre a heartbeat e polling) che esegue una pipeline shell `grim | cwebp` via `child_process.spawn`, bufferizza l'output WebP in memoria e lo invia al server via `ApiClient` con `multipart/form-data`. Il componente riceve config (enabled, interval) dalla risposta dell'heartbeat e si riconfigura a caldo. Nessuna coda/persistenza locale degli screenshot: dato effimero.

**Tech Stack:** Node.js 20 LTS, Jest 30 (CommonJS), axios, form-data (transitivo), pacchetti Debian `grim` + `webp` installati via `install.sh`.

**Spec di riferimento:** `../../onesiforo/docs/superpowers/specs/2026-04-24-onesibox-diagnostic-screenshots-design.md` (copia anche disponibile in `onesiforo` repo).

**Precondizione:** il piano server in `onesiforo/docs/superpowers/plans/2026-04-24-onesibox-diagnostic-screenshots.md` deve aver completato **almeno la Fase A** (endpoint `/api/v1/appliances/screenshot` operativo, `HeartbeatResource` estesa con i due nuovi campi). Senza questo, il daemon non ha niente a cui parlare.

---

## Fase A — Dipendenze di sistema e configurazione

### Task 1: Aggiungere `grim` e `webp` a `install.sh`

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Individuare la sezione `apt-get install`**

Localizzare in `install.sh` la lista di pacchetti installati via `apt-get install` (probabilmente sezione "Dipendenze di sistema" / "Installazione pacchetti").

- [ ] **Step 2: Aggiungere i due pacchetti**

Modificare la lista di pacchetti per includere `grim` e `webp` (il pacchetto `webp` su Debian fornisce `cwebp`). Esempio (adattare al formato esatto dello script):

```bash
# prima:
apt-get install -y --no-install-recommends \
    curl wget git jq nodejs npm chromium ...

# dopo:
apt-get install -y --no-install-recommends \
    curl wget git jq nodejs npm chromium \
    grim webp ...
```

- [ ] **Step 3: Verificare la sintassi dello script**

Run: `bash -n install.sh`
Expected: nessun output (sintassi valida).

- [ ] **Step 4: Verificare che i binari esistano in modo atteso su Debian trixie**

Fare una ricerca documentale breve (ipotesi già validata in design): pacchetti `grim` e `webp` sono in repository Debian standard di trixie. Non serve testarli localmente su macOS.

- [ ] **Step 5: Commit**

```bash
git add install.sh
git commit -m "feat(install): add grim and webp for diagnostic screenshots"
```

---

### Task 2: Aggiungere config nuovi campi + validation

**Files:**
- Modify: `src/config/config.js`
- Modify: `config/config.json.example`
- Create: `tests/unit/config/screenshot-config.test.js`

- [ ] **Step 1: Scrivere il test di validation**

```javascript
const { validateConfig } = require('../../../src/config/config');

describe('screenshot config validation', () => {
  const baseValid = {
    server_url: 'https://onesiforo.example.com',
    appliance_id: '00000000-0000-0000-0000-000000000000',
    appliance_token: 'token',
    polling_interval_seconds: 5,
    heartbeat_interval_seconds: 30,
    default_volume: 80,
    device_name: 'Test',
  };

  it('accepts valid screenshot_enabled and screenshot_interval_seconds', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_enabled: true,
      screenshot_interval_seconds: 60,
    })).not.toThrow();
  });

  it('accepts missing screenshot fields (defaults are applied upstream)', () => {
    expect(() => validateConfig(baseValid)).not.toThrow();
  });

  it('rejects screenshot_interval_seconds below 10', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_interval_seconds: 5,
    })).toThrow(/screenshot_interval_seconds/);
  });

  it('rejects screenshot_interval_seconds above 3600', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_interval_seconds: 7200,
    })).toThrow(/screenshot_interval_seconds/);
  });

  it('rejects non-boolean screenshot_enabled', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_enabled: 'yes',
    })).toThrow(/screenshot_enabled/);
  });
});
```

- [ ] **Step 2: Eseguire (fallisce — validation non copre i nuovi campi)**

Run: `npx jest tests/unit/config/screenshot-config.test.js`
Expected: FAIL sui test che si aspettano rejection (la validation attuale accetta qualunque valore).

- [ ] **Step 3: Estendere `validateConfig` in `src/config/config.js`**

Localizzare la funzione `validateConfig` (linee ~52-109 secondo recon). Aggiungere dopo le validazioni esistenti:

```javascript
if (config.screenshot_enabled !== undefined && typeof config.screenshot_enabled !== 'boolean') {
  throw new Error('Invalid config: screenshot_enabled must be a boolean');
}

if (config.screenshot_interval_seconds !== undefined) {
  const s = Number(config.screenshot_interval_seconds);
  if (!Number.isInteger(s) || s < 10 || s > 3600) {
    throw new Error('Invalid config: screenshot_interval_seconds must be an integer between 10 and 3600');
  }
}
```

Inoltre, localizzare la mappatura env var (linee ~13-26) e aggiungere:

```javascript
const envOverrides = {
  // ...esistenti...
  screenshot_enabled: process.env.ONESIBOX_SCREENSHOT_ENABLED,
  screenshot_interval_seconds: process.env.ONESIBOX_SCREENSHOT_INTERVAL,
};
```

Nel parsing numerici (linee ~38-42) assicurarsi che `screenshot_interval_seconds` venga convertita in int. Nel parsing boolean (se presente), convertire `'true'/'false'` per `screenshot_enabled`.

- [ ] **Step 4: Aggiungere default nel `config.json.example`**

In `config/config.json.example` aggiungere dopo gli altri campi:

```json
{
  "screenshot_enabled": true,
  "screenshot_interval_seconds": 60
}
```

Mantenere sintassi JSON valida (virgola prima se ci sono altri campi dopo, ecc.).

- [ ] **Step 5: Rieseguire il test**

Run: `npx jest tests/unit/config/screenshot-config.test.js`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/config.js config/config.json.example tests/unit/config/screenshot-config.test.js
git commit -m "feat(config): validate screenshot_enabled and screenshot_interval_seconds"
```

---

## Fase B — Modulo di cattura

### Task 3: Helper `capture.js` — wrapper su `grim | cwebp`

**Files:**
- Create: `src/diagnostics/capture.js`
- Create: `tests/unit/diagnostics/capture.test.js`

- [ ] **Step 1: Scrivere i test con `child_process.spawn` mockato**

```javascript
const { EventEmitter } = require('events');

jest.mock('child_process');
const { spawn } = require('child_process');

const { captureScreen } = require('../../../src/diagnostics/capture');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn(), write: jest.fn() };
  child.pid = 12345;
  child.kill = jest.fn();
  return child;
}

describe('captureScreen', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('pipes grim output to cwebp and resolves with the WebP buffer', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ quality: 75, timeoutMs: 5000 });

    // Simula output dal cwebp
    setImmediate(() => {
      cwebp.stdout.emit('data', Buffer.from([0x52, 0x49, 0x46, 0x46])); // 'RIFF'
      cwebp.stdout.emit('data', Buffer.from([0x00, 0x00, 0x00, 0x00]));
      cwebp.emit('close', 0);
      grim.emit('close', 0);
    });

    const result = await promise;
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(8);
  });

  it('rejects if grim exits with non-zero', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ timeoutMs: 5000 });

    setImmediate(() => {
      grim.stderr.emit('data', Buffer.from('grim error'));
      grim.emit('close', 1);
      cwebp.emit('close', 1);
    });

    await expect(promise).rejects.toThrow(/grim/);
  });

  it('rejects with ENOENT when spawn throws', async () => {
    spawn.mockImplementationOnce(() => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    await expect(captureScreen({ timeoutMs: 5000 })).rejects.toThrow(/ENOENT/);
  });

  it('kills children and rejects on timeout', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ timeoutMs: 50 });
    // do not emit close → trigger timeout

    await expect(promise).rejects.toThrow(/timeout/i);
    expect(grim.kill).toHaveBeenCalled();
    expect(cwebp.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire (fallisce — helper non esiste)**

Run: `npx jest tests/unit/diagnostics/capture.test.js`
Expected: FAIL — `Cannot find module '../../../src/diagnostics/capture'`.

- [ ] **Step 3: Creare l'helper**

```javascript
const { spawn } = require('child_process');
const os = require('os');

function detectWaylandEnv() {
  const uid = (process.getuid ? process.getuid() : 0);
  return {
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
  };
}

function captureScreen({ quality = 75, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let grim, cwebp;
    const env = { ...process.env, ...detectWaylandEnv() };

    try {
      grim = spawn('grim', ['-t', 'ppm', '-'], { env });
      cwebp = spawn('cwebp', ['-q', String(quality), '-o', '-', '-'], { env });
    } catch (err) {
      return reject(new Error(`spawn failed: ${err.code || err.message}`));
    }

    const chunks = [];
    let grimErr = Buffer.alloc(0);
    let cwebpErr = Buffer.alloc(0);
    let grimClosed = false;
    let cwebpClosed = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { grim.kill('SIGKILL'); } catch (_) {}
      try { cwebp.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`capture timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    grim.stdout.on('data', (d) => {
      try { cwebp.stdin.write(d); } catch (_) { /* cwebp may have died */ }
    });
    grim.stderr.on('data', (d) => { grimErr = Buffer.concat([grimErr, d]); });
    grim.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { cwebp.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`grim spawn error: ${err.code || err.message}`));
    });
    grim.on('close', (code) => {
      grimClosed = true;
      try { cwebp.stdin.end(); } catch (_) {}
      if (code !== 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        try { cwebp.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`grim exited with code ${code}: ${grimErr.toString()}`));
      }
    });

    cwebp.stdout.on('data', (d) => { chunks.push(d); });
    cwebp.stderr.on('data', (d) => { cwebpErr = Buffer.concat([cwebpErr, d]); });
    cwebp.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { grim.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`cwebp spawn error: ${err.code || err.message}`));
    });
    cwebp.on('close', (code) => {
      cwebpClosed = true;
      if (settled) return;
      if (code !== 0) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cwebp exited with code ${code}: ${cwebpErr.toString()}`));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

module.exports = { captureScreen };
```

**NOTA PER L'EXECUTOR:** verificare la compatibilità del pipe stdin. Se l'approccio con `cwebp.stdin.write(d)` dà problemi di backpressure in produzione, considerare `grim.stdout.pipe(cwebp.stdin)` — il test resta valido.

- [ ] **Step 4: Rieseguire i test**

Run: `npx jest tests/unit/diagnostics/capture.test.js`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/capture.js tests/unit/diagnostics/capture.test.js
git commit -m "feat(diagnostics): add captureScreen helper (grim | cwebp pipeline)"
```

---

### Task 4: Estendere `ApiClient` con `uploadScreenshot`

**Files:**
- Modify: `src/communication/api-client.js`
- Create: `tests/unit/communication/upload-screenshot.test.js`

- [ ] **Step 1: Ispezionare `ApiClient` per identificare il pattern**

Leggere `src/communication/api-client.js` (~211 righe secondo recon). Individuare:
- Come è strutturato il client axios (linee 36-46).
- Come sono definiti i metodi pubblici (es. `sendHeartbeat`, `fetchCommands`).
- Come viene gestito il return in caso di 401/403 (authFailed flag).

- [ ] **Step 2: Scrivere il test**

```javascript
jest.mock('axios');
const axios = require('axios');

const ApiClient = require('../../../src/communication/api-client');

describe('ApiClient.uploadScreenshot', () => {
  let client;
  let mockAxiosInstance;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ status: 201, data: { id: 42 } }),
      interceptors: { response: { use: jest.fn() } },
    };
    axios.create.mockReturnValue(mockAxiosInstance);

    client = new ApiClient({
      server_url: 'https://example.com',
      appliance_token: 'tok',
    });
  });

  it('posts multipart with captured_at, width, height, screenshot buffer', async () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF
    const capturedAt = new Date('2026-04-24T14:32:11Z');

    const result = await client.uploadScreenshot({
      capturedAt,
      width: 1920,
      height: 1080,
      buffer: buf,
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, form, options] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe('/appliances/screenshot');
    expect(options.headers['Content-Type']).toMatch(/multipart\/form-data/);
    expect(result).toEqual({ id: 42 });
  });

  it('rejects buffers larger than 2MB locally without sending', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(
      client.uploadScreenshot({
        capturedAt: new Date(),
        width: 1920,
        height: 1080,
        buffer: big,
      })
    ).rejects.toThrow(/too large/);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Eseguire (fallisce — metodo non esiste)**

Run: `npx jest tests/unit/communication/upload-screenshot.test.js`
Expected: FAIL.

- [ ] **Step 4: Aggiungere il metodo `uploadScreenshot` all'`ApiClient`**

In `src/communication/api-client.js` aggiungere in cima al file:

```javascript
const FormData = require('form-data');
```

E aggiungere il metodo alla classe (dopo gli altri metodi pubblici):

```javascript
async uploadScreenshot({ capturedAt, width, height, buffer }) {
  const MAX_BYTES = 2 * 1024 * 1024;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('uploadScreenshot: buffer required');
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`uploadScreenshot: buffer too large (${buffer.length} bytes)`);
  }

  const form = new FormData();
  form.append('captured_at', capturedAt.toISOString());
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('screenshot', buffer, {
    filename: 'screenshot.webp',
    contentType: 'image/webp',
  });

  const response = await this.axios.post(
    '/appliances/screenshot',
    form,
    { headers: form.getHeaders() }
  );

  return response.data;
}
```

**NOTA PER L'EXECUTOR:** il nome della property axios nella classe (`this.axios` nel codice sopra) va allineato a come è effettivamente salvata l'istanza nell'`ApiClient` esistente (es. `this.client`, `this.http`). Verificare leggendo il costruttore.

- [ ] **Step 5: Rieseguire**

Run: `npx jest tests/unit/communication/upload-screenshot.test.js`
Expected: 2 PASS.

- [ ] **Step 6: Verificare che i test esistenti dell'`ApiClient` passino ancora**

Run: `npx jest tests/unit/communication/`
Expected: tutti PASS.

- [ ] **Step 7: Commit**

```bash
git add src/communication/api-client.js tests/unit/communication/upload-screenshot.test.js
git commit -m "feat(api-client): add uploadScreenshot multipart method"
```

---

### Task 5: `ScreenshotScheduler` — lifecycle

**Files:**
- Create: `src/diagnostics/screenshot-scheduler.js`
- Create: `tests/unit/diagnostics/screenshot-scheduler.test.js`

- [ ] **Step 1: Scrivere i test di lifecycle + applyServerConfig**

```javascript
jest.useFakeTimers();

const mockCapture = jest.fn();
jest.mock('../../../src/diagnostics/capture', () => ({
  captureScreen: (...args) => mockCapture(...args),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockApiClient = {
  uploadScreenshot: jest.fn().mockResolvedValue({ id: 1 }),
  getThrottleStatus: jest.fn().mockReturnValue({ allowed: true }),
};

const ScreenshotScheduler = require('../../../src/diagnostics/screenshot-scheduler');

describe('ScreenshotScheduler', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllTimers();
    mockCapture.mockReset();
    mockCapture.mockResolvedValue(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    mockApiClient.uploadScreenshot.mockClear();

    scheduler = new ScreenshotScheduler({
      apiClient: mockApiClient,
      logger: mockLogger,
      config: { screenshot_enabled: true, screenshot_interval_seconds: 60 },
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('does not fire before start()', () => {
    jest.advanceTimersByTime(120000);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('fires every interval once started', async () => {
    scheduler.start();

    jest.advanceTimersByTime(60000);
    await Promise.resolve(); // let the promise chain run
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('stop() halts further ticks', () => {
    scheduler.start();
    jest.advanceTimersByTime(60000);
    scheduler.stop();
    jest.advanceTimersByTime(120000);
    // calls prior to stop are ok; the key is no new calls happen after stop
    const callsBefore = mockCapture.mock.calls.length;
    jest.advanceTimersByTime(60000);
    expect(mockCapture.mock.calls.length).toBe(callsBefore);
  });

  it('applyServerConfig with new interval restarts the timer', async () => {
    scheduler.start();
    jest.advanceTimersByTime(30000);

    scheduler.applyServerConfig({ enabled: true, intervalSeconds: 20 });
    jest.advanceTimersByTime(20000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('applyServerConfig with enabled=false stops the scheduler', () => {
    scheduler.start();
    scheduler.applyServerConfig({ enabled: false, intervalSeconds: 60 });
    const callsBefore = mockCapture.mock.calls.length;
    jest.advanceTimersByTime(180000);
    expect(mockCapture.mock.calls.length).toBe(callsBefore);
  });

  it('applyServerConfig with enabled=true starts the scheduler if stopped', async () => {
    scheduler.applyServerConfig({ enabled: false, intervalSeconds: 60 });
    expect(mockCapture).not.toHaveBeenCalled();

    scheduler.applyServerConfig({ enabled: true, intervalSeconds: 60 });
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Eseguire (fallisce — classe non esiste)**

Run: `npx jest tests/unit/diagnostics/screenshot-scheduler.test.js`
Expected: FAIL.

- [ ] **Step 3: Creare lo scheduler**

```javascript
class ScreenshotScheduler {
  constructor({ apiClient, logger, config }) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.enabled = config.screenshot_enabled !== false;
    this.intervalSeconds = config.screenshot_interval_seconds || 60;

    this.timer = null;
    this.isCapturing = false;
    this.envErrorLogged = false;
  }

  start() {
    if (this.timer || !this.enabled) return;
    this._scheduleNext();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  applyServerConfig({ enabled, intervalSeconds }) {
    const wasEnabled = this.enabled;
    const prevInterval = this.intervalSeconds;

    if (typeof enabled === 'boolean') {
      this.enabled = enabled;
    }
    if (Number.isInteger(intervalSeconds) && intervalSeconds >= 10 && intervalSeconds <= 3600) {
      this.intervalSeconds = intervalSeconds;
    }

    if (!this.enabled && this.timer) {
      this.stop();
      return;
    }
    if (this.enabled && !wasEnabled) {
      this.envErrorLogged = false;
      this.start();
      return;
    }
    if (this.enabled && this.intervalSeconds !== prevInterval && this.timer) {
      this.stop();
      this.start();
    }
  }

  _scheduleNext() {
    const ms = this.intervalSeconds * 1000;
    this.timer = setInterval(() => this._tick(), ms);
  }

  async _tick() {
    if (this.isCapturing) {
      this.logger.warn('screenshot: previous tick still running, skipping');
      return;
    }
    this.isCapturing = true;
    const capturedAt = new Date();

    try {
      const { captureScreen } = require('./capture');
      const buffer = await captureScreen({ quality: 75, timeoutMs: 8000 });

      if (buffer.length > 2 * 1024 * 1024) {
        this.logger.warn(`screenshot: buffer too large (${buffer.length}), skipping upload`);
        return;
      }

      await this.apiClient.uploadScreenshot({
        capturedAt,
        width: 1920,
        height: 1080,
        buffer,
      });
    } catch (err) {
      if (err.code === 'ENOENT' || /ENOENT/.test(err.message)) {
        if (!this.envErrorLogged) {
          this.logger.error('screenshot: grim or cwebp not found (ENOENT), disabling until config refresh', { err: err.message });
          this.envErrorLogged = true;
        }
        this.stop();
        return;
      }
      if (/timeout/i.test(err.message)) {
        this.logger.warn('screenshot: capture timed out, skipping tick');
        return;
      }
      this.logger.warn('screenshot: upload failed, dropping', { err: err.message });
    } finally {
      this.isCapturing = false;
    }
  }
}

module.exports = ScreenshotScheduler;
```

- [ ] **Step 4: Rieseguire i test**

Run: `npx jest tests/unit/diagnostics/screenshot-scheduler.test.js`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/screenshot-scheduler.js tests/unit/diagnostics/screenshot-scheduler.test.js
git commit -m "feat(diagnostics): add ScreenshotScheduler with server-driven lifecycle"
```

---

### Task 6: Error handling — ENOENT e HTTP failure non-fatali

**Files:**
- Modify: `tests/unit/diagnostics/screenshot-scheduler.test.js`

- [ ] **Step 1: Aggiungere i test**

Appendere al file del Task 5:

```javascript
describe('ScreenshotScheduler error handling', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllTimers();
    mockCapture.mockReset();
    mockApiClient.uploadScreenshot.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();

    scheduler = new ScreenshotScheduler({
      apiClient: mockApiClient,
      logger: mockLogger,
      config: { screenshot_enabled: true, screenshot_interval_seconds: 60 },
    });
  });

  afterEach(() => scheduler.stop());

  it('on ENOENT logs error once and disables scheduler', async () => {
    const err = new Error('grim ENOENT');
    err.code = 'ENOENT';
    mockCapture.mockRejectedValue(err);

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    // further ticks must not happen
    const errorCallsBefore = mockLogger.error.mock.calls.length;
    jest.advanceTimersByTime(300000);
    expect(mockLogger.error.mock.calls.length).toBe(errorCallsBefore);
  });

  it('on HTTP 5xx logs warn and continues', async () => {
    mockCapture.mockResolvedValue(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    mockApiClient.uploadScreenshot.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    mockApiClient.uploadScreenshot.mockResolvedValueOnce({ id: 99 });

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/upload failed/),
      expect.any(Object)
    );

    jest.advanceTimersByTime(60000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mockApiClient.uploadScreenshot).toHaveBeenCalledTimes(2);
  });

  it('does not overlap two ticks', async () => {
    let resolve;
    mockCapture.mockImplementation(() => new Promise(r => { resolve = r; }));

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    // second tick scheduled but first is still pending
    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/previous tick still running/)
    );

    resolve(Buffer.from([0x52]));
  });
});
```

- [ ] **Step 2: Eseguire — i test devono passare con la logica esistente del Task 5**

Run: `npx jest tests/unit/diagnostics/screenshot-scheduler.test.js`
Expected: tutti PASS (lifecycle + error handling).

Se qualcosa non passa per dettagli di timing (Promise ticks), affinare il `await Promise.resolve()` count. Non cambiare la logica dello scheduler senza motivo.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/diagnostics/screenshot-scheduler.test.js
git commit -m "test(diagnostics): cover ENOENT disable, 5xx continue, no overlap"
```

---

## Fase C — Integrazione

### Task 7: Istanziare `ScreenshotScheduler` in `main.js` e propagare config dal heartbeat

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Ispezionare `main.js` per capire dove si istanziano heartbeat/polling scheduler**

Individuare (linee ~365 e ~427 secondo recon) dove sono creati gli `setInterval` per polling e heartbeat.

- [ ] **Step 2: Istanziare lo scheduler**

In `main.js`, subito dopo la creazione di `apiClient`:

```javascript
const ScreenshotScheduler = require('./diagnostics/screenshot-scheduler');
// ...
const screenshotScheduler = new ScreenshotScheduler({
  apiClient,
  logger,
  config,
});
screenshotScheduler.start();
```

- [ ] **Step 3: Agganciare la response heartbeat**

Localizzare la funzione che gestisce l'intervallo heartbeat (linea ~427). Nel punto in cui si riceve `res` (la response) dopo l'`await apiClient.sendHeartbeat(...)`, aggiungere:

```javascript
// subito dopo la response positiva del heartbeat:
if (res && typeof res === 'object') {
  // i due campi possono essere top-level o dentro res.data a seconda di HeartbeatResource
  const payload = res.data || res;
  screenshotScheduler.applyServerConfig({
    enabled: payload.screenshot_enabled,
    intervalSeconds: payload.screenshot_interval_seconds,
  });
}
```

**NOTA PER L'EXECUTOR:** verificare il formato esatto di `res` dall'heartbeat lato client (guardare come oggi vengono letti i campi di risposta, se esistono). Se la response è `res.data.foo` nel resto del codice, usare `res.data.screenshot_enabled`.

- [ ] **Step 4: Gestire shutdown pulito**

Localizzare i signal handlers esistenti (SIGTERM/SIGINT). Aggiungere:

```javascript
process.on('SIGTERM', () => { screenshotScheduler.stop(); /* ... */ });
process.on('SIGINT',  () => { screenshotScheduler.stop(); /* ... */ });
```

(Appendere al chain esistente, non sovrascrivere handler preesistenti.)

- [ ] **Step 5: Verificare che `npm test` passi tutto**

Run: `npm test`
Expected: tutti i test verdi (nuovi + preesistenti).

- [ ] **Step 6: Verificare il lint se configurato**

Run: `npm run lint` (se presente) — fix se necessario.
Expected: zero errori.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(main): wire ScreenshotScheduler and propagate heartbeat config"
```

---

## Fase D — Validazione su box reale

### Task 8: Smoke test su Raspberry Pi di staging

**Files:**
- Nessuna modifica codice. Validazione manuale.

- [ ] **Step 1: Precondizioni**

- Server onesiforo in staging con endpoint `/api/v1/appliances/screenshot` operativo (Fase A del piano server completata).
- Una OnesiBox di test con token valido.
- Accesso SSH alla box.

- [ ] **Step 2: Deploy del codice aggiornato**

```bash
ssh admin@<box-ip>
cd /opt/onesibox
sudo git pull
sudo apt-get install -y grim webp
sudo systemctl restart onesibox
```

- [ ] **Step 3: Verifica binari**

```bash
which grim
which cwebp
WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) grim -t ppm - | cwebp -q 75 -o /tmp/test.webp -
file /tmp/test.webp
```

Expected: `RIFF (little-endian) data, Web/P image`.

- [ ] **Step 4: Verifica log del daemon**

```bash
journalctl -u onesibox -f | grep -E 'screenshot|capture'
```

Expected: ogni 60s voce di log positiva (niente error su ENOENT, niente timeout).

- [ ] **Step 5: Verifica sul server**

Nel pannello Filament `/admin/onesi-boxes/{id}/screenshots` devono comparire le immagini. Upload frequency ≈ 1/min.

- [ ] **Step 6: Verifica propagazione config**

Dal pannello Filament cambiare `screenshot_interval_seconds` a 30. Attendere il prossimo heartbeat. Verificare via `journalctl -u onesibox -f` che il log del tick avvenga ora ogni 30s.

- [ ] **Step 7: Verifica spegnimento**

Dal pannello Filament toggle OFF. Attendere un heartbeat. Verificare che nei log non appaiano più tick screenshot.

- [ ] **Step 8: Rollback test**

Riaccendere. Verificare ripresa.

- [ ] **Step 9: Nessun commit (è validazione). Fine del piano.**

---

## Coverage spec vs piano

| Sezione spec | Task che la implementa |
|---|---|
| §5.1 deps di sistema | Task 1 |
| §5.2 modulo scheduler | Task 5 |
| §5.3 capture pipeline | Task 3 |
| §5.4 invio multipart | Task 4 |
| §5.5 error handling | Task 5, 6 |
| §5.6 config locale + env var | Task 2 |
| §2.e (runtime config da heartbeat) | Task 7 |
| §11.2 testing box-side | Task 3, 4, 5, 6 |
| §12 deployment box | Task 1, 8 |

## Dipendenze esterne

- `grim` (pacchetto Debian) — screenshot Wayland.
- `webp` (pacchetto Debian) — `cwebp` compression.
- `form-data` (npm) — già transitivo di axios, nessuna installazione esplicita.

Nessuna nuova dipendenza npm da installare.
