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
