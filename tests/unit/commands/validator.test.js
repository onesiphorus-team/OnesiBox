const { isUrlAllowed, isZoomUrl, validateCommand } = require('../../../src/commands/validator');

describe('URL Validator', () => {
  describe('isUrlAllowed', () => {
    it('should allow jw.org URLs', () => {
      expect(isUrlAllowed('https://www.jw.org/en/library/videos/')).toBe(true);
      expect(isUrlAllowed('https://jw.org/finder?docid=123')).toBe(true);
      expect(isUrlAllowed('https://wol.jw.org/en/wol/d/r1/lp-e/123')).toBe(true);
    });

    it('should allow jw-cdn.org subdomains', () => {
      expect(isUrlAllowed('https://b.jw-cdn.org/video.mp4')).toBe(true);
      expect(isUrlAllowed('https://download.jw-cdn.org/file.mp3')).toBe(true);
    });

    it('should allow akamaihd.net CDN', () => {
      expect(isUrlAllowed('https://download-a.akamaihd.net/file.mp4')).toBe(true);
    });

    it('should reject non-whitelisted domains', () => {
      expect(isUrlAllowed('https://youtube.com/watch?v=123')).toBe(false);
      expect(isUrlAllowed('https://example.com/video')).toBe(false);
      expect(isUrlAllowed('https://malicious.jw.org.fake.com')).toBe(false);
    });

    it('should reject HTTP URLs', () => {
      expect(isUrlAllowed('http://www.jw.org/video')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isUrlAllowed('not-a-url')).toBe(false);
      expect(isUrlAllowed('')).toBe(false);
    });
  });

  describe('isZoomUrl', () => {
    it('should accept valid Zoom URLs', () => {
      expect(isZoomUrl('https://zoom.us/j/123456789')).toBe(true);
      expect(isZoomUrl('https://zoom.us/j/123456789?pwd=abc')).toBe(true);
      expect(isZoomUrl('https://us02web.zoom.us/j/123')).toBe(true);
    });

    it('should reject non-Zoom URLs', () => {
      expect(isZoomUrl('https://youtube.com/watch')).toBe(false);
      expect(isZoomUrl('https://zoom.com.fake.com/j/123')).toBe(false);
    });
  });
});

describe('Command Validator', () => {
  describe('validateCommand', () => {
    it('should validate play_media command with valid URL', () => {
      const result = validateCommand({
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'play_media',
        payload: {
          url: 'https://www.jw.org/en/library/videos/',
          media_type: 'video'
        }
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject play_media with non-whitelisted URL', () => {
      const result = validateCommand({
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'play_media',
        payload: {
          url: 'https://youtube.com/watch?v=123',
          media_type: 'video'
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL not in authorized domain whitelist');
    });

    it('should reject unknown command types', () => {
      const result = validateCommand({
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'unknown_command',
        payload: {}
      });
      expect(result.valid).toBe(false);
    });

    it('should validate set_volume command', () => {
      const valid = validateCommand({
        id: '123',
        type: 'set_volume',
        payload: { level: 50 }
      });
      expect(valid.valid).toBe(true);

      const invalid = validateCommand({
        id: '123',
        type: 'set_volume',
        payload: { level: 150 }
      });
      expect(invalid.valid).toBe(false);
    });

    it('should reject expired commands', () => {
      const result = validateCommand({
        id: '123',
        type: 'stop_media',
        expires_at: '2020-01-01T00:00:00Z'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Command has expired');
    });
  });
});
