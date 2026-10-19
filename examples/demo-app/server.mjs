// A tiny shop the QA automation kit tests itself against: JWT-style login, an OpenAPI document, an
// orders/products API, and two plain HTML pages (login, orders list with a client-side search).
// No dependencies.  Run: node server.mjs   (DEMO_PORT, DEMO_USERNAME, DEMO_PASSWORD)
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const SECRET = randomBytes(16).toString('hex');

const openapi = {
  openapi: '3.0.1',
  info: { title: 'Demo shop API', version: '1.0.0' },
  paths: {
    '/auth/login': {
      post: {
        operationId: 'login',
        summary: 'Sign in and receive a bearer token',
        tags: ['Auth'],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginDto' } } } },
        responses: { 200: { description: 'ok' }, 401: { description: 'bad credentials' } },
      },
    },
    '/api/products': {
      get: { operationId: 'listProducts', summary: 'List products', tags: ['Product'], security: [{ bearer: [] }], responses: { 200: { description: 'ok' } } },
    },
    '/api/orders': {
      get: { operationId: 'listOrders', summary: 'List orders', tags: ['Order'], security: [{ bearer: [] }], responses: { 200: { description: 'ok' } } },
      post: {
        operationId: 'createOrder',
        summary: 'Create an order',
        tags: ['Order'],
        security: [{ bearer: [] }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrderDto' } } } },
        responses: { 201: { description: 'created' } },
      },
    },
    '/api/orders/{id}': {
      get: {
        operationId: 'getOrder',
        summary: 'Get an order by id',
        tags: ['Order'],
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'ok' }, 404: { description: 'not found' } },
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      LoginDto: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } },
      CreateOrderDto: {
        type: 'object',
        required: ['customer', 'items'],
        properties: { customer: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer' } } } } },
      },
    },
  },
};

const LOGIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in — Demo shop</title></head><body>
<main><h1>Sign in</h1>
<form id="login-form">
  <label for="username">Username</label> <input id="username" name="username" autocomplete="username" />
  <label for="password">Password</label> <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
<p id="error" role="alert"></p></main>
<script>
document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value }) });
  if (!response.ok) { document.getElementById('error').textContent = 'Wrong username or password'; return; }
  localStorage.setItem('token', (await response.json()).token);
  location.href = '/orders';
});
</script></body></html>`;

const ORDERS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Orders — Demo shop</title></head><body>
<main><h1>Orders</h1>
<input id="search" type="search" aria-label="Search orders" placeholder="Search by customer" />
<p id="count" role="status" aria-busy="true">Loading…</p>
<table id="orders"><thead><tr>
  <th data-col-id="id">Order</th><th data-col-id="customer">Customer</th><th data-col-id="status">Status</th><th data-col-id="total">Total</th>
</tr></thead><tbody></tbody></table></main>
<script>
const token = localStorage.getItem('token');
if (!token) location.href = '/login';
let orders = [];
function render() {
  const needle = document.getElementById('search').value.trim().toLowerCase();
  const rows = orders.filter((o) => o.customer.toLowerCase().includes(needle));
  document.querySelector('#orders tbody').innerHTML = rows.map((o) =>
    '<tr><td>' + o.id + '</td><td>' + o.customer + '</td><td>' + o.status + '</td><td>' + o.total.toFixed(2) + '</td></tr>').join('');
  const count = document.getElementById('count');
  count.textContent = rows.length + ' orders';
  count.setAttribute('aria-busy', 'false');
}
fetch('/api/orders', { headers: { Authorization: 'Bearer ' + token } })
  .then((r) => { if (r.status === 401) { localStorage.removeItem('token'); location.href = '/login'; } return r.json(); })
  .then((data) => { orders = data; render(); });
document.getElementById('search').addEventListener('input', render);
</script></body></html>`;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

function verify(token) {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature || createHmac('sha256', SECRET).update(body).digest('base64url') !== signature) return undefined;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return payload.exp > Date.now() / 1000 ? payload : undefined;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return undefined;
  }
}

/** Creates the demo server (not listening). Each server has its own in-memory data. */
export function createDemoServer(options = {}) {
  const username = options.username ?? process.env.DEMO_USERNAME ?? 'qa';
  const password = options.password ?? process.env.DEMO_PASSWORD ?? 'secret';
  const products = [
    { id: 'p1', sku: 'SKU-100', name: 'Desk lamp', price: 24.5 },
    { id: 'p2', sku: 'SKU-200', name: 'Office chair', price: 189 },
    { id: 'p3', sku: 'SKU-300', name: 'Notebook', price: 3.2 },
  ];
  const orders = [
    { id: 'o-1001', customer: 'Acme Corp', status: 'open', total: 213.5 },
    { id: 'o-1002', customer: 'Globex', status: 'shipped', total: 24.5 },
    { id: 'o-1003', customer: 'Acme Labs', status: 'open', total: 9.6 },
  ];

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status, body, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(type === 'application/json' ? JSON.stringify(body) : body);
    };

    if (request.method === 'GET' && url.pathname === '/openapi.json') return send(200, openapi);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { Location: '/orders' });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/login') return send(200, LOGIN_PAGE, 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/orders') return send(200, ORDERS_PAGE, 'text/html; charset=utf-8');
    if (request.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readJson(request);
      if (body?.username !== username || body?.password !== password) return send(401, { error: 'invalid credentials' });
      return send(200, { token: sign({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }) });
    }

    if (url.pathname.startsWith('/api/')) {
      const auth = request.headers.authorization ?? '';
      if (!verify(auth.replace(/^Bearer\s+/i, ''))) return send(401, { error: 'unauthorized' });
      if (request.method === 'GET' && url.pathname === '/api/products') return send(200, products);
      if (request.method === 'GET' && url.pathname === '/api/orders') return send(200, orders);
      const match = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (request.method === 'GET' && match) {
        const order = orders.find((o) => o.id === decodeURIComponent(match[1]));
        return order ? send(200, order) : send(404, { error: 'not found' });
      }
      if (request.method === 'POST' && url.pathname === '/api/orders') {
        const body = await readJson(request);
        if (!body?.customer || !Array.isArray(body.items) || body.items.length === 0) return send(400, { error: 'customer and items are required' });
        const total = body.items.reduce((sum, item) => sum + (products.find((p) => p.id === item.productId)?.price ?? 0) * (item.quantity ?? 1), 0);
        const order = { id: `o-${1001 + orders.length}`, customer: body.customer, status: 'open', total };
        orders.push(order);
        return send(201, order);
      }
    }
    return send(404, { error: 'not found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.DEMO_PORT ?? 4600);
  createDemoServer().listen(port, '127.0.0.1', () => console.log(`Demo shop on http://127.0.0.1:${port}`));
}
