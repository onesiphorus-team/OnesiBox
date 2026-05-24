jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const {
  checkMeetingEnded,
  startMeetingEndDetection,
  stopMeetingEndDetection,
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
