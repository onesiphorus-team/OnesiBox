const fs = require('fs');
const path = require('path');
const logger = require('../logging/logger');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '../../config/config.json');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_REGEX = /^https:\/\/.+/;

/**
 * Environment variables that can override config file values.
 * Sensitive values (like tokens) SHOULD be provided via env vars in production.
 */
const ENV_OVERRIDES = {
  ONESIBOX_SERVER_URL: 'server_url',
  ONESIBOX_APPLIANCE_ID: 'appliance_id',
  ONESIBOX_TOKEN: 'appliance_token',
  ONESIBOX_POLLING_INTERVAL: 'polling_interval_seconds',
  ONESIBOX_HEARTBEAT_INTERVAL: 'heartbeat_interval_seconds',
  ONESIBOX_DEFAULT_VOLUME: 'default_volume',
  ONESIBOX_WS_ENABLED: 'websocket_enabled',
  ONESIBOX_REVERB_KEY: 'reverb_key',
  ONESIBOX_REVERB_HOST: 'reverb_host',
  ONESIBOX_REVERB_PORT: 'reverb_port',
  ONESIBOX_REVERB_SCHEME: 'reverb_scheme'
};

/**
 * Apply environment variable overrides to config.
 * Environment variables take precedence over config file values.
 * @param {object} config - The config object to modify
 */
function applyEnvOverrides(config) {
  for (const [envVar, configKey] of Object.entries(ENV_OVERRIDES)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      // Parse numeric values
      if (['polling_interval_seconds', 'heartbeat_interval_seconds', 'default_volume', 'reverb_port'].includes(configKey)) {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
          config[configKey] = numValue;
        }
      } else if (configKey === 'websocket_enabled') {
        config[configKey] = value === 'true' || value === '1';
      } else {
        config[configKey] = value;
      }
    }
  }
}

function validateConfig(config) {
  const errors = [];

  if (!config.server_url || !URL_REGEX.test(config.server_url)) {
    errors.push('server_url must be a valid HTTPS URL (set via config or ONESIBOX_SERVER_URL env var)');
  }

  if (!config.appliance_id || !UUID_REGEX.test(config.appliance_id)) {
    errors.push('appliance_id must be a valid UUID (set via config or ONESIBOX_APPLIANCE_ID env var)');
  }

  if (!config.appliance_token || typeof config.appliance_token !== 'string') {
    errors.push('appliance_token is required (set via config or ONESIBOX_TOKEN env var)');
  }

  if (config.polling_interval_seconds !== undefined) {
    if (typeof config.polling_interval_seconds !== 'number' || config.polling_interval_seconds < 1) {
      errors.push('polling_interval_seconds must be >= 1');
    }
  }

  if (config.heartbeat_interval_seconds !== undefined) {
    if (typeof config.heartbeat_interval_seconds !== 'number' || config.heartbeat_interval_seconds < 10) {
      errors.push('heartbeat_interval_seconds must be >= 10');
    }
  }

  if (config.default_volume !== undefined) {
    if (typeof config.default_volume !== 'number' || config.default_volume < 0 || config.default_volume > 100) {
      errors.push('default_volume must be between 0 and 100');
    }
  }

  if (config.update_check_interval_seconds !== undefined) {
    if (typeof config.update_check_interval_seconds !== 'number' || config.update_check_interval_seconds < 60) {
      errors.push('update_check_interval_seconds must be >= 60');
    }
  }

  return errors;
}

function loadConfig() {
  let config = {};

  // Load from config file if it exists
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');

    try {
      config = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON in configuration file: ${e.message}`);
    }
  } else {
    logger.info('Config file not found, using environment variables only', { path: CONFIG_PATH });
  }

  // Apply environment variable overrides (takes precedence over config file)
  applyEnvOverrides(config);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  // Derive default reverb_host from server_url if not set
  let defaultReverbHost = null;
  if (config.server_url) {
    try {
      defaultReverbHost = new URL(config.server_url).hostname;
    } catch {
      // ignore parse error, will remain null
    }
  }

  let websocketEnabled = config.websocket_enabled ?? true;

  // If WebSocket is enabled but reverb_key is missing, warn and disable
  if (websocketEnabled && !config.reverb_key) {
    logger.warn('WebSocket enabled but reverb_key is not set, disabling WebSocket');
    websocketEnabled = false;
  }

  const finalConfig = {
    server_url: config.server_url,
    appliance_id: config.appliance_id,
    appliance_token: config.appliance_token,
    polling_interval_seconds: config.polling_interval_seconds ?? 5,
    heartbeat_interval_seconds: config.heartbeat_interval_seconds ?? 30,
    default_volume: config.default_volume ?? 80,
    update_check_interval_seconds: config.update_check_interval_seconds ?? 1800, // 30 minutes
    websocket_enabled: websocketEnabled,
    reverb_key: config.reverb_key || null,
    reverb_host: config.reverb_host || defaultReverbHost,
    reverb_port: config.reverb_port ?? 8080,
    reverb_scheme: config.reverb_scheme || 'http'
  };

  // Log config without sensitive token
  logger.info('Configuration loaded successfully', {
    server_url: finalConfig.server_url,
    appliance_id: finalConfig.appliance_id,
    polling_interval_seconds: finalConfig.polling_interval_seconds,
    heartbeat_interval_seconds: finalConfig.heartbeat_interval_seconds,
    update_check_interval_seconds: finalConfig.update_check_interval_seconds,
    websocket_enabled: finalConfig.websocket_enabled,
    reverb_host: finalConfig.reverb_host,
    reverb_port: finalConfig.reverb_port,
    token_source: process.env.ONESIBOX_TOKEN ? 'environment' : 'config_file'
  });

  return finalConfig;
}

module.exports = { loadConfig, validateConfig };
