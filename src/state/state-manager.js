const EventEmitter = require('events');
const logger = require('../logging/logger');

const STATUS = {
  IDLE: 'idle',
  PLAYING: 'playing',
  CALLING: 'calling',
  ERROR: 'error'
};

const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline'
};

class StateManager extends EventEmitter {
  constructor() {
    super();
    this.status = STATUS.IDLE;
    this.connectionStatus = CONNECTION_STATUS.RECONNECTING;
    this.currentMedia = null;
    this.currentMeeting = null;
    this.lastHeartbeat = null;
    this.volume = 80;
    this.isPaused = false;
    this.errorRecoveryTimer = null;
  }

  getState() {
    return {
      status: this.status,
      connectionStatus: this.connectionStatus,
      currentMedia: this.currentMedia,
      currentMeeting: this.currentMeeting,
      lastHeartbeat: this.lastHeartbeat,
      volume: this.volume,
      isPaused: this.isPaused
    };
  }

  setStatus(newStatus) {
    if (!Object.values(STATUS).includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    const oldStatus = this.status;
    this.status = newStatus;
    logger.info('Status changed', { from: oldStatus, to: newStatus });
    this.emit('statusChange', { from: oldStatus, to: newStatus });

    if (newStatus === STATUS.ERROR) {
      this._scheduleErrorRecovery();
    } else if (this.errorRecoveryTimer) {
      clearTimeout(this.errorRecoveryTimer);
      this.errorRecoveryTimer = null;
    }
  }

  setConnectionStatus(newStatus) {
    if (!Object.values(CONNECTION_STATUS).includes(newStatus)) {
      throw new Error(`Invalid connection status: ${newStatus}`);
    }
    const oldStatus = this.connectionStatus;
    this.connectionStatus = newStatus;
    logger.info('Connection status changed', { from: oldStatus, to: newStatus });
    this.emit('connectionStatusChange', { from: oldStatus, to: newStatus });
  }

  setPlaying(mediaInfo) {
    this.currentMedia = {
      url: mediaInfo.url,
      media_type: mediaInfo.media_type,
      position: 0,
      duration: null,
      started_at: new Date().toISOString(),
      is_paused: false
    };
    this.isPaused = false;
    this.setStatus(STATUS.PLAYING);
  }

  stopPlaying() {
    this.currentMedia = null;
    this.isPaused = false;
    this.setStatus(STATUS.IDLE);
  }

  setPaused(paused) {
    this.isPaused = paused;
    if (this.currentMedia) {
      this.currentMedia.is_paused = paused;
    }
    this.emit('pauseChange', { isPaused: paused });
  }

  setMeeting(meetingInfo) {
    this.currentMeeting = {
      meeting_url: meetingInfo.meeting_url,
      meeting_id: meetingInfo.meeting_id || null,
      joined_at: new Date().toISOString()
    };
    this.currentMedia = null;
    this.isPaused = false;
    this.setStatus(STATUS.CALLING);
  }

  leaveMeeting() {
    this.currentMeeting = null;
    this.setStatus(STATUS.IDLE);
  }

  setVolume(level) {
    this.volume = Math.max(0, Math.min(100, level));
    logger.info('Volume changed', { level: this.volume });
    this.emit('volumeChange', { level: this.volume });
  }

  updateHeartbeat() {
    this.lastHeartbeat = new Date().toISOString();
  }

  setError(errorMessage) {
    logger.error('Entering error state', { error: errorMessage });
    this.setStatus(STATUS.ERROR);
  }

  _scheduleErrorRecovery() {
    if (this.errorRecoveryTimer) {
      clearTimeout(this.errorRecoveryTimer);
    }
    this.errorRecoveryTimer = setTimeout(() => {
      logger.info('Auto-recovering from error state');
      this.currentMedia = null;
      this.currentMeeting = null;
      this.isPaused = false;
      this.setStatus(STATUS.IDLE);
    }, 10000);
  }
}

const stateManager = new StateManager();

module.exports = {
  stateManager,
  STATUS,
  CONNECTION_STATUS
};
