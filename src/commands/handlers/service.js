const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');

const execFileAsync = promisify(execFile);

/**
 * Restart the OnesiBox systemd service.
 *
 * This command is typically used by administrators to remotely restart
 * the OnesiBox application without a full system reboot.
 *
 * @param {object} command - The command object
 * @param {object} _browserController - Browser controller (unused)
 * @returns {Promise<object>} Result with status and message
 */
async function restartService(command, _browserController) {
  logger.info('Restarting OnesiBox service', { commandId: command.id });

  try {
    // Execute systemctl restart command
    // This will cause the current process to be terminated by systemd
    // and a new instance will be started
    await execFileAsync('sudo', ['systemctl', 'restart', 'onesibox'], {
      timeout: 30000 // 30 second timeout
    });

    // This code will likely not execute because the process will be killed
    // by systemd, but we return a response just in case
    return {
      success: true,
      message: 'Service restart initiated'
    };
  } catch (error) {
    // If we get here, the restart command failed
    logger.error('Failed to restart OnesiBox service', {
      commandId: command.id,
      error: error.message,
      code: error.code
    });

    // Provide helpful error message
    let message = `Failed to restart service: ${error.message}`;
    if (error.code === 'ENOENT') {
      message = 'systemctl command not found - is systemd available?';
    } else if (error.message.includes('permission denied') ||
               error.message.includes('not permitted')) {
      message = 'Permission denied - ensure sudo is configured for onesibox user';
    }

    throw new Error(message);
  }
}

module.exports = {
  restartService
};
