jest.mock('axios');
jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const axios = require('axios');

const ApiClient = require('../../../src/communication/api-client');

describe('ApiClient.uploadScreenshot', () => {
  let client;
  let mockAxiosInstance;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ status: 201, data: { id: 42 } }),
      interceptors: { response: { use: jest.fn() } },
    };
    axios.create.mockReturnValue(mockAxiosInstance);

    client = new ApiClient({
      server_url: 'https://example.com',
      appliance_token: 'tok',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts multipart with captured_at, width, height, screenshot buffer', async () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF
    const capturedAt = new Date('2026-04-24T14:32:11Z');

    const result = await client.uploadScreenshot({
      capturedAt,
      width: 1920,
      height: 1080,
      buffer: buf,
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, form, options] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe('/appliances/screenshot');
    const contentType =
      options.headers['Content-Type'] || options.headers['content-type'];
    expect(contentType).toMatch(/multipart\/form-data/);
    expect(form).toBeDefined();
    expect(result).toEqual({ id: 42 });
  });

  it('rejects buffers larger than 2MB locally without sending', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(
      client.uploadScreenshot({
        capturedAt: new Date(),
        width: 1920,
        height: 1080,
        buffer: big,
      })
    ).rejects.toThrow(/too large/);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });
});
