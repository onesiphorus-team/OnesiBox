const http = require('http');
const https = require('https');
const axios = require('axios');
const logger = require('../logging/logger');

// Disable keep-alive to prevent stale connection reuse behind Cloudflare.
// Node.js 20 defaults to keepAlive:true; stale pooled connections cause 10s hangs.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

class ApiClient {
  constructor(config) {
    this.config = config;
    this.consecutiveFailures = 0;

    /**
     * Whether the client detected an unrecoverable auth failure (401/403).
     * When true, polling should stop to avoid flooding the server.
     */
    this.authFailed = false;

    /**
     * Current backoff delay in ms (used for 429 rate limit responses).
     * Resets to 0 on successful requests.
     */
    this.backoffMs = 0;

    /**
     * Queue of failed ACKs to retry on next successful connection.
     * Each entry: { commandId, ack, retries }
     */
    this.pendingAcks = [];

    // The backend identifies the appliance via the Sanctum token,
    // so we don't need to include the appliance ID in the URL
    this.client = axios.create({
      baseURL: `${config.server_url}/api/v1`,
      timeout: 10000,
      httpAgent,
      httpsAgent,
      headers: {
        'Authorization': `Bearer ${config.appliance_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.client.interceptors.response.use(
      (response) => {
        this.consecutiveFailures = 0;
        this.backoffMs = 0;
        if (this.authFailed) {
          logger.info('Auth recovered, resuming normal operation');
          this.authFailed = false;
        }
        return response;
      },
      (error) => {
        const status = error.response?.status;

        if (status === 401 || status === 403) {
          if (!this.authFailed) {
            logger.error('Authentication/authorization failure - entering dormant state', {
              status,
              message: error.response?.data?.message || error.message
            });
            this.authFailed = true;
          }
        } else if (status === 429) {
          // Exponential backoff: 2s, 4s, 8s, 16s, max 60s
          this.backoffMs = Math.min(60000, Math.max(2000, this.backoffMs * 2 || 2000));
          logger.warn('Rate limited (429), backing off', { backoffMs: this.backoffMs });
        }

        this.consecutiveFailures++;
        logger.error('API request failed', {
          url: error.config?.url,
          status,
          message: error.message,
          consecutiveFailures: this.consecutiveFailures
        });
        return Promise.reject(error);
      }
    );
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

  /**
   * Queue a failed ACK for retry on next successful connection.
   * Maximum 50 pending ACKs, oldest are dropped if exceeded.
   *
   * @param {string} commandId - Command UUID
   * @param {object} ack - ACK payload
   */
  queueAckRetry(commandId, ack) {
    const MAX_PENDING_ACKS = 50;
    const MAX_RETRIES = 3;

    // Don't queue if already pending
    if (this.pendingAcks.some(p => p.commandId === commandId)) {
      return;
    }

    this.pendingAcks.push({ commandId, ack, retries: 0, maxRetries: MAX_RETRIES });

    if (this.pendingAcks.length > MAX_PENDING_ACKS) {
      const dropped = this.pendingAcks.shift();
      logger.warn('Dropped oldest pending ACK due to queue overflow', {
        commandId: dropped.commandId
      });
    }

    logger.info('Queued ACK for retry', {
      commandId,
      pendingCount: this.pendingAcks.length
    });
  }

  /**
   * Retry sending any queued ACKs.
   * Called after each successful poll to drain the retry queue.
   */
  async retryPendingAcks() {
    if (this.pendingAcks.length === 0) {
      return;
    }

    const toRetry = [...this.pendingAcks];
    this.pendingAcks = [];

    for (const pending of toRetry) {
      try {
        await this.acknowledgeCommand(pending.commandId, pending.ack);
        logger.info('Retried ACK successfully', { commandId: pending.commandId });
      } catch (error) {
        pending.retries++;
        if (pending.retries < pending.maxRetries) {
          this.pendingAcks.push(pending);
          logger.warn('ACK retry failed, will retry again', {
            commandId: pending.commandId,
            retries: pending.retries,
            maxRetries: pending.maxRetries
          });
        } else {
          logger.error('ACK retry exhausted, dropping', {
            commandId: pending.commandId,
            retries: pending.retries
          });
        }
      }
    }
  }

  /**
   * Check if the client should skip requests due to auth failure or rate limit backoff.
   *
   * @returns {{ shouldSkip: boolean, reason: string|null }}
   */
  getThrottleStatus() {
    if (this.authFailed) {
      return { shouldSkip: true, reason: 'auth_failed' };
    }
    if (this.backoffMs > 0) {
      return { shouldSkip: true, reason: 'rate_limited', backoffMs: this.backoffMs };
    }
    return { shouldSkip: false, reason: null };
  }
}

module.exports = ApiClient;
