const { stateManager, STATUS, CONNECTION_STATUS } = require('../../../src/state/state-manager');

describe('StateManager', () => {
  beforeEach(() => {
    stateManager.status = STATUS.IDLE;
    stateManager.connectionStatus = CONNECTION_STATUS.RECONNECTING;
    stateManager.currentMedia = null;
    stateManager.currentMeeting = null;
    stateManager.volume = 80;
    stateManager.isPaused = false;
    if (stateManager.errorRecoveryTimer) {
      clearTimeout(stateManager.errorRecoveryTimer);
      stateManager.errorRecoveryTimer = null;
    }
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = stateManager.getState();
      expect(state.status).toBe(STATUS.IDLE);
      expect(state.connectionStatus).toBe(CONNECTION_STATUS.RECONNECTING);
      expect(state.volume).toBe(80);
    });
  });

  describe('setStatus', () => {
    it('should change status and emit event', () => {
      const listener = jest.fn();
      stateManager.on('statusChange', listener);

      stateManager.setStatus(STATUS.PLAYING);

      expect(stateManager.status).toBe(STATUS.PLAYING);
      expect(listener).toHaveBeenCalledWith({
        from: STATUS.IDLE,
        to: STATUS.PLAYING
      });

      stateManager.off('statusChange', listener);
    });

    it('should reject invalid status', () => {
      expect(() => stateManager.setStatus('invalid')).toThrow();
    });
  });

  describe('setPlaying', () => {
    it('should set playing state with media info', () => {
      stateManager.setPlaying({
        url: 'https://www.jw.org/video',
        media_type: 'video'
      });

      expect(stateManager.status).toBe(STATUS.PLAYING);
      expect(stateManager.currentMedia).toMatchObject({
        url: 'https://www.jw.org/video',
        media_type: 'video',
        position: 0
      });
      expect(stateManager.isPaused).toBe(false);
    });
  });

  describe('stopPlaying', () => {
    it('should clear media and return to idle', () => {
      stateManager.setPlaying({ url: 'test', media_type: 'video' });
      stateManager.stopPlaying();

      expect(stateManager.status).toBe(STATUS.IDLE);
      expect(stateManager.currentMedia).toBeNull();
    });
  });

  describe('setMeeting', () => {
    it('should set calling state with meeting info', () => {
      stateManager.setMeeting({
        meeting_url: 'https://zoom.us/j/123',
        meeting_id: '123'
      });

      expect(stateManager.status).toBe(STATUS.CALLING);
      expect(stateManager.currentMeeting).toMatchObject({
        meeting_url: 'https://zoom.us/j/123',
        meeting_id: '123'
      });
    });

    it('should clear media when joining meeting', () => {
      stateManager.setPlaying({ url: 'test', media_type: 'video' });
      stateManager.setMeeting({ meeting_url: 'https://zoom.us/j/123' });

      expect(stateManager.currentMedia).toBeNull();
    });
  });

  describe('setVolume', () => {
    it('should clamp volume between 0 and 100', () => {
      stateManager.setVolume(150);
      expect(stateManager.volume).toBe(100);

      stateManager.setVolume(-10);
      expect(stateManager.volume).toBe(0);

      stateManager.setVolume(50);
      expect(stateManager.volume).toBe(50);
    });
  });

  describe('error recovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should auto-recover from error after 10 seconds', () => {
      stateManager.setError('Test error');
      expect(stateManager.status).toBe(STATUS.ERROR);

      jest.advanceTimersByTime(10000);

      expect(stateManager.status).toBe(STATUS.IDLE);
    });
  });
});
