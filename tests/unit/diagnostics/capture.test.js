const { EventEmitter } = require('events');
const { Writable } = require('stream');

jest.mock('child_process');
const { spawn } = require('child_process');

const { captureScreen } = require('../../../src/diagnostics/capture');

/**
 * Record every 'error' a stream emits while nobody is listening.
 *
 * That is exactly the condition Node turns into an uncaught exception, which in
 * production takes the whole kiosk process down. Asserting on it directly keeps
 * the check about the source under test: Jest's runner swallows the real
 * uncaughtException before a `process.on('uncaughtException')` listener
 * installed by a test can ever observe it, so such a listener always sees an
 * empty list and asserting on it proves nothing.
 */
function trackEscapedErrors(stream, sink) {
  const emit = stream.emit.bind(stream);
  stream.emit = (event, ...args) => {
    if (event === 'error' && stream.listenerCount('error') === 0) {
      sink.push(args[0]);
      return false;
    }
    return emit(event, ...args);
  };
  return stream;
}

function fakeChild() {
  const child = new EventEmitter();
  // Errors that would have become uncaught exceptions, per child.
  child.escapedErrors = [];
  child.stdout = trackEscapedErrors(new EventEmitter(), child.escapedErrors);
  child.stderr = trackEscapedErrors(new EventEmitter(), child.escapedErrors);
  child.killed = false;
  // Real Writable so that writing to a killed child behaves like a dead pipe
  // does in production: EPIPE surfaces as an async 'error' event on the stream,
  // never as a synchronous throw from write().
  child.stdin = trackEscapedErrors(new Writable({
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
  }), child.escapedErrors);
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

  it('kills grim when the cwebp spawn throws synchronously', async () => {
    const grim = fakeChild();
    spawn
      .mockImplementationOnce(() => grim)
      .mockImplementationOnce(() => {
        // EMFILE/EAGAIN under file-descriptor exhaustion throw synchronously,
        // unlike ENOENT which arrives as an async 'error' event.
        const err = new Error('spawn EMFILE');
        err.code = 'EMFILE';
        throw err;
      });

    await expect(captureScreen({ timeoutMs: 5000 })).rejects.toThrow(/EMFILE/);

    // Without this, grim survives the rejection blocked on a pipe nobody
    // reads: one orphan per tick on a Pi that runs for months.
    expect(grim.kill).toHaveBeenCalledWith('SIGKILL');
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

    const promise = captureScreen({ timeoutMs: 50 });
    // no close event → timeout fires and SIGKILLs both children
    await expect(promise).rejects.toThrow(/timeout/i);

    // Every child stream must be guarded before any EPIPE can land on it.
    for (const stream of [grim.stdin, grim.stdout, grim.stderr,
      cwebp.stdin, cwebp.stdout, cwebp.stderr]) {
      expect(stream.listenerCount('error')).toBeGreaterThan(0);
    }

    // grim is still streaming into the now-dead cwebp stdin
    grim.stdout.emit('data', Buffer.from([0x50, 0x36, 0x0a]));
    await new Promise((r) => setTimeout(r, 20));

    // The EPIPE must have reached a listener; escaping here means Node would
    // have promoted it to an uncaught exception and killed the process.
    expect(cwebp.escapedErrors.map((e) => e.code)).toEqual([]);
    expect(grim.escapedErrors.map((e) => e.code)).toEqual([]);
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

    // The broken pipe must not escape either: the real failure is the cwebp
    // exit code, not a process-killing EPIPE on the way out.
    await new Promise((r) => setTimeout(r, 20));
    expect(cwebp.escapedErrors.map((e) => e.code)).toEqual([]);
  });
});
