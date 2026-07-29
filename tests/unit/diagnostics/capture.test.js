const { EventEmitter } = require('events');
const { Writable } = require('stream');

jest.mock('child_process');
const { spawn } = require('child_process');

const { captureScreen } = require('../../../src/diagnostics/capture');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  // Real Writable so that writing to a killed child behaves like a dead pipe
  // does in production: EPIPE surfaces as an async 'error' event on the stream,
  // never as a synchronous throw from write().
  child.stdin = new Writable({
    write(chunk, encoding, cb) {
      if (child.killed) {
        const err = new Error('write EPIPE');
        err.code = 'EPIPE';
        err.errno = -32;
        err.syscall = 'write';
        cb(err);
        return;
      }
      cb();
    },
  });
  child.pid = 12345;
  child.kill = jest.fn(() => { child.killed = true; });
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

  it('absorbs EPIPE when grim keeps writing after cwebp was killed', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    try {
      const promise = captureScreen({ timeoutMs: 50 });
      // no close event → timeout fires and SIGKILLs both children
      await expect(promise).rejects.toThrow(/timeout/i);

      // grim is still streaming into the now-dead cwebp stdin
      grim.stdout.emit('data', Buffer.from([0x50, 0x36, 0x0a]));
      await new Promise((r) => setTimeout(r, 20));

      expect(uncaught.map((e) => e.code)).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('does not mask a cwebp failure when the pipe breaks', async () => {
    const grim = fakeChild();
    const cwebp = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => cwebp);

    const promise = captureScreen({ timeoutMs: 5000 });

    setImmediate(() => {
      cwebp.stderr.emit('data', Buffer.from('cwebp boom'));
      cwebp.killed = true;
      cwebp.emit('close', 1);
      grim.stdout.emit('data', Buffer.from([0x50, 0x36, 0x0a]));
    });

    await expect(promise).rejects.toThrow(/cwebp exited with code 1/);
  });
});
