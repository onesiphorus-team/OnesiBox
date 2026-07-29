jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { chromium } = require('playwright');
const {
  joinZoom,
  cleanup: zoomCleanup,
  isZoomActive,
  stopMeetingEndDetection,
} = require('../../../src/commands/handlers/zoom');
const { stateManager, STATUS } = require('../../../src/state/state-manager');

/**
 * Le sovrapposizioni fra due joinZoom() non sono ipotetiche: il manager
 * abbandona un handler che sfora i 180s (_runHandlerWithTimeout) e lascia
 * che continui a girare, mentre il comando successivo parte subito. Questi
 * test riproducono quella finestra con Playwright simulato — la corsa non
 * richiede hardware. Vedi issue #77.
 */

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lascia girare le microtask in sospeso senza far avanzare il tempo. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Un contesto Playwright simulato, con la navigazione sotto controllo del
 * test: `gotoDeferred` decide quando (e come) termina il page.goto().
 */
function makeContext() {
  const gotoDeferred = deferred();

  const page = {
    isClosed: jest.fn(() => false),
    url: jest.fn(() => 'https://app.zoom.us/wc/123456789/start'),
    evaluate: jest.fn().mockResolvedValue(''),
    goto: jest.fn(() => gotoDeferred.promise),
    waitForSelector: jest.fn().mockResolvedValue({
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
    }),
    $: jest.fn().mockResolvedValue(null),
    click: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(undefined),
  };

  const context = {
    pages: jest.fn(() => [page]),
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return { context, page, gotoDeferred };
}

const COMMAND = {
  payload: {
    meeting_url: 'https://zoom.us/j/123456789?pwd=abc',
    participant_name: 'Test Box',
  },
};

describe('joinZoom: due sessioni sovrapposte', () => {
  let browserController;

  beforeEach(() => {
    browserController = { goToStandby: jest.fn().mockResolvedValue(undefined) };
    stateManager.status = STATUS.IDLE;
    stateManager.currentMedia = null;
    stateManager.currentMeeting = null;
  });

  afterEach(async () => {
    stopMeetingEndDetection();
    await zoomCleanup().catch(() => {});
    chromium.launchPersistentContext.mockReset();
    stateManager.status = STATUS.IDLE;
    stateManager.currentMeeting = null;
  });

  it('la sessione superata non chiude il browser di quella che l\'ha sostituita', async () => {
    const abandoned = makeContext();
    const current = makeContext();
    current.gotoDeferred.resolve();

    chromium.launchPersistentContext
      .mockResolvedValueOnce(abandoned.context)
      .mockResolvedValueOnce(current.context);

    // Sessione 1: si pianta nella navigazione, esattamente dove la coglie il
    // timeout del manager.
    const abandonedJoin = joinZoom(COMMAND, browserController);
    await flush();
    expect(abandoned.page.goto).toHaveBeenCalled();

    // Sessione 2: arriva il comando successivo e va a buon fine.
    await joinZoom(COMMAND, browserController);
    expect(isZoomActive()).toBe(true);

    // Solo ora la sessione 1 abbandonata si accorge di essere fallita.
    abandoned.gotoDeferred.reject(new Error('Timeout 30000ms exceeded'));
    await expect(abandonedJoin).rejects.toThrow();
    await flush();

    // Il suo cleanup non deve toccare la riunione in corso.
    expect(current.context.close).not.toHaveBeenCalled();
    expect(isZoomActive()).toBe(true);
  });

  it('la sessione superata non fa screenshot sulla pagina di quella corrente', async () => {
    const abandoned = makeContext();
    const current = makeContext();
    current.gotoDeferred.resolve();

    chromium.launchPersistentContext
      .mockResolvedValueOnce(abandoned.context)
      .mockResolvedValueOnce(current.context);

    const abandonedJoin = joinZoom(COMMAND, browserController);
    await flush();

    await joinZoom(COMMAND, browserController);

    abandoned.gotoDeferred.reject(new Error('Timeout 30000ms exceeded'));
    await expect(abandonedJoin).rejects.toThrow();
    await flush();

    expect(current.page.screenshot).not.toHaveBeenCalled();
  });

  it('non avvia due contesti insieme sullo stesso profilo', async () => {
    const first = makeContext();
    const second = makeContext();
    second.gotoDeferred.resolve();

    const firstLaunch = deferred();
    chromium.launchPersistentContext
      .mockImplementationOnce(() => firstLaunch.promise)
      .mockResolvedValueOnce(second.context);

    // Sessione 1: bloccata dentro launchPersistentContext, con il
    // SingletonLock di ~/.onesibox-zoom già preso dal suo Chromium.
    const firstJoin = joinZoom(COMMAND, browserController);
    await flush();
    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

    // Sessione 2: non deve lanciare un secondo Chromium sullo stesso profilo
    // finché il primo avvio non si è concluso.
    const secondJoin = joinZoom(COMMAND, browserController);
    await flush();
    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

    firstLaunch.resolve(first.context);
    first.gotoDeferred.resolve();
    await firstJoin.catch(() => {});
    await secondJoin;

    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('chiude il contesto della sessione superata invece di lasciarlo orfano', async () => {
    const superseded = makeContext();
    const winner = makeContext();
    superseded.gotoDeferred.resolve();
    winner.gotoDeferred.resolve();

    const firstLaunch = deferred();
    chromium.launchPersistentContext
      .mockImplementationOnce(() => firstLaunch.promise)
      .mockResolvedValueOnce(winner.context);

    const firstJoin = joinZoom(COMMAND, browserController);
    await flush();

    const secondJoin = joinZoom(COMMAND, browserController);
    await flush();

    // Il Chromium della sessione 1 si materializza quando ormai è superata.
    firstLaunch.resolve(superseded.context);
    await firstJoin.catch(() => {});
    await secondJoin;
    await flush();

    // Nessun riferimento resterebbe a quel contesto: va chiuso subito,
    // altrimenti resta acceso fino al riavvio tenendo il lock del profilo.
    expect(superseded.context.close).toHaveBeenCalled();
    expect(winner.context.close).not.toHaveBeenCalled();
    expect(isZoomActive()).toBe(true);
  });
});
