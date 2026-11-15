const fs = require('fs');
const path = require('path');
const logger = require('../logging/logger');

/**
 * Toglie da un profilo Chromium il marchio di "uscita anomala".
 *
 * Le box vengono spente staccando la corrente, quindi Chromium non chiude mai
 * il profilo in modo pulito: nelle Preferences resta `exit_type: "Crashed"` e
 * al lancio successivo compare il fumetto "Restore pages?" sopra la pagina.
 * In kiosk nessuno puo' chiuderlo. Va chiamata PRIMA di avviare il browser,
 * a browser spento: Chromium riscrive il file mentre gira.
 *
 * Non lancia mai: un profilo illeggibile non deve impedire l'avvio del browser.
 *
 * @param {string} userDataDir - La user-data-dir passata a Chromium
 * @returns {boolean} true se le Preferences sono state corrette
 */
function markProfileCleanExit(userDataDir) {
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');

  let raw;
  try {
    raw = fs.readFileSync(prefsPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Cannot read Chromium Preferences', { prefsPath, error: error.message });
    }
    return false; // ENOENT: primo avvio, il profilo non esiste ancora
  }

  try {
    const prefs = JSON.parse(raw);
    const profile = prefs.profile && typeof prefs.profile === 'object' ? prefs.profile : {};
    const previousExitType = profile.exit_type;

    const exitTypeOk = previousExitType === undefined || previousExitType === 'Normal';
    if (exitTypeOk && profile.exited_cleanly !== false) {
      return false;
    }

    prefs.profile = { ...profile, exit_type: 'Normal', exited_cleanly: true };

    // Scrittura atomica: se manca la corrente a meta', resta il file vecchio
    // intero invece di uno troncato (che azzererebbe i permessi di mic e webcam).
    const tmpPath = `${prefsPath}.onesibox-tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(prefs));
      fs.renameSync(tmpPath, prefsPath);
    } catch (error) {
      fs.rmSync(tmpPath, { force: true });
      throw error;
    }

    logger.info('Cleared crash marker from Chromium profile', { userDataDir, previousExitType });
    return true;
  } catch (error) {
    logger.warn('Cannot clear crash marker from Chromium profile', { prefsPath, error: error.message });
    return false;
  }
}

module.exports = { markProfileCleanExit };
