const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isUrlAllowed } = require('../validator');

let apiClient = null;

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
  const playerUrl = new URL('http://localhost:3000/player.html');
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
}

async function stopMedia(command, browserController) {
  const currentState = stateManager.getState();

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
