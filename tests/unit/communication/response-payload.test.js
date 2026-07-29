const { unwrapPayload } = require('../../../src/communication/response-payload');
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

describe('unwrapPayload', () => {
  it('unwraps a Laravel API Resource response', () => {
    expect(unwrapPayload(WRAPPED_HEARTBEAT)).toEqual(WRAPPED_HEARTBEAT.data);
  });

  it('returns the payload untouched when the response is not wrapped', () => {
    const flat = {
      server_time: '2026-07-29T09:32:41+00:00',
      next_heartbeat: 30,
      screenshot_enabled: true,
      screenshot_interval_seconds: 60
    };
    expect(unwrapPayload(flat)).toEqual(flat);
  });

  it('returns null for empty or non-object responses', () => {
    expect(unwrapPayload(null)).toBeNull();
    expect(unwrapPayload(undefined)).toBeNull();
    expect(unwrapPayload('')).toBeNull();
    expect(unwrapPayload('ok')).toBeNull();
  });

  it('does not unwrap when data is not an object', () => {
    const payload = { data: 'ok', screenshot_enabled: true };
    expect(unwrapPayload(payload)).toEqual(payload);
  });
});

describe('heartbeat screenshot config propagation', () => {
  function makeScheduler() {
    return new ScreenshotScheduler({
      apiClient: {},
      logger: mockLogger,
      config: { screenshot_enabled: true, screenshot_interval_seconds: 60 }
    });
  }

  it('applies enabled/intervalSeconds from a wrapped heartbeat response', () => {
    const scheduler = makeScheduler();
    const payload = unwrapPayload(WRAPPED_HEARTBEAT);

    scheduler.applyServerConfig({
      enabled: payload.screenshot_enabled,
      intervalSeconds: payload.screenshot_interval_seconds
    });

    expect(scheduler.enabled).toBe(false);
    expect(scheduler.intervalSeconds).toBe(120);
    scheduler.stop();
  });

  it('applies enabled/intervalSeconds from an unwrapped heartbeat response', () => {
    const scheduler = makeScheduler();
    const payload = unwrapPayload({ screenshot_enabled: false, screenshot_interval_seconds: 300 });

    scheduler.applyServerConfig({
      enabled: payload.screenshot_enabled,
      intervalSeconds: payload.screenshot_interval_seconds
    });

    expect(scheduler.enabled).toBe(false);
    expect(scheduler.intervalSeconds).toBe(300);
    scheduler.stop();
  });

  it('regression: reading the wrapped response directly changes nothing', () => {
    const scheduler = makeScheduler();

    scheduler.applyServerConfig({
      enabled: WRAPPED_HEARTBEAT.screenshot_enabled,
      intervalSeconds: WRAPPED_HEARTBEAT.screenshot_interval_seconds
    });

    expect(scheduler.enabled).toBe(true);
    expect(scheduler.intervalSeconds).toBe(60);
    scheduler.stop();
  });
});
