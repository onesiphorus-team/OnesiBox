const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isUrlAllowed } = require('../validator');
const { leaveZoom, isZoomActive } = require('./zoom');

let apiClient = null;
let videoEndedCheckInterval = null;

function setApiClient(client) {
  apiClient = client;
}

async function reportPlaybackEvent(event, mediaInfo = null) {
  if (!apiClient) {
    logger.warn('Cannot report playback event: apiClient not set');
    return;
  }

  try {
    const payload = {
      event,
      timestamp: new Date().toISOString()
    };

    if (mediaInfo) {
      payload.media_url = mediaInfo.url;
      payload.media_type = mediaInfo.media_type;
      payload.position = mediaInfo.position || 0;
      payload.duration = mediaInfo.duration;
    }

    await apiClient.reportPlaybackEvent(payload);
    logger.debug('Playback event reported', { event });
  } catch (error) {
    logger.error('Failed to report playback event', { event, error: error.message });
  }
}

/**
 * Check if URL is a JW.org media URL
 */
function isJwOrgUrl(url) {
  return /jw\.org.*#[a-z]{2,3}\/mediaitems\//i.test(url) ||
         /jw\.org.*_VIDEO/i.test(url);
}

/**
 * Build local player URL for JW.org videos
 */
function buildPlayerUrl(originalUrl, autoplay) {
  const port = process.env.PORT || 3000;
  const playerUrl = new URL(`http://localhost:${port}/player.html`);
  playerUrl.searchParams.set('url', originalUrl);
  playerUrl.searchParams.set('autoplay', autoplay ? 'true' : 'false');
  return playerUrl.toString();
}

async function playMedia(command, browserController) {
  const { url, media_type, autoplay = true, start_position = 0 } = command.payload;

  if (!isUrlAllowed(url)) {
    throw new Error('URL not in authorized domain whitelist');
  }

  logger.info('Playing media', { url, media_type, autoplay, start_position });

  const currentState = stateManager.getState();
  if (currentState.status === STATUS.PLAYING) {
    await stopMedia(command, browserController);
  }

  if (media_type === 'audio') {
    logger.info('Audio-only playback: keeping standby screen visible');
  }

  // Use local player for JW.org URLs to avoid cookies and get direct video
  let targetUrl = url;
  if (isJwOrgUrl(url)) {
    targetUrl = buildPlayerUrl(url, autoplay);
    logger.info('Using local player for JW.org video', { originalUrl: url, playerUrl: targetUrl });
  }

  await browserController.navigateTo(targetUrl);

  stateManager.setPlaying({
    url,
    media_type
  });

  await reportPlaybackEvent('started', { url, media_type, position: start_position });

  if (!autoplay) {
    await browserController.pause();
    stateManager.setPaused(true);
  }

  // Start video completion detection for video media
  if (media_type === 'video') {
    startVideoEndedDetection(browserController, { url, media_type });
  }
}

/**
 * Start polling to detect when a video has naturally ended.
 * player.html sets window.__onesiboxVideoEnded = true on video end,
 * and window.__onesiboxVideoError = true on video error.
 * We poll every 2 seconds to check these flags.
 */
function startVideoEndedDetection(browserController, mediaInfo) {
  stopVideoEndedDetection();

  logger.info('Starting video ended detection');

  const port = process.env.PORT || 3000;
  const standbyUrls = [`http://localhost:${port}`, `http://localhost:${port}/`];

  videoEndedCheckInterval = setInterval(async () => {
    try {
      const currentState = stateManager.getState();
      if (currentState.status !== STATUS.PLAYING) {
        stopVideoEndedDetection();
        return;
      }

      const result = await browserController.executeScript(`
        return {
          ended: window.__onesiboxVideoEnded === true,
          error: window.__onesiboxVideoError === true,
          url: window.location.href
        };
      `);

      if (result && result.ended) {
        logger.info('Video ended naturally, reporting completion');
        stopVideoEndedDetection();

        stateManager.stopPlaying();
        await browserController.goToStandby();
        await reportPlaybackEvent('completed', mediaInfo);
      } else if (result && result.error) {
        logger.info('Video error detected, reporting error and returning to standby');
        stopVideoEndedDetection();

        stateManager.stopPlaying();
        await browserController.goToStandby();
        await reportPlaybackEvent('error', mediaInfo);
      } else if (result && standbyUrls.includes(result.url)) {
        logger.info('Page navigated to standby while still playing, treating as completed');
        stopVideoEndedDetection();

        stateManager.stopPlaying();
        await reportPlaybackEvent('completed', mediaInfo);
      }
    } catch (error) {
      logger.debug('Video ended check failed (page may have changed)', { error: error.message });
      stopVideoEndedDetection();

      const currentState = stateManager.getState();
      if (currentState.status === STATUS.PLAYING &&
          currentState.currentMedia?.url === mediaInfo.url) {
        logger.info('Page changed while playing same media, treating as completed');
        stateManager.stopPlaying();
        await reportPlaybackEvent('completed', mediaInfo);
      }
    }
  }, 2000);
}

/**
 * Stop the video ended detection polling.
 */
function stopVideoEndedDetection() {
  if (videoEndedCheckInterval) {
    clearInterval(videoEndedCheckInterval);
    videoEndedCheckInterval = null;
  }
}

async function stopMedia(command, browserController) {
  const currentState = stateManager.getState();

  stopVideoEndedDetection();

  // Handle Zoom call interruption
  if (currentState.status === STATUS.CALLING || isZoomActive()) {
    logger.info('Stopping Zoom meeting via stop_media command');
    await leaveZoom(command, browserController);
    return;
  }

  if (currentState.status !== STATUS.PLAYING) {
    logger.info('Not playing, nothing to stop');
    return;
  }

  const mediaInfo = currentState.currentMedia;

  logger.info('Stopping media playback');

  await browserController.goToStandby();
  stateManager.stopPlaying();

  await reportPlaybackEvent('stopped', mediaInfo);
}

async function pauseMedia(command, browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.PLAYING) {
    throw new Error('Not playing any media');
  }

  if (currentState.isPaused) {
    logger.info('Media already paused');
    return;
  }

  logger.info('Pausing media playback');

  await browserController.pause();
  stateManager.setPaused(true);

  await reportPlaybackEvent('paused', currentState.currentMedia);
}

async function resumeMedia(command, browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.PLAYING) {
    throw new Error('Not playing any media');
  }

  if (!currentState.isPaused) {
    logger.info('Media not paused');
    return;
  }

  logger.info('Resuming media playback');

  await browserController.resume();
  stateManager.setPaused(false);

  await reportPlaybackEvent('resumed', currentState.currentMedia);
}

module.exports = {
  playMedia,
  stopMedia,
  pauseMedia,
  resumeMedia,
  setApiClient,
  reportPlaybackEvent
};
