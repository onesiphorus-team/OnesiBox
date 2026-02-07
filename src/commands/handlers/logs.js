const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logging/logger');
const { sanitizeLogContent } = require('../../logging/log-sanitizer');

/**
 * Get today's log file path using the same naming pattern as winston-daily-rotate-file.
 */
function getTodayLogPath() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(process.cwd(), 'logs', `onesibox-${today}.log`);
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
 * Get the last N lines from the application log file.
 * Sanitizes sensitive data before returning.
 *
 * @param {object} command - The command object
 * @param {object} _browserController - Browser controller (unused)
 * @returns {Promise<object>} Log content payload
 */
async function getLogs(command, _browserController) {
  const requestedLines = command.payload?.lines || DEFAULT_LINES;
  const lines = Math.min(Math.max(1, requestedLines), MAX_LINES);

  logger.info('Retrieving application logs', {
    commandId: command.id,
    requestedLines: lines
  });

  try {
    const logPath = command.payload?.log_path || getTodayLogPath();

    // Security check: only allow reading from logs directory
    const normalizedPath = path.normalize(logPath);
    const logsDir = path.join(process.cwd(), 'logs');

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

    // Get last N lines
    const lastLines = allLines.slice(-lines);

    // Sanitize sensitive data
    const sanitizedLines = sanitizeLogContent(lastLines);

    logger.info('Logs retrieved successfully', {
      commandId: command.id,
      totalLines: allLines.length,
      returnedLines: sanitizedLines.length
    });

    return {
      lines: sanitizedLines,
      total_lines: allLines.length,
      requested_lines: lines,
      returned_lines: sanitizedLines.length,
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

/**
 * Read logs from a JSON Lines formatted file.
 * Each line is a valid JSON object.
 *
 * @param {string} logPath - Path to the log file
 * @param {number} lines - Number of lines to read
 * @returns {Promise<object[]>} Array of parsed log entries
 */
async function readJsonLinesLog(logPath, lines) {
  const content = await fs.readFile(logPath, 'utf-8');
  const allLines = content.split('\n').filter(line => line.trim());
  const lastLines = allLines.slice(-lines);

  const entries = [];
  for (const line of lastLines) {
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch {
      // If not valid JSON, treat as plain text
      entries.push({ message: line, level: 'info' });
    }
  }

  return entries;
}

module.exports = {
  getLogs,
  readJsonLinesLog,
  MAX_LINES,
  DEFAULT_LINES
};
