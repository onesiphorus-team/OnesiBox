const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const execFileAsync = promisify(execFile);

const STANDBY_URL = 'http://localhost:3000';
const LOCAL_URL_PREFIX = 'http://localhost:3000/';

/**
 * Check if URL is a local application URL (localhost:3000)
 */
function isLocalUrl(url) {
  return url === STANDBY_URL || url.startsWith(LOCAL_URL_PREFIX);
}

/**
 * Controls the Chromium browser for media playback and navigation.
 * Uses xdotool for browser automation on Linux/Raspberry Pi.
 *
 * SECURITY: All shell commands use execFile with argument arrays
 * to prevent command injection vulnerabilities.
 */
class BrowserController {
  constructor() {
    this.currentUrl = STANDBY_URL;
    this.browserProcess = null;
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

    // Additional sanitization: ensure URL doesn't contain shell metacharacters
    // even though we use execFile, this provides defense in depth
    // Skip check for local URLs (they are trusted and may contain & for query params)
    if (!isLocalUrl(url) && this._containsShellMetacharacters(url)) {
      throw new Error('URL contains invalid characters');
    }

    logger.info('Navigating to URL', { url });

    try {
      // Use xdotool to control existing Chromium window
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', '--window', '%@', 'F5']);
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'type', '--clearmodifiers', url]);
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', 'Return']);
    } catch {
      // Fallback: launch new browser instance
      try {
        await this._launchBrowser(url);
      } catch (error) {
        logger.error('Failed to navigate browser', { url, error: error.message });
        throw error;
      }
    }

    this.currentUrl = url;
  }

  /**
   * Navigate back to the standby screen.
   */
  async goToStandby() {
    await this.navigateTo(STANDBY_URL);
  }

  /**
   * Execute a JavaScript snippet in the browser console.
   *
   * @param {string} script - The JavaScript to execute
   * @throws {Error} If script execution fails
   */
  async executeScript(script) {
    // Sanitize script to prevent injection
    if (this._containsShellMetacharacters(script)) {
      throw new Error('Script contains invalid characters');
    }

    logger.info('Executing browser script', { script: script.substring(0, 100) });

    try {
      // Open DevTools
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', '--window', '%@', 'F12']);
      await this._delay(500);

      // Type the script (using type command with clearmodifiers for safety)
      await this._xdotoolCommand(['type', '--clearmodifiers', script]);
      await this._xdotoolCommand(['key', 'Return']);

      // Close DevTools
      await this._xdotoolCommand(['key', 'F12']);
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
      await this.executeScript('document.querySelector("video")?.pause()');
    } catch (error) {
      logger.warn('Failed to pause video', { error: error.message });
    }
  }

  /**
   * Resume video playback.
   */
  async resume() {
    try {
      await this.executeScript('document.querySelector("video")?.play()');
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
   * Execute xdotool with arguments safely.
   * Uses execFile to prevent shell injection.
   *
   * @param {string[]} args - Arguments to pass to xdotool
   * @private
   */
  async _xdotoolCommand(args) {
    return execFileAsync('xdotool', args);
  }

  /**
   * Launch Chromium browser with a URL safely.
   * Uses spawn to prevent shell injection.
   *
   * @param {string} url - The URL to open
   * @private
   */
  async _launchBrowser(url) {
    return new Promise((resolve, reject) => {
      // Use spawn with detached option instead of exec with '&'
      const child = spawn('chromium-browser', [url], {
        detached: true,
        stdio: 'ignore'
      });

      child.unref();

      // Consider launch successful immediately
      // (browser runs independently)
      setTimeout(resolve, 1000);

      child.on('error', (error) => {
        reject(error);
      });
    });
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
    // Characters that could be dangerous in shell context
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
}

module.exports = BrowserController;
