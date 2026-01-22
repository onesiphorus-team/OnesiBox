const axios = require('axios');
const ApiClient = require('../../../src/communication/api-client');

jest.mock('axios');
jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('ApiClient', () => {
  let apiClient;
  let mockAxiosInstance;

  const mockConfig = {
    server_url: 'https://onesiforo.test',
    appliance_id: '550e8400-e29b-41d4-a716-446655440000',
    appliance_token: 'test-token-123'
  };

  beforeEach(() => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn()
        }
      }
    };
    axios.create.mockReturnValue(mockAxiosInstance);
    apiClient = new ApiClient(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create axios instance with correct config', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://onesiforo.test/api/v1',
        timeout: 10000,
        headers: {
          'Authorization': 'Bearer test-token-123',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    });

    it('should NOT include appliance_id in headers', () => {
      const createCall = axios.create.mock.calls[0][0];
      expect(createCall.headers['X-Appliance-ID']).toBeUndefined();
    });
  });

  describe('getCommands', () => {
    it('should call correct endpoint without appliance_id in URL', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: [
            { id: 'cmd-uuid-1', type: 'play_media', payload: { url: 'https://example.com' } }
          ],
          meta: { total: 1, pending: 1 }
        }
      });

      const commands = await apiClient.getCommands();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/appliances/commands',
        { params: { status: 'pending' } }
      );
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe('cmd-uuid-1');
    });

    it('should return empty array when no commands', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: [], meta: { total: 0, pending: 0 } }
      });

      const commands = await apiClient.getCommands();

      expect(commands).toEqual([]);
    });

    it('should parse backend response format correctly', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: [
            {
              id: 'uuid-1',
              type: 'play_media',
              payload: { url: 'https://jw.org/video', media_type: 'video' },
              priority: 2,
              status: 'pending',
              created_at: '2026-01-22T10:00:00Z',
              expires_at: '2026-01-22T11:00:00Z'
            }
          ],
          meta: { total: 5, pending: 1 }
        }
      });

      const commands = await apiClient.getCommands();

      expect(commands[0]).toMatchObject({
        id: 'uuid-1',
        type: 'play_media',
        payload: { url: 'https://jw.org/video', media_type: 'video' },
        priority: 2
      });
    });
  });

  describe('acknowledgeCommand', () => {
    it('should call correct endpoint with command UUID', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { acknowledged: true } });

      await apiClient.acknowledgeCommand('cmd-uuid-123', {
        status: 'success'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/commands/cmd-uuid-123/ack',
        expect.objectContaining({
          status: 'success',
          error_code: null,
          error_message: null,
          executed_at: expect.any(String)
        })
      );
    });

    it('should include error details when command failed', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { acknowledged: true } });

      await apiClient.acknowledgeCommand('cmd-uuid-123', {
        status: 'failed',
        error_code: 'E006',
        error_message: 'Media playback failed'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/commands/cmd-uuid-123/ack',
        expect.objectContaining({
          status: 'failed',
          error_code: 'E006',
          error_message: 'Media playback failed'
        })
      );
    });
  });

  describe('sendHeartbeat', () => {
    it('should call correct endpoint without appliance_id in URL', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { received: true } });

      const heartbeat = {
        status: 'idle',
        cpu_usage: 25,
        memory_usage: 50,
        uptime: 3600
      };

      await apiClient.sendHeartbeat(heartbeat);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/appliances/heartbeat',
        heartbeat
      );
    });
  });

  describe('reportPlaybackEvent', () => {
    it('should call correct endpoint without appliance_id in URL', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      const event = {
        event: 'started',
        media_url: 'https://jw.org/video',
        media_type: 'video',
        timestamp: new Date().toISOString()
      };

      await apiClient.reportPlaybackEvent(event);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/appliances/playback',
        event
      );
    });
  });

  describe('backoff', () => {
    it('should calculate correct backoff delay', () => {
      apiClient.consecutiveFailures = 1;
      expect(apiClient.getBackoffDelay()).toBe(5000);

      apiClient.consecutiveFailures = 2;
      expect(apiClient.getBackoffDelay()).toBe(10000);

      apiClient.consecutiveFailures = 3;
      expect(apiClient.getBackoffDelay()).toBe(20000);

      apiClient.consecutiveFailures = 4;
      expect(apiClient.getBackoffDelay()).toBe(60000);

      apiClient.consecutiveFailures = 10;
      expect(apiClient.getBackoffDelay()).toBe(60000);
    });

    it('should allow retry within limit', () => {
      apiClient.consecutiveFailures = 5;
      expect(apiClient.shouldRetry()).toBe(true);

      apiClient.consecutiveFailures = 7;
      expect(apiClient.shouldRetry()).toBe(false);
    });
  });
});
