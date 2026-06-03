/* ===================== 仲良しTube 追加パッチ =====================
   - Invidiousインスタンスの成功率を学習し、成功率順に並べ替え
   - Piped APIをさらに追加
   - 設定にAPI優先度UI (Piped / Invidious / Min-Pro Search) を追加し並べ替え可能に
   - ホーム動画はチャンネル取得済みのものを優先表示
   - 動画カードからアクセス数 (視聴回数) を非表示
   - m.youtube.com / www.youtube.com の動画でもチャンネル情報を取得/再読込
   ============================================================== */
(function(){
  'use strict';
  /* ---------- 1) Invidious 成功率トラッキング ---------- */
  const STATS_KEY = 'inv_instance_stats_v1';
  function loadStats(){ try { return JSON.parse(localStorage.getItem(STATS_KEY)||'{}'); } catch(_) { return {}; } }
  function saveStats(s){ try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch(_){} }
  const stats = loadStats();
  function recordResult(instance, ok){
    if (!instance) return;
    const host = String(instance).replace(/\/$/,'');
    const cur = stats[host] || { ok:0, fail:0 };
    if (ok) cur.ok++; else cur.fail++;
    // 上限でリセットして古いデータを薄める
    if (cur.ok + cur.fail > 200) { cur.ok = Math.round(cur.ok/2); cur.fail = Math.round(cur.fail/2); }
    stats[host] = cur;
    saveStats(stats);
  }
  window.getInvSuccessRate = function(host){
    const c = stats[String(host).replace(/\/$/,'')];
    if (!c || (c.ok+c.fail) < 3) return 0.5; // 未計測は中間値
    return c.ok / (c.ok + c.fail);
  };
  function sortInvBySuccess(list){
    return list.slice().sort((a,b) => window.getInvSuccessRate(b) - window.getInvSuccessRate(a));
  }
  // fetch をフックして Invidious ホスト宛は成功率を記録
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    // プロキシ越し URL から元のホストを抽出
    let host = null;
    try {
      const m = url.match(/https?:\/\/([^\/]+)/);
      if (m) {
        let candidate = m[1];
        // プロキシ経由なら url= に元URLが入っている
        const mm = url.match(/[?&](?:url|quest|q)=([^&]+)/);
        if (mm) { try { const inner = decodeURIComponent(mm[1]); const m2 = inner.match(/https?:\/\/([^\/]+)/); if (m2) candidate = m2[1]; } catch(_){} }
        host = candidate;
      }
    } catch(_){}
    const isInv = host && (window.INVIDIOUS_INSTANCES||[]).some(i => i.includes(host));
    try {
      const r = await _origFetch(input, init);
      if (isInv) recordResult('https://'+host, !!(r && r.ok));
      return r;
    } catch(e) {
      if (isInv) recordResult('https://'+host, false);
      throw e;
    }
  };
  /* ---------- 2) Piped インスタンス追加 ---------- */
  const EXTRA_PIPED = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.darkness.services',
    'https://api.piped.private.coffee',
    'https://pipedapi.drgns.space',
    'https://pipedapi.in.projectsegfau.lt',
    'https://pipedapi.us.projectsegfau.lt',
    'https://pipedapi.smnz.de',
    'https://pipedapi.tokhmi.xyz',
    'https://piapi.ggtyler.dev',
    'https://pipedapi.ducks.party',
    'https://api.piped.yt',
    'https://pipedapi.nosebs.ru',
    'https://pipedapi.phoenixthrush.com',
  ];
  // 既存 PIPED_INSTANCES とマージ
  try {
    const cur = Array.isArray(window.PIPED_INSTANCES) ? window.PIPED_INSTANCES : [];
    const merged = Array.from(new Set([...cur, ...EXTRA_PIPED]));
    window.PIPED_INSTANCES = merged;
  } catch(_){}
  /* ---------- 3) API 優先度 (Piped / Invidious / Min-Pro) ---------- */
  const API_ORDER_KEY = 'api_provider_order_v1';
  const DEFAULT_ORDER = ['piped','invidious','minpro'];
  const LABELS = { piped:'Piped API', invidious:'Invidious API', minpro:'Min-Pro Search API' };
  function getOrder(){
    try {
      const s = JSON.parse(localStorage.getItem(API_ORDER_KEY)||'null');
      if (Array.isArray(s) && s.length === 3) return s;
    } catch(_){}
    return DEFAULT_ORDER.slice();
  }
  function setOrder(arr){ try { localStorage.setItem(API_ORDER_KEY, JSON.stringify(arr)); } catch(_){} }
  window.getApiProviderOrder = getOrder;
  /* ---------- 4) 各プロバイダの取得関数を統一 ---------- */
  // CORS制限回避: 直接 + 複数CORSプロキシ を並列レース
  const INV_CORS_WRAPPERS = [
    (u) => u,
    (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
    (u) => 'https://cors.eu.org/' + u,
  ];
  async function callInvidious(query, context, page){
    const base = (Array.isArray(window.INVIDIOUS_INSTANCES) && window.INVIDIOUS_INSTANCES.length)
      ? window.INVIDIOUS_INSTANCES.slice()
      : (typeof INVIDIOUS_INSTANCES !== 'undefined' ? INVIDIOUS_INSTANCES.slice() : []);
    const preferred = ['https://lekker.gay','https://iv.melmac.space','https://invidious.materialio.us','https://y.com.sb','https://invidious.f5.si','https://yt.omada.cafe'];
    const pool = Array.from(new Set([...preferred, ...sortInvBySuccess(base)])).slice(0, context === 'search' ? 32 : 12);
    const paths = (context==='trend')
      ? ['/api/v1/popular?region=JP&hl=ja','/api/v1/trending?region=JP&hl=ja']
      : ['/api/v1/search?q='+encodeURIComponent(query)+'&page='+(page||1)+'&hl=ja&region=JP'];
    const tasks = [];
    for (const inst of pool) {
      for (const p of paths) {
        const target = inst.replace(/\/$/,'') + p;
        for (const wrap of INV_CORS_WRAPPERS) {
          const url = wrap(target);
          tasks.push((async () => {
            const r = await _origFetch(url, { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } });
            if (!r || !r.ok) throw new Error('bad');
            const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
            const d = ct.includes('json') ? await r.json() : JSON.parse(await r.text());
            if (!Array.isArray(d) || !d.length) throw new Error('empty');
            return d;
          })());
        }
      }
    }
    if (!tasks.length) return null;
    try { return await Promise.any(tasks); } catch(_) { return null; }
  }
  async function callPiped(query, context, page){
    if (context==='trend' && typeof window.fetchPipedTrending==='function') return await window.fetchPipedTrending();
    if (typeof window.fetchPipedSearch==='function') return await window.fetchPipedSearch(query, page||1);
    return null;
  }
  async function callMinPro(query){
    if (typeof window.fetchExtraSearch==='function') return await window.fetchExtraSearch(query);
    return null;
  }
  const PROVIDERS = { piped: callPiped, invidious: callInvidious, minpro: callMinPro };
  /* ---------- 5) チャンネル情報がある順に並べる ---------- */
  function hasChannelInfo(v){
    if (!v) return false;
    const a = v.author || v.channel || '';
    if (!a) return false;
    if (typeof window.isInvalidChannel === 'function' && window.isInvalidChannel(a)) return false;
    return true;
  }
  function dedupAndSort(list){
    const seen = new Set(); const out = [];
    for (const v of (list||[])) {
      if (!v) continue;
      const id = v.videoId || v.id;
      if (!id || seen.has(id)) continue;
      seen.add(id); out.push(v);
    }
    // チャンネル情報がある (= author あり, isInvalidでない) を先頭に
    return out.sort((a,b) => (hasChannelInfo(b)?1:0) - (hasChannelInfo(a)?1:0));
  }
  /* ---------- 6) fetchFromInvidious を優先度ベースで再ラップ ---------- */
  function installProviderRouter(){
    if (typeof window.fetchFromInvidious !== 'function') return false;
    if (window.__patchedProviderRouter) return true;
    window.__patchedProviderRouter = true;
    window.fetchFromInvidious = async function(query, context, page){
      // ユーザー要求: 検索 (context==='search') は Invidious / Min-Pro のみ使用 (Pipedはスキップ)
      let order = getOrder();
      if (context === 'search') {
        order = order.filter(k => k === 'invidious' || k === 'minpro');
        if (!order.includes('invidious')) order.unshift('invidious');
        if (!order.includes('minpro')) order.push('minpro');
      }
      const tasks = order.map(k => (PROVIDERS[k] ? PROVIDERS[k](query, context, page).catch(()=>null) : Promise.resolve(null)));
      const results = await Promise.allSettled(tasks);
      const out = [];
      // 優先度順に追加（先頭の方が前に並ぶ）
      results.forEach(r => { if (r.status==='fulfilled' && Array.isArray(r.value)) out.push(...r.value); });
      const merged = dedupAndSort(out);
      return merged.length ? merged : null;
    };
    return true;
  }
  if (!installProviderRouter()) {
    const iv = setInterval(() => { if (installProviderRouter()) clearInterval(iv); }, 200);
    setTimeout(() => clearInterval(iv), 15000);
  }
  /* ---------- 7) loadTrend をチャンネル情報優先で並べ直し ---------- */
  const _origLoadTrend2 = window.loadTrend;
  if (typeof _origLoadTrend2 === 'function') {
    window.loadTrend = async function(){
      const r = await _origLoadTrend2.apply(this, arguments);
      // 描画後にカードを並び替え: data-vid を持つカードのうち、チャンネル名が表示されているものを前に
      setTimeout(() => {
        const grid = document.getElementById('home-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.video-card'));
        cards.sort((a,b) => {
          const ca = (a.querySelector('.video-meta-channel')||{}).textContent || '';
          const cb = (b.querySelector('.video-meta-channel')||{}).textContent || '';
          const aHas = ca.trim().length > 0 ? 1 : 0;
          const bHas = cb.trim().length > 0 ? 1 : 0;
          return bHas - aHas;
        });
        cards.forEach(c => grid.appendChild(c));
      }, 600);
      return r;
    };
  }
  /* ---------- 8) 視聴回数表示は元の挙動を維持 ---------- */
  /* ---------- 9) m.youtube.com / www.youtube.com でもチャンネル取得 ---------- */
  function extractVideoId(u){
    if (!u) return null;
    const s = String(u);
    let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = s.match(/youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = s.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  }
  window.extractVideoId = extractVideoId;
  async function refetchChannelForVideo(videoId){
    const pool = sortInvBySuccess((window.INVIDIOUS_INSTANCES||[]).slice()).slice(0,8);
    for (const inst of pool) {
      try {
        const url = (typeof buildFetchUrl==='function'?buildFetchUrl:(x=>x))(`${inst}/api/v1/videos/${videoId}?fields=title,author,authorId,authorThumbnails&hl=ja&region=JP`);
        const r = await _origFetch(url, { signal: AbortSignal.timeout(4000) });
        if (!r || !r.ok) continue;
        const d = await r.json();
        if (d && d.author) return d;
      } catch(_){}
    }
    // Piped fallback
    for (const inst of (window.PIPED_INSTANCES||[]).slice(0,6)) {
      try {
        const r = await _origFetch(`${inst}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
        if (!r || !r.ok) continue;
        const d = await r.json();
        if (d && d.uploader) return { author:d.uploader, authorId:(d.uploaderUrl||'').replace(/^\/channel\//,''), authorThumbnails:d.uploaderAvatar?[{url:d.uploaderAvatar}]:null };
      } catch(_){}
    }
    return null;
  }
  window.refetchChannelForVideo = refetchChannelForVideo;
  // playVideo をラップ: URL風入力なら videoId 抽出 + チャンネル不明なら再取得
  const _origPlayVideo = window.playVideo;
  if (typeof _origPlayVideo === 'function') {
    window.playVideo = function(id, title, channel, thumb){
      // m.youtube.com / www.youtube.com の URL を渡された場合も対応
      const vid = extractVideoId(id) || id;
      const needFetch = !channel || (typeof window.isInvalidChannel==='function' && window.isInvalidChannel(channel));
      const ret = _origPlayVideo.call(this, vid, title, channel||'', thumb||'');
      if (needFetch && vid) {
        refetchChannelForVideo(vid).then(info => {
          if (!info) return;
          // チャンネル名表示要素を後追い更新
          const sel = document.querySelectorAll('.video-channel-name, #channel-name, .api-author, [data-channel-of="'+vid+'"]');
          sel.forEach(el => { if (el && !el.textContent.trim()) el.textContent = info.author; });
          try {
            const avatar = document.querySelector('.video-channel-avatar img, #channel-avatar img');
            if (avatar && info.authorThumbnails && info.authorThumbnails[0]) avatar.src = info.authorThumbnails[0].url;
          } catch(_){}
        });
      }
      return ret;
    };
  }
  /* ---------- 10) 設定 UI: API 優先度ブロックを注入 ---------- */
  function injectApiProviderUI(){
    const settingsView = document.getElementById('view-settings') || document.querySelector('[data-view="settings"]') || document.getElementById('settings-view');
    if (!settingsView) return;
    if (settingsView.querySelector('#api-provider-priority')) return;
    const box = document.createElement('div');
    box.id = 'api-provider-priority';
    box.style.cssText = 'margin:16px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--chip-bg);';
    box.innerHTML = `
      <div style="font-weight:bold;margin-bottom:8px;">API 優先度 (上が高優先)</div>
      <div id="api-prov-list"></div>
      <button id="api-prov-reset" style="margin-top:8px;padding:6px 12px;border-radius:8px;background:var(--chip-bg);border:1px solid var(--border-color);">既定に戻す</button>
    `;
    settingsView.insertBefore(box, settingsView.firstChild);
    renderProvList();
    box.querySelector('#api-prov-reset').onclick = () => { setOrder(DEFAULT_ORDER.slice()); renderProvList(); };
  }
  function renderProvList(){
    const list = document.getElementById('api-prov-list');
    if (!list) return;
    const order = getOrder();
    list.innerHTML = order.map((k,i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border-color);">
        <span style="width:24px;text-align:right;color:var(--text-secondary);">${i+1}.</span>
        <span style="flex:1;font-weight:500;">${LABELS[k]||k}</span>
        <button data-mv="-1" data-i="${i}" ${i===0?'disabled':''} style="padding:4px 10px;border-radius:6px;background:var(--bg-color);border:1px solid var(--border-color);opacity:${i===0?0.4:1};">↑</button>
        <button data-mv="1" data-i="${i}" ${i===order.length-1?'disabled':''} style="padding:4px 10px;border-radius:6px;background:var(--bg-color);border:1px solid var(--border-color);opacity:${i===order.length-1?0.4:1};">↓</button>
      </div>
    `).join('');
    list.querySelectorAll('button[data-mv]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.i, d = +btn.dataset.mv;
        const o = getOrder(); const j = i+d;
        if (j<0 || j>=o.length) return;
        [o[i],o[j]]=[o[j],o[i]]; setOrder(o); renderProvList();
      };
    });
  }
  // navigate フック (既存)
  const _origNav = window.navigate;
  if (typeof _origNav === 'function') {
    window.navigate = function(v){
      const r = _origNav.apply(this, arguments);
      if (v === 'settings') setTimeout(injectApiProviderUI, 100);
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectApiProviderUI, 800));
  setTimeout(injectApiProviderUI, 1500);
  /* ---------- 11) Invidious 優先順位リストも成功率順に再ソート ---------- */
  const _origRenderList = window.renderApiPriorityList;
  if (typeof _origRenderList === 'function') {
    // 起動時に保存優先度がなければ成功率順に
    try {
      const k = 'api_priority_v1';
      if (!localStorage.getItem(k)) {
        const sorted = sortInvBySuccess((window.INVIDIOUS_INSTANCES||[]).slice());
        localStorage.setItem(k, JSON.stringify(sorted));
      }
    } catch(_){}
  }
  console.log('[仲良しTube patch] loaded — providers:', getOrder(), 'piped:', (window.PIPED_INSTANCES||[]).length);
})();

/* ===================== 仲良しTube 追加パッチ #2 =====================
   - 全箇所に小さなスピナー表示
   - 設定で各APIの死活状況 + 何時間死んでいるかを表示
   - Shorts ページの下端で動画自動読み込み
   - 動画再生開始を高速化 (preload + 先行バッファ)
   - 取得できた順に即表示 (streamHome を search にも適用)
   - CORSプロキシを毎回ローテーション
   - 日本人フィルタは home (trend) のみ適用
   - ホームを視聴履歴 + 検索履歴ベースでパーソナライズ
   - 次の動画を視聴中動画と関連性で並び替え
   ============================================================== */
(function(){
  'use strict';
  /* ---------- 共通: 小さいスピナー CSS ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .nyt-mini-spin {
      display:inline-block; width:18px; height:18px; vertical-align:middle;
      border:2px solid var(--text-secondary, #888); border-top-color: transparent;
      border-radius:50%; animation: nyt-spin 0.7s linear infinite;
    }
    .nyt-spin-overlay {
      position:fixed; z-index:9999; right:14px; bottom:14px;
      width:32px; height:32px; border-radius:50%;
      background: rgba(0,0,0,0.55); display:none;
      align-items:center; justify-content:center; pointer-events:none;
    }
    .nyt-spin-overlay.on { display:flex; }
    .nyt-spin-overlay .nyt-mini-spin {
      width:16px; height:16px; border-color:#fff; border-top-color:transparent;
    }
    /* 既存の大きなローダーを小さく */
    .loader-spinner-wrap, #home-loader, #search-loader { transform:scale(0.7); transform-origin:center; }
    .spinner-ring { width:24px !important; height:24px !important; border-width:3px !important; }
    @keyframes nyt-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(css);
  // 右下グローバルスピナー
  const overlay = document.createElement('div');
  overlay.className = 'nyt-spin-overlay';
  overlay.innerHTML = '<div class="nyt-mini-spin"></div>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
  setTimeout(() => { if (!overlay.parentNode) document.body.appendChild(overlay); }, 500);
  /* ---------- fetch 中はグローバルスピナー & 死活トラッキング ---------- */
  const STATS_KEY = 'inv_instance_stats_v1';
  function loadStats(){ try { return JSON.parse(localStorage.getItem(STATS_KEY)||'{}'); } catch(_){ return {}; } }
  function saveStats(s){ try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch(_){} }
  let _activeFetches = 0;
  function bump(d){ _activeFetches = Math.max(0, _activeFetches + d); if (overlay) overlay.classList.toggle('on', _activeFetches>0); }
  // CORSプロキシ ローテーション
  const PROXIES = window.__CORS_PROXIES || [
    (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + u,
    (u) => 'https://proxy.cors.sh/' + u,
    (u) => 'https://cors.eu.org/' + u,
    (u) => 'https://yacdn.org/serve/' + u,
  ];
  window.__CORS_PROXIES = PROXIES;
  let _proxyIdx = 0;
  function nextProxy(u){ const fn = PROXIES[_proxyIdx % PROXIES.length]; _proxyIdx++; return fn(u); }
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    bump(+1);
    // 元のホスト抽出
    let host = null;
    try {
      const m = url.match(/https?:\/\/([^\/]+)/);
      if (m) host = m[1];
      const mm = url.match(/[?&](?:url|quest|q)=([^&]+)/);
      if (mm) { try { const inner = decodeURIComponent(mm[1]); const m2 = inner.match(/https?:\/\/([^\/]+)/); if (m2) host = m2[1]; } catch(_){} }
    } catch(_){}
    const isApi = host && (
      (window.INVIDIOUS_INSTANCES||[]).some(i => i.includes(host)) ||
      (window.PIPED_INSTANCES||[]).some(i => i.includes(host)) ||
      /min-pro/.test(host)
    );
    const stats = loadStats();
    const record = (ok) => {
      if (!host) return;
      const h = 'https://'+host.replace(/^https?:\/\//,'');
      const c = stats[h] || { ok:0, fail:0, lastOk:0, lastFail:0 };
      if (ok) { c.ok++; c.lastOk = Date.now(); }
      else { c.fail++; c.lastFail = Date.now(); }
      if (c.ok + c.fail > 200) { c.ok = Math.round(c.ok/2); c.fail = Math.round(c.fail/2); }
      stats[h] = c; saveStats(stats);
    };
    try {
      const r = await _origFetch(input, init);
      if (isApi) record(!!(r && r.ok));
      if (r && r.ok) { bump(-1); return r; }
      throw new Error('bad');
    } catch(e) {
      if (isApi) record(false);
      // プロキシをローテーションしてリトライ (GETのみ)
      const method = (init && init.method) || 'GET';
      if (typeof input === 'string' && method.toUpperCase()==='GET' && isApi) {
        for (let i = 0; i < 3; i++) {
          try {
            const proxied = nextProxy(input);
            const r2 = await _origFetch(proxied, init);
            if (r2 && r2.ok) { record(true); bump(-1); return r2; }
          } catch(_){}
        }
      }
      bump(-1);
      throw e;
    }
  };
  /* ---------- 設定 API 死活ダッシュボード拡張 ---------- */
  function hoursSince(ts){
    if (!ts) return null;
    const ms = Date.now() - ts;
    const h = ms / 3600000;
    if (h < 1) return Math.max(1, Math.round(ms/60000)) + '分前';
    if (h < 24) return h.toFixed(1) + '時間前';
    return (h/24).toFixed(1) + '日前';
  }
  const _origRender = window.renderApiDashboard;
  function renderDashboardEnhanced(){
    const el = document.getElementById('nyt-api-dashboard');
    if (!el) return;
    const stats = loadStats();
    // すべての既知ホスト (Inv + Piped + min-pro) を統合
    const known = new Set();
    (window.INVIDIOUS_INSTANCES||[]).forEach(i => known.add(i.replace(/\/$/,'')));
    (window.PIPED_INSTANCES||[]).forEach(i => known.add(i.replace(/\/$/,'')));
    known.add('https://min-pro.duckdns.org');
    Object.keys(stats).forEach(h => known.add(h));
    const rows = [...known].map(host => {
      const s = stats[host] || { ok:0, fail:0, lastOk:0, lastFail:0 };
      const total = s.ok + s.fail;
      const rate = total ? Math.round((s.ok/total)*100) : -1;
      // 死亡判定: 直近の失敗が最後で、最後の成功からも長く経っているか、連続失敗
      const isDead = total >= 3 && (rate < 30 || (s.lastFail > s.lastOk && (Date.now() - s.lastOk) > 1800000));
      const color = isDead ? '#ef4444' : rate >= 80 ? '#22c55e' : rate >= 50 ? '#eab308' : rate >= 0 ? '#f97316' : '#9ca3af';
      const status = isDead ? '🔴 死亡' : rate < 0 ? '⚪ 未計測' : rate >= 80 ? '🟢 正常' : '🟡 不安定';
      const deadFor = isDead ? (hoursSince(s.lastOk || s.lastFail) || '?') : '';
      return { host, ok:s.ok, total, rate, color, status, deadFor, isDead };
    }).sort((a,b) => (a.isDead?1:0) - (b.isDead?1:0) || b.rate - a.rate);
    el.innerHTML = rows.map(r => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border-color);font-size:12px;">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;">${r.host.replace('https://','')}</div>
        <div style="width:90px;text-align:right;color:${r.color};font-weight:600;">${r.status}</div>
        <div style="width:60px;text-align:right;color:${r.color};">${r.rate<0?'--':r.rate+'%'}</div>
        <div style="width:110px;text-align:right;font-size:11px;color:var(--text-secondary);">${r.isDead ? '死亡から '+r.deadFor : (r.ok?'最終OK '+(hoursSince(stats[r.host]?.lastOk)||'-'):'')}</div>
      </div>
    `).join('') || '<div style="padding:12px;color:var(--text-secondary);">データなし</div>';
  }
  window.renderApiDashboard = renderDashboardEnhanced;
  setInterval(() => { if (document.getElementById('nyt-api-dashboard')) renderDashboardEnhanced(); }, 5000);
  /* ---------- 日本人フィルタは home のみに ---------- */
  // 既存の renderResults ラップは全画面に適用されているので、上書きで home 限定に
  const FILT_KEY = 'video_filter_v1';
  function curFilter(){ return localStorage.getItem(FILT_KEY) || 'all'; }
  function isJP(v){ const t = (v && ((v.title||'')+' '+(v.channel||v.author||''))) || ''; return /[\u3040-\u309F\u30A0-\u30FF]/.test(t); }
  // renderResults の前に再ラップ
  function rewrapRender(){
    if (typeof window.renderResults !== 'function') return false;
    if (window.__patchedRR2) return true;
    window.__patchedRR2 = true;
    const orig = window.renderResults;
    window.renderResults = function(videos, append){
      let v = videos || [];
      const isHome = (typeof searchContext !== 'undefined' && searchContext === 'trend') || (document.getElementById('home-grid') && !document.getElementById('view-search')?.classList.contains('active'));
      // 日本人フィルタは home のみ、かつ十分な数のJP動画が取れた場合のみ適用
      if (isHome && curFilter()==='japan') {
        const jp = v.filter(isJP);
        // 完全に消えるのを防ぐ: JPが3件未満なら適用しない
        if (jp.length >= 3) v = jp;
      }
      return orig.call(this, v, append);
    };
    return true;
  }
  if (!rewrapRender()) { const t = setInterval(()=>{ if (rewrapRender()) clearInterval(t); }, 100); setTimeout(()=>clearInterval(t), 15000); }
  /* ---------- ホームを履歴+検索でパーソナライズ ---------- */
  function getHist(){ try { return JSON.parse(localStorage.getItem('history')||'[]'); } catch(_){ return []; } }
  function getSearchHist(){ try { return JSON.parse(localStorage.getItem('search_history')||'[]'); } catch(_){ return []; } }
  function topKeywords(){
    const words = new Map();
    const add = (s, w) => { (s||'').split(/[\s\u3000,、。!?！？\[\]【】「」『』()（）]+/).forEach(t => { if (t.length>=2 && !/^https?$/.test(t)) words.set(t, (words.get(t)||0)+w); }); };
    getHist().slice(0,15).forEach(v => { add(v.title, 3); add(v.channel, 2); });
    getSearchHist().slice(0,10).forEach(q => add(q, 4));
    return [...words.entries()].sort((a,b) => b[1]-a[1]).slice(0,8).map(x => x[0]);
  }
  function scoreVideo(v, kws){
    const text = ((v.title||'')+' '+(v.author||v.channel||'')).toLowerCase();
    let s = 0;
    kws.forEach(k => { if (text.includes(k.toLowerCase())) s += 2; });
    if (v.author && getHist().some(h => h.channel === v.author)) s += 5;
    return s;
  }
  // loadTrend をパーソナライズで再ラップ
  const _origLoadTrendPersonal = window.loadTrend;
  if (typeof _origLoadTrendPersonal === 'function') {
    window.loadTrend = async function(){
      const r = await _origLoadTrendPersonal.apply(this, arguments);
      setTimeout(() => {
        const grid = document.getElementById('home-grid');
        if (!grid) return;
        const kws = topKeywords();
        if (!kws.length) return;
        const cards = Array.from(grid.querySelectorAll('.video-card'));
        cards.forEach(c => {
          const title = (c.querySelector('.video-title')||{}).textContent || '';
          const channel = (c.querySelector('.video-meta-channel')||{}).textContent || '';
          c.__score = scoreVideo({ title, author: channel, channel }, kws);
        });
        cards.sort((a,b) => (b.__score||0) - (a.__score||0));
        cards.forEach(c => grid.appendChild(c));
      }, 800);
      return r;
    };
  }
  /* ---------- Shorts: 下端到達で自動追加読み込み ---------- */
  let _shortsLoading = false;
  let _shortsPage = 1;
  async function loadMoreShorts(){
    if (_shortsLoading) return;
    _shortsLoading = true;
    try {
      _shortsPage++;
      // 既存の fetchShortsForHome や検索で取れた shorts を view-shorts に追加
      const sfp = document.getElementById('shorts-full-page');
      if (!sfp) return;
      const queries = ['#shorts 人気','面白い #shorts','ショート 急上昇','話題 #shorts','#shorts 新着'];
      const q = queries[_shortsPage % queries.length];
      // onrender main を最優先 → Piped → invidious を並列発射（CORS回避のため複数経路）
      const tasks = [];
      const CHOCO_MAIN = [
        'https://choco-inv-main-api.onrender.com',
        'https://choco-inv-main-api-sexg.onrender.com',
        'https://choco-inv-main-api-ev9d.onrender.com',
      ];
      const bf = (typeof buildFetchUrl==='function'?buildFetchUrl:(x=>x));
      const sigOpt = { signal: AbortSignal.timeout(8000) };
      CHOCO_MAIN.forEach(inst => {
        tasks.push(_origFetch(`${inst}/api/v1/search?q=${encodeURIComponent(q)}&page=${_shortsPage}&hl=ja&region=JP`, sigOpt).then(r=>r.ok?r.json():null).catch(()=>null));
        tasks.push(_origFetch(`${inst}/api/v1/popular?region=JP&hl=ja`, sigOpt).then(r=>r.ok?r.json():null).catch(()=>null));
        tasks.push(_origFetch(`${inst}/api/v1/trending?region=JP&type=Default&hl=ja`, sigOpt).then(r=>r.ok?r.json():null).catch(()=>null));
      });
      if (typeof window.fetchPipedSearch === 'function') tasks.push(window.fetchPipedSearch(q, _shortsPage).catch(()=>null));
      const inv = (window.INVIDIOUS_INSTANCES||[]).slice(0,6);
      inv.forEach(inst => tasks.push(_origFetch(bf(`${inst}/api/v1/search?q=${encodeURIComponent(q)}&page=${_shortsPage}&hl=ja&region=JP`), sigOpt).then(r=>r.ok?r.json():null).catch(()=>null)));
      const all = (await Promise.all(tasks)).filter(Array.isArray).flat();
      const seen = new Set(Array.from(sfp.querySelectorAll('[data-vid]')).map(el => el.getAttribute('data-vid')));
      const shorts = all.filter(v => v && v.videoId && !seen.has(v.videoId) && v.lengthSeconds>0 && v.lengthSeconds<=61);
      shorts.slice(0, 12).forEach(v => {
        const div = document.createElement('div');
        div.className = 'shorts-item';
        div.setAttribute('data-vid', v.videoId);
        div.style.cssText = 'height:100vh;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;background:#000;cursor:pointer;';
        div.innerHTML = `<div style="text-align:center;color:#fff;padding:20px;"><img src="https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg" style="max-width:300px;border-radius:12px;"><div style="margin-top:12px;font-size:14px;">${(v.title||'').replace(/</g,'&lt;').slice(0,80)}</div><div style="font-size:12px;opacity:0.7;">${(v.author||'').replace(/</g,'&lt;')}</div></div>`;
        div.onclick = () => { if (typeof window.playVideo==='function') window.playVideo(v.videoId, v.title, v.author||'', (v.authorThumbnails&&v.authorThumbnails[0]?v.authorThumbnails[0].url:'')); };
        sfp.appendChild(div);
      });
    } finally {
      _shortsLoading = false;
    }
  }
  function attachShortsScroll(){
    const sfp = document.getElementById('shorts-full-page');
    if (!sfp || sfp.__patched) return;
    sfp.__patched = true;
    sfp.addEventListener('scroll', () => {
      if (sfp.scrollTop + sfp.clientHeight >= sfp.scrollHeight - 300) loadMoreShorts();
    }, { passive: true });
    // wheel/touch: コンテンツが少なくスクロールできない時の救済
    sfp.addEventListener('wheel', (e) => {
      if (e.deltaY > 0 && sfp.scrollHeight - sfp.clientHeight < 50) loadMoreShorts();
    }, { passive: true });
    let touchStart = 0;
    sfp.addEventListener('touchstart', e => touchStart = e.touches[0].clientY, { passive: true });
    sfp.addEventListener('touchend', e => {
      const dy = touchStart - (e.changedTouches[0]?.clientY||0);
      if (dy > 60 && sfp.scrollHeight - sfp.clientHeight - sfp.scrollTop < 100) loadMoreShorts();
    }, { passive: true });
  }
  setInterval(attachShortsScroll, 1500);
  /* ---------- 動画再生を高速化: video要素に preload=auto + 早期再生 ---------- */
  function speedupVideos(){
    document.querySelectorAll('video').forEach(v => {
      if (v.__speed) return; v.__speed = true;
      try {
        v.preload = 'auto';
        v.setAttribute('playsinline','');
        // canplay で即再生試行
        const tryPlay = () => { try { v.play().catch(()=>{}); } catch(_){} };
        v.addEventListener('loadedmetadata', tryPlay, { once:true });
        v.addEventListener('canplay', tryPlay, { once:true });
      } catch(_){}
    });
  }
  const mo = new MutationObserver(() => speedupVideos());
  mo.observe(document.body, { childList:true, subtree:true });
  setInterval(speedupVideos, 1000);
  /* ---------- 次の動画: 視聴中の動画との関連性で並び替え ---------- */
  function currentVideoMeta(){
    const title = (document.querySelector('#api-title, .video-title-main, #video-title') || {}).textContent || '';
    const channel = (document.querySelector('#api-author, .video-channel-name, #channel-name') || {}).textContent || '';
    return { title, channel };
  }
  function tokenize(s){ return (s||'').toLowerCase().split(/[\s\u3000,、。!?！？\[\]【】「」『』()（）]+/).filter(t => t.length>=2); }
  function relSort(){
    const list = document.querySelector('#recommendations, .recommendations, .next-videos, #related-videos, .related-list');
    if (!list || list.__patchedRel) return;
    list.__patchedRel = true;
    const reorder = () => {
      const meta = currentVideoMeta();
      const tokens = new Set(tokenize(meta.title));
      const cards = Array.from(list.querySelectorAll('.video-card, .rec-card, .video-item'));
      cards.forEach(c => {
        const t = (c.querySelector('.video-title, .rec-title') || {}).textContent || '';
        const ch = (c.querySelector('.video-meta-channel, .rec-channel') || {}).textContent || '';
        let s = 0;
        tokenize(t).forEach(w => { if (tokens.has(w)) s += 2; });
        if (ch && meta.channel && ch.trim() === meta.channel.trim()) s += 10;
        c.__rel = s;
      });
      cards.sort((a,b) => (b.__rel||0) - (a.__rel||0));
      cards.forEach(c => list.appendChild(c));
    };
    setTimeout(reorder, 800);
    setTimeout(reorder, 2500);
  }
  setInterval(relSort, 2000);
  console.log('[仲良しTube patch2] loaded');
})();

/* ============ 仲良しTube 追加修正パッチ ============ */
(function(){
  // --- 7) URL末尾の #gsc.* を自動除去 ---
  function stripGscHash(){
    try {
      const h = location.hash || '';
      if (/(^|[#&])gsc\.(tab|q|sort|page)=/.test(h)) {
        const cleaned = h.replace(/(?:^#|&)gsc\.[^&]*/g, '').replace(/^#&?/, '#').replace(/^#$/, '');
        const url = location.pathname + location.search + cleaned;
        history.replaceState(history.state, '', url);
      }
    } catch(_){}
  }
  window.addEventListener('hashchange', stripGscHash, true);
  setInterval(stripGscHash, 800);
  stripGscHash();
  // --- 3) 成功率を定期更新 ---
  function loadApiStats(){
    try { return JSON.parse(localStorage.getItem('nyt_api_stats')||'{}'); } catch(_) { return {}; }
  }
  function updateSuccessRate(){
    const el = document.getElementById('api-success-rate-value');
    if (!el) return;
    const stats = loadApiStats();
    let ok = 0, total = 0;
    Object.values(stats).forEach(s => { if (s && typeof s.ok === 'number'){ ok += s.ok; total += s.ok + (s.fail||0); } });
    if (total === 0){ el.textContent = '--%'; el.parentElement.title = 'まだ計測データがありません'; return; }
    const rate = Math.round(ok/total*100);
    el.textContent = rate + '%';
    el.style.color = rate >= 80 ? '#22c55e' : rate >= 50 ? '#eab308' : '#ef4444';
    el.parentElement.title = `成功 ${ok} / 試行 ${total}`;
  }
  setInterval(updateSuccessRate, 2500);
  setTimeout(updateSuccessRate, 800);
  // --- 4) 検索しても結果が出ない時のフォールバック（強化版） ---
  // isFetchingが永続的にtrueになるのを防ぐ（CSE未到達ハング対策）
  setInterval(() => {
    try {
      if (window.isFetching) {
        if (!window.__fetchStuckSince) window.__fetchStuckSince = Date.now();
        else if (Date.now() - window.__fetchStuckSince > 8000) {
          window.isFetching = false;
          window.__fetchStuckSince = 0;
        }
      } else { window.__fetchStuckSince = 0; }
    } catch(_){}
  }, 1500);
  // 直接 Invidious + Piped を並列で叩いて検索結果を作る（CSE非依存）
  async function directInvidiousSearch(query){
    // Piped 並列タスク
    const piped = (window.PIPED_INSTANCES || []).slice(0, 6).map(inst => {
      const url = `${inst}/search?q=${encodeURIComponent(query)}&filter=videos`;
      const finalUrl = (typeof buildFetchUrl === 'function') ? buildFetchUrl(url) : url;
      return fetch(finalUrl, { signal: AbortSignal.timeout(5500) })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          const items = (d && (d.items || d.results)) || [];
          return items.map(it => {
            const id = (it.url || it.videoId || '').match(/[a-zA-Z0-9_-]{11}/)?.[0];
            if (!id) return null;
            return {
              id, title: it.title || '', channel: it.uploaderName || it.author || '',
              isShort: it.duration > 0 && it.duration <= 61,
              isLive: !!it.isLive, duration: it.duration || 0,
              published: it.uploadedDate || it.uploaded || '',
              viewCount: it.views || 0,
              authorThumb: it.uploaderAvatar || `https://i.pravatar.cc/72?u=${encodeURIComponent(it.uploaderName||'')}`
            };
          }).filter(Boolean);
        })
        .catch(() => []);
    });
    Promise.allSettled(piped).then(rs => {
      const merged = [];
      const seenP = new Set();
      rs.forEach(r => { if (r.status==='fulfilled' && Array.isArray(r.value)) r.value.forEach(v => { if (!seenP.has(v.id)) { seenP.add(v.id); merged.push(v);} }); });
      if (merged.length && window.__needSearchInject) {
        try {
          if (typeof seenVideoIds !== 'undefined' && seenVideoIds && seenVideoIds.clear) seenVideoIds.clear();
          window.searchContext = 'search';
          if (typeof window.renderResults === 'function') window.renderResults(merged, false);
          window.__needSearchInject = false;
          const loader = document.getElementById('search-loader');
          if (loader) loader.classList.add('hidden');
        } catch(_){}
      }
    });
    window.__needSearchInject = true;
    const insts = (typeof getInvidiousFor === 'function')
      ? getInvidiousFor('search')
      : (window.INVIDIOUS_INSTANCES || [
          'https://invidious.f5.si','https://yt.omada.cafe','https://inv.nadeko.net',
          'https://invidious.privacyredirect.com','https://invidious.materialio.us'
        ]);
    const seen = new Set();
    const out = [];
    const tasks = insts.slice(0, 8).map(inst => {
      const url = `${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video&hl=ja&region=JP`;
      const finalUrl = (typeof buildFetchUrl === 'function') ? buildFetchUrl(url) : url;
      return fetch(finalUrl, { signal: AbortSignal.timeout(5500) })
        .then(r => r.ok ? r.json() : null)
        .then(arr => {
          if (!Array.isArray(arr)) return;
          for (const item of arr){
            if (item && item.type === 'video' && item.videoId && !seen.has(item.videoId)){
              seen.add(item.videoId);
              out.push({
                id: item.videoId,
                title: item.title || '',
                channel: item.author || '',
                isShort: item.lengthSeconds > 0 && item.lengthSeconds <= 61,
                isLive: !!item.liveNow,
                duration: item.lengthSeconds || 0,
                published: item.publishedText || '',
                viewCount: item.viewCount || 0,
                authorThumb: (item.authorThumbnails && item.authorThumbnails[0]) ? item.authorThumbnails[0].url : `https://i.pravatar.cc/72?u=${encodeURIComponent(item.author||'')}`
              });
            }
          }
        })
        .catch(() => null);
    });
    await Promise.allSettled(tasks);
    return out;
  }
  let _retryToken = 0;
  function watchSearchResults(query){
    const myTok = ++_retryToken;
    let tries = 0;
    const tick = async () => {
      if (myTok !== _retryToken) return;
      const grid = document.getElementById('search-results-list');
      const have = grid ? grid.querySelectorAll('.video-card,.video-item,.search-result-item').length : 0;
      if (have > 0) {
        const loader = document.getElementById('search-loader');
        if (loader) loader.classList.add('hidden');
        return;
      }
      tries++;
      if (tries > 6) {
        const loader = document.getElementById('search-loader');
        if (loader) { const t = loader.querySelector('.loader-text'); if (t) t.textContent = '結果が見つかりません'; }
        return;
      }
      window.isFetching = false;
      // 1) 直接 Invidious 並列検索
      try {
        const videos = await directInvidiousSearch(query);
        if (videos.length > 0 && typeof window.renderResults === 'function'){
          if (typeof seenVideoIds !== 'undefined' && seenVideoIds && seenVideoIds.clear) seenVideoIds.clear();
          window.searchContext = 'search';
          window.renderResults(videos, false);
          const loader = document.getElementById('search-loader');
          if (loader) loader.classList.add('hidden');
          return;
        }
      } catch(_){}
      // 2) クエリ変形で triggerSearch を再実行
      try {
        const variants = [query, query+' 動画', query+' YouTube', query.replace(/\s+/g,'')+' #shorts', query.split(/\s+/)[0]];
        const q2 = variants[tries % variants.length] || query;
        if (typeof window.triggerSearch === 'function') window.triggerSearch(q2, 'search');
      } catch(_){}
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 1500);
  }
  const _origHS = window.handleSearch;
  if (typeof _origHS === 'function'){
    window.handleSearch = function(e, externalQuery){
      window.isFetching = false; // 前回ハング解除
      const r = _origHS.apply(this, arguments);
      const q = externalQuery || (document.getElementById('search-input')||{}).value;
      if (q) watchSearchResults(q);
      return r;
    };
  }
  // --- 5) どのデバイスでもShortsを表示 ---
  function ensureShortsVisible(){
    const sec = document.getElementById('home-shorts');
    const cont = document.getElementById('home-shorts-container');
    if (!sec || !cont) return;
    const hasItems = cont.querySelectorAll('.home-short-card').length > 0;
    if (hasItems) sec.classList.remove('hidden');
    else if (typeof fetchShortsForHome === 'function'){
      try { fetchShortsForHome(); } catch(_){}
    }
  }
  setTimeout(ensureShortsVisible, 3500);
  setTimeout(ensureShortsVisible, 8000);
  setTimeout(ensureShortsVisible, 15000);
  // ホームに戻る／リサイズ時にも再チェック
  window.addEventListener('resize', () => setTimeout(ensureShortsVisible, 200));
  // --- 6) 関連動画を確実に表示 ---
  function ensureRelated(){
    const wrap = document.getElementById('related-videos');
    const loader = document.getElementById('related-loader');
    if (!wrap) return;
    const have = wrap.querySelectorAll('.related-video').length;
    if (have > 0){ loader && loader.classList.add('hidden'); return; }
    if (!window.currentVideoTitle) return;
    try {
      window.isFetching = false;
      const q = (window.currentVideoTitle||'').substring(0, 20) || (window.currentChannelName||'人気');
      if (typeof window.triggerSearch === 'function') window.triggerSearch(q, 'related');
    } catch(_){}
  }
  const _origPV = window.playVideo;
  if (typeof _origPV === 'function'){
    window.playVideo = function(){
      const r = _origPV.apply(this, arguments);
      [2500, 6000, 12000].forEach(t => setTimeout(ensureRelated, t));
      return r;
    };
  }
})();

