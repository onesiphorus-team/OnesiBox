const mediaHandler = require('../../../src/commands/handlers/media');
const { stateManager, STATUS } = require('../../../src/state/state-manager');

describe('media handler — end of playback detection', () => {
  let apiClient;
  let browserController;

  beforeEach(() => {
    jest.useFakeTimers();

    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
    stateManager.isPaused = false;

    apiClient = { reportPlaybackEvent: jest.fn().mockResolvedValue({}) };
    mediaHandler.setApiClient(apiClient);

    browserController = {
      navigateTo: jest.fn().mockResolvedValue(),
      goToStandby: jest.fn().mockResolvedValue(),
      pause: jest.fn().mockResolvedValue(),
      _executeScript: jest.fn().mockResolvedValue({
        ended: true,
        error: false,
        url: 'http://localhost:3000/player.html'
      })
    };
  });

  afterEach(() => {
    mediaHandler.stopVideoEndedDetection();
    jest.useRealTimers();
    stateManager.currentMedia = null;
    stateManager.status = STATUS.IDLE;
  });

  it.each(['video', 'audio'])('reports completed when a JW.org %s ends', async (mediaType) => {
    const url = `https://www.jw.org/it/biblioteca-digitale/${mediaType}/#it/mediaitems/Cat/pub-x_I_1_${mediaType.toUpperCase()}`;

    await mediaHandler.playMedia(
      { id: 'cmd-1', payload: { url, media_type: mediaType, session_id: 'session-1' } },
      browserController
    );
    await jest.advanceTimersByTimeAsync(2100);

    expect(apiClient.reportPlaybackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'completed', media_url: url, media_type: mediaType, session_id: 'session-1' })
    );
    expect(browserController.goToStandby).toHaveBeenCalled();
  });
});
