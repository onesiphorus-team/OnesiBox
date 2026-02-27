const si = require('systeminformation');
const logger = require('../logging/logger');

/**
 * Find the active non-internal network interface.
 * Excludes docker, bridge, and virtual interfaces.
 *
 * @param {Array} networkInterfaces - List of network interfaces from systeminformation
 * @returns {object|null} The active interface or null
 */
function findActiveInterface(networkInterfaces) {
  return networkInterfaces.find(iface =>
    iface.operstate === 'up' && !iface.internal && iface.ip4 &&
    !iface.iface.startsWith('docker') && !iface.iface.startsWith('br-') &&
    !iface.iface.startsWith('veth')
  ) || null;
}

/**
 * Determine if an interface is WiFi based on its name or type.
 *
 * @param {object} iface - Network interface object
 * @returns {boolean}
 */
function isWifiInterface(iface) {
  return iface.iface.startsWith('wlan') ||
         iface.iface.startsWith('wl') ||
         iface.type === 'wireless';
}

/**
 * Convert WiFi signal dBm to percentage.
 * Typical range: -100 dBm (weak) to -30 dBm (strong).
 *
 * @param {number} signalDbm - Signal strength in dBm
 * @returns {number} Signal percentage (0-100)
 */
function signalDbmToPercent(signalDbm) {
  return Math.min(100, Math.max(0, Math.round(2 * (signalDbm + 100))));
}

/**
 * Get network information for heartbeat and diagnostics.
 * Returns structured network and WiFi data.
 *
 * @returns {Promise<{network: object|null, wifi: object|null}>}
 */
async function getNetworkInfo() {
  try {
    const [networkInterfaces, wifiConnections, defaultGateway] = await Promise.all([
      si.networkInterfaces(),
      si.wifiConnections(),
      si.networkGatewayDefault()
    ]);

    const activeInterface = findActiveInterface(networkInterfaces);

    if (!activeInterface) {
      return { network: null, wifi: null };
    }

    const isWifi = isWifiInterface(activeInterface);

    const network = {
      type: isWifi ? 'wifi' : 'ethernet',
      interface: activeInterface.iface,
      ip: activeInterface.ip4,
      netmask: activeInterface.ip4subnet || null,
      gateway: defaultGateway || null,
      mac: activeInterface.mac || null,
      dns: activeInterface.dnsSuffix ? [activeInterface.dnsSuffix] : []
    };

    let wifi = null;
    if (isWifi && wifiConnections && wifiConnections.length > 0) {
      const wifiConn = wifiConnections[0];
      const signalDbm = wifiConn.signalLevel || -100;

      wifi = {
        ssid: wifiConn.ssid || null,
        signal_dbm: signalDbm,
        signal_percent: signalDbmToPercent(signalDbm),
        channel: wifiConn.channel || null,
        frequency: wifiConn.frequency || null,
        security: wifiConn.security || null
      };
    }

    return { network, wifi };
  } catch (error) {
    logger.debug('Failed to get network info', { error: error.message });
    return { network: null, wifi: null };
  }
}

/**
 * Get detailed memory breakdown (similar to `free -h`).
 *
 * @param {object} mem - Memory data from systeminformation
 * @returns {object}
 */
function getDetailedMemory(mem) {
  return {
    total: mem.total,
    used: mem.used,
    free: mem.free,
    available: mem.available,
    buffers: mem.buffers,
    cached: mem.cached,
    percent: Math.round((mem.used / mem.total) * 100)
  };
}

module.exports = {
  findActiveInterface,
  isWifiInterface,
  signalDbmToPercent,
  getNetworkInfo,
  getDetailedMemory
};
