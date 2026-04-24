const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logging/logger');
const { sanitizeLogContent } = require('../../logging/log-sanitizer');

/**
 * Get today's log file path using the same naming pattern as winston-daily-rotate-file.
 */
function getTodayLogPath() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return path.join(__dirname, '../../..', 'logs', `onesibox-${today}.log`);
}

/**
 * Maximum number of log lines that can be requested.
 */
const MAX_LINES = 500;

/**
 * Default number of log lines if not specified.
 */
const DEFAULT_LINES = 100;

/**
 * Check whether a log line is a heartbeat record emitted by startHeartbeat().
 * Heartbeats are JSON lines with message === 'Heartbeat sent'.
 */
function isHeartbeatLine(line) {
  if (!line.includes('Heartbeat sent')) return false;
  try {
    return JSON.parse(line).message === 'Heartbeat sent';
  } catch {
    return false;
  }
}

/**
 * Get the last N lines from the application log file.
 * Sanitizes sensitive data before returning.
 * Heartbeat records are filtered out by default — set payload.include_heartbeats
 * to true to keep them (useful for diagnosing missing heartbeats).
 *
 * @param {object} command - The command object
 * @param {object} _browserController - Browser controller (unused)
 * @returns {Promise<object>} Log content payload
 */
async function getLogs(command, _browserController) {
  const requestedLines = command.payload?.lines || DEFAULT_LINES;
  const lines = Math.min(Math.max(1, requestedLines), MAX_LINES);
  const includeHeartbeats = command.payload?.include_heartbeats === true;

  logger.info('Retrieving application logs', {
    commandId: command.id,
    requestedLines: lines,
    includeHeartbeats
  });

  try {
    const logPath = command.payload?.log_path || getTodayLogPath();

    // Security check: only allow reading from logs directory
    const normalizedPath = path.resolve(logPath);
    const logsDir = path.join(__dirname, '../../..', 'logs');

    if (!normalizedPath.startsWith(logsDir)) {
      throw new Error('Access denied: can only read from logs directory');
    }

    // Check if file exists
    try {
      await fs.access(logPath);
    } catch {
      logger.warn('Log file not found', { logPath });
      return {
        lines: [],
        total_lines: 0,
        requested_lines: lines,
        log_file: path.basename(logPath),
        timestamp: new Date().toISOString()
      };
    }

    // Read and process log file
    const content = await fs.readFile(logPath, 'utf-8');
    const allLines = content.split('\n').filter(line => line.trim());

    // Filter heartbeats BEFORE slicing so that N lines of signal aren't drowned
    // out by the heartbeat noise that dominates the tail of the file.
    const candidateLines = includeHeartbeats
      ? allLines
      : allLines.filter(line => !isHeartbeatLine(line));

    // Get last N lines
    const lastLines = candidateLines.slice(-lines);

    // Sanitize sensitive data
    const sanitizedLines = sanitizeLogContent(lastLines);

    logger.info('Logs retrieved successfully', {
      commandId: command.id,
      totalLines: allLines.length,
      returnedLines: sanitizedLines.length,
      heartbeatsFiltered: allLines.length - candidateLines.length
    });

    return {
      lines: sanitizedLines,
      total_lines: allLines.length,
      requested_lines: lines,
      returned_lines: sanitizedLines.length,
      heartbeats_filtered: allLines.length - candidateLines.length,
      log_file: path.basename(logPath),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to retrieve logs', {
      commandId: command.id,
      error: error.message
    });
    throw new Error(`Failed to retrieve logs: ${error.message}`);
  }
}

module.exports = {
  getLogs,
  MAX_LINES,
  DEFAULT_LINES
};
