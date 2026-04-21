const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const mediaHandler = require('./media');
const { ERROR_CODES } = require('../validator');

let apiClient = null;

const TILE_SELECTOR = 'button.MuiCardActionArea-root';
const WAIT_TILES_TIMEOUT_MS = 15000;
const WAIT_VIDEO_TIMEOUT_MS = 15000;

function setApiClient(client) {
  apiClient = client;
}

async function reportPlaybackEvent(event, mediaInfo, extra = {}) {
  if (!apiClient) {
    logger.warn('Cannot report stream playback event: apiClient not set');
    return;
  }
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    media_url: mediaInfo.url,
    media_type: 'video',
    position: 0,
    ordinal: mediaInfo.ordinal,
    ...extra
  };
  if (mediaInfo.session_id) payload.session_id = mediaInfo.session_id;
  try {
    await apiClient.reportPlaybackEvent(payload);
    logger.info('Stream playback event reported', {
      event, media_url: payload.media_url, ordinal: payload.ordinal, session_id: payload.session_id || null
    });
  } catch (error) {
    logger.error('Failed to report stream playback event', { event, error: error.message });
  }
}

async function _dismissCookieBanner(browserController) {
  try {
    const result = await browserController._executeScript(`
      const reject = Array.from(document.querySelectorAll('button'))
        .find(b => /rifiuta|reject/i.test(b.textContent || ''));
      if (reject) { reject.click(); return { dismissed: true }; }
      return { dismissed: false };
    `);
    logger.debug('Cookie banner dismiss', result || {});
  } catch (error) {
    logger.debug('Cookie banner dismiss skipped (script error)', { error: error.message });
  }
}

async function _waitForTiles(browserController, ordinal) {
  return browserController._executeScript(`
    return new Promise((resolve) => {
      const deadline = Date.now() + ${WAIT_TILES_TIMEOUT_MS};
      const check = () => {
        const n = document.querySelectorAll(${JSON.stringify(TILE_SELECTOR)}).length;
        if (n >= ${ordinal}) return resolve({ ok: true, tileCount: n });
        if (Date.now() >= deadline) return resolve({ ok: false, tileCount: n, finalUrl: location.href });
        setTimeout(check, 250);
      };
      check();
    });
  `);
}

async function _clickNthTile(browserController, ordinal) {
  return browserController._executeScript(`
    const tiles = document.querySelectorAll(${JSON.stringify(TILE_SELECTOR)});
    if (!tiles[${ordinal - 1}]) return { clicked: false };
    tiles[${ordinal - 1}].click();
    return { clicked: true };
  `);
}

async function _waitForVideo(browserController) {
  return browserController._executeScript(`
    return new Promise((resolve) => {
      const deadline = Date.now() + ${WAIT_VIDEO_TIMEOUT_MS};
      const check = () => {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && isFinite(v.duration)) {
          return resolve({ ok: true, readyState: v.readyState, duration: v.duration });
        }
        if (Date.now() >= deadline) {
          return resolve({ ok: false, readyState: v ? v.readyState : null });
        }
        setTimeout(check, 250);
      };
      check();
    });
  `);
}

async function _injectEndedHooks(browserController) {
  return browserController._executeScript(`
    const v = document.querySelector('video');
    if (!v) return { hooksInstalled: false };
    window.__onesiboxVideoEnded = false;
    window.__onesiboxVideoError = false;
    v.addEventListener('ended', () => { window.__onesiboxVideoEnded = true; });
    v.addEventListener('error', () => { window.__onesiboxVideoError = true; });
    return { hooksInstalled: true };
  `);
}

async function _abortWithError(browserController, mediaInfo, errorCode, errorMessage) {
  logger.error('play_stream_item failed', { error_code: errorCode, error: errorMessage, ...mediaInfo });
  if (stateManager.getState().status === STATUS.PLAYING) {
    stateManager.stopPlaying();
  }
  try {
    await browserController.goToStandby();
  } catch (error) {
    logger.warn('goToStandby failed after stream error', { error: error.message });
  }
  await reportPlaybackEvent('error', mediaInfo, { error_code: errorCode, error_message: errorMessage });
  const err = new Error(errorMessage);
  err.code = errorCode;
  throw err;
}

async function playStreamItem(command, browserController) {
  const { url, ordinal, session_id = null } = command.payload;
  const mediaInfo = { url, ordinal, session_id };

  logger.info('Playing stream item', { url, ordinal, session_id });

  if (stateManager.getState().status === STATUS.PLAYING) {
    await mediaHandler.stopMedia(command, browserController);
  }

  try {
    await browserController.navigateTo(url);
  } catch (error) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.STREAM_NAV_FAILED,
      `Navigation failed: ${error.message}`);
    return;
  }

  await _dismissCookieBanner(browserController);

  const tilesResult = await _waitForTiles(browserController, ordinal);
  if (!tilesResult || !tilesResult.ok) {
    const tileCount = tilesResult?.tileCount ?? 0;
    if (tileCount === 0) {
      await _abortWithError(browserController, mediaInfo, ERROR_CODES.PLAYLIST_LOAD_FAILED,
        `No tiles found after ${WAIT_TILES_TIMEOUT_MS}ms (final URL: ${tilesResult?.finalUrl || 'unknown'})`);
    } else {
      await _abortWithError(browserController, mediaInfo, ERROR_CODES.ORDINAL_OUT_OF_RANGE,
        `Ordinal ${ordinal} exceeds playlist length ${tileCount}`);
    }
    return;
  }

  const clickResult = await _clickNthTile(browserController, ordinal);
  if (!clickResult || !clickResult.clicked) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.VIDEO_START_FAILED,
      `Failed to click tile ${ordinal}`);
    return;
  }

  const videoResult = await _waitForVideo(browserController);
  if (!videoResult || !videoResult.ok) {
    await _abortWithError(browserController, mediaInfo, ERROR_CODES.VIDEO_START_FAILED,
      `Video did not start within ${WAIT_VIDEO_TIMEOUT_MS}ms (readyState: ${videoResult?.readyState})`);
    return;
  }

  await _injectEndedHooks(browserController);

  if (stateManager.getState().status === STATUS.PLAYING) {
    logger.info('Stream item aborted before start (state no longer IDLE)');
    return;
  }

  stateManager.setPlaying({ url, media_type: 'video' });

  await reportPlaybackEvent('started', mediaInfo);

  mediaHandler.startVideoEndedDetection(browserController, {
    url,
    media_type: 'video',
    session_id
  });
}

module.exports = {
  playStreamItem,
  setApiClient
};
