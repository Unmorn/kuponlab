import analyze from './api/analyze.js';
import bestPicks from './api/best-picks.js';
import couponStatus from './api/coupon-status.js';
import customCoupon from './api/custom-coupon.js';
import fixtures from './api/fixtures.js';
import insights from './api/insights.js';
import modelHealth from './api/model-health.js';
import nesineTransfer from './api/nesine-transfer.js';
import oddsMoves from './api/odds-moves.js';
import backtest from './api/backtest.js';
import globalEloBackfill from './api/global-elo-backfill.js';
import performanceBackfill from './api/performance-backfill.js';
import performanceRangeBackfill from './api/performance-range-backfill.js';
import backtestCron from './api/backtest-cron.js';
import globalEloCron from './api/global-elo-cron.js';
import lineupCron from './api/lineup-cron.js';
import oddsCron from './api/odds-cron.js';
import performanceCron from './api/performance-cron.js';
import { bindDatabase, ensureSchema, hasDatabase } from './lib/db.js';

const PUBLIC_ROUTES = new Map([
  ['/api/analyze', analyze],
  ['/api/best-picks', bestPicks],
  ['/api/coupon-status', couponStatus],
  ['/api/custom-coupon', customCoupon],
  ['/api/fixtures', fixtures],
  ['/api/insights', insights],
  ['/api/model-health', modelHealth],
  ['/api/nesine-transfer', nesineTransfer],
  ['/api/odds-moves', oddsMoves]
]);

const ADMIN_ROUTES = new Map([
  ['/api/backtest', backtest],
  ['/api/global-elo-backfill', globalEloBackfill],
  ['/api/performance-backfill', performanceBackfill],
  ['/api/performance-range-backfill', performanceRangeBackfill]
]);

const CACHE_TTLS = new Map([
  ['/api/fixtures', 120],
  ['/api/analyze', 300],
  ['/api/insights', 300],
  ['/api/best-picks', 300],
  ['/api/custom-coupon', 300],
  ['/api/model-health', 600],
  ['/api/odds-moves', 120]
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

async function invoke(handler, request, url) {
  let body = null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    try { body = await request.json(); } catch { body = null; }
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const req = { query, body, method: request.method, headers: request.headers, url: url.toString() };
  let statusCode = 200;
  let response = null;
  const res = {
    status(code) { statusCode = Number(code) || 200; return this; },
    json(payload) { response = json(payload, statusCode); return response; }
  };
  const returned = await handler(req, res);
  return returned instanceof Response ? returned : response || json({ ok: false, error: 'Endpoint yanıt üretmedi.' }, 500);
}

function adminAllowed(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const supplied = request.headers.get('x-admin-token') || new URL(request.url).searchParams.get('key') || '';
  return supplied === env.ADMIN_TOKEN;
}

async function prepareDatabase(env) {
  bindDatabase(env.DB || null);
  if (env.DB) await ensureSchema();
}

async function cachedInvoke(handler, request, url, ctx, ttl) {
  if (!ttl || request.method !== 'GET' || typeof caches === 'undefined') return invoke(handler, request, url);
  const cache = caches.default;
  const key = new Request(url.toString(), { method: 'GET', headers: { accept: 'application/json' } });
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await invoke(handler, request, url);
  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set('cache-control', `public, max-age=${Math.min(ttl, 60)}, s-maxage=${ttl}`);
    headers.set('x-kuponlab-edge-cache', 'MISS');
    const cacheable = new Response(response.body, { status: response.status, headers });
    ctx.waitUntil(cache.put(key, cacheable.clone()));
    return cacheable;
  }
  return response;
}

async function runScheduled(handler) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = Number(code) || 200; return this; },
    json(data) { payload = data; return data; }
  };
  await handler({ query: {}, body: null, method: 'SCHEDULED' }, res);
  if (statusCode >= 400) throw new Error(payload?.error || `Scheduled job failed: ${statusCode}`);
  return payload;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      await prepareDatabase(env);

      if (url.pathname === '/api/_health') {
        return json({
          ok: true,
          app: 'KuponLab',
          cloudflareEdition: '5.5',
          modelVersion: '5.2',
          database: hasDatabase() ? 'd1' : 'stateless',
          time: new Date().toISOString()
        });
      }

      const publicHandler = PUBLIC_ROUTES.get(url.pathname);
      if (publicHandler) {
        const ttl = CACHE_TTLS.get(url.pathname) || 0;
        return cachedInvoke(publicHandler, request, url, ctx, ttl);
      }

      const adminHandler = ADMIN_ROUTES.get(url.pathname);
      if (adminHandler) {
        if (!adminAllowed(request, env)) return json({ ok: false, error: 'Bu yönetim endpointi kapalı.' }, 404);
        return invoke(adminHandler, request, url);
      }

      if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Endpoint bulunamadı.' }, 404);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('KuponLab static assets binding missing.', { status: 500 });
    } catch (error) {
      console.error('KuponLab Worker error', error);
      return json({ ok: false, error: 'Sunucu isteği tamamlanamadı.', detail: String(error?.message || error) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await prepareDatabase(env);
      if (!env.DB) {
        console.warn('KuponLab scheduled job skipped: D1 binding DB is missing.');
        return;
      }
      const jobs = {
        '5 * * * *': lineupCron,
        '20 */2 * * *': oddsCron,
        '50 2 * * *': globalEloCron,
        '35 3 * * *': performanceCron,
        '20 4 * * *': backtestCron
      };
      const handler = jobs[event.cron];
      if (!handler) return;
      const result = await runScheduled(handler);
      console.log('KuponLab scheduled job complete', event.cron, result);
    })());
  }
};
