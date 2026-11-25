/**
 * XAUT/TWD 價格轉發 Worker
 *
 * - 從 MAX 交易所公開 API 取得 xauttwd 的 ticker 與買方掛單（depth）
 * - REST API 失敗（例如被 MAX 防火牆擋）時，改用 MAX 公開行情 WebSocket 的委託簿
 * - 快取 15 秒，避免頻繁呼叫 MAX
 * - MAX 暫時失敗時，5 分鐘內的舊價格仍可回傳（標示 stale）
 * - 只允許指定網站從瀏覽器讀取（CORS）
 *
 * 端點：
 *   GET /       網頁（site/index.html，部署時由 wrangler 打包進 Worker）
 *   GET /price  價格 JSON
 */

import INDEX_HTML from '../site/index.html';

const MAX_API = 'https://max-api.maicoin.com/api/v3';
const MARKET = 'xauttwd';
const TTL_MS = 15 * 1000;          // 快取時間
const STALE_MS = 5 * 60 * 1000;    // MAX 失敗時，舊資料最多可用多久
const DEPTH_LIMIT = 50;            // 取幾筆買單
const ALLOWED_ORIGINS = [
  'https://isawamaho.github.io',
  'https://xaut.ihctw.bid',
];

// 每個 Worker 執行個體各自的記憶體快取
let cache = null;      // { data, at }
let inflight = null;   // 同時多個請求時，只向 MAX 發一次

async function describeFailure(res) {
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
  const h = (k) => res.headers.get(k);
  return `HTTP ${res.status}`
    + (h('server') ? ` server=${h('server')}` : '')
    + (h('cf-mitigated') ? ` cf-mitigated=${h('cf-mitigated')}` : '')
    + (h('cf-ray') ? ` cf-ray=${h('cf-ray')}` : '')
    + (body ? ` body=${body}` : '');
}

// ---------- 備援：MAX 公開行情 WebSocket（委託簿） ----------
const MAX_STREAM = 'https://max-stream.maicoin.com/ws';   // Workers 以 https:// + Upgrade 開 WebSocket
const REST_SKIP_MS = 10 * 60 * 1000;   // REST 被擋後，跳過 REST 的時間
let restBlockedUntil = 0;

function readBookOnce(depth) {
  return new Promise(async (resolve, reject) => {
    let socket, timer;
    const finish = (err, data) => {
      clearTimeout(timer);
      try { socket && socket.close(); } catch {}
      err ? reject(new Error(err)) : resolve(data);
    };
    timer = setTimeout(() => finish('等待委託簿逾時'), 6000);
    try {
      const res = await fetch(MAX_STREAM, { headers: { Upgrade: 'websocket' } });
      socket = res.webSocket;
      if (!socket) return finish('WebSocket HTTP ' + res.status);
      socket.accept();
    } catch (e) {
      return finish('WebSocket 連線失敗');
    }
    socket.addEventListener('message', (event) => {
      let m;
      try { m = JSON.parse(event.data); } catch { return; }
      if (m && m.e === 'error') return finish('MAX 回報錯誤：' + JSON.stringify(m.E || m).slice(0, 120));
      if (!m || m.c !== 'book' || m.M !== MARKET || m.e !== 'snapshot') return;
      const bids = (Array.isArray(m.b) ? m.b : [])
        .map(([p, v]) => [String(p), String(v)])
        .filter(([p, v]) => Number(p) > 0 && Number(v) > 0)
        .sort((x, y) => Number(y[0]) - Number(x[0]));
      if (!bids.length) return finish('委託簿沒有買單');
      const asks = (Array.isArray(m.a) ? m.a : []).map(([p]) => Number(p)).filter((p) => p > 0);
      finish(null, {
        source: 'MAX WebSocket',
        market: MARKET,
        buy: bids[0][0],
        buy_vol: bids[0][1],
        sell: asks.length ? String(Math.min(...asks)) : null,
        last: null,
        ticker_at: Number.isFinite(m.T) ? Math.floor(m.T / 1000) : null,
        bids,
        fetched_at: Math.floor(Date.now() / 1000),
      });
    });
    socket.addEventListener('close', () => finish('行情連線中斷'));
    socket.addEventListener('error', () => finish('行情連線錯誤'));
    socket.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{ channel: 'book', market: MARKET, depth }],
    }));
  });
}

async function fetchFromStream() {
  try {
    return await readBookOnce(20);          // 多取幾檔買單，供逐筆賣出估算
  } catch (e) {
    return await readBookOnce(1);           // 若不接受 depth 20，退回只取最高買單
  }
}

async function getQuote() {
  let restError = 'REST 暫時跳過（先前被擋）';
  if (Date.now() >= restBlockedUntil) {
    try {
      return await fetchFromMax();
    } catch (e) {
      restError = String(e && e.message || e);
      if (/HTTP 403/.test(restError)) restBlockedUntil = Date.now() + REST_SKIP_MS;
    }
  }
  try {
    return await fetchFromStream();
  } catch (e) {
    throw new Error(`REST：${restError.slice(0, 200)}；WebSocket：${e.message}`);
  }
}

async function fetchFromMax() {
  const opts = {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'xaut-twd-price/1.0 (+https://xaut.ihctw.bid/)',
    },
  };
  const [t, d] = await Promise.all([
    fetch(`${MAX_API}/ticker?market=${MARKET}`, opts),
    fetch(`${MAX_API}/depth?market=${MARKET}&limit=${DEPTH_LIMIT}`, opts),
  ]);
  if (!t.ok) throw new Error('ticker ' + await describeFailure(t));
  if (!d.ok) throw new Error('depth ' + await describeFailure(d));
  const ticker = await t.json();
  const depth = await d.json();
  if (!ticker || ticker.buy == null) throw new Error('MAX 回傳資料缺少 buy');

  const bids = (Array.isArray(depth.bids) ? depth.bids : [])
    .map(([price, vol]) => [String(price), String(vol)])
    .sort((a, b) => Number(b[0]) - Number(a[0]));   // 由高到低

  return {
    source: 'MAX REST',
    market: MARKET,
    buy: String(ticker.buy),          // 買方最高出價 = 立即賣出可得價格
    buy_vol: String(ticker.buy_vol),
    sell: String(ticker.sell),
    last: String(ticker.last),
    ticker_at: ticker.at,
    bids,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const cors = { Vary: 'Origin' };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: '只支援 GET' }, 405, cors);

    const { pathname } = new URL(request.url);
    if (pathname === '/' || pathname === '/index.html') {
      return new Response(INDEX_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (pathname !== '/price') return json({ error: '找不到頁面' }, 404, cors);

    let stale = false;
    if (!cache || Date.now() - cache.at > TTL_MS) {
      if (!inflight) {
        inflight = getQuote()
          .then((data) => { cache = { data, at: Date.now() }; })
          .finally(() => { inflight = null; });
      }
      try {
        await inflight;
      } catch (e) {
        if (!cache || Date.now() - cache.at > STALE_MS) {
          return json({ error: '無法取得 MAX 價格', detail: String(e && e.message || e) }, 502, cors);
        }
        stale = true;
      }
    }

    return json(
      { ...cache.data, stale, cache_age_sec: Math.round((Date.now() - cache.at) / 1000) },
      200,
      { ...cors, 'Cache-Control': 'no-store' },
    );
  },
};
