/**
 * Log Sanitizer Module
 *
 * Filters sensitive data from log content before transmission.
 * Patterns include passwords, tokens, API keys, and other credentials.
 */

/**
 * Patterns to detect and redact sensitive information.
 * Each pattern has a regex and replacement text.
 */
const SENSITIVE_PATTERNS = [
  // API keys and tokens (various formats)
  {
    pattern: /(^|['"`:=\s])(api[_-]?key|apikey|api[_-]?token|access[_-]?token|auth[_-]?token|bearer|token)['"`:=\s]+['"]?[a-zA-Z0-9_\-./+=]{8,}['"]?/gi,
    replacement: '$1$2=[REDACTED]'
  },
  // Passwords in various formats
  {
    pattern: /(^|['"`:=\s])(password|passwd|pwd|secret|credential)['"`:=\s]+['"]?[^\s'"`,}{)\]]+['"]?/gi,
    replacement: '$1$2=[REDACTED]'
  },
  // Authorization headers
  {
    pattern: /(Authorization|Bearer|Basic)\s*[:=]\s*['"]?([a-zA-Z0-9_\-./+=]{8,})['"]?/gi,
    replacement: '$1: [REDACTED]'
  },
  // JWT tokens (three base64 parts separated by dots)
  {
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    replacement: '[JWT_REDACTED]'
  },
  // Private keys
  {
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]'
  },
  // SSH keys
  {
    pattern: /ssh-(rsa|ed25519|ecdsa)\s+[A-Za-z0-9+/=]+/g,
    replacement: '[SSH_KEY_REDACTED]'
  },
  // AWS credentials
  {
    pattern: /(AKIA|ASIA)[A-Z0-9]{16}/g,
    replacement: '[AWS_KEY_REDACTED]'
  },
  // Generic secrets in environment variable format
  {
    pattern: /([A-Z_]+_SECRET|[A-Z_]+_KEY|[A-Z_]+_TOKEN)\s*=\s*['"]?([^\s'"]+)['"]?/g,
    replacement: '$1=[REDACTED]'
  },
  // Email addresses (optional - can be configured)
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]'
  },
  // Credit card numbers (basic pattern)
  {
    pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
    replacement: '[CARD_REDACTED]'
  },
  // IP addresses in sensitive contexts (optional)
  // Keeping IPs visible for debugging but redacting if in auth context
  {
    pattern: /(auth|login|session).*?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gi,
    replacement: '$1 [IP_REDACTED]'
  }
];

/**
 * Sanitize a single line of log content.
 *
 * @param {string} line - The log line to sanitize
 * @returns {string} Sanitized log line
 */
function sanitizeLine(line) {
  if (!line || typeof line !== 'string') {
    return line;
  }

  let sanitized = line;

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    // Reset regex lastIndex for global patterns
    if (pattern.global) {
      pattern.lastIndex = 0;
    }
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

/**
 * Sanitize multiple lines of log content.
 *
 * @param {string|string[]} content - Log content (string or array of lines)
 * @returns {string[]} Array of sanitized log lines
 */
function sanitizeLogContent(content) {
  if (!content) {
    return [];
  }

  // Handle string input
  if (typeof content === 'string') {
    const lines = content.split('\n');
    return lines.map(sanitizeLine);
  }

  // Handle array input
  if (Array.isArray(content)) {
    return content.map(line =>
      typeof line === 'string' ? sanitizeLine(line) : String(line)
    );
  }

  return [];
}

/**
 * Check if a line contains sensitive patterns (for testing).
 *
 * @param {string} line - The line to check
 * @returns {boolean} True if sensitive content detected
 */
function containsSensitiveData(line) {
  if (!line || typeof line !== 'string') {
    return false;
  }

  for (const { pattern } of SENSITIVE_PATTERNS) {
    if (pattern.global) {
      pattern.lastIndex = 0;
    }
    if (pattern.test(line)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  sanitizeLine,
  sanitizeLogContent,
  containsSensitiveData,
  SENSITIVE_PATTERNS
};
