const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');
const { stateManager } = require('../../state/state-manager');

const execFileAsync = promisify(execFile);

/**
 * Set system volume using wpctl/pactl/amixer with execFile (no shell).
 * This is safer than exec() as it prevents command injection.
 * Tries multiple methods: wpctl (PipeWire), pactl (PulseAudio), amixer with pulse, amixer direct.
 * Also unmutes to ensure audio is not muted.
 * @param {number} level - Volume level 0-100
 * @returns {Promise<boolean>}
 */
async function setSystemVolume(level) {
  const clampedLevel = Math.max(0, Math.min(100, level));

  // Try wpctl (PipeWire/WirePlumber) first - default on modern Raspberry Pi OS
  try {
    const wpctlLevel = (clampedLevel / 100).toFixed(2);
    await execFileAsync('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', wpctlLevel]);
    await execFileAsync('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', '0']);
    logger.debug('Volume set via wpctl', { level: clampedLevel });
    return true;
  } catch (error) {
    logger.debug('wpctl failed, trying pactl', { error: error.message });
  }

  // Try pactl (PulseAudio)
  try {
    await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${clampedLevel}%`]);
    await execFileAsync('pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']);
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
 * Get current system volume using wpctl/amixer with execFile (no shell).
 * @returns {Promise<number|null>}
 */
async function getVolume() {
  // Try wpctl first (PipeWire) - output format: "Volume: 0.51"
  try {
    const { stdout } = await execFileAsync('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']);
    const match = stdout.match(/Volume:\s+([\d.]+)/);
    if (match) {
      return Math.round(parseFloat(match[1]) * 100);
    }
  } catch {
    // fall through to amixer
  }

  // Fallback to amixer - output format: "[75%]"
  try {
    const { stdout } = await execFileAsync('amixer', ['get', 'Master']);
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
