jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { aggiornaStatoAudio, AUDIO_PERSO_DOPO_MS } = require('../../../src/commands/handlers/zoom');
const { stateManager } = require('../../../src/state/state-manager');

// Il server avvisa su Telegram quando una riunione resta senza audio: il box
// deve dirlo solo quando e' certo, mai per un dubbio.
describe('aggiornaStatoAudio', () => {
  function paginaChe(rispondeCon) {
    return { evaluate: jest.fn().mockImplementation(async () => rispondeCon()) };
  }

  beforeEach(() => {
    stateManager.setMeeting({ meeting_url: 'https://us05web.zoom.us/j/123', meeting_id: '123' });
  });

  afterEach(() => {
    stateManager.leaveMeeting();
  });

  it('reports the audio as connected when the "join audio" button is not on screen', async () => {
    await aggiornaStatoAudio(paginaChe(() => ({ presidioAttivo: true, assenteDaMs: 0, riagganci: 2 })));

    expect(stateManager.getState().currentMeeting).toMatchObject({ audio_connected: true, audio_reconnects: 2 });
  });

  it('gives the automatic reconnection some time before reporting the audio as missing', async () => {
    await aggiornaStatoAudio(paginaChe(() => ({ presidioAttivo: true, assenteDaMs: AUDIO_PERSO_DOPO_MS - 1000, riagganci: 5 })));
    expect(stateManager.getState().currentMeeting.audio_connected).toBe(true);

    await aggiornaStatoAudio(paginaChe(() => ({ presidioAttivo: true, assenteDaMs: AUDIO_PERSO_DOPO_MS + 1000, riagganci: 15 })));
    expect(stateManager.getState().currentMeeting.audio_connected).toBe(false);
  });

  it('reports "unknown" when the meeting watch is not running or the page does not answer', async () => {
    await aggiornaStatoAudio(paginaChe(() => ({ presidioAttivo: false, assenteDaMs: 0, riagganci: 0 })));
    expect(stateManager.getState().currentMeeting.audio_connected).toBeNull();

    await aggiornaStatoAudio(paginaChe(() => { throw new Error('Target closed'); }));
    expect(stateManager.getState().currentMeeting.audio_connected).toBeNull();
  });
});
