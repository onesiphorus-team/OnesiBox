const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const LOCAL_PORT = process.env.PORT || 3000;
const STANDBY_URL = `http://localhost:${LOCAL_PORT}`;
const LOCAL_URL_PREFIX = `http://localhost:${LOCAL_PORT}/`;
const DATA_DIR = process.env.ONESIBOX_DATA_DIR || '/opt/onesibox/data';

// Find system Chromium executable
function findChromiumPath() {
  if (process.env.CHROMIUM_BIN) {
    try {
      execSync(`test -x ${process.env.CHROMIUM_BIN}`, { stdio: 'ignore' });
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
  ];

  for (const p of paths) {
    try {
      execSync(`test -x ${p}`, { stdio: 'ignore' });
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
  }

  /**
   * Initialize the browser on startup.
   */
  async initialize() {
    if (this.isInitialized) {
      logger.debug('Browser already initialized');
      return;
    }

    logger.info('Initializing browser controller');

    // Detect display server
    const isWayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
    logger.info('Display server detected', { isWayland, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY });

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
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: null,
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

    this.page.on('crash', async () => {
      logger.error('Page crashed, attempting recovery');
      await this._recoverFromCrash();
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
      execSync(`pkill -f "chromium.*user-data-dir=${DATA_DIR}"`, { stdio: 'ignore' });
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
  async executeScript(script) {
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
    logger.info('Attempting crash recovery');

    try {
      await this._closeBrowser();
      await this._delay(1000);
      this.isInitialized = false;
      await this.initialize();
      logger.info('Crash recovery successful');
    } catch (error) {
      logger.error('Crash recovery failed', { error: error.message });
      throw error;
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

module.exports = BrowserController;
