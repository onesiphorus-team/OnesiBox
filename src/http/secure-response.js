const logger = require('../logging/logger');

/**
 * Security headers included in every HTTP response.
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
 * Write an HTTP response head with the security headers.
 *
 * The guard is the point of this function. Handlers answer on the happy path
 * and answer again from their catch block; when the failure happens after the
 * head was written, `res.writeHead` throws ERR_HTTP_HEADERS_SENT. Those
 * handlers are async and main.js dispatches them without awaiting, so the
 * throw becomes an unhandled rejection — fatal since Node 15. Refusing the
 * second write turns a dead kiosk into one logged warning.
 *
 * The skip is logged rather than swallowed: a handler answering twice is a bug
 * in that handler, and it has to stay visible.
 *
 * @param {import('http').ServerResponse} res - The response object.
 * @param {number} statusCode - HTTP status code.
 * @param {object} [additionalHeaders] - Additional headers to include.
 * @returns {boolean} True when the head was written, false when it was skipped.
 */
function writeSecureResponse(res, statusCode, additionalHeaders = {}) {
  if (!res || res.headersSent || res.writableEnded) {
    logger.warn('Skipped an HTTP response that was already answered', {
      statusCode,
      headersSent: !!(res && res.headersSent),
      ended: !!(res && res.writableEnded)
    });
    return false;
  }

  res.writeHead(statusCode, { ...SECURITY_HEADERS, ...additionalHeaders });
  return true;
}

/**
 * Send a complete JSON response, head and body, guarded end to end.
 *
 * Callers get one call that is always safe to make, including from a catch
 * block that has no idea how far the happy path got.
 *
 * @param {import('http').ServerResponse} res - The response object.
 * @param {number} statusCode - HTTP status code.
 * @param {*} body - Value to serialise as the JSON body.
 * @returns {boolean} True when the response was sent.
 */
function sendSecureJson(res, statusCode, body) {
  if (!writeSecureResponse(res, statusCode, { 'Content-Type': 'application/json' })) {
    return false;
  }

  res.end(JSON.stringify(body));
  return true;
}

module.exports = { SECURITY_HEADERS, writeSecureResponse, sendSecureJson };
