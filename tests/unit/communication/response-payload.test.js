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

  // Collection endpoints wrap a list the same way: /appliances/commands returns
  // { data: [...], meta: {...} }. Returning the envelope there would silently
  // hand a caller the wrapper instead of the commands.
  it('unwraps a Laravel Resource collection to the array itself', () => {
    const commands = [{ uuid: 'a', type: 'reboot' }, { uuid: 'b', type: 'set_volume' }];
    const body = { data: commands, meta: { total: 2, pending: 2 } };

    expect(unwrapPayload(body)).toBe(commands);
  });

  it('unwraps an empty Laravel Resource collection to an empty array', () => {
    expect(unwrapPayload({ data: [], meta: { total: 0 } })).toEqual([]);
  });

  it('returns null for a bare top-level array, which is not a Resource envelope', () => {
    expect(unwrapPayload([{ uuid: 'a' }])).toBeNull();
    expect(unwrapPayload([])).toBeNull();
  });
});

// The heartbeat propagation tests that used to live here reimplemented the
// production glue inline, so they could not fail for any change to src/. They
// now exercise the real function: see heartbeat-response.test.js.
