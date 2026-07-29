jest.mock('../../../src/logging/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const http = require('http');

const logger = require('../../../src/logging/logger');
const {
  SECURITY_HEADERS,
  writeSecureResponse,
  sendSecureJson
} = require('../../../src/http/secure-response');

/** A real ServerResponse, so headersSent/writableEnded behave like production. */
function makeResponse() {
  return new http.ServerResponse({ method: 'GET', httpVersionMajor: 1, httpVersionMinor: 1 });
}

/**
 * Drive an async handler through a real request, calling it exactly the way
 * createServer() does in main.js: without awaiting it, so anything it throws
 * becomes a floating rejection. The rejection is captured here instead of being
 * left to escape, because Jest swallows the real process-level event.
 */
function driveHandler(handler) {
  return new Promise((resolve, reject) => {
    let outcome;
    const server = http.createServer((req, res) => {
      outcome = handler(req, res).then(() => null, (error) => error);
    });

    server.listen(0, () => {
      http.get({ port: server.address().port }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          outcome.then((rejection) => {
            server.close(() => resolve({ status: res.statusCode, headers: res.headers, body, rejection }));
          });
        });
      }).on('error', reject);
    });
  });
}

describe('writeSecureResponse', () => {
  afterEach(() => jest.clearAllMocks());

  it('writes the status with the security headers plus the caller\'s own', () => {
    const res = makeResponse();
    const writeHead = jest.spyOn(res, 'writeHead');

    expect(writeSecureResponse(res, 200, { 'Content-Type': 'application/json' })).toBe(true);

    expect(res.statusCode).toBe(200);
    expect(writeHead).toHaveBeenCalledWith(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
  });

  // The defect: handleApiSystemInfo and handleJwMediaProxy call this from their
  // catch blocks. When the failure happens after the happy path already wrote
  // the head, writeHead throws ERR_HTTP_HEADERS_SENT — inside an async handler
  // invoked without await, so it becomes an unhandled rejection, and since
  // Node 15 that kills the process.
  it('refuses to write a second time instead of throwing ERR_HTTP_HEADERS_SENT', () => {
    const res = makeResponse();
    writeSecureResponse(res, 200, { 'Content-Type': 'application/json' });

    let result;
    expect(() => { result = writeSecureResponse(res, 502, { 'Content-Type': 'application/json' }); }).not.toThrow();
    expect(result).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it('reports the skipped write instead of swallowing it silently', () => {
    const res = makeResponse();
    writeSecureResponse(res, 200, {});

    writeSecureResponse(res, 502, {});

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ statusCode: 502, headersSent: true });
  });

  it('refuses to write once the response is over', () => {
    const res = makeResponse();
    res.assignSocket(new (require('stream').PassThrough)());
    writeSecureResponse(res, 200, {});
    res.end('{}');

    expect(writeSecureResponse(res, 500, {})).toBe(false);
  });

  it('tolerates a missing response object', () => {
    expect(() => writeSecureResponse(null, 500, {})).not.toThrow();
    expect(writeSecureResponse(null, 500, {})).toBe(false);
  });
});

describe('sendSecureJson', () => {
  afterEach(() => jest.clearAllMocks());

  it('sends a JSON body with the security headers', async () => {
    const result = await driveHandler(async (req, res) => {
      sendSecureJson(res, 200, { version: '1.2.3', ip: '192.168.1.10' });
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ version: '1.2.3', ip: '192.168.1.10' });
    expect(result.headers['content-type']).toBe('application/json');
    // Every security header has to survive the guard and reach the client.
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      expect(result.headers[header.toLowerCase()]).toBe(value);
    }
  });

  // End-to-end shape of handleApiSystemInfo: the happy path answers, then
  // something later throws and the catch block answers again. Before the guard
  // this second answer rejected the handler promise with ERR_HTTP_HEADERS_SENT
  // and took the whole kiosk down.
  it('leaves no floating rejection when a catch block answers twice', async () => {
    const result = await driveHandler(async (req, res) => {
      try {
        sendSecureJson(res, 200, { version: '1.2.3' });
        throw new Error('systeminformation failed after the response was written');
      } catch {
        sendSecureJson(res, 200, { version: 'unknown', ip: '--', wifi: null });
      }
    });

    expect(result.rejection).toBeNull();
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ version: '1.2.3' });
  });

  it('does not write after end either', async () => {
    const result = await driveHandler(async (req, res) => {
      sendSecureJson(res, 200, { ok: true });
      expect(sendSecureJson(res, 502, { error: 'too late' })).toBe(false);
    });

    expect(result.rejection).toBeNull();
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });
});
