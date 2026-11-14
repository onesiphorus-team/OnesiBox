const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isZoomUrl } = require('../validator');

// Directory for persistent browser profile
const USER_DATA_DIR = path.join(os.homedir(), '.onesibox-zoom');

// Delay before starting end-of-meeting polling (1h 45m).
// Meetings typically don't end before this, so we don't waste cycles polling early.
const END_DETECTION_START_DELAY_MS = 105 * 60 * 1000;

// How often to poll the Zoom page once detection starts.
const END_DETECTION_POLL_INTERVAL_MS = 30 * 1000;

// Hostnames considered "still inside a Zoom meeting". Anything else (Zoom redirects to
// us02web.zoom.us / zoom.us "leave_url" / about:blank when the host ends) means we're out.
const ZOOM_MEETING_HOST_PATTERN = /(^|\.)zoom\.us$/i;
const ZOOM_MEETING_PATH_PATTERN = /\/wc\//;

// Phrases that Zoom shows on the "meeting ended" / "removed by host" screens, in EN/IT.
// Only full sentences specific enough that they wouldn't appear naturally in chat —
// short phrases like "meeting ended" or "riunione terminata" are excluded to avoid
// false positives if a participant happens to type them after the 1h 45m mark.
const MEETING_ENDED_PHRASES = [
  'this meeting has been ended',
  'the host has ended this meeting',
  "l'host ha terminato",
  'la riunione è stata terminata',
  'è stata terminata dall',
];

// Se il pulsante "Join Audio by Computer" resta a schermo cosi' a lungo
// nonostante il riaggancio automatico (che lo preme ogni 3 secondi), la
// riunione e' davvero senza audio: lo si riferisce al server, che avvisa.
const AUDIO_PERSO_DOPO_MS = 45_000;

// Playwright browser context (persists between calls)
let browserContext = null;
let page = null;

// End-of-meeting detection timers (module-level so they can be cleared from any handler).
let endDetectionStartTimer = null;
let endDetectionPollInterval = null;
let endDetectionTicking = false;

// Serializzazione dei comandi join. Il backend consegna lo stesso join piu'
// volte (WebSocket + polling senza dedup, piu' i retry quando l'ack del primo
// tentativo tarda). La sera del 14/08/2026 questo ha prodotto: due browser che
// si contendevano il SingletonLock dello stesso profilo, page.goto abortite a
// vicenda, e un duplicato che — trovando lo stato CALLING — e' USCITO dalla
// riunione appena joinata per rientrarci. La riunione e' partita solo al terzo
// giro, con la GPU ormai compromessa e i video in arrivo neri.
let joinInCorso = null; // Promise del join in volo, null se nessuno
let joinMeetingIdInCorso = null;

// Quanti rilanci del browser ha gia' fatto la verifica WebGL per il join
// corrente: al massimo uno, altrimenti un guasto GPU persistente diventerebbe
// un ciclo infinito di rientri in riunione.
let rilanciPerWebgl = 0;

// Attesa prima della sonda WebGL dopo il join: il client Zoom impiega qualche
// secondo a inizializzare il rendering, e una sonda troppo precoce rischia di
// misurare uno stato transitorio.
const WEBGL_CHECK_DELAY_MS = 25 * 1000;
const WEBGL_RECHECK_DELAY_MS = 8 * 1000;

/**
 * Convert Zoom meeting URL to web client format.
 *
 * Handles various Zoom URL formats:
 * - https://us05web.zoom.us/j/123456789?pwd=xxx
 * - https://zoom.us/j/123456789?pwd=xxx
 *
 * @param {string} url - Original Zoom URL
 * @returns {string} - Web client URL
 */
function convertToWebClientUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/');

    // Find meeting ID after /j/
    const jIndex = pathParts.indexOf('j');
    const meetingId = jIndex !== -1 ? pathParts[jIndex + 1] : null;

    if (!meetingId) {
      throw new Error('Cannot extract meeting ID from URL');
    }

    const password = parsedUrl.searchParams.get('pwd');

    let webClientUrl = `https://app.zoom.us/wc/${meetingId}/join`;
    if (password) {
      webClientUrl += `?pwd=${password}`;
    }

    return webClientUrl;
  } catch (error) {
    logger.error('Failed to convert Zoom URL', { url, error: error.message });
    throw error;
  }
}

/**
 * Costruisce l'URL del web client a partire dal link ricevuto dall'esterno.
 *
 * Il link originale non viene toccato: quello che componiamo e' l'URL di
 * app.zoom.us che apriamo noi, e vi aggiungiamo `uname` cosi' Zoom precompila
 * il nome del partecipante.
 *
 * Serve perche' la box e' un kiosk senza tastiera davanti a una persona
 * anziana: senza il nome nell'URL, Zoom mostra "Enter Meeting Info" con il
 * campo vuoto e il pulsante Join disabilitato, e nessuno puo' compilarlo.
 * Il riempimento via automazione in joinZoom() resta come riserva, ma dipende
 * dal fatto che il form sia gia' comparso: Zoom mostra prima "Joining
 * Meeting..." e il form arriva dopo, quindi non e' affidabile da solo.
 */
function buildJoinUrl(meetingUrl, participantName) {
  const webClientUrl = convertToWebClientUrl(meetingUrl);

  if (!participantName) {
    return webClientUrl;
  }

  const separator = webClientUrl.includes('?') ? '&' : '?';

  return `${webClientUrl}${separator}uname=${encodeURIComponent(participantName)}`;
}

/**
 * Parse Zoom URL to extract meeting details.
 *
 * @param {string} url - The URL to parse
 * @returns {{ meetingId: string|null, password: string|null }}
 */
function parseZoomUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');

    let meetingId = null;
    let password = null;

    const jIndex = pathParts.indexOf('j');
    if (jIndex !== -1 && pathParts[jIndex + 1]) {
      meetingId = pathParts[jIndex + 1];
    }

    password = urlObj.searchParams.get('pwd');

    return { meetingId, password };
  } catch {
    return { meetingId: null, password: null };
  }
}

/**
 * Close existing Playwright browser context if open.
 */
async function closeBrowserContext() {
  stopMeetingEndDetection();
  if (browserContext) {
    try {
      await browserContext.close();
    } catch (error) {
      logger.warn('Error closing browser context', { error: error.message });
    }
    browserContext = null;
    page = null;
  }
}

/**
 * Check whether the current Playwright page is on a "meeting ended" state.
 *
 * Looks at both URL (Zoom navigates away from /wc/ when the host ends) and visible
 * page text ("Meeting Ended", "L'host ha terminato la riunione", etc.). Returns true
 * if any signal indicates the meeting is no longer active.
 *
 * @param {import('playwright').Page} activePage
 * @returns {Promise<boolean>}
 */
async function checkMeetingEnded(activePage) {
  if (!activePage || activePage.isClosed()) {
    return true;
  }

  let currentUrl;
  try {
    currentUrl = activePage.url();
  } catch {
    return true;
  }

  if (!currentUrl || currentUrl === 'about:blank') {
    return true;
  }

  try {
    const parsed = new URL(currentUrl);
    const hostMatches = ZOOM_MEETING_HOST_PATTERN.test(parsed.hostname);
    const pathMatches = ZOOM_MEETING_PATH_PATTERN.test(parsed.pathname);
    if (!hostMatches || !pathMatches) {
      return true;
    }
  } catch {
    return true;
  }

  try {
    // Cap to 8KB: end-of-meeting banners are short and live near the top of body,
    // so we don't need (and shouldn't ship over IPC) a full chat transcript.
    const bodyText = await activePage.evaluate(
      () => (document.body?.innerText || '').slice(0, 8192)
    );
    const normalized = bodyText.toLowerCase();
    if (MEETING_ENDED_PHRASES.some((phrase) => normalized.includes(phrase))) {
      return true;
    }
  } catch (error) {
    logger.warn('Failed to read Zoom page body for end detection', { error: error.message });
  }

  return false;
}

/**
 * Stop both the deferred start timer and the active polling interval, if any.
 */
function stopMeetingEndDetection() {
  if (endDetectionStartTimer) {
    clearTimeout(endDetectionStartTimer);
    endDetectionStartTimer = null;
  }
  if (endDetectionPollInterval) {
    clearInterval(endDetectionPollInterval);
    endDetectionPollInterval = null;
  }
  endDetectionTicking = false;
}

/**
 * Schedule end-of-meeting polling. After END_DETECTION_START_DELAY_MS we start polling
 * the Playwright page every END_DETECTION_POLL_INTERVAL_MS. When `checkMeetingEnded`
 * returns true, we tear down the browser context and update state — same effect as a
 * manual `leaveZoom`, but triggered by the host closing the meeting.
 *
 * @param {object} browserController - Used to keep the main kiosk browser in standby.
 */
function startMeetingEndDetection(browserController) {
  stopMeetingEndDetection();

  logger.info('Scheduling Zoom end-of-meeting detection', {
    start_delay_ms: END_DETECTION_START_DELAY_MS,
    poll_interval_ms: END_DETECTION_POLL_INTERVAL_MS,
  });

  endDetectionStartTimer = setTimeout(() => {
    endDetectionStartTimer = null;

    if (!browserContext || !page) {
      logger.info('End-detection start fired but no active Zoom session, skipping');
      return;
    }

    logger.info('Starting Zoom end-of-meeting polling');
    endDetectionPollInterval = setInterval(
      () => runEndDetectionTick(browserController),
      END_DETECTION_POLL_INTERVAL_MS
    );
  }, END_DETECTION_START_DELAY_MS);
}

/**
 * One polling tick: read the page, and if the meeting has ended, clean up.
 * Guarded against re-entrance so a slow page evaluation can't overlap with itself.
 *
 * @param {object} browserController
 */
async function runEndDetectionTick(browserController) {
  if (endDetectionTicking) {
    return;
  }
  endDetectionTicking = true;

  try {
    const activePage = page;
    if (!browserContext || !activePage) {
      stopMeetingEndDetection();
      return;
    }

    const ended = await checkMeetingEnded(activePage);
    if (!ended) {
      await aggiornaStatoAudio(activePage);
      return;
    }

    logger.info('Detected Zoom meeting ended by host, cleaning up');

    stopMeetingEndDetection();
    await closeBrowserContext();

    if (stateManager.getState().status === STATUS.CALLING) {
      stateManager.leaveMeeting();
    }

    if (browserController && typeof browserController.goToStandby === 'function') {
      try {
        await browserController.goToStandby();
      } catch (error) {
        logger.warn('Failed to return main browser to standby after Zoom end', { error: error.message });
      }
    }
  } catch (error) {
    logger.warn('End-of-meeting tick failed', { error: error.message });
  } finally {
    endDetectionTicking = false;
  }
}

/**
 * Legge dalla pagina della riunione se Zoom ha l'audio collegato e lo salva
 * nello stato, che il heartbeat riferisce al server.
 *
 * "Senza audio" solo se il pulsante "Join Audio by Computer" e' rimasto a
 * schermo per AUDIO_PERSO_DOPO_MS nonostante il riaggancio automatico. Se la
 * pagina non risponde o il presidio non e' partito, l'esito resta ignoto
 * (null): meglio nessun avviso che un falso allarme.
 *
 * @param {import('playwright').Page} activePage
 */
async function aggiornaStatoAudio(activePage) {
  let letto = null;
  try {
    letto = await activePage.evaluate(() => ({
      presidioAttivo: !!window.__onesiboxVistaTimer,
      assenteDaMs: window.__onesiboxAudioAssenteDa ? Date.now() - window.__onesiboxAudioAssenteDa : 0,
      riagganci: window.__onesiboxRiagganciAudio || 0,
    }));
  } catch {
    letto = null;
  }

  if (!letto || !letto.presidioAttivo) {
    stateManager.setMeetingAudio({ audioConnected: null, audioReconnects: null });
    return;
  }

  stateManager.setMeetingAudio({
    audioConnected: letto.assenteDaMs < AUDIO_PERSO_DOPO_MS,
    audioReconnects: letto.riagganci,
  });
}

/**
 * Nasconde la striscia di miniature dei partecipanti, lasciando solo il video
 * grande (oratore attivo o schermo condiviso).
 *
 * Non e' una questione estetica: ogni riquadro visibile e' un decoder H.264 in
 * piu', e Zoom smette di richiedere al server gli stream che non stai
 * mostrando. Su un Pi 4 che regge a fatica un flusso, e' la differenza tra
 * fluido e a scatti.
 *
 * L'euristica non usa i nomi delle classi di Zoom, che cambiano a ogni
 * rilascio: guarda la geometria. Il video con l'area maggiore e' quello
 * principale; per ogni altro video si risale l'albero fino al piu' alto
 * antenato che NON contiene il video principale, e si nasconde quello. Cosi'
 * per costruzione e' impossibile nascondere il riquadro grande: nel momento in
 * cui un antenato lo conterrebbe, la risalita si ferma.
 *
 * Rigirata ogni 3 secondi perche' Zoom ricostruisce il DOM quando cambia
 * l'oratore o parte una condivisione. Se restasse zero video visibili, il
 * passaggio si annulla da solo.
 */
async function nascondiPartecipantiSecondari(page) {
  try {
    // L'interfaccia della riunione impiega qualche secondo a comparire dopo il
    // click su Join: prima di allora non c'e' nulla da misurare.
    await page.waitForTimeout(9000);

    // Disattivato di default (opt-in con ONESIBOX_NASCONDI_MINIATURE=1): la
    // configurazione verificata sul campo e' quella del box Pi 4 che dal
    // 15/08/2026 entra in tutte le adunanze, e li' l'occultamento e' spento
    // (era stato escluso durante l'indagine sui video neri e non e' mai
    // servito riaccenderlo). Il riaggancio dell'audio resta sempre attivo.
    const nascondiMiniature = process.env.ONESIBOX_NASCONDI_MINIATURE === '1';

    const esito = await page.evaluate((attivaMiniature) => {
      window.__onesiboxNascondiMiniature = attivaMiniature;
      // Zoom ripropone "Join Audio by Computer" al centro dello schermo quando
      // perde l'aggancio all'audio, anche se era gia' stato premuto. Su un
      // kiosk davanti a una persona anziana quel pulsante non lo preme
      // nessuno: da li' in poi la riunione resta muta fino a fine adunanza.
      //
      // Il testo richiesto contiene sia "audio" sia "computer" (o l'equivalente
      // italiano) proprio per non rischiare di premere altro: "Leave", "Mute" e
      // i pulsanti della barra non possono corrispondere.
      const riagganciaAudio = () => {
        const frasi = [
          ['audio', 'computer'],
          ['audio', 'dispositivo'],
        ];
        const candidati = document.querySelectorAll('button, [role="button"], a');
        for (const b of candidati) {
          const testo = (b.innerText || b.textContent || '').trim().toLowerCase();
          if (!testo || testo.length > 60) continue;
          if (frasi.some((parole) => parole.every((p) => testo.includes(p)))) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              b.click();
              return testo;
            }
          }
        }
        return null;
      };

      const applica = () => {
        const riagganciato = riagganciaAudio();
        if (riagganciato) {
          window.__onesiboxRiagganciAudio = (window.__onesiboxRiagganciAudio || 0) + 1;
          console.log('[onesibox] riagganciato audio premendo:', riagganciato);
        }
        // Da quando il pulsante dell'audio e' visibile senza interruzioni: se
        // il clic funziona sparisce al giro dopo e il conteggio si azzera.
        if (riagganciato) {
          window.__onesiboxAudioAssenteDa = window.__onesiboxAudioAssenteDa || Date.now();
        } else {
          window.__onesiboxAudioAssenteDa = null;
        }

        // Il riaggancio audio va sempre fatto; nascondere le miniature invece
        // e' un'ottimizzazione opzionale, attivabile senza toccare il resto
        // con ONESIBOX_NASCONDI_MINIATURE=1.
        if (!window.__onesiboxNascondiMiniature) {
          return { video: -1, nascosti: 0, disattivato: true };
        }
        const visibili = Array.from(document.querySelectorAll('video'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { el, area: r.width * r.height, w: Math.round(r.width), h: Math.round(r.height) };
          })
          .filter((v) => v.area > 400)
          .sort((a, b) => b.area - a.area);

        if (visibili.length < 2) {
          return { video: visibili.length, nascosti: 0, principale: visibili[0] || null };
        }

        const principale = visibili[0].el;
        let nascosti = 0;

        for (const { el } of visibili.slice(1)) {
          let nodo = el;
          while (
            nodo.parentElement
            && nodo.parentElement !== document.body
            && !nodo.parentElement.contains(principale)
          ) {
            nodo = nodo.parentElement;
          }
          // se risalendo siamo arrivati a un nodo che contiene il principale,
          // non tocchiamo niente: significa che i due video condividono il
          // contenitore piu' vicino e non sono separabili senza rischi.
          if (!nodo.contains(principale) && nodo !== document.body) {
            nodo.style.setProperty('display', 'none', 'important');
            nascosti += 1;
          }
        }

        // rete di sicurezza: se abbiamo lasciato lo schermo senza video,
        // annulliamo tutto invece di lasciare l'anziana davanti al nero.
        const ancoraVisibili = Array.from(document.querySelectorAll('video'))
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width * r.height > 400; });
        if (ancoraVisibili.length === 0) {
          document.querySelectorAll('[style*="display"]').forEach((el) => {
            if (el.style.display === 'none') el.style.removeProperty('display');
          });
          return { video: visibili.length, nascosti: 0, annullato: true };
        }

        return {
          video: visibili.length,
          nascosti,
          principale: { w: visibili[0].w, h: visibili[0].h },
        };
      };

      const primo = applica();
      if (!window.__onesiboxVistaTimer) {
        window.__onesiboxVistaTimer = setInterval(applica, 3000);
      }

      // diagnostica: serve a capire come e' fatto il DOM di Zoom senza doverci
      // entrare a mano, cosi' la prossima regolazione si fa sui dati veri.
      const contenitori = Array.from(document.querySelectorAll('video')).slice(0, 8).map((el) => {
        const r = el.getBoundingClientRect();
        const p = el.parentElement;
        return `${Math.round(r.width)}x${Math.round(r.height)} <${(p && p.className && String(p.className).slice(0, 60)) || '?'}>`;
      });

      return { ...primo, contenitori };
    }, nascondiMiniature);

    logger.info('Presidio riunione attivo (miniature + riaggancio audio)', {
      ...esito,
      miniatureAttive: nascondiMiniature,
    });
  } catch (error) {
    // Non deve mai far fallire la riunione: nel peggiore dei casi si resta con
    // la striscia visibile, che e' esattamente la situazione di prima.
    logger.warn('Impossibile avviare il presidio della riunione', { error: error.message });
  }
}

/**
 * Sceglie il binario del browser di Zoom.
 *
 * Default: il Chromium di sistema (vedi il commento al lancio in
 * eseguiJoinZoom: e' l'unico con H.264). Se non c'e' — macchina di sviluppo,
 * installazione incompleta — si ripiega sul Chromium di Playwright invece di
 * fallire il join: un video a volte nero e' meglio di nessuna riunione.
 *
 * ONESIBOX_ZOOM_BROWSER=bundled forza il Chromium di Playwright, il
 * comportamento precedente: e' la via di rientro rapida se su qualche box il
 * Chromium di sistema desse problemi, senza dover toccare il codice.
 *
 * @returns {string|undefined} percorso dell'eseguibile, o undefined per il
 *   Chromium di Playwright
 */
function resolveZoomExecutable() {
  const scelta = (process.env.ONESIBOX_ZOOM_BROWSER || 'system').toLowerCase();
  if (scelta === 'bundled') {
    logger.info('Zoom: uso il Chromium di Playwright (ONESIBOX_ZOOM_BROWSER=bundled)');
    return undefined;
  }

  // Richiesto qui e non in testa al modulo: controller.js e' pesante da
  // caricare e ai test di questo handler non serve.
  const BrowserController = require('../../browser/controller');
  const percorso = BrowserController.findChromiumPath();
  if (!percorso) {
    logger.warn('Zoom: Chromium di sistema non trovato, ripiego su quello di Playwright (niente H.264)');
    return undefined;
  }
  return percorso;
}

/**
 * Lancia il browser di Zoom; se il profilo persistente e' inservibile, lo
 * svuota e riprova una volta sola.
 *
 * Un profilo Chromium e' legato alla build che lo ha scritto: dentro ci sono
 * ShaderCache, GraphiteDawnCache e Local State. Aprirlo con un binario diverso
 * puo' far uscire il browser all'avvio con SIGTRAP, prima ancora di mostrare
 * una finestra. È successo il 14/08/2026 passando dal Chromium di Playwright a
 * quello di sistema: il profilo vecchio dava SIGTRAP a ogni tentativo, uno
 * pulito partiva senza problemi.
 *
 * Senza questo recupero, un profilo corrotto significa che nessuno entra piu'
 * in nessuna riunione finche' qualcuno non va sul posto — e sul posto c'e' una
 * persona anziana che il dispositivo non lo tocca.
 *
 * La directory NON viene rimossa, solo svuotata: onesibox.service la elenca in
 * ReadWritePaths, e se sparisse systemd non riuscirebbe piu' ad avviare il
 * servizio.
 */
async function lanciaConProfiloRecuperabile(opzioni) {
  try {
    return await chromium.launchPersistentContext(USER_DATA_DIR, opzioni);
  } catch (errore) {
    logger.warn('Avvio del browser Zoom fallito, provo a rigenerare il profilo', {
      error: errore.message.split('\n')[0],
    });

    try {
      for (const voce of fs.readdirSync(USER_DATA_DIR)) {
        fs.rmSync(path.join(USER_DATA_DIR, voce), { recursive: true, force: true });
      }
      logger.info('Profilo Zoom svuotato, secondo tentativo di avvio');
    } catch (erroreProfilo) {
      logger.error('Impossibile svuotare il profilo Zoom', { error: erroreProfilo.message });
      throw errore;
    }

    return chromium.launchPersistentContext(USER_DATA_DIR, opzioni);
  }
}

/**
 * Sonda il WebGL2 della pagina Zoom qualche secondo dopo il join e, se manca,
 * rilancia il browser una volta sola.
 *
 * Perche' serve: senza WebGL2 il client Zoom non disegna i video degli altri
 * partecipanti — schermo nero per tutta la riunione, e davanti allo schermo
 * c'e' una persona anziana che non puo' ne' accorgersene in tempo ne'
 * intervenire. I flag giusti (--use-angle=gles) non bastano quando il GPU
 * process e' stato compromesso da lanci/kill concorrenti prima del join (e'
 * successo la sera del 14/08/2026), e --enable-unsafe-swiftshader non fa da
 * rete di sicurezza se SwiftShader non e' incluso nella build (Chromium
 * Debian arm64). Un rilancio pulito a tempesta finita risolve.
 *
 * Prudenza: si agisce solo su un "no" certo della sonda (contesto webgl2
 * null), confermato da una seconda misura. Un esito ignoto (evaluate fallita
 * o timeout) non fa rilanciare niente: meglio non toccare una riunione che
 * magari funziona.
 */
async function verificaWebglDopoJoin(paginaDelJoin, command, browserController) {
  const sonda = async () => {
    try {
      return await Promise.race([
        paginaDelJoin.evaluate(() => {
          const canvas = document.createElement('canvas');
          return { webgl2: !!canvas.getContext('webgl2') };
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
      ]);
    } catch {
      return null;
    }
  };

  // La pagina potrebbe essere stata sostituita o chiusa nel frattempo (nuovo
  // join, uscita dalla riunione): in quel caso questa verifica non ha piu'
  // niente da dire.
  const paginaAncoraAttuale = () => page === paginaDelJoin && !paginaDelJoin.isClosed();

  await new Promise((resolve) => setTimeout(resolve, WEBGL_CHECK_DELAY_MS));
  if (!paginaAncoraAttuale()) return;

  // Certo e' solo un oggetto con webgl2 booleano: qualunque altra risposta
  // (null per evaluate fallita o timeout, o una forma inattesa) vale "ignoto".
  const esitoCerto = (e) => !!e && typeof e.webgl2 === 'boolean';

  let esito = await sonda();
  if (!esitoCerto(esito)) {
    logger.warn('Verifica WebGL dopo il join: esito ignoto, nessuna azione');
    return;
  }
  if (esito.webgl2) {
    logger.info('Verifica WebGL dopo il join: ok');
    return;
  }

  // Prima misura negativa: riconferma dopo una pausa, il GPU process potrebbe
  // essersi appena riavviato da solo.
  await new Promise((resolve) => setTimeout(resolve, WEBGL_RECHECK_DELAY_MS));
  if (!paginaAncoraAttuale()) return;

  esito = await sonda();
  if (!esitoCerto(esito) || esito.webgl2) {
    logger.info('Verifica WebGL: negativa alla prima misura ma non alla seconda, nessuna azione', { esito });
    return;
  }

  if (rilanciPerWebgl >= 1) {
    logger.error('WebGL ancora assente dopo il rilancio: niente altri tentativi, serve intervento');
    return;
  }
  rilanciPerWebgl += 1;

  logger.error('WebGL assente dopo il join: i video in arrivo sarebbero neri, rilancio pulito del browser Zoom');

  await closeBrowserContext();
  if (stateManager.getState().status === STATUS.CALLING) {
    stateManager.leaveMeeting();
  }

  // __rilancioWebgl dice al wrapper di non azzerare il contatore dei rilanci:
  // senza, un guasto GPU persistente diventerebbe un ciclo infinito.
  await joinZoom({ ...command, __rilancioWebgl: true }, browserController);
}

/**
 * Punto di ingresso del comando join: assorbe i duplicati e serializza.
 *
 * Il backend consegna lo stesso join piu' volte (vedi il commento sulle
 * variabili joinInCorso). Qui:
 * - un join per la riunione il cui join e' GIA' IN CORSO si accoda alla stessa
 *   Promise: stesso esito, nessun secondo browser, niente clash di profilo;
 * - un join per una riunione DIVERSA attende che quello in corso si concluda,
 *   poi procede normalmente;
 * - un join per la riunione in cui siamo GIA' DENTRO (pagina viva, non sulla
 *   schermata di fine riunione) e' un no-op riuscito: il vecchio comportamento
 *   era "Already in a meeting, leaving first", cioe' uscire dall'adunanza
 *   appena joinata per rientrarci, con l'anziana davanti.
 */
async function joinZoom(command, browserController) {
  const { meeting_url } = command.payload || {};
  const idRichiesto = meeting_url ? parseZoomUrl(meeting_url).meetingId : null;

  if (!command.__rilancioWebgl) {
    rilanciPerWebgl = 0;
  }

  if (joinInCorso) {
    if (idRichiesto && idRichiesto === joinMeetingIdInCorso) {
      logger.info('Join duplicato per la stessa riunione, mi accodo al tentativo in corso', {
        meeting_id: idRichiesto,
      });
      return joinInCorso;
    }
    logger.info('Un altro join risulta in corso, attendo che si concluda prima di procedere');
    try {
      await joinInCorso;
    } catch {
      // L'esito (e l'ack) di quel join appartiene al comando che lo ha avviato.
    }
  }

  const statoAttuale = stateManager.getState();
  if (
    statoAttuale.status === STATUS.CALLING
    && idRichiesto
    && statoAttuale.currentMeeting?.meeting_id === idRichiesto
    && browserContext
    && page
    && !page.isClosed()
    && !(await checkMeetingEnded(page))
  ) {
    logger.info('Siamo gia dentro la riunione richiesta: comando join ridondante, nessuna azione', {
      meeting_id: idRichiesto,
    });
    return;
  }

  joinMeetingIdInCorso = idRichiesto;
  joinInCorso = eseguiJoinZoom(command, browserController);
  try {
    return await joinInCorso;
  } finally {
    joinInCorso = null;
    joinMeetingIdInCorso = null;
  }
}

/**
 * Join a Zoom meeting using Playwright automation.
 *
 * This handler:
 * 1. Converts the meeting URL to web client format
 * 2. Launches Playwright with persistent context (for camera/mic permissions)
 * 3. Navigates to the meeting
 * 4. Fills the participant name
 * 5. Clicks the join button
 *
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller (for fallback navigation)
 */
async function eseguiJoinZoom(command, browserController) {
  const { meeting_url, participant_name = 'OnesiBox User' } = command.payload;

  if (!isZoomUrl(meeting_url)) {
    throw new Error('Invalid Zoom URL');
  }

  logger.info('Starting Zoom join process', { meeting_url, participant_name });

  const currentState = stateManager.getState();

  // Interrupt any current playback
  if (currentState.status === STATUS.PLAYING) {
    logger.info('Interrupting media playback for Zoom meeting');
    await browserController.goToStandby();
    stateManager.stopPlaying();
  }

  // Leave existing meeting if in one
  if (currentState.status === STATUS.CALLING) {
    logger.info('Already in a meeting, leaving first');
    await leaveZoom(command, browserController);
  }

  try {
    // Convert URL to web client format
    const webClientUrl = buildJoinUrl(meeting_url, participant_name);
    logger.info('Converted to web client URL', { webClientUrl });

    // Close existing context if any
    await closeBrowserContext();

    // Il kiosk resta aperto sotto Zoom per tutta la riunione. Parcheggiarlo su
    // about:blank prima di lanciare Zoom libera oltre un core sul Pi 4 (vedi
    // BrowserController.suspendForOverlay). Va fatto PRIMA del lancio: il join
    // dura ~90 secondi, ed è proprio la fase in cui la CPU serve tutta a Zoom.
    if (browserController && typeof browserController.suspendForOverlay === 'function') {
      await browserController.suspendForOverlay();
    }

    // ATTENZIONE — configurazione di lancio ripristinata a quella del mattino
    // del 14/08/2026, l'ultima con cui i video in arrivo si vedevano davvero.
    //
    // Nel corso di quella giornata era stata cambiata per risolvere un problema
    // reale e verificato: il Chromium che Playwright si porta dietro NON ha i
    // codec proprietari (RTCRtpReceiver.getCapabilities('video') elenca VP8,
    // VP9, AV1 ma non H264), quindi Zoom ripiegava su VP8/VP9, che sul Pi 4 non
    // hanno decodifica hardware: da qui gli scatti e i 324% di CPU.
    //
    // Passare al Chromium di sistema ha dato H.264 hardware, ma i video in
    // arrivo hanno smesso del tutto di comparire: canvas creato e nero, oppure
    // nessun canvas. Meglio un video che si vede a scatti che un video che non
    // si vede: davanti allo schermo c'e' una persona anziana che non puo'
    // segnalare il problema ne' intervenire.
    //
    // Chi riprende in mano questa parte: il nodo NON e' Wayland (provate a
    // confronto entrambe le varianti, identiche) e non e' lo user agent
    // (provato "X11; Linux x86_64" al posto del "CrOS x86_64" con cui il
    // Chromium di Debian si presenta: nessuna differenza).
    //
    // AGGIORNAMENTO sera del 14/08/2026: trovato il nodo vero, ed era un
    // terzo fattore che nessuna delle prove sopra toccava — il backend di
    // ANGLE. Vedi il commento su --use-angle=gles qui sotto.
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--start-fullscreen',
      '--autoplay-policy=no-user-gesture-required',
      '--password-store=basic',
      // La GPU del Pi 4 (V3D) espone OpenGL desktop solo fino alla 3.1, ma
      // per dare WebGL2 ad ANGLE serve una 3.3+: lasciato al default, ANGLE
      // sceglie il backend desktop e il client Zoom resta senza WebGL2 —
      // "WebGL is not supported on this device" in console e i video degli
      // altri partecipanti mai disegnati (il proprio si', perche' e' un
      // <video> locale, non un canvas). In OpenGL ES la V3D arriva alla
      // 3.1, che per WebGL2 basta: questo flag forza il backend ES. E' lo
      // stesso flag con cui gira il browser kiosk. Misurato il 14/08/2026:
      // senza flag webgl2=null, con flag webgl2 su "ANGLE (Broadcom, V3D
      // 4.2.14.0, OpenGL ES 3.1)".
      '--use-angle=gles',
      // Rete di sicurezza: se l'inizializzazione della GPU fallisse
      // comunque, meglio un WebGL software (lento ma visibile) che nessun
      // video. Anche questo allineato al browser kiosk.
      '--enable-unsafe-swiftshader',
      // Il Chromium di sistema (Debian 144) prova a prendere la webcam via
      // portale PipeWire; su questo compositor (labwc) la richiesta non
      // riceve mai risposta e TUTTO lo stack media della pagina resta
      // congelato: enumerateDevices appeso, webcam "non rilevata", e il
      // client Zoom che non inizializza nemmeno il video in ingresso.
      // Misurato il 14/08/2026: senza questo flag enumerateDevices non
      // risponde in 10s; con il flag elenca subito i dispositivi e
      // getUserMedia acquisisce la USB 2.0 Camera via V4L2 diretto.
      // NB: sovrascrive il --disable-features interno di Playwright
      // (l'ultimo occorrenza vince): gia' cosi' anche per il kiosk, mai
      // dato problemi.
      '--disable-features=WebRtcPipeWireCamera,WebRtcPipeWireCapturer',
      // Porta di debug su loopback: permette di ispezionare la riunione in
      // corso (video, canvas, worker) senza riavviare il servizio e senza far
      // uscire e rientrare l'anziana. Non raggiungibile dalla rete.
      '--remote-debugging-port=9223',
      '--remote-debugging-address=127.0.0.1',
    ];

    // Launch browser with persistent context for camera/mic permissions
    // Chromium DI SISTEMA, non quello di Playwright: e' l'unico dei due
    // con i codec proprietari (H264). Serve davvero: la sera del
    // 14/08/2026, dalla sala con banda scarsa, Zoom serviva il video del
    // mittente solo in H264 — il Chromium di Playwright (solo VP8/9)
    // teneva lo schermo nero mentre un client di prova col Chromium di
    // sistema, nella stessa riunione nello stesso momento, lo mostrava.
    // Il tentativo fallito del pomeriggio con questo stesso binario era
    // affondato per la mancanza di --use-angle=gles (niente WebGL2), che
    // ora e' nei launchArgs. Se il profilo persistente e' stato scritto
    // dall'altro binario puo' dare SIGTRAP al primo avvio:
    // lanciaConProfiloRecuperabile lo svuota e riprova da solo.
    //
    // Vale sia per Pi 4 sia per Pi 5: i codec sono una proprieta' della build
    // di Chromium, non dell'hardware (il Pi 5 non ha nemmeno la decodifica
    // H.264 hardware, ma la CPU regge bene quella software), e la V3D di
    // entrambi espone OpenGL ES 3.1, quindi --use-angle=gles da' WebGL2 su
    // tutti e due. Vedi resolveZoomExecutable per il ripiego.
    browserContext = await lanciaConProfiloRecuperabile({
      headless: false,
      executablePath: resolveZoomExecutable(),
      args: launchArgs,
      permissions: ['microphone', 'camera'],
      viewport: null, // Fullscreen
      ignoreHTTPSErrors: true,
    });

    page = browserContext.pages()[0] || await browserContext.newPage();

    // Diagnostica: la console del client Zoom e' l'unico posto dove si vede
    // perche' un video arriva ma resta nero. Senza questo aggancio si puo' solo
    // tirare a indovinare da fuori. Filtrata su errori e avvisi per non
    // riempire il log con la telemetria di Zoom.
    page.on('console', (msg) => {
      const tipo = msg.type();
      if (tipo !== 'error' && tipo !== 'warning') {
        return;
      }
      const testo = msg.text().slice(0, 300);
      if (/favicon|analytics|beacon|third-party cookie|deprecat/i.test(testo)) {
        return;
      }
      logger.warn('Zoom console', { tipo, testo });
    });

    page.on('pageerror', (errore) => {
      logger.error('Zoom errore JS', { testo: String(errore.message).slice(0, 300) });
    });

    // Navigate to Zoom web client
    logger.info('Navigating to Zoom web client');
    await page.goto(webClientUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for the join form to appear (try multiple selectors)
    logger.info('Waiting for join form');

    // Try to find the name input field
    let nameInput = null;
    const nameSelectors = ['#inputname', 'input[type="text"]', '[role="textbox"]', 'input[placeholder*="name" i]'];

    for (const selector of nameSelectors) {
      try {
        nameInput = await page.waitForSelector(selector, { timeout: 5000 });
        if (nameInput) {
          logger.info('Found name input', { selector });
          break;
        }
      } catch {
        // Try next selector
      }
    }

    if (nameInput) {
      // Clear existing value and fill with participant name
      await nameInput.click({ clickCount: 3 }); // Select all
      await nameInput.fill(participant_name);
      logger.info('Filled participant name', { participant_name });
    } else {
      logger.warn('Could not find name input field');
    }

    // Find and click the join button
    const joinButtonTexts = ['Join', 'Entra', 'Partecipa', 'Join Meeting', 'Partecipa alla riunione'];
    let joinClicked = false;

    for (const text of joinButtonTexts) {
      try {
        const button = await page.$(`button:has-text("${text}")`);
        if (button) {
          await button.click();
          joinClicked = true;
          logger.info('Clicked join button', { buttonText: text });
          break;
        }
      } catch {
        // Try next button text
      }
    }

    if (!joinClicked) {
      // Try clicking any visible primary button
      try {
        await page.click('button[type="submit"], button.zm-btn--primary, button.preview-join-button', { timeout: 5000 });
        joinClicked = true;
        logger.info('Clicked join button via fallback selector');
      } catch {
        logger.warn('Could not find join button to click');
      }
    }

    // Parse meeting ID for state tracking
    const parsedUrl = parseZoomUrl(meeting_url);

    // Update state
    stateManager.setMeeting({
      meeting_url,
      meeting_id: parsedUrl.meetingId
    });

    // Schedule background detection of host-ended meetings.
    startMeetingEndDetection(browserController);

    // Senza await: aspetta 9 secondi che l'interfaccia di Zoom si formi, e non
    // c'e' ragione di ritardare di altrettanto l'ACK del comando al server.
    nascondiPartecipantiSecondari(page).catch(() => { /* gia' loggato dentro */ });

    // Anche questa senza await, per lo stesso motivo. Vedi il commento sulla
    // funzione per il perche' esiste.
    verificaWebglDopoJoin(page, command, browserController).catch((error) => {
      logger.warn('Verifica WebGL dopo il join non riuscita', { error: error.message });
    });

    logger.info('Zoom meeting join initiated', {
      meeting_id: parsedUrl.meetingId,
      participant_name
    });

  } catch (error) {
    logger.error('Failed to join Zoom meeting', { error: error.message });

    // Take screenshot for debugging
    if (page) {
      try {
        const screenshotPath = path.join(os.tmpdir(), 'zoom-error-screenshot.png');
        await page.screenshot({ path: screenshotPath });
        logger.info('Debug screenshot saved', { path: screenshotPath });
      } catch {
        // Ignore screenshot errors
      }
    }

    // Cleanup on error
    await closeBrowserContext();

    // Il kiosk è stato parcheggiato su about:blank prima del lancio: se il join
    // fallisce va riportato alla standby, altrimenti l'anziana resta davanti a
    // uno schermo nero senza che nessuno possa intervenire sul posto.
    if (browserController && typeof browserController.goToStandby === 'function') {
      try {
        await browserController.goToStandby();
      } catch (standbyError) {
        logger.warn('Failed to restore standby after failed Zoom join', {
          error: standbyError.message,
        });
      }
    }

    throw error;
  }
}

/**
 * Leave the current Zoom meeting.
 *
 * This closes the Playwright browser context and brings the kiosk back to standby.
 *
 * Il browser kiosk non mostra più la standby "già pronta sotto": da quando
 * joinZoom lo parcheggia su about:blank per liberare CPU, chiudere Zoom
 * scoprirebbe una pagina vuota. Il ritorno alla standby va quindi fatto qui
 * esplicitamente — è una navigazione sul browser già aperto, non un riavvio.
 *
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller, per tornare alla standby
 */
async function leaveZoom(_command, browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.CALLING) {
    logger.info('Not in a meeting, nothing to leave');
    return;
  }

  logger.info('Leaving Zoom meeting', {
    meeting_id: currentState.currentMeeting?.meeting_id
  });

  stopMeetingEndDetection();

  try {
    if (page) {
      // Try to click leave button
      const leaveButtonTexts = ['Leave', 'Esci', 'Abbandona', 'Leave Meeting', 'Abbandona riunione'];

      for (const text of leaveButtonTexts) {
        try {
          const button = await page.$(`button:has-text("${text}")`);
          if (button) {
            await button.click();
            logger.info('Clicked leave button', { buttonText: text });

            // Wait a moment for confirmation dialog
            await page.waitForTimeout(1000);

            // Confirm leave if dialog appears
            const confirmTexts = ['Leave Meeting', 'Abbandona riunione', 'Leave'];
            for (const confirmText of confirmTexts) {
              try {
                const confirmButton = await page.$(`button:has-text("${confirmText}")`);
                if (confirmButton) {
                  await confirmButton.click();
                  logger.info('Confirmed leave', { buttonText: confirmText });
                  break;
                }
              } catch {
                // Ignore
              }
            }
            break;
          }
        } catch {
          // Try next button text
        }
      }
    }
  } catch (error) {
    logger.warn('Error clicking leave button', { error: error.message });
  }

  // Close Playwright browser context
  // This closes only the Zoom browser, not the main kiosk browser
  await closeBrowserContext();

  // Riporta il kiosk dalla about:blank di parcheggio alla schermata di standby.
  // Non deve poter far fallire l'uscita dalla riunione: se la navigazione non
  // riesce, lo stato va aggiornato lo stesso, altrimenti il dispositivo resta
  // convinto di essere in chiamata.
  if (browserController && typeof browserController.goToStandby === 'function') {
    try {
      await browserController.goToStandby();
    } catch (error) {
      logger.warn('Failed to restore standby after leaving Zoom', { error: error.message });
    }
  }

  stateManager.leaveMeeting();

  logger.info('Zoom meeting left');
}

/**
 * Cleanup Zoom resources.
 * Should be called during application shutdown to ensure proper cleanup.
 */
async function cleanup() {
  logger.info('Cleaning up Zoom resources');
  stopMeetingEndDetection();
  await closeBrowserContext();
}

/**
 * Check if a Zoom meeting is currently active.
 * @returns {boolean} True if Zoom browser context is open
 */
function isZoomActive() {
  return browserContext !== null;
}

module.exports = {
  joinZoom,
  leaveZoom,
  parseZoomUrl,
  convertToWebClientUrl,
  buildJoinUrl,
  cleanup,
  isZoomActive,
  checkMeetingEnded,
  startMeetingEndDetection,
  stopMeetingEndDetection,
  END_DETECTION_START_DELAY_MS,
  END_DETECTION_POLL_INTERVAL_MS,
  AUDIO_PERSO_DOPO_MS,
  aggiornaStatoAudio,
};
