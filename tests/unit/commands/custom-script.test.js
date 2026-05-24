const os = require('os');
const path = require('path');
const fs = require('fs/promises');

jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { ERROR_CODES } = require('../../../src/commands/validator');

describe('Custom script handler', () => {
  let scriptsDir;
  let executeCustomScript;
  let HandlerError;

  beforeEach(async () => {
    jest.resetModules();
    jest.useRealTimers();
    scriptsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onesibox-scripts-'));
    process.env.ONESIBOX_CUSTOM_SCRIPTS_DIR = scriptsDir;

    jest.doMock('../../../src/logging/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));

    ({ executeCustomScript, HandlerError } = require('../../../src/commands/handlers/custom-script'));
  });

  afterEach(async () => {
    await fs.rm(scriptsDir, { recursive: true, force: true });
    delete process.env.ONESIBOX_CUSTOM_SCRIPTS_DIR;
  });

  async function writeScript(name, body) {
    const p = path.join(scriptsDir, name);
    await fs.writeFile(p, body, { mode: 0o755 });
    return p;
  }

  function makeCommand(scriptName, staticArgs = []) {
    return {
      id: 'cmd-1',
      type: 'custom_script',
      payload: { script_name: scriptName, static_args: staticArgs },
    };
  }

  it('runs a script that exits 0', async () => {
    await writeScript('ok.sh', '#!/bin/bash\necho hi\n');
    await expect(executeCustomScript(makeCommand('ok.sh'))).resolves.toBeUndefined();
  });

  it('passes static_args to the script as separate arguments', async () => {
    await writeScript('args.sh', '#!/bin/bash\nif [ "$1" = "alpha" ] && [ "$2" = "beta gamma" ]; then exit 0; else exit 7; fi\n');
    await expect(executeCustomScript(makeCommand('args.sh', ['alpha', 'beta gamma']))).resolves.toBeUndefined();
  });

  it('maps a non-zero exit to CUSTOM_SCRIPT_FAILED (E114)', async () => {
    await writeScript('fail.sh', '#!/bin/bash\nexit 3\n');
    await expect(executeCustomScript(makeCommand('fail.sh'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_FAILED,
    });
  });

  it('rejects a missing script with CUSTOM_SCRIPT_NOT_FOUND (E115)', async () => {
    await expect(executeCustomScript(makeCommand('does-not-exist.sh'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_NOT_FOUND,
    });
  });

  it('rejects a non-executable script with CUSTOM_SCRIPT_NOT_FOUND (E115)', async () => {
    const p = path.join(scriptsDir, 'noexec.sh');
    await fs.writeFile(p, '#!/bin/bash\necho hi\n', { mode: 0o644 });
    await expect(executeCustomScript(makeCommand('noexec.sh'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_NOT_FOUND,
    });
  });

  it('rejects an invalid basename with CUSTOM_SCRIPT_INVALID_NAME (E116)', async () => {
    await expect(executeCustomScript(makeCommand('../escape.sh'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME,
    });
    await expect(executeCustomScript(makeCommand('sub/dir/file.sh'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME,
    });
    await expect(executeCustomScript(makeCommand('no-extension'))).rejects.toMatchObject({
      error_code: ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME,
    });
  });

  it('rejects symlinks that escape the whitelist directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'onesibox-outside-'));
    const target = path.join(outside, 'mal.sh');
    await fs.writeFile(target, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    await fs.symlink(target, path.join(scriptsDir, 'link.sh'));

    try {
      await expect(executeCustomScript(makeCommand('link.sh'))).rejects.toMatchObject({
        error_code: ERROR_CODES.CUSTOM_SCRIPT_INVALID_NAME,
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('exposes HandlerError with error_code', async () => {
    expect(HandlerError).toBeDefined();
    const e = new HandlerError('E114', 'boom');
    expect(e.error_code).toBe('E114');
    expect(e.message).toBe('boom');
  });
});
