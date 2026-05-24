jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { chromium } = require('playwright');
const {
  checkMeetingEnded,
  startMeetingEndDetection,
  stopMeetingEndDetection,
  joinZoom,
  cleanup: zoomCleanup,
  END_DETECTION_START_DELAY_MS,
  END_DETECTION_POLL_INTERVAL_MS,
} = require('../../../src/commands/handlers/zoom');
const { stateManager, STATUS } = require('../../../src/state/state-manager');

function makePage({ url, body, closed = false } = {}) {
  return {
    isClosed: () => closed,
    url: () => url,
    evaluate: jest.fn().mockResolvedValue(body ?? ''),
  };
}

describe('checkMeetingEnded', () => {
  it('returns true when page is null', async () => {
    expect(await checkMeetingEnded(null)).toBe(true);
  });

  it('returns true when page is closed', async () => {
    expect(await checkMeetingEnded(makePage({ closed: true }))).toBe(true);
  });

  it('returns true on about:blank', async () => {
    expect(await checkMeetingEnded(makePage({ url: 'about:blank' }))).toBe(true);
  });

  it('returns true when URL is no longer on a Zoom web-client meeting path', async () => {
    expect(
      await checkMeetingEnded(makePage({ url: 'https://zoom.us/postattendee', body: '' }))
    ).toBe(true);
  });

  it('returns true when DOM contains an English "meeting ended" phrase', async () => {
    const result = await checkMeetingEnded(
      makePage({
        url: 'https://app.zoom.us/wc/123456789/start',
        body: 'This meeting has been ended by host.\nReturn to home',
      })
    );
    expect(result).toBe(true);
  });

  it('returns true when DOM contains an Italian "meeting ended" phrase', async () => {
    const result = await checkMeetingEnded(
      makePage({
        url: 'https://app.zoom.us/wc/123456789/start',
        body: "L'host ha terminato la riunione",
      })
    );
    expect(result).toBe(true);
  });

  it('returns false when still on a Zoom /wc/ URL with no end phrases', async () => {
    const result = await checkMeetingEnded(
      makePage({
        url: 'https://app.zoom.us/wc/123456789/start',
        body: 'Mute Stop Video Participants Chat Share Screen Reactions Leave',
      })
    );
    expect(result).toBe(false);
  });
});

describe('startMeetingEndDetection / stopMeetingEndDetection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stateManager.status = STATUS.IDLE;
    stateManager.currentMeeting = null;
  });

  afterEach(() => {
    stopMeetingEndDetection();
    jest.useRealTimers();
  });

  it('does nothing for the first 1h 45m', () => {
    startMeetingEndDetection({ goToStandby: jest.fn() });
    jest.advanceTimersByTime(END_DETECTION_START_DELAY_MS - 1000);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('schedules the poll interval after the start delay', () => {
    startMeetingEndDetection({ goToStandby: jest.fn() });
    jest.advanceTimersByTime(END_DETECTION_START_DELAY_MS);
    // After start delay fires, an interval should be active.
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('stop reduces the active timer count after start', () => {
    const baseline = jest.getTimerCount();
    startMeetingEndDetection({ goToStandby: jest.fn() });
    const afterStart = jest.getTimerCount();
    expect(afterStart).toBeGreaterThan(baseline);
    stopMeetingEndDetection();
    expect(jest.getTimerCount()).toBeLessThan(afterStart);
  });

  it('stop is idempotent', () => {
    startMeetingEndDetection({ goToStandby: jest.fn() });
    stopMeetingEndDetection();
    expect(() => stopMeetingEndDetection()).not.toThrow();
  });

  it('exports a 30 second poll interval', () => {
    expect(END_DETECTION_POLL_INTERVAL_MS).toBe(30 * 1000);
  });

  it('exports a 1h 45m start delay', () => {
    expect(END_DETECTION_START_DELAY_MS).toBe(105 * 60 * 1000);
  });
});

describe('joinZoom + end detection lifecycle', () => {
  let fakePage;
  let fakeContext;
  let browserController;

  beforeEach(() => {
    jest.useFakeTimers();

    const nameInput = {
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
    };

    fakePage = {
      isClosed: jest.fn(() => false),
      url: jest.fn(() => 'https://app.zoom.us/wc/123456789/start'),
      evaluate: jest.fn().mockResolvedValue('Mute Stop Video Participants Leave'),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(nameInput),
      $: jest.fn().mockResolvedValue(null),
      click: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
    };

    fakeContext = {
      pages: jest.fn(() => [fakePage]),
      newPage: jest.fn().mockResolvedValue(fakePage),
      close: jest.fn().mockResolvedValue(undefined),
    };

    chromium.launchPersistentContext.mockResolvedValue(fakeContext);

    browserController = {
      goToStandby: jest.fn().mockResolvedValue(undefined),
    };

    stateManager.status = STATUS.IDLE;
    stateManager.currentMedia = null;
    stateManager.currentMeeting = null;
  });

  afterEach(async () => {
    stopMeetingEndDetection();
    await zoomCleanup().catch(() => {});
    jest.useRealTimers();
    chromium.launchPersistentContext.mockReset();
  });

  it('joins, polls during meeting without cleanup, then tears down once host ends', async () => {
    await joinZoom(
      { payload: { meeting_url: 'https://zoom.us/j/123456789?pwd=abc', participant_name: 'Test Box' } },
      browserController
    );

    expect(stateManager.getState().status).toBe(STATUS.CALLING);
    expect(fakePage.goto).toHaveBeenCalled();
    expect(chromium.launchPersistentContext).toHaveBeenCalled();

    // Advance past the 1h 45m start delay so the interval is registered.
    await jest.advanceTimersByTimeAsync(END_DETECTION_START_DELAY_MS);

    // First poll tick: meeting still active → no teardown.
    await jest.advanceTimersByTimeAsync(END_DETECTION_POLL_INTERVAL_MS);
    expect(fakeContext.close).not.toHaveBeenCalled();
    expect(browserController.goToStandby).not.toHaveBeenCalled();
    expect(stateManager.getState().status).toBe(STATUS.CALLING);

    // Host ends the meeting → Zoom navigates away from /wc/.
    fakePage.url.mockReturnValue('https://zoom.us/postattendee?meeting_result=ended');

    // Next poll tick should detect end and clean up.
    await jest.advanceTimersByTimeAsync(END_DETECTION_POLL_INTERVAL_MS);

    expect(fakeContext.close).toHaveBeenCalled();
    expect(browserController.goToStandby).toHaveBeenCalled();
    expect(stateManager.getState().status).toBe(STATUS.IDLE);
    expect(stateManager.getState().currentMeeting).toBeNull();
  });

  it('detects end via DOM phrase even if URL stays on /wc/', async () => {
    await joinZoom(
      { payload: { meeting_url: 'https://zoom.us/j/123456789?pwd=abc', participant_name: 'Test Box' } },
      browserController
    );

    await jest.advanceTimersByTimeAsync(END_DETECTION_START_DELAY_MS);

    // Simulate the post-meeting modal overlay (URL unchanged, body shows end message).
    fakePage.evaluate.mockResolvedValue('This meeting has been ended by host\nReturn to home');

    await jest.advanceTimersByTimeAsync(END_DETECTION_POLL_INTERVAL_MS);

    expect(fakeContext.close).toHaveBeenCalled();
    expect(browserController.goToStandby).toHaveBeenCalled();
    expect(stateManager.getState().status).toBe(STATUS.IDLE);
  });

  it('does not false-positive when chat mentions short phrases like "meeting ended"', async () => {
    await joinZoom(
      { payload: { meeting_url: 'https://zoom.us/j/123456789?pwd=abc', participant_name: 'Test Box' } },
      browserController
    );

    await jest.advanceTimersByTimeAsync(END_DETECTION_START_DELAY_MS);

    fakePage.evaluate.mockResolvedValue('Chat: Bob: do you know when the meeting ended last week? Alice: no idea');

    await jest.advanceTimersByTimeAsync(END_DETECTION_POLL_INTERVAL_MS);

    expect(fakeContext.close).not.toHaveBeenCalled();
    expect(stateManager.getState().status).toBe(STATUS.CALLING);
  });
});
