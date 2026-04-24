jest.useFakeTimers();

const mockCapture = jest.fn();
jest.mock('../../../src/diagnostics/capture', () => ({
  captureScreen: (...args) => mockCapture(...args),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockApiClient = {
  uploadScreenshot: jest.fn().mockResolvedValue({ id: 1 }),
  getThrottleStatus: jest.fn().mockReturnValue({ allowed: true }),
};

const ScreenshotScheduler = require('../../../src/diagnostics/screenshot-scheduler');

describe('ScreenshotScheduler', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllTimers();
    mockCapture.mockReset();
    mockCapture.mockResolvedValue(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    mockApiClient.uploadScreenshot.mockClear();

    scheduler = new ScreenshotScheduler({
      apiClient: mockApiClient,
      logger: mockLogger,
      config: { screenshot_enabled: true, screenshot_interval_seconds: 60 },
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('does not fire before start()', () => {
    jest.advanceTimersByTime(120000);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('fires every interval once started', async () => {
    scheduler.start();

    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('stop() halts further ticks', () => {
    scheduler.start();
    jest.advanceTimersByTime(60000);
    scheduler.stop();
    jest.advanceTimersByTime(120000);
    const callsBefore = mockCapture.mock.calls.length;
    jest.advanceTimersByTime(60000);
    expect(mockCapture.mock.calls.length).toBe(callsBefore);
  });

  it('applyServerConfig with new interval restarts the timer', async () => {
    scheduler.start();
    jest.advanceTimersByTime(30000);

    scheduler.applyServerConfig({ enabled: true, intervalSeconds: 20 });
    jest.advanceTimersByTime(20000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('applyServerConfig with enabled=false stops the scheduler', () => {
    scheduler.start();
    scheduler.applyServerConfig({ enabled: false, intervalSeconds: 60 });
    const callsBefore = mockCapture.mock.calls.length;
    jest.advanceTimersByTime(180000);
    expect(mockCapture.mock.calls.length).toBe(callsBefore);
  });

  it('applyServerConfig with enabled=true starts the scheduler if stopped', async () => {
    scheduler.applyServerConfig({ enabled: false, intervalSeconds: 60 });
    expect(mockCapture).not.toHaveBeenCalled();

    scheduler.applyServerConfig({ enabled: true, intervalSeconds: 60 });
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenshotScheduler error handling', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllTimers();
    mockCapture.mockReset();
    mockApiClient.uploadScreenshot.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();

    scheduler = new ScreenshotScheduler({
      apiClient: mockApiClient,
      logger: mockLogger,
      config: { screenshot_enabled: true, screenshot_interval_seconds: 60 },
    });
  });

  afterEach(() => scheduler.stop());

  it('on ENOENT logs error once and disables scheduler', async () => {
    const err = new Error('grim ENOENT');
    err.code = 'ENOENT';
    mockCapture.mockRejectedValue(err);

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const errorCallsBefore = mockLogger.error.mock.calls.length;
    jest.advanceTimersByTime(300000);
    expect(mockLogger.error.mock.calls.length).toBe(errorCallsBefore);
  });

  it('on HTTP 5xx logs warn and continues', async () => {
    mockCapture.mockResolvedValue(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    mockApiClient.uploadScreenshot.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    mockApiClient.uploadScreenshot.mockResolvedValueOnce({ id: 99 });

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/upload failed/),
      expect.any(Object)
    );

    jest.advanceTimersByTime(60000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mockApiClient.uploadScreenshot).toHaveBeenCalledTimes(2);
  });

  it('does not overlap two ticks', async () => {
    let resolve;
    mockCapture.mockImplementation(() => new Promise(r => { resolve = r; }));

    scheduler.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    // second tick scheduled but first is still pending
    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/previous tick still running/)
    );

    resolve(Buffer.from([0x52]));
  });
});
