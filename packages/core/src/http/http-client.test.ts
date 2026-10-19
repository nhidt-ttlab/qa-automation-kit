import { strict as assert } from 'node:assert';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createAuthProviders } from '../auth/providers.js';
import { HttpClient, resolveAgainstBase } from './http-client.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('HttpClient', () => {
  let server: Server;
  let baseUrl: string;
  const seen: Seen[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        if (req.url?.startsWith('/big')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ blob: 'x'.repeat(30_000) }));
          return;
        }
        if (req.url?.startsWith('/file')) {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(Buffer.from([1, 2, 3]));
          return;
        }
        res.statusCode = req.url?.startsWith('/missing') ? 404 : 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, accessToken: 'leak-me' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function client() {
    const env = { TOKEN: 'bearer-1', KEY: 'key-1' };
    const auth = createAuthProviders(
      {
        bearer: { baseUrl, auth: { type: 'static-bearer', tokenEnv: 'TOKEN' } },
        keyed: { baseUrl, auth: { type: 'api-key', keyEnv: 'KEY', in: 'query', name: 'api_key' } },
      },
      { env },
    );
    return new HttpClient(
      new Map([
        ['bearer', { baseUrl, auth: auth.get('bearer') }],
        ['keyed', { baseUrl, auth: auth.get('keyed') }],
        ['open', { baseUrl }],
      ]),
    );
  }

  it('attaches credentials, sends JSON and records a redacted trace', async () => {
    const http = client();
    const result = await http.request('bearer', { method: 'POST', path: '/orders', query: { page: 2, skip: undefined }, body: { name: 'a', password: 'p' } });

    assert.deepEqual(result, { ok: true, status: 200, data: { ok: true, accessToken: 'leak-me' } });
    const request = seen.at(-1)!;
    assert.equal(request.url, '/orders?page=2');
    assert.equal(request.headers.authorization, 'Bearer bearer-1');
    assert.deepEqual(JSON.parse(request.body), { name: 'a', password: 'p' });

    const [entry] = http.getTrace();
    assert.equal(entry!.url, `${baseUrl}/orders?page=2`);
    assert.deepEqual(entry!.requestBody, { name: 'a', password: '[REDACTED]' });
    assert.deepEqual(entry!.responseBody, { ok: true, accessToken: '[REDACTED]' });
  });

  it('sends a query api key but keeps it out of the trace', async () => {
    const http = client();
    await http.request('keyed', { method: 'GET', path: '/items', query: { q: 'x' } });
    assert.equal(seen.at(-1)!.url, '/items?q=x&api_key=key-1');
    assert.equal(http.getTrace()[0]!.url, `${baseUrl}/items?q=x`);
  });

  it('keeps the path prefix of a base URL', async () => {
    const http = new HttpClient(new Map([['prefixed', { baseUrl: `${baseUrl}/be` }]]));
    await http.request('prefixed', { method: 'GET', path: '/orders', query: { page: 1 } });
    assert.equal(seen.at(-1)!.url, '/be/orders?page=1');
    assert.equal(resolveAgainstBase('orders', `${baseUrl}/be/`).toString(), `${baseUrl}/be/orders`);
    assert.equal(resolveAgainstBase('https://other.test/x', `${baseUrl}/be`).toString(), 'https://other.test/x');
  });

  it('returns non-2xx as a result, not an error', async () => {
    const result = await client().request('open', { method: 'GET', path: '/missing' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(seen.at(-1)!.headers.authorization, undefined);
  });

  it('caps large trace bodies', async () => {
    const http = client();
    await http.request('open', { method: 'GET', path: '/big' });
    const body = http.getTrace()[0]!.responseBody as { __truncated: boolean; originalLength: number };
    assert.equal(body.__truncated, true);
    assert.ok(body.originalLength > 30_000);
  });

  it('returns raw bytes without tracing them', async () => {
    const http = client();
    const result = await http.requestRaw('bearer', { method: 'GET', path: '/file' });
    assert.deepEqual([...result.data], [1, 2, 3]);
    assert.equal(result.headers['content-type'], 'application/octet-stream');
    assert.equal(http.getTrace()[0]!.responseBody, '<binary 3 bytes>');
  });

  it('uploads multipart forms', async () => {
    const http = client();
    const result = await http.requestMultipart('bearer', {
      path: '/upload',
      fields: { kind: 'sheet' },
      files: [{ field: 'file', filename: 'a.csv', contentType: 'text/csv', data: Buffer.from('a,b') }],
    });
    assert.equal(result.ok, true);
    const request = seen.at(-1)!;
    assert.match(String(request.headers['content-type']), /^multipart\/form-data/);
    assert.match(request.body, /filename="a\.csv"/);
    assert.deepEqual(http.getTrace()[0]!.requestBody, { multipartFields: ['kind'], files: ['a.csv'] });
  });

  it('exposes the bearer token and rejects unknown sources', async () => {
    const http = client();
    assert.equal(await http.getToken('bearer'), 'bearer-1');
    assert.equal(await http.getToken('open'), undefined);
    await assert.rejects(http.request('nope', { method: 'GET', path: '/' }), /Unknown API source "nope"/);
  });
});
