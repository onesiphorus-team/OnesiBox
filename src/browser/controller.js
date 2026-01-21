const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../logging/logger');
const { isUrlAllowed, isZoomUrl } = require('../commands/validator');

const execAsync = promisify(exec);

const STANDBY_URL = 'http://localhost:3000';

class BrowserController {
  constructor() {
    this.currentUrl = STANDBY_URL;
    this.browserProcess = null;
  }

  async navigateTo(url) {
    if (!isUrlAllowed(url) && !isZoomUrl(url) && url !== STANDBY_URL) {
      throw new Error(`URL not allowed: ${url}`);
    }

    logger.info('Navigating to URL', { url });

    try {
      await execAsync(`xdotool search --onlyvisible --class chromium key --window %@ F5`);
      await execAsync(`xdotool search --onlyvisible --class chromium type "${url}"`);
      await execAsync(`xdotool search --onlyvisible --class chromium key Return`);
    } catch {
      try {
        await execAsync(`chromium-browser "${url}" &`);
      } catch (error) {
        logger.error('Failed to navigate browser', { url, error: error.message });
        throw error;
      }
    }

    this.currentUrl = url;
  }

  async goToStandby() {
    await this.navigateTo(STANDBY_URL);
  }

  async executeScript(script) {
    logger.info('Executing browser script', { script: script.substring(0, 100) });
    try {
      await execAsync(`xdotool search --onlyvisible --class chromium key --window %@ F12`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await execAsync(`xdotool type "${script}"`);
      await execAsync(`xdotool key Return`);
      await execAsync(`xdotool key F12`);
    } catch (error) {
      logger.error('Failed to execute script', { error: error.message });
      throw error;
    }
  }

  async pause() {
    try {
      await this.executeScript('document.querySelector("video")?.pause()');
    } catch (error) {
      logger.warn('Failed to pause video', { error: error.message });
    }
  }

  async resume() {
    try {
      await this.executeScript('document.querySelector("video")?.play()');
    } catch (error) {
      logger.warn('Failed to resume video', { error: error.message });
    }
  }

  getCurrentUrl() {
    return this.currentUrl;
  }
}

module.exports = BrowserController;
