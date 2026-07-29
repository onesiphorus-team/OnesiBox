const CommandManager = require('../../../src/commands/manager');

jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/state/state-manager', () => ({
  stateManager: {
    getState: jest.fn(() => ({ status: 'idle' })),
    stopPlaying: jest.fn()
  },
  STATUS: {
    IDLE: 'idle',
    PLAYING: 'playing',
    CALLING: 'calling'
  }
}));

const logger = require('../../../src/logging/logger');

// Budget attesi (vedi COMMAND_TIMEOUTS_MS in src/commands/manager.js).
const DEFAULT_TIMEOUT_MS = 60_000;
const JOIN_ZOOM_TIMEOUT_MS = 180_000;

function stopMediaCommand(id = 'cmd-stop') {
  return { id, type: 'stop_media', payload: {} };
}

function setVolumeCommand(id = 'cmd-volume') {
  return { id, type: 'set_volume', payload: { level: 50 } };
}

/**
 * Lascia girare le microtask pendenti senza far avanzare i timer finti.
 */
async function flushMicrotasks() {
  await jest.advanceTimersByTimeAsync(0);
}

describe('CommandManager handler timeout', () => {
  let manager;
  let apiClient;
  let browserController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    apiClient = {
      acknowledgeCommand: jest.fn().mockResolvedValue(undefined),
      queueAckRetry: jest.fn()
    };
    browserController = {};
    manager = new CommandManager(apiClient, browserController);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases processing and acks E010 when a handler never settles', async () => {
    manager.registerHandler('stop_media', () => new Promise(() => {}));

    let settled = false;
    manager.processCommands([stopMediaCommand('cmd-1')]).then(() => { settled = true; });

    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1_000);
    await flushMicrotasks();

    expect(settled).toBe(true);
    expect(manager.processing).toBe(false);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledWith('cmd-1', expect.objectContaining({
      status: 'failed',
      error_code: 'E010'
    }));
  });

  it('logs the timeout at error level (debug is invisible in production)', async () => {
    manager.registerHandler('stop_media', () => new Promise(() => {}));

    manager.processCommands([stopMediaCommand('cmd-1')]);
    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1_000);
    await flushMicrotasks();

    const loggedAtErrorOrWarn = [...logger.error.mock.calls, ...logger.warn.mock.calls]
      .some(([message]) => /timed out/i.test(message));
    expect(loggedAtErrorOrWarn).toBe(true);
  });

  it('runs queued batches after a stuck handler times out', async () => {
    const volumeHandler = jest.fn().mockResolvedValue(undefined);
    manager.registerHandler('stop_media', () => new Promise(() => {}));
    manager.registerHandler('set_volume', volumeHandler);

    manager.processCommands([stopMediaCommand('cmd-1')]);
    await flushMicrotasks();

    // Secondo batch mentre il primo è ancora "in esecuzione": viene accodato.
    manager.processCommands([setVolumeCommand('cmd-2')]);
    await flushMicrotasks();
    expect(volumeHandler).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1_000);
    await flushMicrotasks();

    expect(volumeHandler).toHaveBeenCalledTimes(1);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledWith('cmd-2', expect.objectContaining({
      status: 'success'
    }));
    expect(manager.processing).toBe(false);
  });

  it('does not kill a slow but legitimate handler inside its budget', async () => {
    manager.registerHandler('stop_media', () => new Promise(resolve => {
      setTimeout(() => resolve('done'), DEFAULT_TIMEOUT_MS - 10_000);
    }));

    let settled = false;
    manager.processCommands([stopMediaCommand('cmd-1')]).then(() => { settled = true; });

    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 10_000 + 100);
    await flushMicrotasks();

    expect(settled).toBe(true);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledWith('cmd-1', expect.objectContaining({
      status: 'success',
      result: 'done'
    }));
  });

  it('gives join_zoom a longer budget than the default', async () => {
    // 90s: oltre il budget di default, dentro quello di join_zoom.
    manager.registerHandler('join_zoom', () => new Promise(resolve => {
      setTimeout(resolve, 90_000);
    }));

    const command = {
      id: 'cmd-zoom',
      type: 'join_zoom',
      payload: { meeting_url: 'https://zoom.us/j/123456789' }
    };

    let settled = false;
    manager.processCommands([command]).then(() => { settled = true; });

    await jest.advanceTimersByTimeAsync(90_000 + 100);
    await flushMicrotasks();

    expect(settled).toBe(true);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledWith('cmd-zoom', expect.objectContaining({
      status: 'success'
    }));
    expect(CommandManager.getCommandTimeoutMs('join_zoom')).toBe(JOIN_ZOOM_TIMEOUT_MS);
    expect(CommandManager.getCommandTimeoutMs('stop_media')).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('swallows a rejection arriving after the timeout without a second ACK', async () => {
    let rejectHandler;
    manager.registerHandler('stop_media', () => new Promise((_resolve, reject) => {
      rejectHandler = reject;
    }));

    manager.processCommands([stopMediaCommand('cmd-1')]);
    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1_000);
    await flushMicrotasks();

    expect(apiClient.acknowledgeCommand).toHaveBeenCalledTimes(1);

    rejectHandler(new Error('too late'));
    await flushMicrotasks();

    expect(apiClient.acknowledgeCommand).toHaveBeenCalledTimes(1);
    // La rejection tardiva deve restare gestita (niente unhandledRejection) e
    // lasciare una traccia visibile in produzione.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/abandoned handler failed/i),
      expect.objectContaining({ id: 'cmd-1', error: 'too late' })
    );
  });
});
