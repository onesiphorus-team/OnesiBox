/**
 * Runs the install.sh test suite as part of `npm test`.
 *
 * install-sh.test.sh was reachable only through `npm run test:shell`, while
 * `npm test` was plain jest and the repository has no CI. A suite nobody runs
 * protects nothing, and the regression it guards — `curl … | sudo bash`
 * exiting 0 without installing anything — is silent by nature.
 *
 * Wrapping it rather than chaining `jest && bash …` in the npm script keeps a
 * single runner and a single summary, and puts the shell output in the failure
 * message instead of leaving it above a second, unrelated report.
 * `npm run test:shell` still works on its own.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'install-sh.test.sh');

// The shell suite refuses to run as root, on purpose: without root install.sh
// stops at the prerequisite check, and with it the tests would install
// OnesiBox for real. Skipping keeps `npm test` usable inside a root container
// instead of failing there for a reason that has nothing to do with the code.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const itUnlessRoot = isRoot ? it.skip : it;

describe('install.sh shell suite', () => {
  itUnlessRoot('passes', () => {
    const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 120000 });

    if (result.error) {
      throw new Error(`Could not run ${SCRIPT}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`${SCRIPT} failed (exit ${result.status}):\n\n${result.stdout}${result.stderr}`);
    }
  }, 120000);
});
