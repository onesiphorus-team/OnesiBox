const logger = require('../logging/logger');

/**
 * Winston's file transport writes asynchronously, so exiting the instant an
 * exception is logged drops the one line that explains the crash. Wait long
 * enough for the flush, but not long enough to matter to a restart.
 */
const DEFAULT_FLUSH_DELAY_MS = 500;

/** Describe any thrown value, Error or not, without throwing in the process. */
function describeFailure(value) {
  if (value instanceof Error) {
    return { error: value.message, stack: value.stack };
  }
  return { error: String(value), stack: null };
}

/**
 * Install the process-level guards the client never had.
 *
 * Neither `unhandledRejection` nor `uncaughtException` was handled anywhere in
 * src/, while floating promises sit in every periodic path. Node's default for
 * both since v15 is to print to stderr and terminate, so a single failed fetch
 * takes down an unattended kiosk and the reason only ever reaches the systemd
 * journal.
 *
 * The two failures are not treated the same, on purpose:
 *
 * - `unhandledRejection` means one promise chain failed. Nothing was unwound,
 *   the rest of the process is intact, and the honest response for an appliance
 *   in someone's home is to log it loudly at error level, with the stack, and
 *   keep serving. Dying would trade a broken feature for a broken box.
 *
 * - `uncaughtException` means a stack was unwound at an arbitrary point,
 *   leaving invariants half-applied — `isPolling` stuck true so polling never
 *   resumes, a browser context half-initialised, a Zoom process orphaned. Node
 *   itself documents resuming as undefined behaviour. Carrying on produces a
 *   box that keeps heartbeating "healthy" while doing nothing, which is worse
 *   than being down because nobody notices. So: log the stack, then exit(1) and
 *   let Restart=always hand back a process in a known state.
 *
 * Neither handler hides anything: every failure is logged at error with its
 * stack before any decision is taken.
 *
 * @param {object} [options]
 * @param {NodeJS.EventEmitter} [options.target] - Emitter to install on.
 * @param {Function} [options.exit] - Exit function, for tests.
 * @param {number} [options.flushDelayMs] - Grace period for the log flush.
 * @returns {{uninstall: Function}} Handle removing both listeners.
 */
function installProcessGuards(options = {}) {
  const {
    target = process,
    exit = (code) => process.exit(code),
    flushDelayMs = DEFAULT_FLUSH_DELAY_MS
  } = options;

  let exiting = false;

  const onUnhandledRejection = (reason) => {
    logger.error('Unhandled promise rejection, keeping the box running', describeFailure(reason));
  };

  const onUncaughtException = (error, origin) => {
    // Wrapped: if the log transport is what broke, the exit must still happen.
    try {
      logger.error('Uncaught exception, restarting the process', {
        ...describeFailure(error),
        origin: origin || 'uncaughtException'
      });
    } catch {
      // Nothing left to log with.
    }

    if (exiting) return;
    exiting = true;

    // Not unref'd: this timer has to hold the process up until the log is
    // flushed, otherwise an empty event loop exits with code 0 and systemd
    // records a clean stop for what was a crash.
    setTimeout(() => exit(1), flushDelayMs);
  };

  target.on('unhandledRejection', onUnhandledRejection);
  target.on('uncaughtException', onUncaughtException);

  return {
    uninstall() {
      target.removeListener('unhandledRejection', onUnhandledRejection);
      target.removeListener('uncaughtException', onUncaughtException);
    }
  };
}

module.exports = { installProcessGuards, DEFAULT_FLUSH_DELAY_MS };
