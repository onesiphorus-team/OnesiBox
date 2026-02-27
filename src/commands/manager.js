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
  get_logs: 4
};

class CommandManager extends EventEmitter {
  constructor(apiClient, browserController) {
    super();
    this.apiClient = apiClient;
    this.browserController = browserController;
    this.handlers = new Map();
    this.processing = false;
    this.pendingBatches = [];
  }

  registerHandler(commandType, handler) {
    this.handlers.set(commandType, handler);
    logger.info('Registered command handler', { type: commandType });
  }

  async processCommand(command) {
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
      const result = await handler(command, this.browserController);

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
        error_code: getErrorCodeForCommandType(command.type),
        error_message: error.message
      });
      this.emit('commandExecuted', { command, status: 'failed', error });
    }
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
