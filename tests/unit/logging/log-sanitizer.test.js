const {
  sanitizeLine,
  sanitizeLogContent,
  containsSensitiveData,
  SENSITIVE_PATTERNS
} = require('../../../src/logging/log-sanitizer');

describe('Log Sanitizer', () => {
  describe('SENSITIVE_PATTERNS', () => {
    it('should have patterns defined', () => {
      expect(SENSITIVE_PATTERNS).toBeDefined();
      expect(Array.isArray(SENSITIVE_PATTERNS)).toBe(true);
      expect(SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
    });
  });

  describe('sanitizeLine', () => {
    it('should redact API keys', () => {
      const line = 'Config: api_key = "sk_live_1234567890abcdef"';
      const result = sanitizeLine(line);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk_live_1234567890abcdef');
    });

    it('should redact API keys at start of line', () => {
      const line = 'api_key = "sk_live_1234567890abcdef"';
      const result = sanitizeLine(line);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk_live_1234567890abcdef');
    });

    it('should redact auth tokens', () => {
      // auth_token pattern matches first, so JWT is redacted via auth_token pattern
      const line = 'auth_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"';
      const result = sanitizeLine(line);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('eyJhbGciOiJI');
    });

    it('should redact standalone JWT tokens', () => {
      // JWT pattern matches when appearing without token key prefix
      const line = 'Token is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U here';
      const result = sanitizeLine(line);
      expect(result).toContain('[JWT_REDACTED]');
      expect(result).not.toContain('eyJhbGciOiJI');
    });

    it('should redact passwords in various formats', () => {
      const lines = [
        { input: 'Config password = "supersecret123"', expected: '[REDACTED]' },
        { input: 'password = "supersecret123"', expected: '[REDACTED]' },
        { input: 'User passwd: mypass456', expected: '[REDACTED]' },
        { input: 'pwd="hidden123"', expected: '[REDACTED]' },
        { input: 'secret = "confidential1"', expected: '[REDACTED]' }
      ];

      lines.forEach(({ input, expected }) => {
        const result = sanitizeLine(input);
        expect(result).toContain(expected);
      });
    });

    it('should redact Authorization headers', () => {
      const line = 'Authorization: Bearer abc123def456789';
      const result = sanitizeLine(line);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('abc123def456789');
    });

    it('should redact private keys', () => {
      const line = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
      const result = sanitizeLine(line);
      expect(result).toBe('[PRIVATE_KEY_REDACTED]');
    });

    it('should redact RSA private keys', () => {
      const line = '-----BEGIN RSA PRIVATE KEY-----\nMIICXQIBAAJBAK\n-----END RSA PRIVATE KEY-----';
      const result = sanitizeLine(line);
      expect(result).toBe('[PRIVATE_KEY_REDACTED]');
    });

    it('should redact SSH keys', () => {
      const line = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ';
      const result = sanitizeLine(line);
      expect(result).toBe('[SSH_KEY_REDACTED]');
    });

    it('should redact AWS access keys', () => {
      const line = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeLine(line);
      expect(result).toContain('[AWS_KEY_REDACTED]');
    });

    it('should redact environment variable secrets', () => {
      const lines = [
        'DATABASE_SECRET=mysecretvalue',
        'API_KEY=1234567890',
        'AUTH_TOKEN=bearer_token_here'
      ];

      lines.forEach(line => {
        const result = sanitizeLine(line);
        expect(result).toContain('[REDACTED]');
      });
    });

    it('should redact email addresses', () => {
      const line = 'User email: user@example.com logged in';
      const result = sanitizeLine(line);
      expect(result).toContain('[EMAIL_REDACTED]');
      expect(result).not.toContain('user@example.com');
    });

    it('should redact credit card numbers', () => {
      const lines = [
        'Card: 4111-1111-1111-1111',
        'Payment with 4111 1111 1111 1111',
        'CC: 4111111111111111'
      ];

      lines.forEach(line => {
        const result = sanitizeLine(line);
        expect(result).toContain('[CARD_REDACTED]');
      });
    });

    it('should redact IP addresses in auth contexts', () => {
      const line = 'login attempt from 192.168.1.100';
      const result = sanitizeLine(line);
      expect(result).toContain('[IP_REDACTED]');
    });

    it('should preserve non-sensitive content', () => {
      const line = 'User clicked play button for video';
      const result = sanitizeLine(line);
      expect(result).toBe(line);
    });

    it('should handle null input', () => {
      const result = sanitizeLine(null);
      expect(result).toBeNull();
    });

    it('should handle empty string', () => {
      const result = sanitizeLine('');
      expect(result).toBe('');
    });

    it('should handle non-string input', () => {
      const result = sanitizeLine(12345);
      expect(result).toBe(12345);
    });
  });

  describe('sanitizeLogContent', () => {
    it('should sanitize array of lines', () => {
      const lines = [
        'Normal log line',
        'Config password = "secret123"',
        'Another normal line'
      ];

      const result = sanitizeLogContent(lines);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Normal log line');
      expect(result[1]).toContain('[REDACTED]');
      expect(result[2]).toBe('Another normal line');
    });

    it('should sanitize string input by splitting on newlines', () => {
      const content = 'Line 1\npassword=secret123\nLine 3';

      const result = sanitizeLogContent(content);

      expect(result).toHaveLength(3);
      expect(result[1]).toContain('[REDACTED]');
    });

    it('should return empty array for null input', () => {
      const result = sanitizeLogContent(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      const result = sanitizeLogContent(undefined);
      expect(result).toEqual([]);
    });

    it('should convert non-string array items to strings', () => {
      const lines = ['text', 123, true];

      const result = sanitizeLogContent(lines);

      expect(result).toEqual(['text', '123', 'true']);
    });

    it('should handle mixed content with multiple sensitive patterns', () => {
      const lines = [
        'api_key = "abc12345678"',
        'Normal line',
        'User email: test@example.com, password: secret123'
      ];

      const result = sanitizeLogContent(lines);

      expect(result[0]).toContain('[REDACTED]');
      expect(result[1]).toBe('Normal line');
      expect(result[2]).toContain('[EMAIL_REDACTED]');
      expect(result[2]).toContain('[REDACTED]');
    });
  });

  describe('containsSensitiveData', () => {
    it('should detect API keys', () => {
      expect(containsSensitiveData('api_key = "secret1234567890"')).toBe(true);
    });

    it('should detect passwords', () => {
      expect(containsSensitiveData('User password: mysecret')).toBe(true);
    });

    it('should detect JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(containsSensitiveData(`Token: ${jwt}`)).toBe(true);
    });

    it('should detect email addresses', () => {
      expect(containsSensitiveData('Contact: user@domain.com')).toBe(true);
    });

    it('should return false for normal content', () => {
      expect(containsSensitiveData('User clicked play button')).toBe(false);
    });

    it('should return false for null input', () => {
      expect(containsSensitiveData(null)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(containsSensitiveData('')).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(containsSensitiveData(12345)).toBe(false);
    });
  });
});
