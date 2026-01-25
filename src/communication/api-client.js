const axios = require('axios');
const logger = require('../logging/logger');

const BACKOFF_SCHEDULE = [5000, 10000, 20000, 60000];

class ApiClient {
  constructor(config) {
    this.config = config;
    this.consecutiveFailures = 0;

    // The backend identifies the appliance via the Sanctum token,
    // so we don't need to include the appliance ID in the URL
    this.client = axios.create({
      baseURL: `${config.server_url}/api/v1`,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${config.appliance_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.client.interceptors.response.use(
      (response) => {
        this.consecutiveFailures = 0;
        return response;
      },
      (error) => {
        this.consecutiveFailures++;
        logger.error('API request failed', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
          consecutiveFailures: this.consecutiveFailures
        });
        return Promise.reject(error);
      }
    );
  }

  getBackoffDelay() {
    const index = Math.min(this.consecutiveFailures - 1, BACKOFF_SCHEDULE.length - 1);
    return BACKOFF_SCHEDULE[Math.max(0, index)];
  }

  shouldRetry() {
    return this.consecutiveFailures < BACKOFF_SCHEDULE.length + 3;
  }

  /**
   * Fetch pending commands from the backend.
   * The backend identifies the appliance via the Sanctum token.
   * Response format: { data: [...commands], meta: { total, pending } }
   */
  async getCommands() {
    const response = await this.client.get('/appliances/commands', {
      params: { status: 'pending' }
    });
    // Backend returns { data: [...], meta: {...} }
    return response.data.data || [];
  }

  /**
   * Acknowledge command execution.
   * Uses command UUID as the identifier.
   * For diagnostic commands (get_system_info, get_logs), result contains the payload.
   */
  async acknowledgeCommand(commandUuid, ack) {
    await this.client.post(`/commands/${commandUuid}/ack`, {
      status: ack.status,
      error_code: ack.error_code || null,
      error_message: ack.error_message || null,
      result: ack.result || null,
      executed_at: new Date().toISOString()
    });
  }

  /**
   * Send heartbeat with device metrics.
   * The backend identifies the appliance via the Sanctum token.
   */
  async sendHeartbeat(heartbeat) {
    const response = await this.client.post('/appliances/heartbeat', heartbeat);
    return response.data;
  }

  /**
   * Report playback events (started, paused, resumed, stopped, etc).
   * The backend identifies the appliance via the Sanctum token.
   */
  async reportPlaybackEvent(event) {
    await this.client.post('/appliances/playback', event);
  }
}

module.exports = ApiClient;
