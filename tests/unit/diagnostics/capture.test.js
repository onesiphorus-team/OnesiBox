const { EventEmitter } = require('events');

jest.mock('child_process');
const { spawn } = require('child_process');

const { captureScreen } = require('../../../src/diagnostics/capture');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn(), write: jest.fn() };
  child.pid = 12345;
  child.kill = jest.fn();
  return child;
}

describe('captureScreen', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('pipes grim output to cwebp and resolves with the WebP buffer', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ quality: 75, timeoutMs: 5000 });

    setImmediate(() => {
      cwebp.stdout.emit('data', Buffer.from([0x52, 0x49, 0x46, 0x46])); // 'RIFF'
      cwebp.stdout.emit('data', Buffer.from([0x00, 0x00, 0x00, 0x00]));
      cwebp.emit('close', 0);
      grim.emit('close', 0);
    });

    const result = await promise;
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(8);
  });

  it('rejects if grim exits with non-zero', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ timeoutMs: 5000 });

    setImmediate(() => {
      grim.stderr.emit('data', Buffer.from('grim error'));
      grim.emit('close', 1);
      cwebp.emit('close', 1);
    });

    await expect(promise).rejects.toThrow(/grim/);
  });

  it('rejects with ENOENT when spawn throws', async () => {
    spawn.mockImplementationOnce(() => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    await expect(captureScreen({ timeoutMs: 5000 })).rejects.toThrow(/ENOENT/);
  });

  it('kills children and rejects on timeout', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ timeoutMs: 50 });
    // do not emit close → trigger timeout

    await expect(promise).rejects.toThrow(/timeout/i);
    expect(grim.kill).toHaveBeenCalled();
    expect(cwebp.kill).toHaveBeenCalled();
  });
});
