const { unwrapPayload } = require('../../../src/communication/response-payload');

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

// The heartbeat propagation tests that used to live here reimplemented the
// production glue inline, so they could not fail for any change to src/. They
// now exercise the real function: see heartbeat-response.test.js.
