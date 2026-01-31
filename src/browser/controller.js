const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const STANDBY_URL = 'http://localhost:3000';
const LOCAL_URL_PREFIX = 'http://localhost:3000/';

// Find system Chromium executable
// Priority: CHROMIUM_BIN env var > system paths > Playwright bundled
function findChromiumPath() {
  // 1. Check environment variable first
  if (process.env.CHROMIUM_BIN) {
    try {
      execSync(`test -x ${process.env.CHROMIUM_BIN}`, { stdio: 'ignore' });
      return process.env.CHROMIUM_BIN;
    } catch {
      // Env var set but path invalid, continue to fallbacks
    }
  }

  // 2. Check common system paths
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

  // 3. Fallback: let Playwright use its bundled browser
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
 * Uses Playwright for browser automation - works on both X11 and Wayland.
 *
 * SECURITY: All URLs are validated before navigation.
 */
class BrowserController {
  constructor() {
    this.currentUrl = STANDBY_URL;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the browser on startup.
   * Launches Chromium in kiosk mode using Playwright.
   */
  async initialize() {
    if (this.isInitialized) {
      logger.debug('Browser already initialized');
      return;
    }

    logger.info('Initializing browser controller with Playwright');

    try {
      // Detect display server (Wayland or X11)
      const isWayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
      logger.info('Display server detected', { isWayland, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY });

      // Browser launch arguments for kiosk mode
      const launchArgs = [
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
        '--use-fake-ui-for-media-stream',
        '--disable-crashpad',
        '--disable-crash-reporter',
        '--disable-breakpad',
      ];

      // Add Wayland-specific flags if running on Wayland
      if (isWayland) {
        launchArgs.push(
          '--enable-features=UseOzonePlatform',
          '--ozone-platform=wayland',
          '--enable-features=WebRTCPipeWireCapturer'
        );
        logger.info('Added Wayland-specific browser flags');
      }

      // Find system Chromium or use Playwright's bundled browser
      const chromiumPath = findChromiumPath();

      // Create persistent user data directory with Crash Reports folder
      // This is required for system Chromium on ARM64 where crashpad needs the database
      // Use /opt/onesibox/data because systemd service uses ProtectHome=true
      const userDataDir = '/opt/onesibox/data/chromium';
      const crashReportsDir = path.join(userDataDir, 'Crash Reports');

      try {
        fs.mkdirSync(crashReportsDir, { recursive: true });
        logger.debug('Created crash reports directory', { path: crashReportsDir });
      } catch (err) {
        logger.warn('Could not create crash reports directory', { error: err.message });
      }

      const launchOptions = {
        headless: false,
        args: launchArgs,
        ignoreDefaultArgs: ['--enable-automation'],
      };

      // Use system Chromium if available (required for Raspberry Pi)
      if (chromiumPath) {
        launchOptions.executablePath = chromiumPath;
        logger.info('Using system Chromium', { path: chromiumPath });
      } else {
        logger.info('Using Playwright bundled Chromium');
      }

      // Launch browser with persistent context to use persistent user data directory
      // This fixes crashpad issues on ARM64 where the Crash Reports directory must exist
      this.context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        viewport: null, // Use full screen
        ignoreHTTPSErrors: true,
      });

      // Get browser reference from context
      this.browser = this.context.browser();

      // Get or create main page
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Navigate to standby
      await this.page.goto(STANDBY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.currentUrl = STANDBY_URL;

      // Handle page crashes
      this.page.on('crash', async () => {
        logger.error('Page crashed, attempting recovery');
        await this._recoverFromCrash();
      });

      // Handle browser disconnection
      this.browser.on('disconnected', async () => {
        logger.error('Browser disconnected, attempting restart');
        this.isInitialized = false;
        await this.initialize();
      });

      this.isInitialized = true;
      logger.info('Browser controller initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser', { error: error.message });
      throw error;
    }
  }

  /**
   * Navigate the browser to a URL.
   * URL must be in the whitelist, a local URL, or Zoom URL.
   *
   * @param {string} url - The URL to navigate to
   * @throws {Error} If URL is not allowed or navigation fails
   */
  async navigateTo(url) {
    if (!isUrlAllowed(url) && !isZoomUrl(url) && !isLocalUrl(url)) {
      throw new Error(`URL not allowed: ${url}`);
    }

    // Additional sanitization for non-local URLs
    if (!isLocalUrl(url) && this._containsShellMetacharacters(url)) {
      throw new Error('URL contains invalid characters');
    }

    logger.info('Navigating to URL', { url });

    try {
      await this._ensureBrowserReady();

      // Stop any playing media first
      await this._stopAllMedia();

      // Navigate to new URL
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      this.currentUrl = url;
      logger.info('Navigation successful', { url });
    } catch (error) {
      logger.error('Navigation failed', { url, error: error.message });

      // Try to recover
      try {
        await this._recoverFromCrash();
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.currentUrl = url;
      } catch (retryError) {
        logger.error('Navigation retry failed', { error: retryError.message });
        throw error;
      }
    }
  }

  /**
   * Navigate back to the standby screen.
   * Stops any playing media first, then navigates.
   */
  async goToStandby() {
    logger.info('Going to standby');

    try {
      await this._ensureBrowserReady();

      // Stop any media playback
      await this._stopAllMedia();

      // Small delay to ensure media is stopped
      await this._delay(100);

      // Navigate to standby
      await this.page.goto(STANDBY_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      this.currentUrl = STANDBY_URL;
      logger.info('Navigated to standby successfully');
    } catch (error) {
      logger.warn('Failed to navigate to standby cleanly', { error: error.message });

      // Try recovery
      await this._recoverFromCrash();
    }
  }

  /**
   * Stop all media playback in the browser using JavaScript.
   */
  async _stopAllMedia() {
    try {
      await this.page.evaluate(() => {
        // Stop all video and audio elements
        document.querySelectorAll('video, audio').forEach(el => {
          el.pause();
          el.currentTime = 0;
          el.src = '';
          el.load();
        });
      });
      logger.debug('Media stop script executed');
    } catch (error) {
      // Not critical - navigation will handle it
      logger.debug('Could not execute media stop script', { error: error.message });
    }
  }

  /**
   * Execute a JavaScript snippet in the browser.
   *
   * @param {string} script - The JavaScript to execute
   * @throws {Error} If script execution fails
   */
  async executeScript(script) {
    logger.info('Executing browser script', { script: script.substring(0, 100) });

    try {
      await this._ensureBrowserReady();

      // Execute script via Playwright
      const result = await this.page.evaluate((code) => {
        // Use Function constructor to execute arbitrary code
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
   * Pause video playback.
   */
  async pause() {
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
   * Resume video playback.
   */
  async resume() {
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

  /**
   * Get the current URL.
   * @returns {string} The current URL
   */
  getCurrentUrl() {
    return this.currentUrl;
  }

  /**
   * Force restart the browser.
   * Use sparingly - this will close and reopen the browser.
   *
   * @param {string} url - The URL to open after restart
   */
  async forceRestartBrowser(url = STANDBY_URL) {
    logger.info('Force restarting browser', { url });

    try {
      // Close existing browser
      await this._closeBrowser();

      // Wait for cleanup
      await this._delay(500);

      // Reinitialize
      this.isInitialized = false;
      await this.initialize();

      // Navigate to requested URL
      if (url !== STANDBY_URL) {
        await this.navigateTo(url);
      }

      logger.info('Browser force restarted successfully');
    } catch (error) {
      logger.error('Failed to force restart browser', { error: error.message });
      throw error;
    }
  }

  /**
   * Close the browser gracefully.
   */
  async _closeBrowser() {
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch (error) {
      logger.debug('Error closing browser', { error: error.message });
    }
  }

  /**
   * Ensure browser is ready for operations.
   */
  async _ensureBrowserReady() {
    if (!this.isInitialized || !this.page || this.page.isClosed()) {
      logger.warn('Browser not ready, reinitializing');
      this.isInitialized = false;
      await this.initialize();
    }
  }

  /**
   * Recover from a crash or error state.
   */
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

  /**
   * Check if a string contains shell metacharacters.
   * Defense in depth against injection attacks.
   *
   * @param {string} str - String to check
   * @returns {boolean} True if contains dangerous characters
   * @private
   */
  _containsShellMetacharacters(str) {
    const dangerousChars = /[`$\\;|&><\n\r]/;
    return dangerousChars.test(str);
  }

  /**
   * Promise-based delay helper.
   *
   * @param {number} ms - Milliseconds to wait
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup on shutdown.
   */
  async shutdown() {
    logger.info('Shutting down browser controller');
    await this._closeBrowser();
    this.isInitialized = false;
  }
}

module.exports = BrowserController;
