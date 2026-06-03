// =================== ベース設定 ===================
let currentView = 'welcome';
let currentVideoId = null; let currentVideoTitle = '';
let currentChannelName = ''; let currentChannelThumb = '';
let currentChannelId = null;
let searchContext = 'trend'; let isFetching = false;
let lastQuery = ''; let currentPage = 1; let captchaTimer = null;
const seenVideoIds = new Set();
const KAHOOT_KEY_URL = 'https://apis.kahoot.it/media-api/youtube/key';
const CORS_PROXIES = ['https://api.codetabs.com/v1/proxy?quest=', 'https://api.codetabs.com/v1/tmp/?quest='];
let currentChannelTab = 'home';
let shortStreamType = 1;
let currentShortItems = [];
let currentEduKey = null;
let currentGVFormats = null;
let currentGVAllFormats = null;
let selectedQuality = null;
let currentChannelShortsPage = 1;
let currentChannelShortsName = '';
// ===== choco-inv-main-api 透過リライト: /api/v1/... → /api/... =====
// このAPIはInvidious互換だが /api/v1 ではなく /api を使う。
// 既存コードを変えずにInvidiousインスタンスとして混在運用するためfetchをラップ。
(function(){
  const origFetch = window.fetch.bind(window);
  const CHOCO_HOSTS = ['choco-inv-main-api.onrender.com','choco-inv-main-api-sexg.onrender.com','choco-inv-main-api-ev9d.onrender.com'];
  function rewriteChoco(urlStr) {
    try {
      // CORSプロキシ越しでも対応 (encodeされた本物URLを抽出)
      let prefix = '', actual = urlStr;
      const m = urlStr.match(/^(https?:\/\/[^\/]+\/[^?]*\?(?:url=)?)(https?%3A.+)$/i);
      if (m) { prefix = m[1]; actual = decodeURIComponent(m[2]); }
      const u = new URL(actual);
      if (!CHOCO_HOSTS.includes(u.host)) return urlStr;
      // /api/v1/videos/{id} はchoco-main未対応 → 失敗させて他インスタンスに回す
      if (/^\/api\/v1\/videos\/[A-Za-z0-9_-]{11}/.test(u.pathname)) return '__CHOCO_UNSUPPORTED__';
      // /api/v1/xxx → /api/xxx
      if (u.pathname.startsWith('/api/v1/')) u.pathname = '/api/' + u.pathname.slice('/api/v1/'.length);
      const rewritten = u.toString();
      return prefix ? (prefix + encodeURIComponent(rewritten)) : rewritten;
    } catch(e) { return urlStr; }
  }
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') {
        const r = rewriteChoco(input);
        if (r === '__CHOCO_UNSUPPORTED__') return Promise.reject(new Error('choco-main: /videos/ unsupported'));
        return origFetch(r, init);
      } else if (input && input.url) {
        const r = rewriteChoco(input.url);
        if (r === '__CHOCO_UNSUPPORTED__') return Promise.reject(new Error('choco-main: /videos/ unsupported'));
        if (r !== input.url) return origFetch(new Request(r, input), init);
      }
    } catch(e){}
    return origFetch(input, init);
  };
})();
const INVIDIOUS_INSTANCES = [
  // フォールバック（最小限）。完全なリストは instances/invidious.json からロード済み
  'https://choco-inv-main-api.onrender.com', 'https://choco-inv-main-api-sexg.onrender.com',
  'https://choco-inv-main-api-ev9d.onrender.com',
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com', 'https://invidious.f5.si',
  'https://iv.melmac.space', 'https://yt.omada.cafe', 'https://yewtu.be',
];
// =================== Invidiousインスタンスの役割分担 ===================
// 各タスクごとに別グループを割り当てて並列負荷を分散・最速化する
function _splitInstances(arr, n) {
  const out = Array.from({length:n}, () => []);
  arr.forEach((x,i) => out[i%n].push(x));
  return out;
}
try { window.INVIDIOUS_INSTANCES = INVIDIOUS_INSTANCES; } catch(_) {}
// =================== 拡張: instances/ JSON ロード / live.json / 高速化 ===================
// instances/invidious.json・piped.json・other.json を優先ロード、失敗時はリモートAPIにフォールバック
(function enhanceInstancesAndLive(){
  const SS_KEY_INV   = 'inv_remote_instances_v1';
  const SS_KEY_PIPED = 'piped_remote_instances_v1';
  const SS_KEY_LIVE  = 'live_json_cache_v1';
  const TTL = 30 * 60 * 1000;
  function readCache(k){
    try {
      const raw = sessionStorage.getItem(k);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || (Date.now() - (o.t||0)) > TTL) return null;
      return o.v;
    } catch(_) { return null; }
  }
  function writeCache(k, v){
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch(_) {}
  }
  function dedupe(arr){
    const seen = new Set(); const out = [];
    for (const u of arr) {
      if (!u || typeof u !== 'string') continue;
      const url = u.replace(/\/+$/, '');
      if (!/^https:\/\//.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url); out.push(url);
    }
    return out;
  }
  // --- instances/invidious.json → リモートAPIフォールバック ---
  async function fetchInvidiousList(){
    const cached = readCache(SS_KEY_INV);
    if (cached) return cached;
    try {
      const r = await fetch('/instances/invidious.json', { cache: 'force-cache' });
      if (r.ok) {
        const local = await r.json();
        if (Array.isArray(local) && local.length) { writeCache(SS_KEY_INV, local); return local; }
      }
    } catch(_) {}
    const urls = [
      'https://api.invidious.io/instances.json?sort_by=type,users',
      'https://corsproxy.io/?https://api.invidious.io/instances.json',
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        if (!Array.isArray(data)) continue;
        const list = data
          .filter(([, info]) => info && (info.type === 'https') && info.api === true)
          .map(([, info]) => info.uri)
          .filter(Boolean);
        if (list.length) { writeCache(SS_KEY_INV, list); return list; }
      } catch(_) {}
    }
    return [];
  }
  // --- instances/piped.json → リモートAPIフォールバック ---
  async function fetchPipedList(){
    const cached = readCache(SS_KEY_PIPED);
    if (cached) return cached;
    try {
      const r = await fetch('/instances/piped.json', { cache: 'force-cache' });
      if (r.ok) {
        const local = await r.json();
        if (Array.isArray(local) && local.length) { writeCache(SS_KEY_PIPED, local); return local; }
      }
    } catch(_) {}
    const sources = [
      'https://piped-instances.kavin.rocks/',
      'https://corsproxy.io/?https://piped-instances.kavin.rocks/',
    ];
    for (const u of sources) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        if (!Array.isArray(data)) continue;
        const list = data.map(x => x.api_url || x.apiUrl).filter(Boolean);
        if (list.length) { writeCache(SS_KEY_PIPED, list); return list; }
      } catch(_) {}
    }
    return [];
  }
  // --- live.json からライブ動画IDを取得 ---
  async function fetchLiveIds(){
    const cached = readCache(SS_KEY_LIVE);
    if (cached) return cached;
    const candidates = [
      '/live.json',
      'https://raw.githubusercontent.com/kanade0404/youtube-live-list/main/live.json',
      'https://corsproxy.io/?https://raw.githubusercontent.com/kanade0404/youtube-live-list/main/live.json',
    ];
    for (const u of candidates) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        let ids = [];
        if (Array.isArray(data)) {
          ids = data.map(x => typeof x === 'string' ? x : (x && (x.videoId || x.id))).filter(Boolean);
        } else if (data && typeof data === 'object') {
          if (Array.isArray(data.live)) ids = data.live.map(x => x.videoId || x.id || x).filter(Boolean);
          else if (Array.isArray(data.videos)) ids = data.videos.map(x => x.videoId || x.id || x).filter(Boolean);
          else if (Array.isArray(data.ids)) ids = data.ids.filter(Boolean);
        }
        ids = ids.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{6,}$/.test(id));
        if (ids.length) { writeCache(SS_KEY_LIVE, ids); return ids; }
      } catch(_) {}
    }
    return [];
  }
  // --- メイン: 並列取得してマージ ---
  (async function init(){
    try {
      const [invList, pipedList, liveIds] = await Promise.all([
        fetchInvidiousList(),
        fetchPipedList(),
        fetchLiveIds(),
      ]);
      if (invList && invList.length) {
        const merged = dedupe([...invList, ...INVIDIOUS_INSTANCES]);
        INVIDIOUS_INSTANCES.length = 0;
        merged.forEach(u => INVIDIOUS_INSTANCES.push(u));
        try { window.INVIDIOUS_INSTANCES = INVIDIOUS_INSTANCES; } catch(_) {}
        console.info('[enhance] Invidious instances merged:', INVIDIOUS_INSTANCES.length);
      }
      if (pipedList && pipedList.length) {
        const existing = (window.PIPED_INSTANCES && Array.isArray(window.PIPED_INSTANCES))
          ? window.PIPED_INSTANCES : [];
        const merged = dedupe([...pipedList, ...existing]);
        if (window.PIPED_INSTANCES && Array.isArray(window.PIPED_INSTANCES)) {
          window.PIPED_INSTANCES.length = 0;
          merged.forEach(u => window.PIPED_INSTANCES.push(u));
        } else {
          window.PIPED_INSTANCES = merged;
        }
        console.info('[enhance] Piped instances merged:', window.PIPED_INSTANCES.length);
      }
      if (liveIds && liveIds.length) {
        window.LIVE_VIDEO_IDS = liveIds;
        window.isKnownLiveId = function(id){ return liveIds.indexOf(id) !== -1; };
        console.info('[enhance] live.json IDs loaded:', liveIds.length);
      }
      // instances/other.json から poketube / hyperpipe 等を window.OTHER_INSTANCES へ
      try {
        const r = await fetch('/instances/other.json', { cache: 'force-cache' });
        if (r.ok) {
          const others = await r.json();
          // オブジェクト形式 { poketube:[...], ... } も配列も両対応
          const flat = Array.isArray(others)
            ? others
            : Object.entries(others).flatMap(([k,v]) => Array.isArray(v) ? v : []);
          if (flat.length) {
            window.OTHER_INSTANCES = dedupe(flat);
            console.info('[enhance] Other instances loaded:', window.OTHER_INSTANCES.length);
          }
        }
      } catch(_) {}
      // 役割分割テーブルを再構築
      try {
        const groups = _splitInstances(INVIDIOUS_INSTANCES, 5);
        INVIDIOUS_ROLES.trend   = groups[0].concat(groups[1]).slice(0, 18);
        INVIDIOUS_ROLES.search  = groups[1].concat(groups[2]).slice(0, 18);
        INVIDIOUS_ROLES.shorts  = groups[2].concat(groups[3]).slice(0, 18);
        INVIDIOUS_ROLES.channel = groups[3].concat(groups[4]).slice(0, 18);
        INVIDIOUS_ROLES.video   = groups[4].concat(groups[0]).slice(0, 16);
      } catch(_) {}
    } catch (e) {
      console.warn('[enhance] init failed', e);
    }
  })();
})();
const _INV_GROUPS = _splitInstances(INVIDIOUS_INSTANCES, 5);
const INVIDIOUS_ROLES = {
  trend:   _INV_GROUPS[0].concat(_INV_GROUPS[1]).slice(0, 14),  // ホーム/トレンド
  search:  _INV_GROUPS[1].concat(_INV_GROUPS[2]).slice(0, 14),  // 検索
  shorts:  _INV_GROUPS[2].concat(_INV_GROUPS[3]).slice(0, 14),  // ショート
  channel: _INV_GROUPS[3].concat(_INV_GROUPS[4]).slice(0, 14),  // チャンネル
  video:   _INV_GROUPS[4].concat(_INV_GROUPS[0]).slice(0, 12),  // 単一動画メタ
};
function getInvidiousFor(role) {
  return INVIDIOUS_ROLES[role] && INVIDIOUS_ROLES[role].length
    ? INVIDIOUS_ROLES[role]
    : INVIDIOUS_INSTANCES.slice(0, 12);
}
// =================== 最速 Invidious インスタンス自動選定 ===================
// 全インスタンスに軽量リクエストを送り、最速で応答した上位 5 件を使う
// 結果は 5 分間 sessionStorage にキャッシュ
const FAST_INV_CACHE_KEY = '__fastInvInstances_v1';
const FAST_INV_TTL_MS = 5 * 60 * 1000;
const FAST_INV_TOP_N = 3;
const FAST_INV_TIMEOUT_MS = 2500;
let _fastInvPromise = null;
let _fastInvList = null;
(function _loadFastInvFromCache(){
  try {
    const raw = sessionStorage.getItem(FAST_INV_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.list) && obj.list.length && (Date.now() - obj.ts) < FAST_INV_TTL_MS) {
      _fastInvList = obj.list;
    }
  } catch(_) {}
})();
function _pingInvidious(base, timeoutMs) {
  // /api/v1/stats は軽量・CORS可で生死/速度の指標になる
  const url = base.replace(/\/$/, '') + '/api/v1/stats';
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { method: 'GET', signal: ctrl.signal, cache: 'no-store', mode: 'cors' })
    .then(r => {
      clearTimeout(t);
      if (!r.ok) throw new Error('bad status ' + r.status);
      return { base, ms: performance.now() - start };
    })
    .catch(e => { clearTimeout(t); throw e; });
}
function refreshFastInvidious(force) {
  if (!force && _fastInvList && _fastInvList.length) return Promise.resolve(_fastInvList);
  if (_fastInvPromise) return _fastInvPromise;
  const top = [];
  _fastInvPromise = new Promise((resolve) => {
    let finished = false;
    let remaining = INVIDIOUS_INSTANCES.length;
    const done = () => {
      if (finished) return;
      finished = true;
      const list = top.slice(0, FAST_INV_TOP_N).map(x => x.base);
      if (list.length) {
        _fastInvList = list;
        try { sessionStorage.setItem(FAST_INV_CACHE_KEY, JSON.stringify({ ts: Date.now(), list })); } catch(_) {}
        console.log('[FastInv] top', list);
      }
      _fastInvPromise = null;
      resolve(_fastInvList || []);
    };
    INVIDIOUS_INSTANCES.forEach(base => {
      _pingInvidious(base, FAST_INV_TIMEOUT_MS)
        .then(res => {
          top.push(res);
          top.sort((a,b) => a.ms - b.ms);
          // 上位 N 揃った時点で早期確定（残りは待たない）
          if (top.length >= FAST_INV_TOP_N) done();
        })
        .catch(()=>{})
        .finally(() => {
          if (--remaining <= 0) done();
        });
    });
    // 全体タイムアウト（保険）
    setTimeout(done, FAST_INV_TIMEOUT_MS + 500);
  });
  return _fastInvPromise;
}
// 起動時にバックグラウンドで計測開始（ブロックしない）
try { setTimeout(() => refreshFastInvidious(false), 200); } catch(_) {}
// getInvidiousFor を上書き：最速リストがあればそれを優先、無ければ従来ロジック
const _origGetInvidiousFor = getInvidiousFor;
getInvidiousFor = function(role) {
  if (_fastInvList && _fastInvList.length) {
    // 最速 N 件 + 従来のロール別フォールバックを後ろに連結（重複排除）
    const fallback = _origGetInvidiousFor(role) || [];
    const seen = new Set();
    const merged = [];
    for (const u of _fastInvList.concat(fallback)) {
      if (!seen.has(u)) { seen.add(u); merged.push(u); }
    }
    return merged;
  }
  // まだ未計測なら、裏で計測を走らせつつ従来リストを返す
  refreshFastInvidious(false);
  return _origGetInvidiousFor(role);
};
// 投稿日が1年以内かどうか（不明はtrueにして除外しすぎないようにする）
function _isWithinOneYear(item) {
  if (!item) return true;
  const ts = item.published || item.publishedTimestamp || 0;
  if (ts && ts > 1000000000) {
    const nowSec = Date.now() / 1000;
    if (nowSec - ts > 365 * 86400) return false;
    return true;
  }
  // publishedText で「2年前」「3 years ago」等は除外
  const txt = String(item.publishedText || item.published || '');
  if (/(\d+)\s*年前/.test(txt)) {
    const n = parseInt(RegExp.$1); if (n >= 1) return false;
  }
  if (/(\d+)\s*years?\s*ago/i.test(txt)) {
    const n = parseInt(RegExp.$1); if (n >= 1) return false;
  }
  return true;
}
// 概要欄テキスト中のURL/メンションをリンク化
function _linkifyText(text) {
  if (!text) return '';
  // まずHTMLエスケープ
  let s = String(text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  // URL → <a>
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const safe = url.replace(/"/g,'&quot;');
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:#3ea6ff;text-decoration:none;word-break:break-all;" onclick="event.stopPropagation();">${url}</a>`;
  });
  // @ハンドル → 内部チャンネル遷移
  s = s.replace(/(^|[\s>])@([A-Za-z0-9_\-\.]{2,30})/g, (m, pre, h) => {
    return `${pre}<a href="javascript:void(0)" onclick="event.stopPropagation();openChannel('${h.replace(/'/g,"\\'")}',null);" style="color:#3ea6ff;text-decoration:none;">@${h}</a>`;
  });
  // 改行 → <br>
  return s.replace(/\n/g,'<br>');
}
