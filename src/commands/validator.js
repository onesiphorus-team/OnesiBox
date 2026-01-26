const logger = require('../logging/logger');

/**
 * Centralized error codes for consistent error reporting.
 *
 * Standard codes (E001-E010) are aligned with Onesiforo server spec:
 * - E001: Token non valido (server-side only)
 * - E002: Risorsa non trovata (server-side only)
 * - E003: Non autorizzato / Appliance disattivata (server-side only)
 * - E004: Comando scaduto
 * - E005: URL media non valido
 * - E006: Tipo comando non supportato
 * - E007: Appliance offline (server-side only)
 * - E008: Rate limit superato (server-side only)
 * - E009: Errore interno
 * - E010: Timeout esecuzione
 *
 * Client-specific codes (E1xx) for handler errors:
 */
const ERROR_CODES = {
  // Standard codes (aligned with server spec)
  COMMAND_EXPIRED: 'E004',
  URL_NOT_WHITELISTED: 'E005',
  UNKNOWN_COMMAND_TYPE: 'E006',
  INTERNAL_ERROR: 'E009',
  EXECUTION_TIMEOUT: 'E010',

  // Client-specific handler errors (E1xx range)
  MEDIA_HANDLER_FAILED: 'E101',
  ZOOM_HANDLER_FAILED: 'E102',
  VOLUME_HANDLER_FAILED: 'E103',
  SYSTEM_HANDLER_FAILED: 'E104',
  DIAGNOSTICS_HANDLER_FAILED: 'E105',
  SERVICE_HANDLER_FAILED: 'E106',
  INVALID_COMMAND_STRUCTURE: 'E107',
  INVALID_PAYLOAD: 'E108'
};

/**
 * Allowed base domains for media playback.
 * Only exact matches or valid subdomains are permitted.
 */
const ALLOWED_DOMAINS = [
  'jw.org',
  'www.jw.org',
  'wol.jw.org',
  'download-a.akamaihd.net'
];

/**
 * Regex patterns for allowed CDN domains.
 */
const ALLOWED_DOMAIN_PATTERNS = [
  /^[a-z0-9-]+\.jw-cdn\.org$/
];

/**
 * Maximum URL length to prevent buffer overflow attacks.
 */
const MAX_URL_LENGTH = 2048;

/**
 * Valid command types that the appliance can process.
 */
const COMMAND_TYPES = [
  'play_media',
  'stop_media',
  'pause_media',
  'resume_media',
  'set_volume',
  'join_zoom',
  'leave_zoom',
  'reboot',
  'shutdown',
  'restart_service',
  'get_system_info',
  'get_logs'
];

/**
 * Check if a URL is in the allowed domain whitelist.
 *
 * Security measures:
 * - Enforces HTTPS protocol
 * - Validates exact domain match or proper subdomain
 * - Checks URL length to prevent overflow attacks
 * - Validates against regex patterns for CDN domains
 *
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is allowed
 */
function isUrlAllowed(url) {
  try {
    // Check URL length first
    if (!url || url.length > MAX_URL_LENGTH) {
      return false;
    }

    const parsedUrl = new URL(url);
    const { hostname, protocol, port } = parsedUrl;

    // Must be HTTPS (no HTTP, no other protocols)
    if (protocol !== 'https:') {
      return false;
    }

    // Reject non-standard ports (could bypass security)
    if (port && port !== '443') {
      return false;
    }

    // Normalize hostname to lowercase
    const normalizedHostname = hostname.toLowerCase();

    // Check exact domain match
    if (ALLOWED_DOMAINS.includes(normalizedHostname)) {
      return true;
    }

    // Check if it's a valid subdomain of an allowed domain
    // A valid subdomain must have the allowed domain preceded by a dot
    for (const domain of ALLOWED_DOMAINS) {
      // Ensure it's a proper subdomain: "sub.domain.com" for "domain.com"
      // This prevents "fakedomain.com" from matching "domain.com"
      if (normalizedHostname.endsWith('.' + domain)) {
        // Additional check: the part before the domain must be valid
        const subdomain = normalizedHostname.slice(0, -(domain.length + 1));
        if (isValidSubdomainPart(subdomain)) {
          return true;
        }
      }
    }

    // Check against regex patterns (e.g., CDN subdomains)
    for (const pattern of ALLOWED_DOMAIN_PATTERNS) {
      if (pattern.test(normalizedHostname)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validate that a subdomain part contains only valid characters.
 * Valid subdomain: alphanumeric and hyphens, not starting/ending with hyphen.
 *
 * @param {string} subdomain - The subdomain part to validate
 * @returns {boolean} True if valid
 */
function isValidSubdomainPart(subdomain) {
  if (!subdomain || subdomain.length === 0) {
    return false;
  }

  // Each label in the subdomain must be valid
  const labels = subdomain.split('.');
  for (const label of labels) {
    // Label must be 1-63 characters, alphanumeric and hyphens
    // Cannot start or end with hyphen
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a URL is a valid Zoom meeting URL.
 *
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is a valid Zoom URL
 */
function isZoomUrl(url) {
  try {
    if (!url || url.length > MAX_URL_LENGTH) {
      return false;
    }

    const { hostname, protocol, port } = new URL(url);

    // Must be HTTPS
    if (protocol !== 'https:') {
      return false;
    }

    // No non-standard ports
    if (port && port !== '443') {
      return false;
    }

    const normalizedHostname = hostname.toLowerCase();

    // Must be exactly zoom.us or a subdomain of zoom.us
    return normalizedHostname === 'zoom.us' ||
           (normalizedHostname.endsWith('.zoom.us') &&
            isValidSubdomainPart(normalizedHostname.slice(0, -8)));
  } catch {
    return false;
  }
}

/**
 * Validate a command structure and payload.
 *
 * @param {object} command - The command to validate
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
function validateCommand(command) {
  const errors = [];

  if (!command || typeof command !== 'object') {
    errors.push('Invalid command structure');
    return { valid: false, errors };
  }

  if (!command.id) {
    errors.push('Command missing id');
  }

  if (!command.type) {
    errors.push('Command missing type');
  } else if (!COMMAND_TYPES.includes(command.type)) {
    errors.push(`Unknown command type: ${command.type}`);
  }

  if (command.expires_at) {
    const expiresAt = new Date(command.expires_at);
    if (isNaN(expiresAt.getTime())) {
      errors.push('Invalid expires_at format');
    } else if (expiresAt < new Date()) {
      errors.push('Command has expired');
    }
  }

  // Type-specific validation
  switch (command.type) {
    case 'play_media':
      if (!command.payload?.url) {
        errors.push('play_media requires url in payload');
      } else if (!isUrlAllowed(command.payload.url)) {
        errors.push('URL not in authorized domain whitelist');
      }
      if (!command.payload?.media_type || !['video', 'audio'].includes(command.payload.media_type)) {
        errors.push('play_media requires media_type (video|audio) in payload');
      }
      break;

    case 'set_volume':
      if (command.payload?.level === undefined) {
        errors.push('set_volume requires level in payload');
      } else if (typeof command.payload.level !== 'number' ||
                 !Number.isFinite(command.payload.level) ||
                 command.payload.level < 0 ||
                 command.payload.level > 100) {
        errors.push('set_volume level must be 0-100');
      }
      break;

    case 'join_zoom':
      if (!command.payload?.meeting_url) {
        errors.push('join_zoom requires meeting_url in payload');
      } else if (!isZoomUrl(command.payload.meeting_url)) {
        errors.push('join_zoom meeting_url must be a valid Zoom URL');
      }
      break;

    case 'reboot':
    case 'shutdown':
      // Optional delay parameter validation
      if (command.payload?.delay !== undefined) {
        if (typeof command.payload.delay !== 'number' ||
            !Number.isFinite(command.payload.delay) ||
            command.payload.delay < 0 ||
            command.payload.delay > 3600) {
          errors.push(`${command.type} delay must be 0-3600 seconds`);
        }
      }
      break;

    case 'get_logs':
      // Optional lines parameter validation
      if (command.payload?.lines !== undefined) {
        if (typeof command.payload.lines !== 'number' ||
            !Number.isInteger(command.payload.lines) ||
            command.payload.lines < 1 ||
            command.payload.lines > 500) {
          errors.push('get_logs lines must be 1-500');
        }
      }
      break;

    case 'get_system_info':
    case 'restart_service':
      // No payload required
      break;
  }

  if (errors.length > 0) {
    logger.warn('Command validation failed', { commandId: command.id, errors });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get the appropriate error code for validation errors.
 *
 * @param {string[]} errors - Array of error messages
 * @returns {string} Error code
 */
function getErrorCodeForValidation(errors) {
  if (errors.some(e => e.includes('Unknown command type'))) {
    return ERROR_CODES.UNKNOWN_COMMAND_TYPE;
  }
  if (errors.some(e => e.includes('whitelist'))) {
    return ERROR_CODES.URL_NOT_WHITELISTED;
  }
  if (errors.some(e => e.includes('expired'))) {
    return ERROR_CODES.COMMAND_EXPIRED;
  }
  return ERROR_CODES.INVALID_COMMAND_STRUCTURE;
}

/**
 * Get error code for a specific command type failure.
 *
 * @param {string} commandType - The command type that failed
 * @returns {string} Error code
 */
function getErrorCodeForCommandType(commandType) {
  switch (commandType) {
    case 'play_media':
    case 'stop_media':
    case 'pause_media':
    case 'resume_media':
      return ERROR_CODES.MEDIA_HANDLER_FAILED;
    case 'join_zoom':
    case 'leave_zoom':
      return ERROR_CODES.ZOOM_HANDLER_FAILED;
    case 'set_volume':
      return ERROR_CODES.VOLUME_HANDLER_FAILED;
    case 'reboot':
    case 'shutdown':
      return ERROR_CODES.SYSTEM_HANDLER_FAILED;
    case 'restart_service':
      return ERROR_CODES.SERVICE_HANDLER_FAILED;
    case 'get_system_info':
    case 'get_logs':
      return ERROR_CODES.DIAGNOSTICS_HANDLER_FAILED;
    default:
      return ERROR_CODES.INVALID_COMMAND_STRUCTURE;
  }
}

module.exports = {
  isUrlAllowed,
  isZoomUrl,
  validateCommand,
  getErrorCodeForValidation,
  getErrorCodeForCommandType,
  COMMAND_TYPES,
  ERROR_CODES,
  MAX_URL_LENGTH
};
