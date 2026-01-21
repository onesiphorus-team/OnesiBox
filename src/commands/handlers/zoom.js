const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isZoomUrl } = require('../validator');

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

async function joinZoom(command, browserController) {
  const { meeting_url, meeting_id, password } = command.payload;

  if (!isZoomUrl(meeting_url)) {
    throw new Error('Invalid Zoom URL');
  }

  logger.info('Joining Zoom meeting', { meeting_url });

  const currentState = stateManager.getState();

  if (currentState.status === STATUS.PLAYING) {
    logger.info('Interrupting media playback for Zoom meeting');
    stateManager.stopPlaying();
  }

  if (currentState.status === STATUS.CALLING) {
    logger.info('Already in a meeting, leaving first');
    await leaveZoom(command, browserController);
  }

  const parsedUrl = parseZoomUrl(meeting_url);
  const finalMeetingId = meeting_id || parsedUrl.meetingId;

  await browserController.navigateTo(meeting_url);

  stateManager.setMeeting({
    meeting_url,
    meeting_id: finalMeetingId
  });

  logger.info('Zoom meeting joined', {
    meeting_id: finalMeetingId,
    has_password: !!(password || parsedUrl.password)
  });
}

async function leaveZoom(command, browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.CALLING) {
    logger.info('Not in a meeting, nothing to leave');
    return;
  }

  logger.info('Leaving Zoom meeting', {
    meeting_id: currentState.currentMeeting?.meeting_id
  });

  await browserController.goToStandby();
  stateManager.leaveMeeting();

  logger.info('Zoom meeting left');
}

module.exports = {
  joinZoom,
  leaveZoom,
  parseZoomUrl
};
