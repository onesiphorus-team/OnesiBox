const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const execFileAsync = promisify(execFile);

const STANDBY_URL = 'http://localhost:3000';
const LOCAL_URL_PREFIX = 'http://localhost:3000/';

// Chromium binary - configurable via environment variable
// Default: 'chromium' (Debian 12+/Raspberry Pi OS Bookworm)
// Alternative: 'chromium-browser' (older Debian/Ubuntu)
const CHROMIUM_BIN = process.env.CHROMIUM_BIN || 'chromium';

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
    this.browserPid = null; // Track the PID of our browser process
    this.isInitialized = false;
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

    // Try xdotool navigation first (preferred method - doesn't launch new browser)
    let xdotoolSuccess = false;
    try {
      // Use Ctrl+L to focus address bar (more reliable than F5+type)
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', '--window', '%@', 'ctrl+l']);
      await this._delay(100);
      await this._xdotoolCommand(['type', '--clearmodifiers', url]);
      await this._xdotoolCommand(['key', 'Return']);
      xdotoolSuccess = true;
    } catch (xdotoolError) {
      logger.debug('xdotool navigation failed', { error: xdotoolError.message });
    }

    // Fallback: launch new browser ONLY if we don't have one running
    if (!xdotoolSuccess) {
      if (this.browserPid) {
        // We have a browser but xdotool failed - try restarting our own
        logger.warn('xdotool failed but browser exists, restarting own browser');
        await this._restartOwnBrowser(url);
      } else {
        // No browser at all - launch one
        logger.info('No browser running, launching new instance');
        try {
          await this._launchBrowser(url);
        } catch (error) {
          logger.error('Failed to launch browser', { url, error: error.message });
          throw error;
        }
      }
    }

    this.currentUrl = url;
  }

  /**
   * Navigate back to the standby screen.
   * Stops any playing media first using JavaScript, then navigates.
   * Does NOT restart the browser to avoid disrupting other browser contexts (e.g., Zoom Playwright).
   */
  async goToStandby() {
    logger.info('Going to standby');

    try {
      // First, stop any media playback via JavaScript to ensure clean stop
      await this._stopAllMedia();

      // Small delay to ensure media is stopped
      await this._delay(100);

      // Navigate to standby using the standard navigation
      await this._navigateToUrl(STANDBY_URL);
      this.currentUrl = STANDBY_URL;

      logger.info('Navigated to standby successfully');
    } catch (error) {
      logger.warn('Failed to navigate to standby cleanly, attempting browser restart', { error: error.message });
      // Only restart as last resort
      await this._restartOwnBrowser(STANDBY_URL);
    }
  }

  /**
   * Stop all media playback in the browser using JavaScript.
   * This ensures video/audio stops without needing to kill the browser.
   */
  async _stopAllMedia() {
    try {
      // Stop all video and audio elements
      const stopScript = `
        document.querySelectorAll('video, audio').forEach(el => {
          el.pause();
          el.currentTime = 0;
          el.src = '';
          el.load();
        });
      `.replace(/\n/g, ' ').trim();

      // Try via xdotool console execution
      await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', '--window', '%@', 'F12']);
      await this._delay(300);
      await this._xdotoolCommand(['type', '--clearmodifiers', stopScript]);
      await this._xdotoolCommand(['key', 'Return']);
      await this._delay(200);
      await this._xdotoolCommand(['key', 'F12']);

      logger.debug('Media stop script executed');
    } catch (error) {
      // Not critical - navigation will handle it
      logger.debug('Could not execute media stop script', { error: error.message });
    }
  }

  /**
   * Navigate to a URL using xdotool. Does not launch new browser.
   * @param {string} url - URL to navigate to
   * @private
   */
  async _navigateToUrl(url) {
    // Try to use xdotool to navigate in existing window
    await this._xdotoolCommand(['search', '--onlyvisible', '--class', 'chromium', 'key', '--window', '%@', 'ctrl+l']);
    await this._delay(100);
    await this._xdotoolCommand(['type', '--clearmodifiers', url]);
    await this._xdotoolCommand(['key', 'Return']);
  }

  /**
   * Restart only our own browser process (if we track it) or launch a new one.
   * This is a fallback for when navigation fails.
   * Does NOT use pkill to avoid killing Playwright browsers.
   *
   * @param {string} url - The URL to open
   * @private
   */
  async _restartOwnBrowser(url = STANDBY_URL) {
    logger.info('Restarting own browser process', { url });

    try {
      // Kill only our tracked browser process if we have one
      if (this.browserPid) {
        try {
          await execFileAsync('kill', ['-9', String(this.browserPid)]);
          logger.info('Killed own browser process', { pid: this.browserPid });
        } catch {
          // Process might already be dead
          logger.debug('Browser process already terminated');
        }
        this.browserPid = null;
      }

      // Wait for process to terminate
      await this._delay(300);

      // Launch fresh browser
      await this._launchBrowser(url);
      this.currentUrl = url;

      logger.info('Browser restarted successfully');
    } catch (error) {
      logger.error('Failed to restart browser', { error: error.message });
      throw error;
    }
  }

  /**
   * Force kill all Chromium processes and relaunch.
   * Use sparingly - this will kill Playwright browsers too!
   * Should only be used for initialization or critical recovery.
   *
   * @param {string} url - The URL to open after restart
   */
  async forceRestartBrowser(url = STANDBY_URL) {
    logger.info('Force restarting all browsers', { url });

    try {
      // Kill all chromium processes
      await execFileAsync('pkill', ['-f', 'chromium']).catch(() => {
        // Ignore errors if no chromium is running
      });

      // Wait for processes to terminate
      await this._delay(500);

      // Launch fresh browser
      await this._launchBrowser(url);
      this.currentUrl = url;

      logger.info('Browser force restarted successfully');
    } catch (error) {
      logger.error('Failed to force restart browser', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize the browser on startup.
   * This is the only place where force restart should be used.
   */
  async initialize() {
    if (this.isInitialized) {
      logger.debug('Browser already initialized');
      return;
    }

    logger.info('Initializing browser controller');
    await this.forceRestartBrowser(STANDBY_URL);
    this.isInitialized = true;
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
   * Launches in kiosk mode for fullscreen without decorations.
   * Tracks the PID for later selective termination.
   *
   * @param {string} url - The URL to open
   * @private
   */
  async _launchBrowser(url) {
    return new Promise((resolve, reject) => {
      // Kiosk mode flags for fullscreen without decorations
      const chromiumArgs = [
        '--kiosk',                              // Fullscreen kiosk mode
        '--noerrdialogs',                       // No error dialogs
        '--disable-infobars',                   // No info bars
        '--no-first-run',                       // Skip first run wizard
        '--autoplay-policy=no-user-gesture-required', // Allow autoplay
        '--disable-session-crashed-bubble',    // No crash bubbles
        '--disable-features=TranslateUI',      // No translate popup
        '--check-for-update-interval=31536000', // Disable update check
        url
      ];

      // Use spawn with detached option instead of exec with '&'
      const child = spawn(CHROMIUM_BIN, chromiumArgs, {
        detached: true,
        stdio: 'ignore'
      });

      // Track our browser PID for selective termination
      this.browserPid = child.pid;
      logger.info('Browser launched', { binary: CHROMIUM_BIN, pid: this.browserPid, url });

      child.unref();

      // Consider launch successful immediately
      // (browser runs independently)
      setTimeout(resolve, 1000);

      child.on('error', (error) => {
        this.browserPid = null;
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
