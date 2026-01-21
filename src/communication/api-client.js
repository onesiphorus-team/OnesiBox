const axios = require('axios');
const logger = require('../logging/logger');

const BACKOFF_SCHEDULE = [5000, 10000, 20000, 60000];

class ApiClient {
  constructor(config) {
    this.config = config;
    this.consecutiveFailures = 0;

    this.client = axios.create({
      baseURL: `${config.server_url}/api/v1`,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${config.appliance_token}`,
        'X-Appliance-ID': config.appliance_id,
        'Content-Type': 'application/json'
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

  async getCommands() {
    const response = await this.client.get(
      `/appliances/${this.config.appliance_id}/commands`,
      { params: { status: 'pending' } }
    );
    return response.data.commands || [];
  }

  async acknowledgeCommand(commandId, ack) {
    await this.client.post(`/commands/${commandId}/ack`, {
      status: ack.status,
      error_code: ack.error_code || null,
      error_message: ack.error_message || null,
      executed_at: new Date().toISOString()
    });
  }

  async sendHeartbeat(heartbeat) {
    const response = await this.client.post(
      `/appliances/${this.config.appliance_id}/heartbeat`,
      heartbeat
    );
    return response.data;
  }

  async reportPlaybackEvent(event) {
    await this.client.post(
      `/appliances/${this.config.appliance_id}/playback`,
      event
    );
  }
}

module.exports = ApiClient;
