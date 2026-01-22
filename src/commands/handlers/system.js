const { exec } = require('child_process');
const logger = require('../../logging/logger');
const { stateManager } = require('../../state/state-manager');

/**
 * Execute a system command with sudo.
 * @param {string} command - The command to execute
 * @returns {Promise<void>}
 */
function executeSystemCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logger.error('System command failed', { command, error: error.message, stderr });
        reject(error);
        return;
      }
      logger.info('System command executed', { command, stdout });
      resolve();
    });
  });
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
    await executeSystemCommand(`sudo shutdown -r +${Math.ceil(delay / 60)}`);
  } else {
    logger.info('Executing immediate reboot');
    // Small delay to allow acknowledgment to be sent
    setTimeout(async () => {
      try {
        await executeSystemCommand('sudo reboot');
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
    await executeSystemCommand(`sudo shutdown -h +${Math.ceil(delay / 60)}`);
  } else {
    logger.info('Executing immediate shutdown');
    // Small delay to allow acknowledgment to be sent
    setTimeout(async () => {
      try {
        await executeSystemCommand('sudo shutdown -h now');
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
