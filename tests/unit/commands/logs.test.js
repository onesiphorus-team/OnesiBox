const { getLogs, MAX_LINES, DEFAULT_LINES } = require('../../../src/commands/handlers/logs');
const path = require('path');

// Mock dependencies
jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/logging/log-sanitizer', () => ({
  sanitizeLogContent: jest.fn((lines) => lines.map(line =>
    line.replace(/password=secret/g, 'password=[REDACTED]')
  ))
}));

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn()
  }
}));

describe('Logs Handler', () => {
  let mockBrowserController;
  let fs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBrowserController = {};
    fs = require('fs').promises;
  });

  describe('Constants', () => {
    it('should have correct MAX_LINES value', () => {
      expect(MAX_LINES).toBe(500);
    });

    it('should have correct DEFAULT_LINES value', () => {
      expect(DEFAULT_LINES).toBe(100);
    });
  });

  describe('getLogs', () => {
    it('should return log lines from default path', async () => {
      const logContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 3 } };

      const result = await getLogs(command, mockBrowserController);

      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      expect(result).toMatchObject({
        lines: ['Line 3', 'Line 4', 'Line 5'],
        total_lines: 5,
        requested_lines: 3,
        returned_lines: 3,
        log_file: `onesibox-${today}.log`,
        timestamp: expect.any(String)
      });
    });

    it('should use DEFAULT_LINES when not specified', async () => {
      const lines = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`);
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(lines.join('\n'));

      const command = { id: '123', type: 'get_logs', payload: {} };

      const result = await getLogs(command, mockBrowserController);

      expect(result.requested_lines).toBe(DEFAULT_LINES);
      expect(result.returned_lines).toBe(DEFAULT_LINES);
    });

    it('should cap lines at MAX_LINES', async () => {
      const lines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`);
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(lines.join('\n'));

      const command = { id: '123', type: 'get_logs', payload: { lines: 1000 } };

      const result = await getLogs(command, mockBrowserController);

      expect(result.requested_lines).toBe(MAX_LINES);
      expect(result.returned_lines).toBe(MAX_LINES);
    });

    it('should enforce minimum of 1 line', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue('Single line');

      const command = { id: '123', type: 'get_logs', payload: { lines: -5 } };

      const result = await getLogs(command, mockBrowserController);

      expect(result.requested_lines).toBe(1);
    });

    it('should return empty array when log file not found', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const command = { id: '123', type: 'get_logs', payload: { lines: 10 } };

      const result = await getLogs(command, mockBrowserController);

      expect(result.lines).toEqual([]);
      expect(result.total_lines).toBe(0);
    });

    it('should sanitize log content', async () => {
      const logContent = 'Normal line\npassword=secret\nAnother line';
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 10 } };

      const result = await getLogs(command, mockBrowserController);

      const { sanitizeLogContent } = require('../../../src/logging/log-sanitizer');
      expect(sanitizeLogContent).toHaveBeenCalled();
    });

    it('should reject paths outside logs directory', async () => {
      const command = {
        id: '123',
        type: 'get_logs',
        payload: { log_path: '/etc/passwd' }
      };

      await expect(getLogs(command, mockBrowserController))
        .rejects
        .toThrow('Access denied');
    });

    it('should reject path traversal attempts', async () => {
      const command = {
        id: '123',
        type: 'get_logs',
        payload: { log_path: path.join(process.cwd(), 'logs', '..', '..', 'etc', 'passwd') }
      };

      await expect(getLogs(command, mockBrowserController))
        .rejects
        .toThrow('Access denied');
    });

    it('should filter empty lines', async () => {
      const logContent = 'Line 1\n\nLine 2\n   \nLine 3';
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 10 } };

      const result = await getLogs(command, mockBrowserController);

      expect(result.total_lines).toBe(3);
    });
  });

  describe('Heartbeat filtering', () => {
    const heartbeat = (ts) => JSON.stringify({
      level: 'info',
      message: 'Heartbeat sent',
      service: 'onesibox',
      status: 'idle',
      timestamp: ts
    });
    const realLog = (msg) => JSON.stringify({
      level: 'info',
      message: msg,
      service: 'onesibox'
    });

    it('filters out heartbeat lines by default', async () => {
      const logContent = [
        realLog('App started'),
        heartbeat('2026-04-24T10:00:00Z'),
        realLog('Command received'),
        heartbeat('2026-04-24T10:00:30Z'),
        realLog('Command completed')
      ].join('\n');

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 10 } };
      const result = await getLogs(command, mockBrowserController);

      expect(result.returned_lines).toBe(3);
      expect(result.total_lines).toBe(5);
      expect(result.heartbeats_filtered).toBe(2);
      expect(result.lines.every(line => !line.includes('Heartbeat sent'))).toBe(true);
    });

    it('includes heartbeats when include_heartbeats is true', async () => {
      const logContent = [
        realLog('App started'),
        heartbeat('2026-04-24T10:00:00Z'),
        realLog('Command received')
      ].join('\n');

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = {
        id: '123',
        type: 'get_logs',
        payload: { lines: 10, include_heartbeats: true }
      };
      const result = await getLogs(command, mockBrowserController);

      expect(result.returned_lines).toBe(3);
      expect(result.heartbeats_filtered).toBe(0);
      expect(result.lines.some(line => line.includes('Heartbeat sent'))).toBe(true);
    });

    it('filters heartbeats BEFORE slicing so requested N lines are all signal', async () => {
      // 20 heartbeats tail-padding 2 real log lines: requesting 2 lines must
      // return the 2 real lines, not 2 heartbeats.
      const heartbeats = Array.from({ length: 20 }, (_, i) =>
        heartbeat(`2026-04-24T10:00:${String(i).padStart(2, '0')}Z`)
      );
      const logContent = [
        realLog('First real event'),
        realLog('Second real event'),
        ...heartbeats
      ].join('\n');

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 2 } };
      const result = await getLogs(command, mockBrowserController);

      expect(result.returned_lines).toBe(2);
      expect(result.lines[0]).toContain('First real event');
      expect(result.lines[1]).toContain('Second real event');
      expect(result.heartbeats_filtered).toBe(20);
    });

    it('treats non-JSON lines as non-heartbeats', async () => {
      const logContent = [
        'plain text without JSON',
        'Heartbeat sent but not valid JSON',
        realLog('App event')
      ].join('\n');

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(logContent);

      const command = { id: '123', type: 'get_logs', payload: { lines: 10 } };
      const result = await getLogs(command, mockBrowserController);

      expect(result.returned_lines).toBe(3);
      expect(result.heartbeats_filtered).toBe(0);
    });
  });

});
