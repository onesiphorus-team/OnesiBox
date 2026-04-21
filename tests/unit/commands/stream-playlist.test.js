const streamPlaylist = require('../../../src/commands/handlers/stream-playlist');
const { stateManager, STATUS } = require('../../../src/state/state-manager');
const mediaHandler = require('../../../src/commands/handlers/media');

describe('stream-playlist handler', () => {
  let mockBrowserController;
  let mockApiClient;

  beforeEach(() => {
    jest.spyOn(mediaHandler, 'stopVideoEndedDetection').mockImplementation(() => {});
    jest.spyOn(mediaHandler, 'startVideoEndedDetection').mockImplementation(() => {});
    jest.spyOn(mediaHandler, 'stopMedia').mockImplementation(async () => {});

    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
    stateManager.isPaused = false;

    mockApiClient = {
      reportPlaybackEvent: jest.fn().mockResolvedValue({})
    };
    streamPlaylist.setApiClient(mockApiClient);

    mockBrowserController = {
      navigateTo: jest.fn().mockResolvedValue(),
      goToStandby: jest.fn().mockResolvedValue(),
      _executeScript: jest.fn()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
    if (stateManager.errorRecoveryTimer) {
      clearTimeout(stateManager.errorRecoveryTimer);
      stateManager.errorRecoveryTimer = null;
    }
  });

  describe('playStreamItem — happy path', () => {
    it('should navigate, click nth tile, start playback and report started', async () => {
      mockBrowserController._executeScript
        .mockResolvedValueOnce({ dismissed: true })
        .mockResolvedValueOnce({ ok: true, tileCount: 4 })
        .mockResolvedValueOnce({ clicked: true })
        .mockResolvedValueOnce({ ok: true, readyState: 4, duration: 4697 })
        .mockResolvedValueOnce({ hooksInstalled: true });

      const command = {
        id: 'cmd-1',
        type: 'play_stream_item',
        payload: {
          url: 'https://stream.jw.org/6311-4713-5379-2156',
          ordinal: 2,
          session_id: 'session-abc'
        }
      };

      await streamPlaylist.playStreamItem(command, mockBrowserController);

      expect(mockBrowserController.navigateTo).toHaveBeenCalledWith(
        'https://stream.jw.org/6311-4713-5379-2156'
      );
      expect(mockBrowserController._executeScript).toHaveBeenCalledTimes(5);
      expect(stateManager.status).toBe(STATUS.PLAYING);
      expect(mockApiClient.reportPlaybackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'started',
          media_url: 'https://stream.jw.org/6311-4713-5379-2156',
          session_id: 'session-abc'
        })
      );
      expect(mediaHandler.startVideoEndedDetection).toHaveBeenCalled();
    });
  });
});
