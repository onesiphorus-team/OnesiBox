const EventEmitter = require('events');
const logger = require('../logging/logger');
const { stateManager, CONNECTION_STATUS } = require('../state/state-manager');

const BACKOFF_SCHEDULE = [5000, 10000, 20000, 60000];
const MAX_CONSECUTIVE_FAILURES = 3;

class PollingClient extends EventEmitter {
  constructor(apiClient, commandManager, intervalSeconds = 5) {
    super();
    this.apiClient = apiClient;
    this.commandManager = commandManager;
    this.intervalMs = intervalSeconds * 1000;
    this.intervalHandle = null;
    this.consecutiveFailures = 0;
    this.isPolling = false;
    this.stopped = false;
  }

  async start() {
    if (this.intervalHandle) {
      return;
    }

    this.stopped = false;
    logger.info('Polling client starting', { intervalMs: this.intervalMs });

    await this._poll();

    this.intervalHandle = setInterval(() => this._poll(), this.intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info('Polling client stopped');
  }

  async _poll() {
    if (this.isPolling || this.stopped) {
      return;
    }

    this.isPolling = true;

    try {
      const commands = await this.apiClient.getCommands();
      this._onSuccess();

      if (commands.length > 0) {
        logger.info('Received commands from server', { count: commands.length });
        this.emit('commands', commands);
        await this.commandManager.processCommands(commands);
      }
    } catch (error) {
      await this._onFailure(error);
    } finally {
      this.isPolling = false;
    }
  }

  _onSuccess() {
    if (this.consecutiveFailures > 0) {
      logger.info('Connection restored after failures', {
        previousFailures: this.consecutiveFailures
      });
    }
    this.consecutiveFailures = 0;
    stateManager.setConnectionStatus(CONNECTION_STATUS.CONNECTED);
    this.emit('connected');
  }

  async _onFailure(error) {
    this.consecutiveFailures++;

    logger.error('Polling failed', {
      error: error.message,
      consecutiveFailures: this.consecutiveFailures
    });

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stateManager.setConnectionStatus(CONNECTION_STATUS.OFFLINE);
      this.emit('offline');

      const backoffIndex = Math.min(
        this.consecutiveFailures - MAX_CONSECUTIVE_FAILURES,
        BACKOFF_SCHEDULE.length - 1
      );
      const backoffDelay = BACKOFF_SCHEDULE[backoffIndex];

      logger.info('Applying backoff delay', { delayMs: backoffDelay });
      await this._sleep(backoffDelay);
    } else {
      stateManager.setConnectionStatus(CONNECTION_STATUS.RECONNECTING);
      this.emit('reconnecting');
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      isPolling: this.isPolling,
      consecutiveFailures: this.consecutiveFailures,
      connectionStatus: stateManager.getState().connectionStatus
    };
  }
}

module.exports = PollingClient;
