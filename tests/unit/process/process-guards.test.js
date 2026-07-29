jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { EventEmitter } = require('events');

const logger = require('../../../src/logging/logger');
const { installProcessGuards } = require('../../../src/process/process-guards');

/**
 * Stand-in for `process`. The guards are never installed on the real process
 * here: Jest intercepts uncaughtException/unhandledRejection before any
 * listener a test could install, so driving a fake emitter is the only way to
 * assert on what the handlers actually do.
 */
function fakeProcess() {
  const target = new EventEmitter();
  target.exitCode = undefined;
  return target;
}

describe('installProcessGuards', () => {
  let target;
  let exit;

  beforeEach(() => {
    jest.useFakeTimers();
    target = fakeProcess();
    exit = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('installs both handlers that src/ was missing entirely', () => {
    installProcessGuards({ target, exit });

    expect(target.listenerCount('unhandledRejection')).toBe(1);
    expect(target.listenerCount('uncaughtException')).toBe(1);
  });

  describe('unhandledRejection', () => {
    // Floating promises are everywhere in the periodic paths (main.js command
    // dispatch, media handlers, screenshot scheduler). Since Node 15 an
    // unhandled rejection terminates the process, so an appliance nobody is
    // watching goes dark because one fetch failed.
    it('keeps the process alive but logs the failure with its stack', () => {
      installProcessGuards({ target, exit });
      const reason = new Error('JW media proxy failed');

      target.emit('unhandledRejection', reason, Promise.resolve());
      jest.runAllTimers();

      expect(exit).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message, meta] = logger.error.mock.calls[0];
      expect(message).toMatch(/unhandled/i);
      expect(meta.error).toBe('JW media proxy failed');
      expect(meta.stack).toContain('Error: JW media proxy failed');
    });

    it('logs non-Error rejection values too, rather than crashing the handler', () => {
      installProcessGuards({ target, exit });

      expect(() => target.emit('unhandledRejection', 'plain string reason', Promise.resolve())).not.toThrow();
      expect(() => target.emit('unhandledRejection', undefined, Promise.resolve())).not.toThrow();

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error.mock.calls[0][1].error).toBe('plain string reason');
      expect(exit).not.toHaveBeenCalled();
    });
  });

  describe('uncaughtException', () => {
    it('logs the stack before doing anything else', () => {
      installProcessGuards({ target, exit });
      const error = new Error('ERR_HTTP_HEADERS_SENT');

      target.emit('uncaughtException', error, 'uncaughtException');

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message, meta] = logger.error.mock.calls[0];
      expect(message).toMatch(/uncaught/i);
      expect(meta.error).toBe('ERR_HTTP_HEADERS_SENT');
      expect(meta.stack).toContain('Error: ERR_HTTP_HEADERS_SENT');
      expect(meta.origin).toBe('uncaughtException');
    });

    // Carrying on with a half-unwound stack leaves invariants broken (isPolling
    // stuck true, a half-initialised browser) and the box keeps heartbeating
    // "healthy" while doing nothing. Exiting hands a clean process back to
    // Restart=always, and an offline box is at least visible on the dashboard.
    it('exits non-zero so systemd restarts a clean process', () => {
      installProcessGuards({ target, exit, flushDelayMs: 500 });

      target.emit('uncaughtException', new Error('boom'), 'uncaughtException');

      // Winston's file transport writes asynchronously: exiting on the spot
      // would drop the very line that explains the crash.
      expect(exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(499);
      expect(exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('exits once even if more exceptions arrive while it is going down', () => {
      installProcessGuards({ target, exit, flushDelayMs: 500 });

      target.emit('uncaughtException', new Error('first'), 'uncaughtException');
      target.emit('uncaughtException', new Error('second'), 'uncaughtException');
      jest.runAllTimers();

      expect(exit).toHaveBeenCalledTimes(1);
      // Still logged: a second failure on the way out is diagnostic, not noise.
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('survives a logger that throws and still exits', () => {
      logger.error.mockImplementationOnce(() => { throw new Error('log transport is gone'); });
      installProcessGuards({ target, exit, flushDelayMs: 0 });

      expect(() => target.emit('uncaughtException', new Error('boom'), 'uncaughtException')).not.toThrow();
      jest.runAllTimers();

      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it('can be uninstalled, leaving no listener behind', () => {
    const guards = installProcessGuards({ target, exit });

    guards.uninstall();

    expect(target.listenerCount('unhandledRejection')).toBe(0);
    expect(target.listenerCount('uncaughtException')).toBe(0);
  });
});
