const EventEmitter = require('events');
const Pusher = require('pusher-js');
const logger = require('../logging/logger');

const WS_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting'
};

class WebSocketManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.pusher = null;
    this.channel = null;
    this.status = WS_STATUS.DISCONNECTED;
  }

  connect() {
    if (this.pusher) {
      this.disconnect();
    }

    const { reverb_key, reverb_host, reverb_port, reverb_scheme, server_url, appliance_token, appliance_id } = this.config;

    logger.info('WebSocket connecting', { host: reverb_host, port: reverb_port });

    this.pusher = new Pusher(reverb_key, {
      wsHost: reverb_host,
      wsPort: reverb_port,
      wssPort: reverb_port,
      forceTLS: reverb_scheme === 'https',
      enabledTransports: ['ws', 'wss'],
      disabledTransports: ['sockjs'],
      cluster: '',
      authEndpoint: `${server_url}/api/broadcasting/auth`,
      auth: {
        headers: {
          Authorization: `Bearer ${appliance_token}`,
          Accept: 'application/json'
        }
      }
    });

    this._bindConnectionEvents();
    this._subscribeToChannel(appliance_id);
  }

  _bindConnectionEvents() {
    this.pusher.connection.bind('connected', () => {
      logger.info('WebSocket connected');
      this._setStatus(WS_STATUS.CONNECTED);
    });

    this.pusher.connection.bind('disconnected', () => {
      logger.warn('WebSocket disconnected');
      this._setStatus(WS_STATUS.DISCONNECTED);
    });

    this.pusher.connection.bind('connecting', () => {
      logger.info('WebSocket reconnecting');
      this._setStatus(WS_STATUS.RECONNECTING);
    });

    this.pusher.connection.bind('unavailable', () => {
      logger.warn('WebSocket unavailable');
      this._setStatus(WS_STATUS.DISCONNECTED);
    });

    this.pusher.connection.bind('failed', () => {
      logger.error('WebSocket connection failed');
      this._setStatus(WS_STATUS.DISCONNECTED);
    });

    this.pusher.connection.bind('error', (error) => {
      logger.error('WebSocket error', { error: error?.message || error });
    });
  }

  _subscribeToChannel(applianceId) {
    const channelName = `private-appliance.${applianceId}`;
    logger.info('Subscribing to channel', { channel: channelName });

    this.channel = this.pusher.subscribe(channelName);

    this.channel.bind('pusher:subscription_succeeded', () => {
      logger.info('Channel subscription succeeded', { channel: channelName });
    });

    this.channel.bind('pusher:subscription_error', (error) => {
      logger.error('Channel subscription failed', { channel: channelName, error });
      this.emit('subscription-failed', error);
    });

    // broadcastAs() → 'NewCommand'; raw pusher-js binds without dot prefix (unlike Echo)
    this.channel.bind('NewCommand', (data) => {
      logger.info('New command event received', {
        uuid: data.uuid,
        type: data.type,
        priority: data.priority
      });
      this.emit('command-available', data);
    });
  }

  _setStatus(newStatus) {
    const oldStatus = this.status;
    if (oldStatus === newStatus) return;

    this.status = newStatus;
    this.emit(newStatus); // emit 'connected', 'disconnected', or 'reconnecting'
    this.emit('status-change', { from: oldStatus, to: newStatus });
  }

  getStatus() {
    return this.status;
  }

  disconnect() {
    if (this.pusher) {
      logger.info('WebSocket disconnecting');
      if (this.channel) {
        this.channel.unbind_all();
      }
      this.pusher.connection.unbind_all();
      this.pusher.disconnect();
      this.pusher = null;
      this.channel = null;
      this._setStatus(WS_STATUS.DISCONNECTED);
    }
  }
}

module.exports = { WebSocketManager, WS_STATUS };
