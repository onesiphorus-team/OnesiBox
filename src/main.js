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

const execFileAsync = promisify(execFile);

// Version will be loaded from git tag (cached after first fetch)
let cachedVersion = null;

const WEB_DIR = path.join(__dirname, '../web');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

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
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
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
  res.writeHead(200, { 'Content-Type': 'application/json' });
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version,
      ip: primaryIp,
      wifi: wifiSsid
    }));
  } catch (error) {
    logger.warn('Failed to get system info', { error: error.message });
    const version = await getAppVersion();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version,
      ip: '--',
      wifi: null
    }));
  }
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.url === '/api/status') {
      handleApiStatus(req, res);
    } else if (req.url === '/api/system-info') {
      handleApiSystemInfo(req, res);
    } else {
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

async function startHeartbeat() {
  const sendHeartbeat = async () => {
    try {
      const [cpu, mem, disk, temp] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.cpuTemperature()
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
        cpu_usage: Math.round(cpu.currentLoad),
        memory_usage: Math.round((mem.used / mem.total) * 100),
        disk_usage: disk[0] ? Math.round(disk[0].use) : 0,
        temperature: temp.main || 0,
        uptime,
        timestamp: new Date().toISOString()
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
