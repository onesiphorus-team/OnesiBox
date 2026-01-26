const { reboot, shutdown, executeSystemCommand } = require('../../../src/commands/handlers/system');

// Mock dependencies
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

jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, callback) => {
    // Simulate successful command execution
    callback(null, 'success', '');
  })
}));

describe('System Handler', () => {
  let mockBrowserController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockBrowserController = {
      goToStandby: jest.fn().mockResolvedValue()
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('reboot', () => {
    it('should execute reboot command', async () => {
      const command = {
        id: '123',
        type: 'reboot',
        payload: {}
      };

      await reboot(command, mockBrowserController);

      // Fast-forward the setTimeout
      jest.advanceTimersByTime(1000);

      const { execFile } = require('child_process');
      expect(execFile).toHaveBeenCalledWith(
        'sudo',
        ['reboot'],
        expect.any(Function)
      );
    });

    it('should schedule delayed reboot', async () => {
      const command = {
        id: '123',
        type: 'reboot',
        payload: { delay: 120 }
      };

      await reboot(command, mockBrowserController);

      const { execFile } = require('child_process');
      expect(execFile).toHaveBeenCalledWith(
        'sudo',
        ['shutdown', '-r', '+2'],
        expect.any(Function)
      );
    });

    it('should stop current playback before reboot', async () => {
      const { stateManager } = require('../../../src/state/state-manager');
      stateManager.getState.mockReturnValue({ status: 'playing' });

      const command = {
        id: '123',
        type: 'reboot',
        payload: {}
      };

      await reboot(command, mockBrowserController);

      expect(mockBrowserController.goToStandby).toHaveBeenCalled();
      expect(stateManager.stopPlaying).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should execute shutdown command', async () => {
      const command = {
        id: '123',
        type: 'shutdown',
        payload: {}
      };

      await shutdown(command, mockBrowserController);

      // Fast-forward the setTimeout
      jest.advanceTimersByTime(1000);

      const { execFile } = require('child_process');
      expect(execFile).toHaveBeenCalledWith(
        'sudo',
        ['shutdown', '-h', 'now'],
        expect.any(Function)
      );
    });

    it('should schedule delayed shutdown', async () => {
      const command = {
        id: '123',
        type: 'shutdown',
        payload: { delay: 300 }
      };

      await shutdown(command, mockBrowserController);

      const { execFile } = require('child_process');
      expect(execFile).toHaveBeenCalledWith(
        'sudo',
        ['shutdown', '-h', '+5'],
        expect.any(Function)
      );
    });

    it('should stop current playback before shutdown', async () => {
      const { stateManager } = require('../../../src/state/state-manager');
      stateManager.getState.mockReturnValue({ status: 'playing' });

      const command = {
        id: '123',
        type: 'shutdown',
        payload: {}
      };

      await shutdown(command, mockBrowserController);

      expect(mockBrowserController.goToStandby).toHaveBeenCalled();
      expect(stateManager.stopPlaying).toHaveBeenCalled();
    });
  });
});
