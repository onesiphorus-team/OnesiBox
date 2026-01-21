const si = require('systeminformation');
const EventEmitter = require('events');
const logger = require('../logging/logger');
const { stateManager } = require('../state/state-manager');

class HeartbeatService extends EventEmitter {
  constructor(apiClient, intervalSeconds = 30) {
    super();
    this.apiClient = apiClient;
    this.intervalMs = intervalSeconds * 1000;
    this.intervalHandle = null;
    this.startTime = Date.now();
  }

  async start() {
    if (this.intervalHandle) {
      return;
    }

    logger.info('Heartbeat service starting', { intervalMs: this.intervalMs });

    await this._sendHeartbeat();

    this.intervalHandle = setInterval(() => this._sendHeartbeat(), this.intervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info('Heartbeat service stopped');
  }

  async _collectMetrics() {
    try {
      const [cpu, mem, disk, temp] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.cpuTemperature()
      ]);

      return {
        cpu_usage: Math.round(cpu.currentLoad),
        memory_usage: Math.round((mem.used / mem.total) * 100),
        disk_usage: disk[0] ? Math.round(disk[0].use) : 0,
        temperature: temp.main || 0
      };
    } catch (error) {
      logger.warn('Failed to collect some metrics', { error: error.message });
      return {
        cpu_usage: 0,
        memory_usage: 0,
        disk_usage: 0,
        temperature: 0
      };
    }
  }

  async _sendHeartbeat() {
    try {
      const metrics = await this._collectMetrics();
      const state = stateManager.getState();
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);

      const heartbeat = {
        status: state.status,
        current_media: state.currentMedia ? {
          url: state.currentMedia.url,
          media_type: state.currentMedia.media_type,
          position: state.currentMedia.position,
          duration: state.currentMedia.duration
        } : null,
        cpu_usage: metrics.cpu_usage,
        memory_usage: metrics.memory_usage,
        disk_usage: metrics.disk_usage,
        temperature: metrics.temperature,
        uptime,
        timestamp: new Date().toISOString()
      };

      const response = await this.apiClient.sendHeartbeat(heartbeat);
      stateManager.updateHeartbeat();

      logger.debug('Heartbeat sent successfully', {
        status: state.status,
        cpu: metrics.cpu_usage,
        memory: metrics.memory_usage
      });

      this.emit('sent', heartbeat);

      if (response?.next_heartbeat) {
        this._adjustInterval(response.next_heartbeat * 1000);
      }
    } catch (error) {
      logger.error('Failed to send heartbeat', { error: error.message });
      this.emit('error', error);
    }
  }

  _adjustInterval(newIntervalMs) {
    if (newIntervalMs === this.intervalMs) {
      return;
    }

    logger.info('Adjusting heartbeat interval', {
      oldMs: this.intervalMs,
      newMs: newIntervalMs
    });

    this.intervalMs = newIntervalMs;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = setInterval(() => this._sendHeartbeat(), this.intervalMs);
    }
  }
}

module.exports = HeartbeatService;
