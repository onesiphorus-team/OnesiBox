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

// Lo stesso comando arriva due volte per costruzione: dall'evento WebSocket e
// dal polling di riserva, che lo trova ancora "pending" finche' l'ACK non
// parte. Vedi RECENT_COMMAND_TTL_MS in src/commands/manager.js.
describe('CommandManager duplicate command ids', () => {
  let manager;
  let apiClient;

  function stopMedia(id) {
    return { id, type: 'stop_media', payload: {} };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    apiClient = {
      acknowledgeCommand: jest.fn().mockResolvedValue(undefined),
      queueAckRetry: jest.fn()
    };
    manager = new CommandManager(apiClient, {});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a command only once when a copy arrives while the first is still running', async () => {
    let release;
    const handler = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    manager.registerHandler('stop_media', handler);

    const first = manager.processCommand(stopMedia('cmd-1'));
    await jest.advanceTimersByTimeAsync(0);

    // Copia dal polling mentre il primo e' ancora in esecuzione.
    await manager.processCommand(stopMedia('cmd-1'));
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledTimes(1);
  });

  it('ignores a late copy of a command that has just finished', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    manager.registerHandler('stop_media', handler);

    await manager.processCommand(stopMedia('cmd-1'));
    await jest.advanceTimersByTimeAsync(60 * 1000);
    await manager.processCommand(stopMedia('cmd-1'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledTimes(1);
  });

  it('runs again the same id once it has been forgotten', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    manager.registerHandler('stop_media', handler);

    await manager.processCommand(stopMedia('cmd-1'));
    await jest.advanceTimersByTimeAsync(11 * 60 * 1000);
    await manager.processCommand(stopMedia('cmd-1'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not treat different ids as duplicates', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    manager.registerHandler('stop_media', handler);

    await manager.processCommand(stopMedia('cmd-1'));
    await manager.processCommand(stopMedia('cmd-2'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('still dedups a command whose handler failed', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    manager.registerHandler('stop_media', handler);

    await manager.processCommand(stopMedia('cmd-1'));
    await manager.processCommand(stopMedia('cmd-1'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(apiClient.acknowledgeCommand).toHaveBeenCalledWith(
      'cmd-1',
      expect.objectContaining({ status: 'failed' })
    );
  });
});
