const EventEmitter = require('events');
const logger = require('../logging/logger');
const { validateCommand, getErrorCodeForValidation } = require('./validator');
const { stateManager, STATUS } = require('../state/state-manager');

const COMMAND_PRIORITY = {
  join_zoom: 1,
  leave_zoom: 1,
  play_media: 2,
  stop_media: 2,
  pause_media: 2,
  resume_media: 2,
  set_volume: 3
};

class CommandManager extends EventEmitter {
  constructor(apiClient, browserController) {
    super();
    this.apiClient = apiClient;
    this.browserController = browserController;
    this.handlers = new Map();
    this.processing = false;
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
        error_code: 'E003',
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

      await handler(command, this.browserController);

      await this._sendAck(command.id, { status: 'success' });
      this.emit('commandExecuted', { command, status: 'success' });
    } catch (error) {
      logger.error('Command execution failed', {
        id: command.id,
        type: command.type,
        error: error.message
      });

      const errorCode = this._getErrorCodeForType(command.type);
      await this._sendAck(command.id, {
        status: 'failed',
        error_code: errorCode,
        error_message: error.message
      });
      this.emit('commandExecuted', { command, status: 'failed', error });
    }
  }

  async processCommands(commands) {
    if (this.processing) {
      logger.warn('Already processing commands, skipping batch');
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
      this.processing = false;
    }
  }

  async _sendAck(commandId, ack) {
    try {
      await this.apiClient.acknowledgeCommand(commandId, ack);
    } catch (error) {
      logger.error('Failed to send command acknowledgment', {
        commandId,
        error: error.message
      });
    }
  }

  _getErrorCodeForType(commandType) {
    switch (commandType) {
      case 'play_media':
      case 'stop_media':
      case 'pause_media':
      case 'resume_media':
        return 'E006';
      case 'join_zoom':
      case 'leave_zoom':
        return 'E007';
      case 'set_volume':
        return 'E008';
      default:
        return 'E004';
    }
  }
}

module.exports = CommandManager;
