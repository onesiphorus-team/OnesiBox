jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { chromium } = require('playwright');
const {
  joinZoom,
  cleanup: zoomCleanup,
  stopMeetingEndDetection,
} = require('../../../src/commands/handlers/zoom');
const { stateManager, STATUS } = require('../../../src/state/state-manager');

/**
 * The handler must refuse a non-Zoom meeting_url *before* launching the browser.
 * Without this guard the host would still be app.zoom.us, but the meeting ID and
 * password would come from an attacker-controlled URL and the box would join a
 * real call with microphone and camera enabled.
 */
describe('joinZoom meeting_url guard', () => {
  let browserController;

  beforeEach(() => {
    browserController = { goToStandby: jest.fn().mockResolvedValue(undefined) };
    stateManager.status = STATUS.IDLE;
    stateManager.currentMedia = null;
    stateManager.currentMeeting = null;
    chromium.launchPersistentContext.mockReset();
    chromium.launchPersistentContext.mockRejectedValue(
      new Error('browser must not be launched for a rejected URL')
    );
  });

  afterEach(async () => {
    stopMeetingEndDetection();
    await zoomCleanup().catch(() => {});
    chromium.launchPersistentContext.mockReset();
  });

  const rejectedUrls = [
    ['an unrelated host', 'https://evil.example.com/j/999888777?pwd=segreto'],
    ['suffix injection on zoom.us', 'https://zoom.us.attacker.io/j/999888777?pwd=segreto'],
    ['a lookalike without the dot', 'https://evilzoom.us/j/999888777'],
    ['a non-standard port', 'https://zoom.us:9999/j/999888777'],
    ['plain HTTP', 'http://zoom.us/j/999888777'],
    ['an over-length URL', `https://zoom.us/j/${'9'.repeat(3000)}`],
  ];

  it.each(rejectedUrls)('rejects %s and never launches the browser', async (_label, url) => {
    await expect(
      joinZoom({ payload: { meeting_url: url, participant_name: 'Test Box' } }, browserController)
    ).rejects.toThrow('Invalid Zoom URL');

    expect(chromium.launchPersistentContext).not.toHaveBeenCalled();
    expect(browserController.goToStandby).not.toHaveBeenCalled();
    expect(stateManager.getState().status).toBe(STATUS.IDLE);
    expect(stateManager.getState().currentMeeting).toBeNull();
  });
});
