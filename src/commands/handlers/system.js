const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');
const { stateManager } = require('../../state/state-manager');

const execFileAsync = promisify(execFile);

/**
 * Execute a system command with sudo using execFile (no shell).
 * This is safer than exec() as it doesn't spawn a shell and prevents command injection.
 * @param {string} command - The command to execute (e.g., 'shutdown', 'reboot')
 * @param {string[]} args - Array of arguments
 * @returns {Promise<void>}
 */
async function executeSystemCommand(command, args = []) {
  const fullArgs = ['sudo', command, ...args];
  const logCommand = fullArgs.join(' ');

  try {
    const { stdout } = await execFileAsync('sudo', [command, ...args]);
    logger.info('System command executed', { command: logCommand, stdout });
  } catch (error) {
    logger.error('System command failed', { command: logCommand, error: error.message });
    throw error;
  }
}

/**
 * Reboot the device.
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller (unused but required by interface)
 */
async function reboot(command, browserController) {
  const { delay = 0 } = command.payload || {};

  logger.info('Reboot command received', { delay });

  // Stop any current playback/meeting
  const currentState = stateManager.getState();
  if (currentState.status !== 'idle') {
    logger.info('Stopping current activity before reboot');
    await browserController.goToStandby();
    stateManager.stopPlaying();
  }

  if (delay > 0) {
    logger.info('Scheduling reboot', { delaySeconds: delay });
    await executeSystemCommand('shutdown', ['-r', `+${Math.ceil(delay / 60)}`]);
  } else {
    logger.info('Executing immediate reboot');
    // Small delay to allow acknowledgment to be sent
    setTimeout(async () => {
      try {
        await executeSystemCommand('reboot', []);
      } catch (error) {
        logger.error('Reboot execution failed', { error: error.message });
      }
    }, 1000);
  }
}

/**
 * Shutdown the device.
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller (unused but required by interface)
 */
async function shutdown(command, browserController) {
  const { delay = 0 } = command.payload || {};

  logger.info('Shutdown command received', { delay });

  // Stop any current playback/meeting
  const currentState = stateManager.getState();
  if (currentState.status !== 'idle') {
    logger.info('Stopping current activity before shutdown');
    await browserController.goToStandby();
    stateManager.stopPlaying();
  }

  if (delay > 0) {
    logger.info('Scheduling shutdown', { delaySeconds: delay });
    await executeSystemCommand('shutdown', ['-h', `+${Math.ceil(delay / 60)}`]);
  } else {
    logger.info('Executing immediate shutdown');
    // Small delay to allow acknowledgment to be sent
    setTimeout(async () => {
      try {
        await executeSystemCommand('shutdown', ['-h', 'now']);
      } catch (error) {
        logger.error('Shutdown execution failed', { error: error.message });
      }
    }, 1000);
  }
}

module.exports = {
  reboot,
  shutdown,
  executeSystemCommand
};
