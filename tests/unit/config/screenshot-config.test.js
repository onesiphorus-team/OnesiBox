const { validateConfig } = require('../../../src/config/config');

describe('screenshot config validation', () => {
  const baseValid = {
    server_url: 'https://onesiforo.example.com',
    appliance_id: '00000000-0000-0000-0000-000000000000',
    appliance_token: 'token',
    polling_interval_seconds: 5,
    heartbeat_interval_seconds: 30,
    default_volume: 80,
    device_name: 'Test',
  };

  it('accepts valid screenshot_enabled and screenshot_interval_seconds', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_enabled: true,
      screenshot_interval_seconds: 60,
    })).not.toThrow();
  });

  it('accepts missing screenshot fields (defaults are applied upstream)', () => {
    expect(() => validateConfig(baseValid)).not.toThrow();
  });

  it('rejects screenshot_interval_seconds below 10', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_interval_seconds: 5,
    })).toThrow(/screenshot_interval_seconds/);
  });

  it('rejects screenshot_interval_seconds above 3600', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_interval_seconds: 7200,
    })).toThrow(/screenshot_interval_seconds/);
  });

  it('rejects non-boolean screenshot_enabled', () => {
    expect(() => validateConfig({
      ...baseValid,
      screenshot_enabled: 'yes',
    })).toThrow(/screenshot_enabled/);
  });
});
