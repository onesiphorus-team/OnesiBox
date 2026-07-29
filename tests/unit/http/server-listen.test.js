jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const http = require('http');
const { EventEmitter } = require('events');

const logger = require('../../../src/logging/logger');
const { listenWithRetry } = require('../../../src/http/server-listen');

/**
 * Start a throwaway server so the port it grabs is genuinely taken, exactly
 * like the residual OnesiBox instance that survives a SIGKILL and keeps 3000
 * bound while systemd starts the new one.
 */
function occupyPort() {
  return new Promise((resolve) => {
    const blocker = http.createServer(() => {});
    blocker.listen(0, () => resolve(blocker));
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  });
}

/** A server double: records listen() calls without touching the network. */
function fakeServer() {
  const server = new EventEmitter();
  server.listen = jest.fn();
  return server;
}

describe('listenWithRetry', () => {
  const openServers = [];
  const openHandles = [];

  function track(server) {
    openServers.push(server);
    return server;
  }

  /** listenWithRetry whose pending retry is cancelled when the test ends. */
  function listen(server, port, options) {
    const handle = listenWithRetry(server, port, options);
    openHandles.push(handle);
    return handle;
  }

  afterEach(async () => {
    // A pending retry holds the event loop by design, so leaving one behind
    // would keep the Jest worker alive after the run.
    while (openHandles.length > 0) {
      openHandles.pop().cancel();
    }
    while (openServers.length > 0) {
      await close(openServers.pop());
    }
    jest.clearAllMocks();
  });

  it('binds the port and reports it once listening', async () => {
    const server = track(http.createServer(() => {}));
    const onListening = jest.fn();

    listen(server, 0, { onListening });
    await new Promise((resolve) => server.once('listening', () => setImmediate(resolve)));

    expect(onListening).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(true);
  });

  // The defect: `server.listen(port, cb)` leaves the 'error' event without a
  // listener, and Node turns a listener-less 'error' into an uncaught
  // exception. Being asynchronous it escapes both the try/catch inside main()
  // and main().catch(), so the process dies with exit code 1 — five times in
  // fifty seconds and systemd's StartLimitBurst=5 stops restarting for good.
  it('handles EADDRINUSE instead of letting it become an uncaught exception', async () => {
    const blocker = track(await occupyPort());
    const server = track(http.createServer(() => {}));

    listen(server, blocker.address().port, { retryDelayMs: 60000 });

    expect(server.listenerCount('error')).toBeGreaterThan(0);
    await new Promise((resolve) => server.once('error', () => setImmediate(resolve)));
    expect(server.listening).toBe(false);
  });

  it('logs the bind failure to the application log, diagnosably', async () => {
    const blocker = track(await occupyPort());
    const port = blocker.address().port;
    const server = track(http.createServer(() => {}));

    listen(server, port, { retryDelayMs: 60000 });
    await new Promise((resolve) => server.once('error', () => setImmediate(resolve)));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.error.mock.calls[0];
    expect(message).toMatch(/HTTP server/i);
    expect(meta).toMatchObject({
      port,
      code: 'EADDRINUSE',
      attempt: 1,
      retryInMs: 60000
    });
    // Whoever reads the app log must understand why the local UI is gone
    // without having to correlate with the systemd journal.
    expect(typeof meta.hint).toBe('string');
    expect(meta.hint.length).toBeGreaterThan(0);
    expect(typeof meta.stack).toBe('string');
  });

  it('keeps retrying and binds as soon as the port is released', async () => {
    const blocker = track(await occupyPort());
    const port = blocker.address().port;
    const server = track(http.createServer(() => {}));
    const onListening = jest.fn();

    const listening = new Promise((resolve) => server.once('listening', resolve));
    listen(server, port, { retryDelayMs: 10, maxRetryDelayMs: 20, onListening });

    await new Promise((resolve) => server.once('error', () => setImmediate(resolve)));
    expect(server.listening).toBe(false);

    await close(blocker);
    await listening;

    expect(server.listening).toBe(true);
    expect(onListening).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/recovered|bound/i),
      expect.objectContaining({ port })
    );
  });

  describe('retry schedule', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function bindError(code = 'EADDRINUSE') {
      const error = new Error(`listen ${code}: address already in use :::3000`);
      error.code = code;
      return error;
    }

    it('backs off exponentially up to the cap instead of hot-looping', () => {
      const server = fakeServer();
      listen(server, 3000, { retryDelayMs: 1000, maxRetryDelayMs: 4000 });

      expect(server.listen).toHaveBeenCalledTimes(1);

      const delays = [];
      for (let i = 0; i < 4; i += 1) {
        server.emit('error', bindError());
        delays.push(logger.error.mock.calls[i][1].retryInMs);
        jest.runOnlyPendingTimers();
      }

      expect(delays).toEqual([1000, 2000, 4000, 4000]);
      expect(server.listen).toHaveBeenCalledTimes(5);
    });

    it('resets the backoff after a successful bind', () => {
      const server = fakeServer();
      listen(server, 3000, { retryDelayMs: 1000, maxRetryDelayMs: 8000 });

      server.emit('error', bindError());
      jest.runOnlyPendingTimers();
      server.emit('error', bindError());
      jest.runOnlyPendingTimers();
      server.emit('listening');
      server.emit('error', bindError());

      const lastCall = logger.error.mock.calls[logger.error.mock.calls.length - 1];
      expect(lastCall[1].retryInMs).toBe(1000);
      expect(lastCall[1].attempt).toBe(1);
    });

    // Found by running the real thing: with an unref'd retry timer, freeing the
    // port while nothing else held the event loop made the process exit 0 in
    // the middle of a retry — a silent death that looks like a clean stop.
    // shutdown() cancels the handle explicitly, so keeping the ref costs
    // nothing there.
    it('keeps the event loop alive while a retry is pending', () => {
      jest.useRealTimers();
      const server = fakeServer();
      const scheduled = [];
      const realSetTimeout = global.setTimeout;
      const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
        const timer = realSetTimeout(fn, ms);
        scheduled.push(timer);
        return timer;
      });

      try {
        listen(server, 3000, { retryDelayMs: 60000 });
        server.emit('error', bindError());

        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].hasRef()).toBe(true);
      } finally {
        scheduled.forEach(clearTimeout);
        spy.mockRestore();
        jest.useFakeTimers();
      }
    });

    it('stops retrying once cancelled, so shutdown is not held open', () => {
      const server = fakeServer();
      const handle = listen(server, 3000, { retryDelayMs: 1000 });

      server.emit('error', bindError());
      handle.cancel();
      jest.runOnlyPendingTimers();

      expect(server.listen).toHaveBeenCalledTimes(1);
    });

    it('reports non-EADDRINUSE bind errors too, without crashing', () => {
      const server = fakeServer();
      listen(server, 80, { retryDelayMs: 1000 });

      expect(() => server.emit('error', bindError('EACCES'))).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'EACCES', port: 80 })
      );
    });
  });
});
