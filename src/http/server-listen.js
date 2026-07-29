const logger = require('../logging/logger');

const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60000;

/**
 * Operator-facing explanation of a bind failure, written for whoever is reading
 * onesibox-*.log rather than the systemd journal.
 */
const HINTS = {
  EADDRINUSE: 'Port already bound, most likely a previous OnesiBox instance that survived a SIGKILL. Retrying in-process: the box keeps polling, sending heartbeats and accepting commands, only the local web UI is unavailable until the port frees up.',
  EACCES: 'The service user is not allowed to bind this port. Ports below 1024 need extra privileges; check the PORT setting in the systemd unit.'
};

const GENERIC_HINT = 'The local HTTP server could not bind. The box keeps running its remote functions; the local web UI stays unavailable until the bind succeeds.';

/**
 * Listen on a port, surviving bind failures.
 *
 * `server.listen(port, callback)` only wires the success path: the 'error'
 * event is left without a listener, and Node escalates a listener-less 'error'
 * to an uncaught exception. It is emitted asynchronously, so neither the
 * try/catch inside main() nor main().catch() ever sees it — the process just
 * dies with exit code 1. Five such deaths inside StartLimitIntervalSec=300
 * exhaust StartLimitBurst=5 and systemd stops restarting the unit altogether,
 * which for an unattended box in an elderly person's home means a house call.
 *
 * Retrying in-process is what keeps that from happening: a busy port is
 * transient (the stale instance eventually goes away), and by not exiting we
 * neither consume the restart budget nor drop the functions that do not depend
 * on the local port — polling, heartbeat, WebSocket commands. A box that
 * reports a degraded local server is far more recoverable than one systemd
 * refuses to start.
 *
 * @param {import('http').Server} server - Server to bind.
 * @param {number|string} port - Port to bind.
 * @param {object} [options]
 * @param {number} [options.retryDelayMs] - Delay before the first retry.
 * @param {number} [options.maxRetryDelayMs] - Cap for the exponential backoff.
 * @param {Function} [options.onListening] - Called on every successful bind.
 * @returns {{cancel: Function}} Handle that stops any pending retry.
 */
function listenWithRetry(server, port, options = {}) {
  const {
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    onListening = null
  } = options;

  let attempt = 0;
  let retryTimer = null;
  let cancelled = false;

  server.on('listening', () => {
    if (attempt > 0) {
      logger.info('HTTP server recovered and bound the port', { port, afterAttempts: attempt });
    }
    attempt = 0;
    if (onListening) onListening();
  });

  server.on('error', (error) => {
    attempt += 1;
    const retryInMs = Math.min(retryDelayMs * Math.pow(2, attempt - 1), maxRetryDelayMs);

    logger.error('HTTP server failed to bind, retrying without exiting', {
      port,
      code: error.code || 'UNKNOWN',
      error: error.message,
      stack: error.stack,
      attempt,
      retryInMs,
      hint: HINTS[error.code] || GENERIC_HINT
    });

    if (cancelled) return;

    // Deliberately referenced: a pending retry must hold the event loop up.
    // Left unref'd, freeing the port while nothing else was scheduled made the
    // process exit 0 mid-retry, which systemd records as a clean stop.
    // shutdown() calls cancel(), so this never delays an orderly exit.
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) server.listen(port);
    }, retryInMs);
  });

  server.listen(port);

  return {
    cancel() {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }
  };
}

module.exports = { listenWithRetry, DEFAULT_RETRY_DELAY_MS, DEFAULT_MAX_RETRY_DELAY_MS };
