/**
 * Runs the update.sh test suite as part of `npm test`.
 *
 * Same reasoning as install-sh.test.js, applied to the script that carries the
 * most risk: update.sh runs as root, from cron, at 03:00, on devices in private
 * homes where nobody can intervene. Its failure paths — a migration that fails,
 * npm install breaking halfway, a service that does not come back — are by
 * definition the ones nobody re-runs by hand, so leaving that suite reachable
 * only through `npm run test:shell` meant the most dangerous script had the
 * least executed tests.
 *
 * The shell suite guards its own fixture: if update.sh's configuration
 * constants stop matching what it expects, it refuses to run rather than risk
 * operating on the real /opt/onesibox. That refusal is a non-zero exit and
 * surfaces here as a failure, which is the intended behaviour — it means the
 * test needs updating alongside the script.
 *
 * `npm run test:shell` still works on its own.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'update-sh.test.sh');

// Mirrors install-sh.test.js: the shell suite declines to run as root so it
// cannot touch a real installation. Skipping keeps `npm test` usable inside a
// root container instead of failing there for a reason unrelated to the code.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const itUnlessRoot = isRoot ? it.skip : it;

describe('update.sh shell suite', () => {
  itUnlessRoot('passes', () => {
    const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 180000 });

    if (result.error) {
      throw new Error(`Could not run ${SCRIPT}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`${SCRIPT} failed (exit ${result.status}):\n\n${result.stdout}${result.stderr}`);
    }
  }, 180000);
});
