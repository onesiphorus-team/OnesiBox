const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../../logging/logger');
const { ERROR_CODES } = require('../validator');

const execFileAsync = promisify(execFile);

/**
 * Directory whitelist for custom scripts. Only files in this directory can be
 * executed by the custom-script handler. The deployer (install.sh / SSH ops)
 * is responsible for populating this directory with vetted .sh files.
 */
const SCRIPTS_DIR = process.env.ONESIBOX_CUSTOM_SCRIPTS_DIR || '/opt/onesibox/custom-scripts';

/**
 * Mirrors CustomCommand::SCRIPT_NAME_REGEX server-side. Defense in depth: the
 * server already filters this, but we re-validate to keep the boundary tight.
 */
const NAME_RE = /^[a-zA-Z0-9_.-]+\.sh$/;

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

/**
 * Custom error with an explicit error_code attached so the manager can forward
 * it back to the server.
 */
class HandlerError extends Error {
  constructor(errorCode, message) {
    super(message);
    this.name = 'HandlerError';
    this.error_code = errorCode;
  }
}

/**
 * Execute a custom shell script previously deployed to the whitelist directory.
 *
 * @param {object} command - Validated command. payload: { script_name, static_args }.
 * @returns {Promise<void>}
 */
async function executeCustomScript(command) {
  const payload = command.payload || {};
  const scriptName = payload.script_name;
  const staticArgs = Array.isArray(payload.static_args) ? payload.static_args.map(String) : [];

  if (typeof scriptName !== 'string' || !NAME_RE.test(scriptName)) {
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME, `invalid script_name: ${scriptName}`);
  }

  const wantedPath = path.join(SCRIPTS_DIR, scriptName);

  // Resolve the whitelist dir's real path once so we can compare apples-to-apples
  // on systems where tmpdir or /opt may be symlinked (e.g. macOS /var → /private/var).
  let realScriptsDir;
  try {
    realScriptsDir = await fs.realpath(SCRIPTS_DIR);
  } catch (err) {
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_NOT_FOUND, `scripts directory missing: ${SCRIPTS_DIR} (${err.code || err.message})`);
  }

  let realPath;
  try {
    realPath = await fs.realpath(wantedPath);
  } catch (err) {
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_NOT_FOUND, `script not found: ${scriptName} (${err.code || err.message})`);
  }

  // Reject symlinks that point outside the whitelist directory.
  if (!realPath.startsWith(realScriptsDir + path.sep)) {
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME, `script ${scriptName} resolves outside whitelist (${realPath})`);
  }

  try {
    await fs.access(realPath, fs.constants.X_OK);
  } catch {
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_NOT_FOUND, `script not executable: ${scriptName}`);
  }

  logger.info('Executing custom script', { script_name: scriptName, args_count: staticArgs.length });

  try {
    const { stdout, stderr } = await execFileAsync(realPath, staticArgs, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    logger.info('Custom script completed', {
      script_name: scriptName,
      stdout_bytes: stdout.length,
      stderr_bytes: stderr.length,
    });
  } catch (err) {
    if (err.killed && (err.signal === 'SIGTERM' || err.signal === 'SIGKILL')) {
      logger.error('Custom script timed out', { script_name: scriptName, timeout_ms: TIMEOUT_MS });
      throw new HandlerError(ERROR_CODES.EXECUTION_TIMEOUT, `script ${scriptName} timed out after ${TIMEOUT_MS}ms`);
    }
    logger.error('Custom script failed', {
      script_name: scriptName,
      exit_code: err.code,
      signal: err.signal,
      message: err.message,
    });
    throw new HandlerError(ERROR_CODES.CUSTOM_SCRIPT_FAILED, `script ${scriptName} exited with ${err.code}`);
  }
}

module.exports = {
  executeCustomScript,
  SCRIPTS_DIR,
  NAME_RE,
  TIMEOUT_MS,
  HandlerError,
};
