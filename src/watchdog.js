const dgram = require('dgram');
const fs = require('fs');
const logger = require('./logging/logger');

/**
 * Systemd watchdog/notify integration.
 * Sends notifications to systemd via NOTIFY_SOCKET.
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
   * Send a notification to systemd.
   * @param {string} message - The notification message
   */
  _notify(message) {
    if (!this.enabled) return;

    try {
      // Handle abstract socket (starts with @)
      const socketPath = this.socketPath.startsWith('@')
        ? '\0' + this.socketPath.slice(1)
        : this.socketPath;

      const socket = dgram.createSocket('unix_dgram');
      const buffer = Buffer.from(message);

      socket.send(buffer, 0, buffer.length, socketPath, (err) => {
        socket.close();
        if (err) {
          logger.warn('Failed to send systemd notification', { error: err.message });
        }
      });
    } catch (error) {
      logger.warn('Watchdog notification error', { error: error.message });
    }
  }

  /**
   * Notify systemd that the service is ready.
   */
  ready() {
    this._notify('READY=1');
    logger.info('Sent READY notification to systemd');
  }

  /**
   * Send watchdog keepalive ping.
   */
  ping() {
    this._notify('WATCHDOG=1');
  }

  /**
   * Update status message in systemd.
   * @param {string} status - Status message
   */
  status(status) {
    this._notify(`STATUS=${status}`);
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
    this._notify('STOPPING=1');
    this.stopPinging();
  }
}

module.exports = new Watchdog();
