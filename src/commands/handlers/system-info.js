const os = require('os');
const si = require('systeminformation');
const logger = require('../../logging/logger');

/**
 * Get system information for diagnostic purposes.
 * Collects CPU, memory, disk, network, and uptime data.
 *
 * @param {object} command - The command object
 * @param {object} _browserController - Browser controller (unused)
 * @returns {Promise<object>} System information payload
 */
async function getSystemInfo(command, _browserController) {
  logger.info('Collecting system information', { commandId: command.id });

  try {
    // Collect all system info in parallel
    const [cpu, mem, disk, networkInterfaces, wifiConnections, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
      si.wifiConnections(),
      si.cpuTemperature()
    ]);

    // Calculate uptime
    const uptimeSeconds = Math.floor(os.uptime());
    const uptimeFormatted = formatUptime(uptimeSeconds);

    // Get load averages
    const loadAvg = os.loadavg();

    // Get primary disk info (usually root partition)
    const primaryDisk = disk.find(d => d.mount === '/') || disk[0] || {};

    // Get active network interface
    const activeInterface = networkInterfaces.find(iface =>
      iface.operstate === 'up' && !iface.internal && iface.ip4
    ) || {};

    // Get WiFi info
    const wifiInfo = wifiConnections[0] || {};

    const systemInfo = {
      uptime_seconds: uptimeSeconds,
      uptime_formatted: uptimeFormatted,
      load_average: {
        '1m': Math.round(loadAvg[0] * 100) / 100,
        '5m': Math.round(loadAvg[1] * 100) / 100,
        '15m': Math.round(loadAvg[2] * 100) / 100
      },
      memory: {
        used_bytes: mem.used,
        total_bytes: mem.total,
        percent: Math.round((mem.used / mem.total) * 100)
      },
      cpu_percent: Math.round(cpu.currentLoad),
      disk: {
        used_bytes: primaryDisk.used || 0,
        total_bytes: primaryDisk.size || 0,
        percent: Math.round(primaryDisk.use || 0)
      },
      temperature: temp.main !== null ? Math.round(temp.main * 10) / 10 : null,
      network: {
        ip_address: activeInterface.ip4 || null,
        interface: activeInterface.iface || null
      },
      wifi: {
        ssid: wifiInfo.ssid || null,
        signal_level: wifiInfo.signalLevel || null
      },
      timestamp: new Date().toISOString()
    };

    logger.info('System information collected', {
      commandId: command.id,
      cpu: systemInfo.cpu_percent,
      memory: systemInfo.memory.percent,
      disk: systemInfo.disk.percent
    });

    // Return the payload - CommandManager will include it in ACK
    return systemInfo;
  } catch (error) {
    logger.error('Failed to collect system information', {
      commandId: command.id,
      error: error.message
    });
    throw new Error(`Failed to collect system information: ${error.message}`);
  }
}

/**
 * Format uptime seconds into human-readable string.
 *
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'giorno' : 'giorni'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'ora' : 'ore'}`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`);
  }

  return parts.length > 0 ? parts.join(', ') : '< 1 minuto';
}

module.exports = {
  getSystemInfo,
  formatUptime
};
