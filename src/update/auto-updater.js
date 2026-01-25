const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('../logging/logger');

const execFileAsync = promisify(execFile);

// Default check interval: 5 minutes
const DEFAULT_CHECK_INTERVAL_SECONDS = 5 * 60;
const REPO_URL = 'git@github.com:onesiphorus-team/OnesiBox.git';
const PROJECT_ROOT = path.join(__dirname, '../..');

class AutoUpdater {
  constructor(options = {}) {
    this.checkIntervalSeconds = options.checkIntervalSeconds || DEFAULT_CHECK_INTERVAL_SECONDS;
    this.checkInterval = null;
    this.isChecking = false;
  }

  /**
   * Get current version from package.json
   */
  getCurrentVersion() {
    const packagePath = path.join(PROJECT_ROOT, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  }

  /**
   * Fetch remote tags and return the latest one
   */
  async getLatestRemoteTag() {
    try {
      // Fetch all remote tags
      const { stdout } = await execFileAsync('git', [
        'ls-remote', '--tags', '--sort=-v:refname', REPO_URL
      ], { cwd: PROJECT_ROOT });

      if (!stdout.trim()) {
        logger.debug('No remote tags found');
        return null;
      }

      // Parse tags from output (format: "hash refs/tags/v1.0.0")
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const match = line.match(/refs\/tags\/(.+?)(\^\{\})?$/);
        if (match && !match[2]) { // Skip ^{} entries (dereferenced tags)
          const tag = match[1];
          // Only consider tags that look like versions (v1.0.0 or 1.0.0)
          if (/^v?\d+\.\d+\.\d+/.test(tag)) {
            return tag;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to fetch remote tags', { error: error.message });
      return null;
    }
  }

  /**
   * Compare two version strings
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  compareVersions(v1, v2) {
    // Remove 'v' prefix if present
    const clean1 = v1.replace(/^v/, '');
    const clean2 = v2.replace(/^v/, '');

    const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  /**
   * Check for updates and apply if available
   */
  async checkForUpdates() {
    if (this.isChecking) {
      logger.debug('Update check already in progress, skipping');
      return false;
    }

    this.isChecking = true;
    logger.info('Checking for updates...');

    try {
      const currentVersion = this.getCurrentVersion();
      const latestTag = await this.getLatestRemoteTag();

      if (!latestTag) {
        logger.info('No remote tags found, skipping update check');
        return false;
      }

      logger.info('Version check', { current: currentVersion, latest: latestTag });

      // Compare versions
      const comparison = this.compareVersions(latestTag, currentVersion);

      if (comparison <= 0) {
        logger.info('Already running the latest version');
        return false;
      }

      logger.info('New version available, starting update', {
        from: currentVersion,
        to: latestTag
      });

      await this.applyUpdate(latestTag);
      return true;

    } catch (error) {
      logger.error('Update check failed', { error: error.message });
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Apply the update: fetch, checkout tag, and restart
   */
  async applyUpdate(tag) {
    logger.info('Fetching latest changes...');

    try {
      // Fetch all tags and branches
      await execFileAsync('git', ['fetch', '--all', '--tags'], {
        cwd: PROJECT_ROOT
      });

      logger.info('Checking out new version...', { tag });

      // Checkout the specific tag
      await execFileAsync('git', ['checkout', `tags/${tag}`], {
        cwd: PROJECT_ROOT
      });

      logger.info('Running npm install for new dependencies...');

      // Install dependencies (in case new ones were added)
      await execFileAsync('npm', ['install', '--production'], {
        cwd: PROJECT_ROOT,
        timeout: 120000 // 2 minutes timeout for npm install
      });

      logger.info('Update complete, restarting application...');

      // Exit with code 0 - systemd will restart the service
      // Give time for logs to flush
      setTimeout(() => {
        process.exit(0);
      }, 1000);

    } catch (error) {
      logger.error('Failed to apply update', {
        error: error.message,
        tag
      });
      throw error;
    }
  }

  /**
   * Start periodic update checks
   */
  start() {
    logger.info('Auto-updater started', {
      checkIntervalSeconds: this.checkIntervalSeconds,
      repo: REPO_URL
    });

    // Do an initial check after a short delay (let the app stabilize first)
    setTimeout(() => {
      this.checkForUpdates();
    }, 60000); // First check after 1 minute

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.checkIntervalSeconds * 1000);
  }

  /**
   * Stop periodic update checks
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Auto-updater stopped');
    }
  }
}

module.exports = AutoUpdater;
