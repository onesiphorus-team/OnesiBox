const EventEmitter = require('events');
const logger = require('../logging/logger');
const { validateCommand, getErrorCodeForValidation, getErrorCodeForCommandType, ERROR_CODES } = require('./validator');
const { stateManager, STATUS } = require('../state/state-manager');

const COMMAND_PRIORITY = {
  // System commands - highest priority
  reboot: 1,
  shutdown: 1,
  restart_service: 1,
  // Video calls - high priority
  join_zoom: 1,
  leave_zoom: 1,
  // Media playback - medium priority
  play_media: 2,
  stop_media: 2,
  pause_media: 2,
  resume_media: 2,
  // Settings - low priority
  set_volume: 3,
  // Diagnostics - lowest priority (can wait)
  get_system_info: 4,
  get_logs: 4,
  // Custom shell scripts - medium priority, run alongside media
  custom_script: 2
};

/**
 * Commands that prepare the box for content, e.g. the custom script that switches the TV to
 * the OnesiBox input, are flagged by the server with payload.run_in_background. They start
 * immediately without holding up the queue, so a slow or unreachable TV never delays the
 * video or the meeting they prepare.
 *
 * @param {object} command
 * @returns {boolean}
 */
function runsInBackground(command) {
  return command?.type === 'custom_script' && command.payload?.run_in_background === true;
}

/**
 * Maximum time a handler may take before the manager gives up on it.
 *
 * Nothing guarantees a handler settles: Playwright's page.evaluate() has no
 * timeout of its own, so a wedged renderer can leave a handler pending forever
 * and, without this guard, processing would stay true for the whole lifetime of
 * the process (see issue #59).
 *
 * Budgets are sized on the slowest legitimate path of each command, on a
 * Raspberry Pi over a slow connection, with margin:
 * - play_media / play_stream_item: goToStandby (30s) + navigateTo (30s) +
 *   waits on tiles/video (15s + 15s) + playback event reporting.
 * - join_zoom: kiosk parked on about:blank (10s) + persistent context launch
 *   + goto with waitUntil domcontentloaded (60s) + selector fallbacks (4x5s)
 *   + join click (5s).
 * - everything else: shell commands, file reads and single navigations, all
 *   well under a minute.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

const COMMAND_TIMEOUTS_MS = {
  play_media: 120_000,
  play_stream_item: 120_000,
  join_zoom: 180_000
};

function getCommandTimeoutMs(commandType) {
  return COMMAND_TIMEOUTS_MS[commandType] ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

/**
 * How long a finished command id is remembered to drop late duplicates.
 *
 * The same command reaches the device twice by design: the WebSocket event
 * executes it immediately, while the server keeps it "pending" until the ACK,
 * which is sent only when the handler finishes. Every fallback poll that runs
 * in between (every 30s with WebSocket connected) fetches it again. On a
 * Raspberry Pi 4 a Zoom join takes ~90s, so two or three copies of the same
 * join_zoom ran concurrently, each closing the other's browser: nobody
 * actually got into the meeting. A Pi 5 joins fast enough to ACK before the
 * next poll, which is why the bug only ever showed on the Pi 4.
 *
 * After completion the ACK may still be in flight or queued for retry, so the
 * id is kept for a while longer instead of being forgotten immediately.
 */
const RECENT_COMMAND_TTL_MS = 10 * 60 * 1000;
const RECENT_COMMAND_MAX = 500;

/**
 * Raised when a handler exceeds its budget. Carries EXECUTION_TIMEOUT (E010)
 * so the server gets a meaningful ACK instead of a generic handler failure.
 */
class HandlerTimeoutError extends Error {
  constructor(commandType, timeoutMs) {
    super(`Handler for ${commandType} timed out after ${timeoutMs}ms`);
    this.name = 'HandlerTimeoutError';
    this.code = ERROR_CODES.EXECUTION_TIMEOUT;
    this.timeoutMs = timeoutMs;
  }
}

class CommandManager extends EventEmitter {
  constructor(apiClient, browserController) {
    super();
    this.apiClient = apiClient;
    this.browserController = browserController;
    this.handlers = new Map();
    this.processing = false;
    this.pendingBatches = [];
    // Command ids currently executing, and recently finished ones (id -> ms
    // timestamp). See RECENT_COMMAND_TTL_MS for why both are needed.
    this.inFlightIds = new Set();
    this.recentIds = new Map();
  }

  /**
   * Whether this command id is already running or finished recently.
   * Commands without an id cannot be matched and are never treated as
   * duplicates.
   */
  _isDuplicate(id) {
    if (!id) return false;
    if (this.inFlightIds.has(id)) return true;
    const finishedAt = this.recentIds.get(id);
    return finishedAt !== undefined && Date.now() - finishedAt < RECENT_COMMAND_TTL_MS;
  }

  _rememberFinished(id) {
    if (!id) return;
    this.inFlightIds.delete(id);
    this.recentIds.set(id, Date.now());

    // Map preserves insertion order: the oldest entries come first.
    const cutoff = Date.now() - RECENT_COMMAND_TTL_MS;
    for (const [oldId, finishedAt] of this.recentIds) {
      if (finishedAt >= cutoff && this.recentIds.size <= RECENT_COMMAND_MAX) break;
      this.recentIds.delete(oldId);
    }
  }

  registerHandler(commandType, handler) {
    this.handlers.set(commandType, handler);
    logger.info('Registered command handler', { type: commandType });
  }

  async processCommand(command) {
    const id = command && command.id;
    if (this._isDuplicate(id)) {
      // No ACK here: the first copy owns the command and will ACK it.
      logger.info('Duplicate command ignored (already running or just executed)', {
        id,
        type: command.type
      });
      return;
    }

    if (id) this.inFlightIds.add(id);
    try {
      await this._processCommandOnce(command);
    } finally {
      this._rememberFinished(id);
    }
  }

  async _processCommandOnce(command) {
    const validation = validateCommand(command);

    if (!validation.valid) {
      await this._sendAck(command.id, {
        status: 'failed',
        error_code: getErrorCodeForValidation(validation.errors),
        error_message: validation.errors.join('; ')
      });
      return;
    }

    const handler = this.handlers.get(command.type);
    if (!handler) {
      logger.error('No handler for command type', { type: command.type });
      await this._sendAck(command.id, {
        status: 'failed',
        error_code: ERROR_CODES.UNKNOWN_COMMAND_TYPE,
        error_message: `No handler registered for ${command.type}`
      });
      return;
    }

    const priority = COMMAND_PRIORITY[command.type] || 5;
    const currentStatus = stateManager.getState().status;

    if (priority === 1 && currentStatus === STATUS.PLAYING) {
      logger.info('Interrupting playback for high-priority command', {
        commandType: command.type
      });
      stateManager.stopPlaying();
    }

    try {
      logger.info('Executing command', {
        id: command.id,
        type: command.type,
        priority
      });

      // Handler may return result data (for diagnostic commands like get_system_info, get_logs)
      const result = await this._runHandlerWithTimeout(command, handler);

      await this._sendAck(command.id, { status: 'success', result: result || null });
      this.emit('commandExecuted', { command, status: 'success', result });
    } catch (error) {
      logger.error('Command execution failed', {
        id: command.id,
        type: command.type,
        error: error.message
      });

      await this._sendAck(command.id, {
        status: 'failed',
        error_code: error instanceof HandlerTimeoutError
          ? ERROR_CODES.EXECUTION_TIMEOUT
          : getErrorCodeForCommandType(command.type),
        error_message: error.message
      });
      this.emit('commandExecuted', { command, status: 'failed', error });
    }
  }

  /**
   * Run a handler, giving up on it once its budget expires.
   *
   * A handler that blows the budget is abandoned, not cancelled: there is no
   * way to cancel a pending promise. It keeps running in the background, so we
   * keep a listener on it to log its late outcome and to stop a late rejection
   * from becoming an unhandled rejection. What matters is that the caller gets
   * control back and processing is released.
   *
   * @param {object} command - The command being executed
   * @param {Function} handler - The registered handler
   * @returns {Promise<*>} The handler result, or a rejection on timeout
   */
  _runHandlerWithTimeout(command, handler) {
    const timeoutMs = getCommandTimeoutMs(command.type);
    // Wrapped so a handler throwing synchronously becomes a rejection too.
    const handlerPromise = (async () => handler(command, this.browserController))();

    let timer = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      // Deliberately not unref'd: while a command is in flight there is real
      // pending work, and an unref'd timer would let the process exit (or the
      // timeout simply never fire) before the ACK is sent. It is always
      // cleared below, so it cannot outlive the command.
      timer = setTimeout(
        () => reject(new HandlerTimeoutError(command.type, timeoutMs)),
        timeoutMs
      );
    });

    return Promise.race([handlerPromise, timeoutPromise])
      .catch((error) => {
        if (error instanceof HandlerTimeoutError) {
          logger.error('Command handler timed out, abandoning it', {
            id: command.id,
            type: command.type,
            timeout_ms: timeoutMs
          });

          handlerPromise.then(
            () => logger.warn('Abandoned handler settled after its timeout', {
              id: command.id,
              type: command.type
            }),
            (lateError) => logger.warn('Abandoned handler failed after its timeout', {
              id: command.id,
              type: command.type,
              error: lateError && lateError.message
            })
          );
        }
        throw error;
      })
      .finally(() => clearTimeout(timer));
  }

  async processCommands(commands) {
    if (this.processing) {
      logger.warn('Already processing commands, queuing batch');
      this.pendingBatches.push(commands);
      return;
    }

    this.processing = true;

    try {
      const sorted = [...commands].sort((a, b) => {
        const priorityA = COMMAND_PRIORITY[a.type] || 5;
        const priorityB = COMMAND_PRIORITY[b.type] || 5;
        return priorityA - priorityB;
      });

      for (const command of sorted) {
        if (runsInBackground(command)) {
          // Started, not awaited: the next command (usually the content it prepares) starts right away.
          this.processCommand(command).catch((error) => {
            logger.error('Background command failed', { id: command.id, type: command.type, error: error.message });
          });
          continue;
        }
        await this.processCommand(command);
      }
    } finally {
      if (this.pendingBatches.length > 0) {
        const nextBatch = this.pendingBatches.shift();
        this.processing = false;
        await this.processCommands(nextBatch);
      } else {
        this.processing = false;
      }
    }
  }

  async _sendAck(commandId, ack) {
    try {
      await this.apiClient.acknowledgeCommand(commandId, ack);
      logger.info('Command acknowledged', { commandId, status: ack.status });
    } catch (error) {
      logger.error('Failed to send ACK, queuing for retry', {
        commandId,
        status: ack.status,
        error: error.message
      });
      this.apiClient.queueAckRetry(commandId, ack);
    }
  }
}

module.exports = CommandManager;
module.exports.HandlerTimeoutError = HandlerTimeoutError;
module.exports.DEFAULT_COMMAND_TIMEOUT_MS = DEFAULT_COMMAND_TIMEOUT_MS;
module.exports.COMMAND_TIMEOUTS_MS = COMMAND_TIMEOUTS_MS;
module.exports.getCommandTimeoutMs = getCommandTimeoutMs;
