const { applyHeartbeatResponse } = require('../../../src/communication/heartbeat-response');
const ScreenshotScheduler = require('../../../src/diagnostics/screenshot-scheduler');

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

// Real shape returned by the Laravel backend: HeartbeatResource is wrapped in
// a `data` key because the project never calls JsonResource::withoutWrapping().
const WRAPPED_HEARTBEAT = {
  data: {
    server_time: '2026-07-29T09:32:41+00:00',
    next_heartbeat: 30,
    screenshot_enabled: false,
    screenshot_interval_seconds: 120
  }
};

function makeScheduler() {
  return new ScreenshotScheduler({
    apiClient: {},
    logger: mockLogger,
    config: { screenshot_enabled: true, screenshot_interval_seconds: 60 }
  });
}

describe('applyHeartbeatResponse', () => {
  // This is the exact defect site of the v0.12.1 heartbeat bug: reading the
  // fields one level too high yields `undefined` for both, which
  // applyServerConfig silently ignores. Asserting on the arguments makes that
  // regression fail loudly instead of passing as "nothing changed".
  it('reads the screenshot config from under the Laravel `data` key', () => {
    const scheduler = { applyServerConfig: jest.fn() };

    applyHeartbeatResponse(WRAPPED_HEARTBEAT, scheduler);

    expect(scheduler.applyServerConfig).toHaveBeenCalledWith({
      enabled: false,
      intervalSeconds: 120
    });
  });

  it('never forwards undefined fields for a wrapped response', () => {
    const scheduler = { applyServerConfig: jest.fn() };

    applyHeartbeatResponse(WRAPPED_HEARTBEAT, scheduler);

    const [args] = scheduler.applyServerConfig.mock.calls[0];
    expect(args.enabled).toBeDefined();
    expect(args.intervalSeconds).toBeDefined();
  });

  it('drives a real ScreenshotScheduler from a wrapped response', () => {
    const scheduler = makeScheduler();

    expect(applyHeartbeatResponse(WRAPPED_HEARTBEAT, scheduler)).toBe(true);

    expect(scheduler.enabled).toBe(false);
    expect(scheduler.intervalSeconds).toBe(120);
    scheduler.stop();
  });

  it('keeps working if the backend ever drops the `data` wrapper', () => {
    const scheduler = makeScheduler();

    applyHeartbeatResponse({
      server_time: '2026-07-29T09:32:41+00:00',
      screenshot_enabled: false,
      screenshot_interval_seconds: 300
    }, scheduler);

    expect(scheduler.enabled).toBe(false);
    expect(scheduler.intervalSeconds).toBe(300);
    scheduler.stop();
  });

  it('leaves the scheduler untouched when the response carries no payload', () => {
    const scheduler = { applyServerConfig: jest.fn() };

    for (const body of [null, undefined, '', 'ok']) {
      expect(applyHeartbeatResponse(body, scheduler)).toBe(false);
    }

    expect(scheduler.applyServerConfig).not.toHaveBeenCalled();
  });

  it('is a no-op when no scheduler is wired yet', () => {
    expect(() => applyHeartbeatResponse(WRAPPED_HEARTBEAT, null)).not.toThrow();
    expect(applyHeartbeatResponse(WRAPPED_HEARTBEAT, null)).toBe(false);
  });
});
