const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const si = require('systeminformation');
const logger = require('./logging/logger');
const watchdog = require('./watchdog');
const { loadConfig } = require('./config/config');
const { stateManager, CONNECTION_STATUS } = require('./state/state-manager');
const ApiClient = require('./communication/api-client');
const BrowserController = require('./browser/controller');
const CommandManager = require('./commands/manager');
const AutoUpdater = require('./update/auto-updater');
const { getVolume } = require('./commands/handlers/volume');

const execFileAsync = promisify(execFile);

// Version will be loaded from git tag (cached after first fetch)
let cachedVersion = null;

const WEB_DIR = path.join(__dirname, '../web');
const PORT = process.env.PORT || 3000;

/**
 * Optional API key for authenticating local API requests.
 * If set, API endpoints require X-API-Key header.
 * If not set, API endpoints are accessible without authentication.
 */
const LOCAL_API_KEY = process.env.ONESIBOX_LOCAL_API_KEY || null;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

/**
 * Security headers to include in all HTTP responses.
 * These headers help protect against common web vulnerabilities.
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; media-src *"
};

/**
 * Write HTTP response with security headers.
 * @param {http.ServerResponse} res - The response object
 * @param {number} statusCode - HTTP status code
 * @param {object} additionalHeaders - Additional headers to include
 */
function writeSecureResponse(res, statusCode, additionalHeaders = {}) {
  res.writeHead(statusCode, { ...SECURITY_HEADERS, ...additionalHeaders });
}

/**
 * Check if API request is authenticated.
 * If LOCAL_API_KEY is not set, all requests are allowed.
 * If set, requests must include matching X-API-Key header.
 * @param {http.IncomingMessage} req - The request object
 * @returns {boolean} True if authenticated
 */
function isApiAuthenticated(req) {
  if (!LOCAL_API_KEY) {
    return true; // No key configured, allow all
  }

  const providedKey = req.headers['x-api-key'];
  return providedKey === LOCAL_API_KEY;
}

/**
 * Send 401 Unauthorized response.
 * @param {http.ServerResponse} res - The response object
 */
function sendUnauthorized(res) {
  writeSecureResponse(res, 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Unauthorized',
    message: 'Valid X-API-Key header required'
  }));
}

let config;
let apiClient;
let browserController;
let commandManager;
let pollingInterval;
let heartbeatInterval;
let autoUpdater;

function serveStatic(req, res) {
  // Extract pathname without query string
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(WEB_DIR, filePath);

  if (!fullPath.startsWith(WEB_DIR)) {
    writeSecureResponse(res, 403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      writeSecureResponse(res, 404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    writeSecureResponse(res, 200, { 'Content-Type': contentType });
    res.end(data);
  });
}

/**
 * Get application version from git tag.
 * Uses `git describe --tags` to get the current tag.
 * Falls back to package.json version if git is not available.
 */
async function getAppVersion() {
  // Return cached version if available
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    // Try to get version from git tag
    const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: path.join(__dirname, '..')
    });
    const gitTag = stdout.trim();

    if (gitTag) {
      // Remove 'v' prefix if present for consistency
      cachedVersion = gitTag.startsWith('v') ? gitTag.substring(1) : gitTag;
      logger.debug('Version from git tag', { version: cachedVersion });
      return cachedVersion;
    }
  } catch (error) {
    logger.debug('Could not get version from git tag', { error: error.message });
  }

  // Fallback to package.json
  try {
    const packageJson = require('../package.json');
    cachedVersion = packageJson.version;
    logger.debug('Version from package.json', { version: cachedVersion });
    return cachedVersion;
  } catch {
    return 'unknown';
  }
}

function handleApiStatus(req, res) {
  const state = stateManager.getState();
  writeSecureResponse(res, 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: state.status,
    connectionStatus: state.connectionStatus,
    volume: state.volume
  }));
}

async function handleApiSystemInfo(req, res) {
  try {
    // Get version, network interfaces and WiFi info in parallel
    const [version, networkInterfaces, wifiConnections] = await Promise.all([
      getAppVersion(),
      si.networkInterfaces(),
      si.wifiConnections()
    ]);

    // Find primary IP (prefer non-internal, non-docker interfaces)
    let primaryIp = '--';
    for (const iface of networkInterfaces) {
      if (!iface.internal && iface.ip4 && !iface.iface.startsWith('docker') && !iface.iface.startsWith('br-')) {
        primaryIp = iface.ip4;
        break;
      }
    }

    // Get WiFi SSID (first connected network)
    let wifiSsid = null;
    if (wifiConnections && wifiConnections.length > 0) {
      wifiSsid = wifiConnections[0].ssid || null;
    }

    writeSecureResponse(res, 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version,
      ip: primaryIp,
      wifi: wifiSsid
    }));
  } catch (error) {
    logger.warn('Failed to get system info', { error: error.message });
    const version = await getAppVersion();
    writeSecureResponse(res, 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version,
      ip: '--',
      wifi: null
    }));
  }
}

/**
 * Proxy endpoint for JW CDN media API.
 * Avoids CORS/CSP issues by fetching server-side.
 */
async function handleJwMediaProxy(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const lang = url.searchParams.get('lang');
  const mediaId = url.searchParams.get('mediaId');

  if (!lang || !mediaId) {
    writeSecureResponse(res, 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing lang or mediaId parameter' }));
    return;
  }

  // Validate parameters (prevent injection)
  if (!/^[A-Z]{1,3}$/i.test(lang) || !/^[\w-]+$/.test(mediaId)) {
    writeSecureResponse(res, 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid parameters' }));
    return;
  }

  const apiUrl = `https://b.jw-cdn.org/apis/mediator/v1/media-items/${lang.toUpperCase()}/${mediaId}`;

  try {
    const https = require('https');
    const fetchPromise = new Promise((resolve, reject) => {
      https.get(apiUrl, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`API returned ${response.statusCode}`));
          }
        });
      }).on('error', reject);
    });

    const data = await fetchPromise;
    writeSecureResponse(res, 200, { 'Content-Type': 'application/json' });
    res.end(data);
  } catch (error) {
    logger.warn('JW media proxy failed', { error: error.message, lang, mediaId });
    writeSecureResponse(res, 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch media data' }));
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;

    // API endpoints require authentication if LOCAL_API_KEY is set
    if (urlPath === '/api/status' || urlPath === '/api/system-info') {
      if (!isApiAuthenticated(req)) {
        logger.warn('Unauthorized API request', {
          url: req.url,
          ip: req.socket.remoteAddress
        });
        sendUnauthorized(res);
        return;
      }

      if (urlPath === '/api/status') {
        handleApiStatus(req, res);
      } else {
        handleApiSystemInfo(req, res);
      }
    } else if (urlPath === '/api/jw-media') {
      // JW media proxy - no auth required (local use only)
      handleJwMediaProxy(req, res);
    } else {
      // Static files don't require authentication
      serveStatic(req, res);
    }
  });
}

async function startPolling() {
  const poll = async () => {
    try {
      const commands = await apiClient.getCommands();
      logger.debug('Poll response', { commandCount: commands.length });
      if (commands.length > 0) {
        logger.info('Received commands', { count: commands.length });
        await commandManager.processCommands(commands);
      }
      stateManager.setConnectionStatus(CONNECTION_STATUS.CONNECTED);
    } catch (error) {
      logger.error('Polling failed', { error: error.message });
      if (apiClient.consecutiveFailures >= 3) {
        stateManager.setConnectionStatus(CONNECTION_STATUS.OFFLINE);
      } else {
        stateManager.setConnectionStatus(CONNECTION_STATUS.RECONNECTING);
      }
    }
  };

  await poll();
  pollingInterval = setInterval(poll, config.polling_interval_seconds * 1000);
}

/**
 * Get network information for heartbeat.
 * Identifies connection type, interface details, and WiFi info if applicable.
 */
async function getNetworkInfo() {
  try {
    const [networkInterfaces, wifiConnections, defaultGateway] = await Promise.all([
      si.networkInterfaces(),
      si.wifiConnections(),
      si.networkGatewayDefault()
    ]);

    // Find the active interface (prefer non-internal, has IP, is up)
    const activeInterface = networkInterfaces.find(iface =>
      iface.operstate === 'up' && !iface.internal && iface.ip4 &&
      !iface.iface.startsWith('docker') && !iface.iface.startsWith('br-') &&
      !iface.iface.startsWith('veth')
    );

    if (!activeInterface) {
      return { network: null, wifi: null };
    }

    // Determine network type based on interface name
    const isWifi = activeInterface.iface.startsWith('wlan') ||
                   activeInterface.iface.startsWith('wl') ||
                   activeInterface.type === 'wireless';

    const network = {
      type: isWifi ? 'wifi' : 'ethernet',
      interface: activeInterface.iface,
      ip: activeInterface.ip4,
      netmask: activeInterface.ip4subnet || null,
      gateway: defaultGateway || null,
      mac: activeInterface.mac || null,
      dns: activeInterface.dnsSuffix ? [activeInterface.dnsSuffix] : []
    };

    // Add WiFi-specific info if applicable
    let wifi = null;
    if (isWifi && wifiConnections && wifiConnections.length > 0) {
      const wifiConn = wifiConnections[0];
      // Convert dBm to percentage (typical range: -100 dBm to -30 dBm)
      const signalDbm = wifiConn.signalLevel || -100;
      const signalPercent = Math.min(100, Math.max(0, 2 * (signalDbm + 100)));

      wifi = {
        ssid: wifiConn.ssid || null,
        signal_dbm: signalDbm,
        signal_percent: Math.round(signalPercent),
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
 * Get detailed memory information for heartbeat.
 * Returns breakdown similar to `free -h` command.
 */
async function getDetailedMemory(mem) {
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

async function startHeartbeat() {
  const sendHeartbeat = async () => {
    try {
      const [cpu, mem, disk, temp, version, networkData] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.cpuTemperature(),
        getAppVersion(),
        getNetworkInfo()
      ]);

      const state = stateManager.getState();
      const uptime = Math.floor(process.uptime());

      const heartbeat = {
        status: state.status,
        current_media: state.currentMedia ? {
          url: state.currentMedia.url,
          type: state.currentMedia.media_type, // Server expects 'type' not 'media_type'
          position: state.currentMedia.position,
          duration: state.currentMedia.duration
        } : null,
        volume: state.volume,
        cpu_usage: Math.round(cpu.currentLoad),
        memory_usage: Math.round((mem.used / mem.total) * 100),
        disk_usage: disk[0] ? Math.round(disk[0].use) : 0,
        temperature: temp.main || 0,
        uptime,
        timestamp: new Date().toISOString(),
        // Extended diagnostics data
        app_version: version,
        network: networkData.network,
        wifi: networkData.wifi,
        memory: await getDetailedMemory(mem)
      };

      await apiClient.sendHeartbeat(heartbeat);
      stateManager.updateHeartbeat();
      logger.debug('Heartbeat sent', { status: state.status });
    } catch (error) {
      logger.error('Heartbeat failed', { error: error.message });
    }
  };

  await sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, config.heartbeat_interval_seconds * 1000);
}

function registerHandlers() {
  const mediaHandler = require('./commands/handlers/media');
  const zoomHandler = require('./commands/handlers/zoom');
  const volumeHandler = require('./commands/handlers/volume');
  const systemHandler = require('./commands/handlers/system');
  const serviceHandler = require('./commands/handlers/service');
  const systemInfoHandler = require('./commands/handlers/system-info');
  const logsHandler = require('./commands/handlers/logs');

  mediaHandler.setApiClient(apiClient);

  // Media handlers
  commandManager.registerHandler('play_media', mediaHandler.playMedia);
  commandManager.registerHandler('stop_media', mediaHandler.stopMedia);
  commandManager.registerHandler('pause_media', mediaHandler.pauseMedia);
  commandManager.registerHandler('resume_media', mediaHandler.resumeMedia);

  // Zoom handlers
  commandManager.registerHandler('join_zoom', zoomHandler.joinZoom);
  commandManager.registerHandler('leave_zoom', zoomHandler.leaveZoom);

  // Volume handler
  commandManager.registerHandler('set_volume', volumeHandler.setVolume);

  // System handlers
  commandManager.registerHandler('reboot', systemHandler.reboot);
  commandManager.registerHandler('shutdown', systemHandler.shutdown);
  commandManager.registerHandler('restart_service', serviceHandler.restartService);

  // Diagnostic handlers
  commandManager.registerHandler('get_system_info', systemInfoHandler.getSystemInfo);
  commandManager.registerHandler('get_logs', logsHandler.getLogs);
}

async function shutdown(signal) {
  logger.info('Shutting down', { signal });

  // Notify systemd we're stopping
  watchdog.stopping();

  if (pollingInterval) clearInterval(pollingInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (autoUpdater) autoUpdater.stop();

  // Cleanup Zoom resources first (if any)
  try {
    const zoomHandler = require('./commands/handlers/zoom');
    await zoomHandler.cleanup();
  } catch {
    // Ignore Zoom cleanup errors during shutdown
  }

  try {
    await browserController.goToStandby();
  } catch {
    // Ignore browser errors during shutdown
  }

  process.exit(0);
}

async function main() {
  logger.info('OnesiBox starting...');

  try {
    config = loadConfig();
  } catch (error) {
    logger.error('Failed to load configuration', { error: error.message });
    process.exit(1);
  }

  apiClient = new ApiClient(config);
  browserController = new BrowserController();
  commandManager = new CommandManager(apiClient, browserController);

  registerHandlers();

  stateManager.setVolume(config.default_volume);

  const server = createServer();
  server.listen(PORT, () => {
    logger.info('HTTP server started', { port: PORT });
  });

  // Launch browser with standby screen on startup
  // Use initialize() which does a force restart to ensure clean state
  try {
    logger.info('Initializing browser...');
    await browserController.initialize();
  } catch (error) {
    logger.warn('Could not initialize browser at startup', { error: error.message });
  }

  // Try to read actual system volume at startup
  try {
    const systemVolume = await getVolume();
    if (systemVolume !== null) {
      stateManager.setVolume(systemVolume);
      logger.info('Volume initialized from system', { level: systemVolume });
    }
  } catch (error) {
    logger.warn('Could not read initial system volume, using default', { error: error.message });
  }

  await startPolling();
  await startHeartbeat();

  stateManager.setConnectionStatus(CONNECTION_STATUS.CONNECTED);
  logger.info('OnesiBox ready');

  // Start auto-updater (checks every 5 minutes by default)
  autoUpdater = new AutoUpdater({
    checkIntervalSeconds: config.update_check_interval_seconds || 5 * 60
  });
  autoUpdater.start();

  // Notify systemd we're ready and start watchdog pings
  watchdog.ready();
  watchdog.startPinging();
  watchdog.status('Running - connected to server');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
