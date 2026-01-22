const { execFile } = require('child_process');
const logger = require('./logging/logger');

/**
 * Systemd watchdog/notify integration.
 * Uses systemd-notify command for notifications.
 */
class Watchdog {
  constructor() {
    this.socketPath = process.env.NOTIFY_SOCKET;
    this.watchdogInterval = null;
    this.enabled = !!this.socketPath;

    if (this.enabled) {
      logger.info('Systemd watchdog enabled', { socket: this.socketPath });
    }
  }

  /**
   * Send a notification to systemd using systemd-notify command.
   * @param {string[]} args - Arguments for systemd-notify
   */
  _notify(args) {
    if (!this.enabled) return;

    execFile('systemd-notify', args, (err) => {
      if (err) {
        logger.warn('Failed to send systemd notification', { error: err.message, args });
      }
    });
  }

  /**
   * Notify systemd that the service is ready.
   */
  ready() {
    this._notify(['--ready']);
    logger.info('Sent READY notification to systemd');
  }

  /**
   * Send watchdog keepalive ping.
   */
  ping() {
    this._notify(['WATCHDOG=1']);
  }

  /**
   * Update status message in systemd.
   * @param {string} status - Status message
   */
  status(status) {
    this._notify([`--status=${status}`]);
  }

  /**
   * Start the watchdog ping interval.
   * Pings every half of WatchdogSec to be safe.
   */
  startPinging() {
    if (!this.enabled) return;

    // Get watchdog timeout from environment (in microseconds)
    const watchdogUsec = parseInt(process.env.WATCHDOG_USEC, 10);
    if (!watchdogUsec) {
      logger.info('No WATCHDOG_USEC set, watchdog pinging disabled');
      return;
    }

    // Ping at half the interval to be safe
    const intervalMs = Math.floor(watchdogUsec / 1000 / 2);

    logger.info('Starting watchdog pings', { intervalMs });

    this.watchdogInterval = setInterval(() => {
      this.ping();
    }, intervalMs);

    // Send first ping immediately
    this.ping();
  }

  /**
   * Stop the watchdog ping interval.
   */
  stopPinging() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Notify systemd that the service is stopping.
   */
  stopping() {
    this._notify(['STOPPING=1']);
    this.stopPinging();
  }
}

module.exports = new Watchdog();
