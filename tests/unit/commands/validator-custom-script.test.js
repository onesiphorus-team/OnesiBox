const { validateCommand, getErrorCodeForCommandType, ERROR_CODES } = require('../../../src/commands/validator');

jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('validator custom_script', () => {
  it('accepts a valid custom_script command', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'to-box.sh', static_args: ['--mode', 'kiosk'] },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts custom_script without static_args', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'to-box.sh' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects script_name with path traversal', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: '../escape.sh' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects script_name with slash', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'sub/file.sh' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects script_name without .sh extension', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'plain' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects non-string static_args entries', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'ok.sh', static_args: ['a', 42] },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects non-array static_args', () => {
    const result = validateCommand({
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: 'ok.sh', static_args: 'not-an-array' },
    });
    expect(result.valid).toBe(false);
  });

  it('maps custom_script to CUSTOM_SCRIPT_FAILED in getErrorCodeForCommandType', () => {
    expect(getErrorCodeForCommandType('custom_script')).toBe(ERROR_CODES.CUSTOM_SCRIPT_FAILED);
  });
});
