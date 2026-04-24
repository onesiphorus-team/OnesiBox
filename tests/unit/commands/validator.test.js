const { isUrlAllowed, isZoomUrl, isStreamJwUrl, validateCommand } = require('../../../src/commands/validator');

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

  describe('isStreamJwUrl', () => {
    it('should accept stream.jw.org share link', () => {
      expect(isStreamJwUrl('https://stream.jw.org/6311-4713-5379-2156')).toBe(true);
    });

    it('should accept stream.jw.org /home paths', () => {
      expect(isStreamJwUrl('https://stream.jw.org/home')).toBe(true);
      expect(isStreamJwUrl('https://stream.jw.org/home?playerOpen=true')).toBe(true);
    });

    it('should accept valid subdomains of stream.jw.org', () => {
      expect(isStreamJwUrl('https://www.stream.jw.org/x')).toBe(true);
    });

    it('should reject HTTP (no TLS)', () => {
      expect(isStreamJwUrl('http://stream.jw.org/x')).toBe(false);
    });

    it('should reject subdomain-injection attempts', () => {
      expect(isStreamJwUrl('https://stream.jw.org.evil.com/x')).toBe(false);
      expect(isStreamJwUrl('https://fake-stream.jw.org/x')).toBe(false);
    });

    it('should reject non-standard ports', () => {
      expect(isStreamJwUrl('https://stream.jw.org:9999/x')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isStreamJwUrl('not-a-url')).toBe(false);
      expect(isStreamJwUrl('')).toBe(false);
      expect(isStreamJwUrl(null)).toBe(false);
    });

    it('should reject URLs exceeding max length', () => {
      const longPath = 'a'.repeat(3000);
      expect(isStreamJwUrl(`https://stream.jw.org/${longPath}`)).toBe(false);
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

    it('should validate reboot command', () => {
      const valid = validateCommand({
        id: '123',
        type: 'reboot',
        payload: {}
      });
      expect(valid.valid).toBe(true);

      const withDelay = validateCommand({
        id: '123',
        type: 'reboot',
        payload: { delay: 60 }
      });
      expect(withDelay.valid).toBe(true);

      const invalidDelay = validateCommand({
        id: '123',
        type: 'reboot',
        payload: { delay: 5000 }
      });
      expect(invalidDelay.valid).toBe(false);
    });

    it('should validate shutdown command', () => {
      const valid = validateCommand({
        id: '123',
        type: 'shutdown',
        payload: {}
      });
      expect(valid.valid).toBe(true);

      const withDelay = validateCommand({
        id: '123',
        type: 'shutdown',
        payload: { delay: 120 }
      });
      expect(withDelay.valid).toBe(true);

      const invalidDelay = validateCommand({
        id: '123',
        type: 'shutdown',
        payload: { delay: -10 }
      });
      expect(invalidDelay.valid).toBe(false);
    });

    it('should validate get_logs include_heartbeats flag', () => {
      const noFlag = validateCommand({
        id: '123',
        type: 'get_logs',
        payload: { lines: 50 }
      });
      expect(noFlag.valid).toBe(true);

      const asBool = validateCommand({
        id: '123',
        type: 'get_logs',
        payload: { include_heartbeats: true }
      });
      expect(asBool.valid).toBe(true);

      const asNonBool = validateCommand({
        id: '123',
        type: 'get_logs',
        payload: { include_heartbeats: 'yes' }
      });
      expect(asNonBool.valid).toBe(false);
      expect(asNonBool.errors.join(' ')).toMatch(/include_heartbeats/);
    });
  });

  describe('validateCommand — play_stream_item', () => {
    const baseCmd = () => ({
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'play_stream_item',
      payload: {
        url: 'https://stream.jw.org/6311-4713-5379-2156',
        ordinal: 1
      }
    });

    it('should accept a valid play_stream_item command', () => {
      const result = validateCommand(baseCmd());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing url', () => {
      const cmd = baseCmd();
      delete cmd.payload.url;
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item requires url in payload');
    });

    it('should reject non-stream.jw.org url', () => {
      const cmd = baseCmd();
      cmd.payload.url = 'https://www.jw.org/en/library/';
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item url must be a stream.jw.org URL');
    });

    it('should reject missing ordinal', () => {
      const cmd = baseCmd();
      delete cmd.payload.ordinal;
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
    });

    it('should reject ordinal = 0', () => {
      const cmd = baseCmd();
      cmd.payload.ordinal = 0;
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
    });

    it('should reject ordinal > 50', () => {
      const cmd = baseCmd();
      cmd.payload.ordinal = 51;
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
    });

    it('should reject non-integer ordinal', () => {
      const cmd = baseCmd();
      cmd.payload.ordinal = 1.5;
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
    });

    it('should reject string ordinal', () => {
      const cmd = baseCmd();
      cmd.payload.ordinal = '1';
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('play_stream_item ordinal must be integer 1-50');
    });
  });
});

describe('Stream Playback Error Codes', () => {
  const { ERROR_CODES } = require('../../../src/commands/validator');

  it('should expose E110 STREAM_NAV_FAILED', () => {
    expect(ERROR_CODES.STREAM_NAV_FAILED).toBe('E110');
  });

  it('should expose E111 PLAYLIST_LOAD_FAILED', () => {
    expect(ERROR_CODES.PLAYLIST_LOAD_FAILED).toBe('E111');
  });

  it('should expose E112 ORDINAL_OUT_OF_RANGE', () => {
    expect(ERROR_CODES.ORDINAL_OUT_OF_RANGE).toBe('E112');
  });

  it('should expose E113 VIDEO_START_FAILED', () => {
    expect(ERROR_CODES.VIDEO_START_FAILED).toBe('E113');
  });
});
