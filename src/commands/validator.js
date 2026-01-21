const logger = require('../logging/logger');

const ALLOWED_DOMAINS = [
  'jw.org',
  'www.jw.org',
  'wol.jw.org',
  'download-a.akamaihd.net'
];

const ALLOWED_DOMAIN_PATTERNS = [
  /^[a-z0-9-]+\.jw-cdn\.org$/
];

const COMMAND_TYPES = [
  'play_media',
  'stop_media',
  'pause_media',
  'resume_media',
  'set_volume',
  'join_zoom',
  'leave_zoom'
];

function isUrlAllowed(url) {
  try {
    const { hostname, protocol } = new URL(url);

    if (protocol !== 'https:') {
      return false;
    }

    if (ALLOWED_DOMAINS.includes(hostname)) {
      return true;
    }

    for (const domain of ALLOWED_DOMAINS) {
      if (hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    for (const pattern of ALLOWED_DOMAIN_PATTERNS) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function isZoomUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'zoom.us' || hostname.endsWith('.zoom.us');
  } catch {
    return false;
  }
}

function validateCommand(command) {
  const errors = [];

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
    if (expiresAt < new Date()) {
      errors.push('Command has expired');
    }
  }

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
      } else if (typeof command.payload.level !== 'number' || command.payload.level < 0 || command.payload.level > 100) {
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
  }

  if (errors.length > 0) {
    logger.warn('Command validation failed', { commandId: command.id, errors });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function getErrorCodeForValidation(errors) {
  if (errors.some(e => e.includes('Unknown command type'))) {
    return 'E003';
  }
  if (errors.some(e => e.includes('whitelist'))) {
    return 'E005';
  }
  return 'E004';
}

module.exports = {
  isUrlAllowed,
  isZoomUrl,
  validateCommand,
  getErrorCodeForValidation,
  COMMAND_TYPES
};
