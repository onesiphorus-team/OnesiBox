const { getSystemInfo, formatUptime } = require('../../../src/commands/handlers/system-info');

// Mock dependencies
jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('systeminformation', () => ({
  currentLoad: jest.fn(),
  mem: jest.fn(),
  fsSize: jest.fn(),
  networkInterfaces: jest.fn(),
  wifiConnections: jest.fn(),
  cpuTemperature: jest.fn()
}));

describe('System Info Handler', () => {
  let mockBrowserController;
  let si;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBrowserController = {};
    si = require('systeminformation');

    // Setup default mock values
    si.currentLoad.mockResolvedValue({ currentLoad: 25.5 });
    si.mem.mockResolvedValue({ used: 2147483648, total: 4294967296 }); // 2GB/4GB = 50%
    si.fsSize.mockResolvedValue([{ mount: '/', used: 5368709120, size: 21474836480, use: 25 }]); // 5GB/20GB
    si.networkInterfaces.mockResolvedValue([
      { iface: 'eth0', operstate: 'up', internal: false, ip4: '192.168.1.100' }
    ]);
    si.wifiConnections.mockResolvedValue([
      { ssid: 'TestNetwork', signalLevel: -50 }
    ]);
    si.cpuTemperature.mockResolvedValue({ main: 45.5 });
  });

  describe('getSystemInfo', () => {
    it('should return complete system information', async () => {
      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result).toMatchObject({
        uptime_seconds: expect.any(Number),
        uptime_formatted: expect.any(String),
        load_average: {
          '1m': expect.any(Number),
          '5m': expect.any(Number),
          '15m': expect.any(Number)
        },
        memory: {
          used_bytes: 2147483648,
          total_bytes: 4294967296,
          percent: 50
        },
        cpu_percent: 26, // Rounded from 25.5
        disk: {
          used_bytes: 5368709120,
          total_bytes: 21474836480,
          percent: 25
        },
        temperature: 45.5,
        network: {
          ip_address: '192.168.1.100',
          interface: 'eth0'
        },
        wifi: {
          ssid: 'TestNetwork',
          signal_level: -50
        },
        timestamp: expect.any(String)
      });
    });

    it('should handle missing WiFi connection', async () => {
      si.wifiConnections.mockResolvedValue([]);

      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result.wifi).toEqual({
        ssid: null,
        signal_level: null
      });
    });

    it('should handle missing network interface', async () => {
      si.networkInterfaces.mockResolvedValue([
        { iface: 'lo', operstate: 'up', internal: true, ip4: '127.0.0.1' }
      ]);

      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result.network).toEqual({
        ip_address: null,
        interface: null
      });
    });

    it('should handle null temperature', async () => {
      si.cpuTemperature.mockResolvedValue({ main: null });

      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result.temperature).toBeNull();
    });

    it('should handle systeminformation errors', async () => {
      si.currentLoad.mockRejectedValue(new Error('Failed to get CPU load'));

      const command = { id: '123', type: 'get_system_info' };

      await expect(getSystemInfo(command, mockBrowserController))
        .rejects
        .toThrow('Failed to collect system information');
    });

    it('should use first disk if root partition not found', async () => {
      si.fsSize.mockResolvedValue([
        { mount: '/home', used: 1073741824, size: 5368709120, use: 20 }
      ]);

      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result.disk.percent).toBe(20);
    });

    it('should handle empty disk info', async () => {
      si.fsSize.mockResolvedValue([]);

      const command = { id: '123', type: 'get_system_info' };

      const result = await getSystemInfo(command, mockBrowserController);

      expect(result.disk).toEqual({
        used_bytes: 0,
        total_bytes: 0,
        percent: 0
      });
    });
  });

  describe('formatUptime', () => {
    it('should format uptime with days, hours, and minutes', () => {
      const seconds = 90061; // 1 day, 1 hour, 1 minute, 1 second

      const result = formatUptime(seconds);

      expect(result).toBe('1 giorno, 1 ora');
    });

    it('should format uptime with multiple days', () => {
      const seconds = 259200; // 3 days

      const result = formatUptime(seconds);

      expect(result).toBe('3 giorni');
    });

    it('should format uptime with hours only', () => {
      const seconds = 7200; // 2 hours

      const result = formatUptime(seconds);

      expect(result).toBe('2 ore');
    });

    it('should format uptime with minutes only', () => {
      const seconds = 300; // 5 minutes

      const result = formatUptime(seconds);

      expect(result).toBe('5 minuti');
    });

    it('should format uptime less than a minute', () => {
      const seconds = 45;

      const result = formatUptime(seconds);

      expect(result).toBe('< 1 minuto');
    });

    it('should handle 1 minute singular form', () => {
      const seconds = 60;

      const result = formatUptime(seconds);

      expect(result).toBe('1 minuto');
    });

    it('should exclude minutes when days are present', () => {
      const seconds = 86460; // 1 day, 1 minute

      const result = formatUptime(seconds);

      expect(result).toBe('1 giorno');
    });
  });
});
