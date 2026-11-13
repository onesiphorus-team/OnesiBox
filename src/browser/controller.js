const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const LOCAL_PORT = process.env.PORT || 3000;
const STANDBY_URL = `http://localhost:${LOCAL_PORT}`;
const LOCAL_URL_PREFIX = `http://localhost:${LOCAL_PORT}/`;
const DATA_DIR = process.env.ONESIBOX_DATA_DIR || '/opt/onesibox/data';
const IS_DEV_MODE = process.env.ONESIBOX_DEV_MODE === '1';

// Find system Chromium executable
function findChromiumPath() {
  if (process.env.CHROMIUM_BIN) {
    try {
      fs.accessSync(process.env.CHROMIUM_BIN, fs.constants.X_OK);
      return process.env.CHROMIUM_BIN;
    } catch {
      // Env var set but path invalid, continue to fallbacks
    }
  }

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

  for (const p of paths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Check if URL is a local application URL (localhost:3000)
 */
function isLocalUrl(url) {
  return url === STANDBY_URL || url.startsWith(LOCAL_URL_PREFIX);
}

/**
 * Controls the Chromium browser for media playback and navigation.
 * Uses direct process spawn for basic navigation, Playwright for advanced control.
 *
 * SECURITY: All URLs are validated before navigation.
 */
class BrowserController {
  constructor() {
    this.currentUrl = STANDBY_URL;
    this.browserProcess = null;
    this.playwrightContext = null;
    this.page = null;
    this.isInitialized = false;
    this.usePlaywright = false; // Will try Playwright first, fall back to spawn
    this.chromiumPath = null;
    this.launchArgs = [];
    // Mutex: una sola inizializzazione e un solo recovery alla volta. La sera
    // del 14/08/2026 sette recovery concorrenti (screenshot, navigazioni e
    // eventi crash in parallelo, ciascuno convinto che il browser mancasse)
    // hanno lanciato sette Chromium sullo stesso profilo: "Opening in existing
    // browser session" a raffica, pkill incrociati e GPU di sistema
    // compromessa proprio nei minuti del join di Zoom.
    this._initPromise = null;
    this._recoveryPromise = null;
  }

  /**
   * Initialize the browser on startup.
   *
   * Rientrante: le chiamate concorrenti si accodano alla stessa Promise
   * invece di avviare ciascuna il proprio browser.
   */
  async initialize() {
    if (this.isInitialized) {
      logger.debug('Browser already initialized');
      return;
    }

    if (this._initPromise) {
      logger.info('Initialization already in progress, joining it');
      return this._initPromise;
    }

    this._initPromise = this._doInitialize();
    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _doInitialize() {
    logger.info('Initializing browser controller');

    // Detect display server
    const isWayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
    logger.info('Display server detected', { isWayland, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY });

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
        '--password-store=basic',
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
        '--password-store=basic',
      ];
    }

    if (isWayland) {
      this.launchArgs.push(
        '--ozone-platform=wayland',
        '--enable-features=UseOzonePlatform'
      );
      logger.info('Added Wayland-specific browser flags');
    }

    // Try Playwright with bundled browser first (better for Zoom control)
    try {
      await this._initPlaywright();
      this.usePlaywright = true;
      logger.info('Using Playwright mode');
    } catch (playwrightError) {
      logger.warn('Playwright failed, falling back to direct spawn', { error: playwrightError.message });
      this.usePlaywright = false;

      // Fall back to direct spawn
      this.chromiumPath = findChromiumPath();
      if (!this.chromiumPath) {
        throw new Error('No browser available');
      }
      await this._launchBrowserDirect(STANDBY_URL);
    }

    this.isInitialized = true;
    logger.info('Browser controller initialized', { mode: this.usePlaywright ? 'playwright' : 'spawn' });
  }

  /**
   * Initialize using Playwright with system Chromium (for video codec support)
   */
  async _initPlaywright() {
    // Use system Chromium for proper video codec support (H.264/MP4)
    // Playwright's bundled Chromium lacks proprietary codecs on Linux
    this.chromiumPath = findChromiumPath();

    const launchOptions = {
      headless: false,
      args: this.launchArgs,
      // `--disable-dev-shm-usage` è un default di Playwright pensato per i
      // container Docker con /dev/shm da 64MB: sposta la shared memory di
      // Chromium su disco. Qui il disco è una microSD e /dev/shm ha 1.9GB,
      // quindi il default fa solo danni: I/O in attesa sulla SD che gonfia il
      // load average senza consumare CPU. Sul Pi va tolto.
      ignoreDefaultArgs: ['--enable-automation', '--disable-dev-shm-usage'],
      viewport: IS_DEV_MODE ? { width: 1280, height: 800 } : null,
      ignoreHTTPSErrors: true,
    };

    // Use system Chromium if available for codec support
    if (this.chromiumPath) {
      launchOptions.executablePath = this.chromiumPath;
      logger.info('Using system Chromium for codec support', { path: this.chromiumPath });
    }

    this.playwrightContext = await chromium.launchPersistentContext(
      path.join(DATA_DIR, 'playwright-profile'),
      launchOptions
    );

    const pages = this.playwrightContext.pages();
    this.page = pages.length > 0 ? pages[0] : await this.playwrightContext.newPage();

    await this.page.goto(STANDBY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.currentUrl = STANDBY_URL;

    // Il listener resta agganciato anche alle pagine di contesti ormai
    // sostituiti: se scatta su una di quelle non deve avviare un recovery
    // (era una delle strade con cui si arrivava ai sette recovery paralleli).
    const paginaDiQuestoContesto = this.page;
    this.page.on('crash', () => {
      if (this.page !== paginaDiQuestoContesto) {
        logger.debug('Crash su una pagina ormai sostituita, ignorato');
        return;
      }
      logger.error('Page crashed, attempting recovery');
      this._recoverFromCrash().catch((error) => {
        logger.error('Recovery dopo crash pagina fallito', { error: error.message });
      });
    });
  }

  /**
   * Launch browser directly with spawn (fallback mode)
   */
  async _launchBrowserDirect(url) {
    await this._killBrowserDirect();
    await this._delay(200);

    const chromiumDataDir = path.join(DATA_DIR, 'chromium');
    const args = [...this.launchArgs, `--user-data-dir=${chromiumDataDir}`, url];

    logger.info('Launching browser directly', { url });

    this.browserProcess = spawn(this.chromiumPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,
      }
    });

    this.browserProcess.on('error', (err) => {
      logger.error('Browser process error', { error: err.message });
    });

    this.browserProcess.on('exit', (code, signal) => {
      logger.info('Browser process exited', { code, signal });
      this.browserProcess = null;
    });

    this.currentUrl = url;
    await this._delay(1000);
  }

  /**
   * Kill direct browser process
   */
  async _killBrowserDirect() {
    if (this.browserProcess && !this.browserProcess.killed) {
      try {
        this.browserProcess.kill('SIGTERM');
        await this._delay(500);
        if (!this.browserProcess.killed) {
          this.browserProcess.kill('SIGKILL');
        }
      } catch (err) {
        logger.debug('Error killing browser', { error: err.message });
      }
    }
    this.browserProcess = null;

    try {
      execFileSync('pkill', ['-f', `chromium.*user-data-dir=${DATA_DIR}`], { stdio: 'ignore' });
    } catch {
      // Ignore
    }
  }

  /**
   * Navigate the browser to a URL.
   */
  async navigateTo(url) {
    if (!isUrlAllowed(url) && !isZoomUrl(url) && !isLocalUrl(url)) {
      throw new Error(`URL not allowed: ${url}`);
    }

    if (!isLocalUrl(url) && this._containsShellMetacharacters(url)) {
      throw new Error('URL contains invalid characters');
    }

    logger.info('Navigating to URL', { url });

    try {
      await this._ensureBrowserReady();

      if (this.usePlaywright && this.page) {
        await this._stopAllMedia();
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.currentUrl = url;
      } else {
        await this._launchBrowserDirect(url);
      }

      logger.info('Navigation successful', { url });
    } catch (error) {
      logger.error('Navigation failed', { url, error: error.message });
      throw error;
    }
  }

  /**
   * Navigate back to the standby screen.
   */
  async goToStandby() {
    logger.info('Going to standby');

    try {
      await this._ensureBrowserReady();

      if (this.usePlaywright && this.page) {
        await this._stopAllMedia();
        await this._delay(100);
        await this.page.goto(STANDBY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.currentUrl = STANDBY_URL;
      } else {
        await this._launchBrowserDirect(STANDBY_URL);
      }

      logger.info('Navigated to standby successfully');
    } catch (error) {
      logger.warn('Failed to navigate to standby', { error: error.message });
      await this._recoverFromCrash();
    }
  }

  /**
   * Park the kiosk browser on about:blank while another window covers it.
   *
   * Durante una riunione Zoom il browser kiosk resta aperto sotto la finestra
   * di Zoom, invisibile — ma la pagina di standby ha quattro animazioni CSS
   * infinite (particelle, logo rotante, glow, pulse) che continuano a girare a
   * 60fps, perché Playwright lancia Chromium con
   * `--disable-renderer-backgrounding` e `--disable-backgrounding-occluded-windows`,
   * cioè disattiva proprio i meccanismi con cui Chromium congela le finestre
   * occluse. Misurato su un Pi 4: 1,13 core su 4 bruciati per renderizzare una
   * pagina che nessuno guarda, mentre Zoom accanto era in fame di CPU.
   *
   * Parcheggiare su about:blank azzera quel costo lasciando il browser vivo e
   * il canale CDP responsivo, così `goToStandby()` lo recupera all'uscita.
   *
   * Non solleva mai: se il parcheggio fallisce si perde un'ottimizzazione, ma
   * la riunione deve partire comunque.
   */
  async suspendForOverlay() {
    if (!this.usePlaywright || !this.page) {
      logger.debug('Kiosk suspend skipped (not in Playwright mode)');
      return;
    }

    try {
      await this._stopAllMedia();
      await this.page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
      this.currentUrl = 'about:blank';
      logger.info('Kiosk parked on about:blank while overlay is active');
    } catch (error) {
      logger.warn('Failed to park kiosk on about:blank, continuing anyway', {
        error: error.message,
      });
    }
  }

  /**
   * Stop all media playback (Playwright mode only)
   */
  async _stopAllMedia() {
    if (!this.usePlaywright || !this.page) return;

    try {
      await this.page.evaluate(() => {
        document.querySelectorAll('video, audio').forEach(el => {
          el.pause();
          el.currentTime = 0;
          el.src = '';
          el.load();
        });
      });
      logger.debug('Media stop script executed');
    } catch (error) {
      logger.debug('Could not execute media stop script', { error: error.message });
    }
  }

  /**
   * Execute a JavaScript snippet in the browser (Playwright mode only)
   */
  async _executeScript(script) {
    if (!this.usePlaywright || !this.page) {
      logger.warn('Script execution not available in spawn mode');
      return null;
    }

    logger.info('Executing browser script', { script: script.substring(0, 100) });

    try {
      await this._ensureBrowserReady();
      const result = await this.page.evaluate((code) => {
        return new Function(code)();
      }, script);
      logger.debug('Script executed successfully');
      return result;
    } catch (error) {
      logger.error('Failed to execute script', { error: error.message });
      throw error;
    }
  }

  /**
   * Pause video playback (Playwright mode only)
   */
  async pause() {
    if (!this.usePlaywright || !this.page) {
      logger.warn('Pause not available in spawn mode');
      return;
    }

    try {
      await this._ensureBrowserReady();
      await this.page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) video.pause();
      });
      logger.info('Video paused');
    } catch (error) {
      logger.warn('Failed to pause video', { error: error.message });
    }
  }

  /**
   * Resume video playback (Playwright mode only)
   */
  async resume() {
    if (!this.usePlaywright || !this.page) {
      logger.warn('Resume not available in spawn mode');
      return;
    }

    try {
      await this._ensureBrowserReady();
      await this.page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) video.play();
      });
      logger.info('Video resumed');
    } catch (error) {
      logger.warn('Failed to resume video', { error: error.message });
    }
  }

  getCurrentUrl() {
    return this.currentUrl;
  }

  async forceRestartBrowser(url = STANDBY_URL) {
    logger.info('Force restarting browser', { url });

    try {
      await this._closeBrowser();
      await this._delay(500);
      this.isInitialized = false;
      await this.initialize();

      if (url !== STANDBY_URL) {
        await this.navigateTo(url);
      }

      logger.info('Browser force restarted successfully');
    } catch (error) {
      logger.error('Failed to force restart browser', { error: error.message });
      throw error;
    }
  }

  async _closeBrowser() {
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.playwrightContext) {
        await this.playwrightContext.close().catch(() => {});
        this.playwrightContext = null;
      }
    } catch (error) {
      logger.debug('Error closing Playwright', { error: error.message });
    }

    await this._killBrowserDirect();
  }

  async _ensureBrowserReady() {
    if (this.usePlaywright) {
      if (!this.isInitialized || !this.page || this.page.isClosed()) {
        logger.warn('Browser not ready, reinitializing');
        this.isInitialized = false;
        await this.initialize();
      }
    } else {
      if (!this.isInitialized || !this.browserProcess || this.browserProcess.killed) {
        logger.warn('Browser not ready, reinitializing');
        this.isInitialized = false;
        await this.initialize();
      }
    }
  }

  async _recoverFromCrash() {
    // Rientrante: chi trova un recovery in corso si accoda al suo esito
    // invece di lanciare il proprio (e di chiudere il browser di quell'altro).
    if (this._recoveryPromise) {
      logger.info('Crash recovery already in progress, joining it');
      return this._recoveryPromise;
    }

    this._recoveryPromise = (async () => {
      logger.info('Attempting crash recovery');
      await this._closeBrowser();
      await this._delay(1000);
      this.isInitialized = false;
      await this.initialize();
      logger.info('Crash recovery successful');
    })();

    try {
      return await this._recoveryPromise;
    } catch (error) {
      logger.error('Crash recovery failed', { error: error.message });
      throw error;
    } finally {
      this._recoveryPromise = null;
    }
  }

  _containsShellMetacharacters(str) {
    const dangerousChars = /[`$\\;|&><\n\r]/;
    return dangerousChars.test(str);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown() {
    logger.info('Shutting down browser controller');
    await this._closeBrowser();
    this.isInitialized = false;
  }
}

// Esposta come proprieta' statica perche' serve anche a chi lancia il browser
// di Zoom (commands/handlers/zoom.js): quel browser DEVE usare il Chromium di
// sistema, l'unico che ha i codec proprietari. Vedi il commento in
// _initPlaywright.
BrowserController.findChromiumPath = findChromiumPath;

module.exports = BrowserController;
