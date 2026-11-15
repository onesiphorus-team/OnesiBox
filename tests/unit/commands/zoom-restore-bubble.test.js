/**
 * joinZoom deve lanciare Chromium in modo che il fumetto "Restore pages?" non
 * compaia sopra la riunione, anche dopo uno spegnimento brusco della box.
 *
 * Due difese, entrambe verificate qui nel punto in cui contano — cioe' nel
 * momento esatto in cui Playwright avvia il browser:
 *  - il profilo e' gia' stato ripulito dal marchio "Crashed";
 *  - il flag --hide-crash-restore-bubble e' fra gli argomenti.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'onesibox-home-'));
jest.spyOn(os, 'homedir').mockReturnValue(FAKE_HOME);

jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));
jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { chromium } = require('playwright');
const { joinZoom } = require('../../../src/commands/handlers/zoom');

const PREFS = path.join(FAKE_HOME, '.onesibox-zoom', 'Default', 'Preferences');
const COMMAND = { payload: { meeting_url: 'https://zoom.us/j/123456789?pwd=abc', participant_name: 'Lucia Iezzi' } };

describe('joinZoom e il fumetto "Restore pages?"', () => {
  let seenAtLaunch;

  beforeEach(() => {
    fs.mkdirSync(path.dirname(PREFS), { recursive: true });
    fs.writeFileSync(PREFS, JSON.stringify({ profile: { exit_type: 'Crashed' } }));

    seenAtLaunch = null;
    chromium.launchPersistentContext.mockImplementation(async (userDataDir, options) => {
      seenAtLaunch = {
        userDataDir,
        args: options.args,
        exitType: JSON.parse(fs.readFileSync(PREFS, 'utf8')).profile.exit_type
      };
      // Il resto del join non interessa a questo test: fermiamolo qui.
      throw new Error('stop dopo il lancio');
    });
  });

  afterAll(() => {
    fs.rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it('ripulisce il profilo prima di avviare Chromium', async () => {
    await joinZoom(COMMAND, {}).catch(() => {});

    expect(seenAtLaunch).not.toBeNull();
    expect(seenAtLaunch.userDataDir).toBe(path.join(FAKE_HOME, '.onesibox-zoom'));
    expect(seenAtLaunch.exitType).toBe('Normal');
  });

  it('passa a Chromium il flag che nasconde il fumetto', async () => {
    await joinZoom(COMMAND, {}).catch(() => {});

    expect(seenAtLaunch.args).toContain('--hide-crash-restore-bubble');
  });
});
