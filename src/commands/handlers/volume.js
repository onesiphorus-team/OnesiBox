const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');
const { stateManager } = require('../../state/state-manager');

const execFileAsync = promisify(execFile);

/**
 * Set system volume using pactl/amixer with execFile (no shell).
 * This is safer than exec() as it prevents command injection.
 * Tries multiple methods: pactl (PulseAudio), amixer with pulse, amixer direct.
 * Also unmutes to ensure audio is not muted.
 * @param {number} level - Volume level 0-100
 * @returns {Promise<boolean>}
 */
async function setSystemVolume(level) {
  const clampedLevel = Math.max(0, Math.min(100, level));

  // Try pactl (PulseAudio) first - most reliable on modern systems
  try {
    await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${clampedLevel}%`]);
    await execFileAsync('pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']); // Unmute
    logger.debug('Volume set via pactl', { level: clampedLevel });
    return true;
  } catch (error) {
    logger.debug('pactl failed, trying amixer', { error: error.message });
  }

  // Try amixer with pulse device
  try {
    await execFileAsync('amixer', ['-D', 'pulse', 'set', 'Master', `${clampedLevel}%`, 'unmute']);
    logger.debug('Volume set via amixer -D pulse', { level: clampedLevel });
    return true;
  } catch (error) {
    logger.debug('amixer -D pulse failed, trying direct amixer', { error: error.message });
  }

  // Try direct amixer as last resort
  try {
    await execFileAsync('amixer', ['set', 'Master', `${clampedLevel}%`, 'unmute']);
    logger.debug('Volume set via amixer', { level: clampedLevel });
    return true;
  } catch (error) {
    logger.error('Failed to set system volume with all methods', { level: clampedLevel, error: error.message });
    return false;
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

/**
 * Get current system volume using amixer with execFile (no shell).
 * Parses the output programmatically instead of using shell pipes.
 * @returns {Promise<number|null>}
 */
async function getVolume() {
  try {
    const { stdout } = await execFileAsync('amixer', ['get', 'Master']);
    // Parse the output to find percentage value (e.g., "[75%]")
    const match = stdout.match(/\[(\d+)%\]/);
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
