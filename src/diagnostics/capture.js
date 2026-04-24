const { spawn } = require('child_process');

function detectWaylandEnv() {
  const uid = (process.getuid ? process.getuid() : 0);
  return {
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
  };
}

function captureScreen({ quality = 75, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let grim, cwebp;
    const env = { ...process.env, ...detectWaylandEnv() };

    try {
      grim = spawn('grim', ['-t', 'ppm', '-'], { env });
      cwebp = spawn('cwebp', ['-q', String(quality), '-o', '-', '-'], { env });
    } catch (err) {
      return reject(new Error(`spawn failed: ${err.code || err.message}`));
    }

    const chunks = [];
    let grimErr = Buffer.alloc(0);
    let cwebpErr = Buffer.alloc(0);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { grim.kill('SIGKILL'); } catch { /* already exited */ }
      try { cwebp.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error(`capture timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    grim.stdout.on('data', (d) => {
      try { cwebp.stdin.write(d); } catch { /* cwebp may have died */ }
    });
    grim.stderr.on('data', (d) => { grimErr = Buffer.concat([grimErr, d]); });
    grim.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { cwebp.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error(`grim spawn error: ${err.code || err.message}`));
    });
    grim.on('close', (code) => {
      try { cwebp.stdin.end(); } catch { /* stdin closed */ }
      if (code !== 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        try { cwebp.kill('SIGKILL'); } catch { /* already exited */ }
        reject(new Error(`grim exited with code ${code}: ${grimErr.toString()}`));
      }
    });

    cwebp.stdout.on('data', (d) => { chunks.push(d); });
    cwebp.stderr.on('data', (d) => { cwebpErr = Buffer.concat([cwebpErr, d]); });
    cwebp.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { grim.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error(`cwebp spawn error: ${err.code || err.message}`));
    });
    cwebp.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cwebp exited with code ${code}: ${cwebpErr.toString()}`));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

module.exports = { captureScreen };
