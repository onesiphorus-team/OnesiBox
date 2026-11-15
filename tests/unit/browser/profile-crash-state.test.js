/**
 * markProfileCleanExit deve togliere dal profilo di Chromium il marchio di
 * "uscita anomala" prima che il browser parta.
 *
 * Il contesto: le box vengono spente staccando la corrente. Chromium trova
 * allora `exit_type: "Crashed"` nelle Preferences e al lancio successivo apre
 * il fumetto "Restore pages?" sopra la riunione Zoom, dove nessuno puo'
 * chiuderlo — osservato su Lucia il 2026-11-15.
 */

jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const logger = require('../../../src/logging/logger');
const { markProfileCleanExit } = require('../../../src/browser/profile-crash-state');

describe('markProfileCleanExit', () => {
  let userDataDir;
  let prefsPath;

  const writePrefs = (content) => {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const readPrefs = () => JSON.parse(fs.readFileSync(prefsPath, 'utf8'));

  beforeEach(() => {
    jest.clearAllMocks();
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onesibox-profile-'));
    prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('riporta a Normal un profilo marcato Crashed', () => {
    writePrefs({ profile: { exit_type: 'Crashed', name: 'Person 1' } });

    expect(markProfileCleanExit(userDataDir)).toBe(true);

    expect(readPrefs().profile.exit_type).toBe('Normal');
    expect(readPrefs().profile.exited_cleanly).toBe(true);
  });

  it('non perde le altre impostazioni del profilo', () => {
    // I permessi di microfono e webcam concessi a Zoom vivono in questo file.
    const original = {
      profile: {
        exit_type: 'Crashed',
        name: 'Person 1',
        content_settings: { exceptions: { media_stream_mic: { 'https://app.zoom.us:443,*': { setting: 1 } } } }
      },
      browser: { window_placement: { maximized: true } }
    };
    writePrefs(original);

    markProfileCleanExit(userDataDir);

    expect(readPrefs()).toEqual({
      ...original,
      profile: { ...original.profile, exit_type: 'Normal', exited_cleanly: true }
    });
  });

  it('copre anche il vecchio flag exited_cleanly=false', () => {
    writePrefs({ profile: { exit_type: 'Normal', exited_cleanly: false } });

    expect(markProfileCleanExit(userDataDir)).toBe(true);
    expect(readPrefs().profile.exited_cleanly).toBe(true);
  });

  it('non riscrive un profilo gia pulito', () => {
    writePrefs({ profile: { exit_type: 'Normal', exited_cleanly: true } });
    const before = fs.statSync(prefsPath).mtimeMs;

    expect(markProfileCleanExit(userDataDir)).toBe(false);
    expect(fs.statSync(prefsPath).mtimeMs).toBe(before);
  });

  it('non fa nulla al primo avvio, quando il profilo non esiste ancora', () => {
    expect(markProfileCleanExit(userDataDir)).toBe(false);
    expect(fs.existsSync(prefsPath)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('lascia intatte Preferences illeggibili e non lancia', () => {
    // Un file troncato dallo spegnimento non deve impedire l'ingresso in riunione.
    writePrefs('{"profile": {"exit_type": "Cra');

    expect(() => markProfileCleanExit(userDataDir)).not.toThrow();
    expect(markProfileCleanExit(userDataDir)).toBe(false);
    expect(fs.readFileSync(prefsPath, 'utf8')).toBe('{"profile": {"exit_type": "Cra');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('non lascia file temporanei nel profilo', () => {
    writePrefs({ profile: { exit_type: 'Crashed' } });

    markProfileCleanExit(userDataDir);

    expect(fs.readdirSync(path.dirname(prefsPath))).toEqual(['Preferences']);
  });
});
