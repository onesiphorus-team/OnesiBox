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

// Il server manda lo script che porta la TV sul box (es. to-box.sh) insieme al video o
// alla riunione, con payload.run_in_background: non deve ritardare il contenuto.
describe('CommandManager background commands', () => {
  let manager;
  let releaseScript;
  let scriptHandler;
  let mediaHandler;

  function script(id, runInBackground) {
    return { id, type: 'custom_script', payload: { script_name: 'to-box.sh', run_in_background: runInBackground } };
  }

  function playMedia(id) {
    return { id, type: 'play_media', payload: { url: 'https://www.jw.org/it/video', media_type: 'video' } };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new CommandManager({
      acknowledgeCommand: jest.fn().mockResolvedValue(undefined),
      queueAckRetry: jest.fn()
    }, {});
    scriptHandler = jest.fn(() => new Promise((resolve) => { releaseScript = resolve; }));
    mediaHandler = jest.fn().mockResolvedValue(undefined);
    manager.registerHandler('custom_script', scriptHandler);
    manager.registerHandler('play_media', mediaHandler);
  });

  it('starts the content without waiting for a background script', async () => {
    await manager.processCommands([script('s1', true), playMedia('m1')]);

    expect(scriptHandler).toHaveBeenCalledTimes(1);
    expect(mediaHandler).toHaveBeenCalledTimes(1);

    releaseScript();
  });

  it('still waits for a script that is not flagged to run in the background', async () => {
    const batch = manager.processCommands([script('s2', false), playMedia('m2')]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(scriptHandler).toHaveBeenCalledTimes(1);
    expect(mediaHandler).not.toHaveBeenCalled();

    releaseScript();
    await batch;

    expect(mediaHandler).toHaveBeenCalledTimes(1);
  });
});
