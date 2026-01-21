const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');
const { stateManager } = require('../../state/state-manager');

const execAsync = promisify(exec);

async function setSystemVolume(level) {
  const clampedLevel = Math.max(0, Math.min(100, level));

  try {
    await execAsync(`amixer set Master ${clampedLevel}%`);
    return true;
  } catch (error) {
    logger.warn('amixer failed, trying alternative method', { error: error.message });

    try {
      await execAsync(`amixer -D pulse set Master ${clampedLevel}%`);
      return true;
    } catch {
      logger.error('Failed to set system volume', { level: clampedLevel });
      return false;
    }
  }
}

async function setVolume(command, _browserController) {
  const { level } = command.payload;

  if (typeof level !== 'number' || level < 0 || level > 100) {
    throw new Error('Volume level must be between 0 and 100');
  }

  logger.info('Setting volume', { level });

  const success = await setSystemVolume(level);

  if (!success) {
    throw new Error('Failed to set system volume');
  }

  stateManager.setVolume(level);

  logger.info('Volume set successfully', { level });
}

async function getVolume() {
  try {
    const { stdout } = await execAsync("amixer get Master | grep -o '[0-9]*%' | head -1");
    const match = stdout.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

module.exports = {
  setVolume,
  setSystemVolume,
  getVolume
};
