// ============ 追加機能: API成功率トラッキング / API優先順位 / 日本語動画フィルター / 読み込みリトライ ============
(function(){
  // --- ストレージキー ---
  const STATS_KEY = 'nyt_api_stats_v1';
  const PRIO_KEY  = 'nyt_api_priority_v1';
  const FILT_KEY  = 'nyt_video_filter_v1'; // 'all' | 'new'
  const TIER_KEY  = 'nyt_api_tier_v1';     // ['inv','piped','min']
  // --- API stats: ホスト名ごとの success/fail を記録 ---
  function loadStats(){ try { return JSON.parse(localStorage.getItem(STATS_KEY)||'{}'); } catch(e){ return {}; } }
  function saveStats(s){ try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch(e){} }
  window._apiStats = loadStats();
  function hostOf(url){ try { return new URL(url, location.href).host; } catch(e){ return ''; } }
  function recordApi(host, ok){
    if (!host) return;
    const s = window._apiStats;
    s[host] = s[host] || { ok: 0, fail: 0 };
    if (ok) s[host].ok++; else s[host].fail++;
    saveStats(s);
  }
  // fetch をラップして Invidious / 既知APIへの呼び出しを統計
  const KNOWN_HOSTS_RE = /(invidious|nadeko|yewtu|yt\.|iv\.|yawtu|funami|f5\.si|omada|min-pro|siawaseok|wista-thumb|duckdns)/i;
  const _origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    let urlStr = '';
    try { urlStr = (typeof input === 'string') ? input : (input && input.url) || ''; } catch(e){}
    // CORSプロキシ経由の場合は内側のターゲットURLを取り出す
    let target = urlStr;
    const m = urlStr.match(/[?&]?(?:url=)?(https?%3A%2F%2F[^&]+)/i) || urlStr.match(/(https?:\/\/[^\s?]+)/i);
    if (m && /(corsproxy|allorigins|codetabs|cors\.)/i.test(urlStr)) {
      try { target = decodeURIComponent(m[1]); } catch(e){}
    }
    const host = hostOf(target);
    const track = host && KNOWN_HOSTS_RE.test(host);
    const p = _origFetch(input, init);
    if (!track) return p;
    return p.then(r => { recordApi(host, !!(r && r.ok)); return r; })
            .catch(e => { recordApi(host, false); throw e; });
  };
  // --- API優先順位: ユーザー設定で先頭に来るインスタンスを変更 ---
  function loadPriority(){ try { return JSON.parse(localStorage.getItem(PRIO_KEY)||'[]'); } catch(e){ return []; } }
  function savePriority(p){ try { localStorage.setItem(PRIO_KEY, JSON.stringify(p)); } catch(e){} }
  function applyPriority(list){
    const prio = loadPriority();
    if (!prio.length) return list;
    const set = new Set(list);
    const head = prio.filter(x => set.has(x));
    const rest = list.filter(x => !head.includes(x));
    return [...head, ...rest];
  }
  // getInvidiousFor をラップ
  if (typeof window.getInvidiousFor === 'function') {
    const _orig = window.getInvidiousFor;
    window.getInvidiousFor = function(role){ return applyPriority(_orig(role)); };
  }
  // --- 動画フィルター (すべて / 新着) ---
  function getFilter(){ return localStorage.getItem(FILT_KEY) || 'all'; }
  function setFilter(v){ try { localStorage.setItem(FILT_KEY, v); } catch(e){} }
  window.isNewVideo = function(v){
    if (!v) return false;
    const ts = v.publishedTimestamp || v.published || 0;
    if (ts && ts > 1000000000) {
      const nowSec = Date.now()/1000;
      return (nowSec - ts) <= 30*86400; // 30日以内
    }
    const txt = String(v.publishedText || v.published || '');
    if (/(\d+)\s*年前|years?\s*ago/i.test(txt)) return false;
    if (/(\d+)\s*[ヶか]月前|months?\s*ago/i.test(txt)) {
      const n = parseInt(RegExp.$1||'0'); return n <= 1;
    }
    if (/分前|時間前|日前|週間前|minutes?\s*ago|hours?\s*ago|days?\s*ago|weeks?\s*ago/i.test(txt)) return true;
    return false;
  };
  // --- API階層優先度 (inv / piped / min) ---
  const DEFAULT_TIER = ['inv','piped','min'];
  function loadTier(){
    try { const a = JSON.parse(localStorage.getItem(TIER_KEY)||'null'); if (Array.isArray(a) && a.length===3) return a; } catch(e){}
    return DEFAULT_TIER.slice();
  }
  function saveTier(a){ try { localStorage.setItem(TIER_KEY, JSON.stringify(a)); } catch(e){} }
  window.getApiTierOrder = loadTier;
  // renderResults をさらにラップ
  const wrapRender = () => {
    if (typeof window.renderResults !== 'function') return false;
    const orig = window.renderResults;
    window.renderResults = function(videos, append){
      let v = videos || [];
      if (getFilter() === 'new') v = v.filter(window.isNewVideo);
      return orig(v, append);
    };
    return true;
  };
  if (!wrapRender()) { const t = setInterval(()=>{ if (wrapRender()) clearInterval(t); }, 80); setTimeout(()=>clearInterval(t), 10000); }
  // --- 高速ホーム読込: 到着順に即描画 + 動画が出るまでリトライ ---
  function mapInvVideo(v){
    return {
      id: v.videoId,
      title: v.title,
      channel: v.author,
      isShort: false,
      isLive: v.liveNow||false,
      authorThumb: v.authorThumbnails && v.authorThumbnails[0] ? v.authorThumbnails[0].url : ('https://i.pravatar.cc/150?u='+encodeURIComponent(v.author||'')),
      duration: v.lengthSeconds||0,
      published: v.publishedText||'',
      viewCount: v.viewCount||0,
      publishedTimestamp: v.published||0
    };
  }
  let _homeLoadToken = 0;
  let _retryTimer = null;
  async function streamHome(token, targetCount){
    targetCount = targetCount || 24;
    // 最速インスタンスの計測を最大 2.5 秒だけ待ってから取得開始
    try {
      if (typeof refreshFastInvidious === 'function') {
        await Promise.race([
          refreshFastInvidious(false),
          new Promise(r => setTimeout(r, 2500))
        ]);
      }
    } catch(_) {}
    if (token !== _homeLoadToken) return 0;
    const pool = (typeof getInvidiousFor === 'function')
      ? getInvidiousFor('trend')
      : ((window.INVIDIOUS_INSTANCES||[]).slice());
    const paths = [
      '/api/v1/trending?region=JP&hl=ja',
      '/api/v1/popular?region=JP&hl=ja',
      '/api/v1/trending?region=JP&type=Default&hl=ja',
      '/api/v1/trending?region=JP&type=Music&hl=ja',
      '/api/v1/trending?region=JP&type=Gaming&hl=ja',
      '/api/v1/popular?hl=ja',
    ];
    const seen = new Set();
    const buffer = [];
    let firstShown = false;
    const grid = document.getElementById('home-grid');
    const loader = document.getElementById('home-loader');
    if (grid) grid.innerHTML = '';
    try { if (typeof seenVideoIds !== 'undefined') seenVideoIds.clear(); } catch(e){}
    if (typeof searchContext !== 'undefined') searchContext = 'trend';
    const tryFetch = (inst, path) => {
      const url = (typeof buildFetchUrl === 'function' ? buildFetchUrl(inst+path) : inst+path);
      return fetch(url, { signal: AbortSignal.timeout(7000) })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (token !== _homeLoadToken) return; // キャンセル
          if (!Array.isArray(d)) return;
          const fresh = [];
          for (const v of d){
            if (!v || !v.videoId || seen.has(v.videoId)) continue;
            if (v.lengthSeconds > 0 && v.lengthSeconds <= 61) continue; // Shorts除外
            if (window.isInvalidChannel && window.isInvalidChannel(v.author)) continue;
            seen.add(v.videoId);
            buffer.push(v);
            fresh.push(v);
          }
          if (fresh.length && grid) {
            // 到着次第、即追記描画
            const mapped = fresh.map(mapInvVideo);
            if (typeof window.renderResults === 'function') {
              window.renderResults(mapped, firstShown);
            }
            firstShown = true;
            if (loader) loader.classList.add('hidden');
          }
        })
        .catch(() => null);
    };
    // 全instance × 全path を並列発射（キャップ無し：確実に取得するため全部に投げる）
    const tasks = [];
    pool.forEach(inst => paths.forEach(p => tasks.push(tryFetch(inst, p))));
    // Piped trending も並列で叩いて最速取得
    if (typeof window.fetchPipedTrending === 'function') {
      tasks.push((async () => {
        try {
          const arr = await window.fetchPipedTrending();
          if (token !== _homeLoadToken || !Array.isArray(arr)) return;
          const fresh = [];
          for (const v of arr) {
            if (!v || !v.videoId || seen.has(v.videoId)) continue;
            if (v.lengthSeconds > 0 && v.lengthSeconds <= 61) continue;
            if (window.isInvalidChannel && window.isInvalidChannel(v.author)) continue;
            seen.add(v.videoId);
            buffer.push(v);
            fresh.push(v);
          }
          if (fresh.length && grid) {
            const mapped = fresh.map(mapInvVideo);
            if (typeof window.renderResults === 'function') window.renderResults(mapped, firstShown);
            firstShown = true;
            if (loader) loader.classList.add('hidden');
          }
        } catch(_){}
      })());
    }
    await Promise.allSettled(tasks);
    return buffer.length;
  }
  window.loadTrend = async function(){
    const grid = document.getElementById('home-grid');
    const loader = document.getElementById('home-loader');
    if (loader) {
      loader.classList.remove('hidden');
      const txt = loader.querySelector('.loader-text');
      if (txt) txt.textContent = '動画を読み込み中...';
    }
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    const myToken = ++_homeLoadToken;
    let attempt = 0;
    const run = async () => {
      if (myToken !== _homeLoadToken) return;
      attempt++;
      if (loader) {
        const txt = loader.querySelector('.loader-text');
        if (txt) txt.textContent = attempt === 1 ? '動画を読み込み中...' : `動画を読み込み中... (再試行 ${attempt})`;
      }
      // リトライ時は最速インスタンス計測を強制リフレッシュ（前回失敗したサーバを差し替える）
      if (attempt > 1) {
        try { if (typeof refreshFastInvidious === 'function') await refreshFastInvidious(true); } catch(_) {}
      }
      let got = 0;
      try { got = await streamHome(myToken, 24); } catch(e) { console.warn('streamHome', e); }
      if (myToken !== _homeLoadToken) return;
      const cards = grid ? grid.querySelectorAll('.video-card').length : 0;
      const viewHome = document.getElementById('view-home');
      const onHome = viewHome && !viewHome.classList.contains('hidden');
      if (cards === 0 && onHome) {
        // フォールバック: 既存検索API
        try { if (typeof triggerSearch === 'function') triggerSearch('人気 日本','trend'); } catch(e){}
        // それでも描画されなければ短い間隔でリトライ
        _retryTimer = setTimeout(() => {
          if (myToken !== _homeLoadToken) return;
          const c2 = grid ? grid.querySelectorAll('.video-card').length : 0;
          if (c2 === 0) run(); else if (loader) loader.classList.add('hidden');
        }, 1200);
      } else if (loader) loader.classList.add('hidden');
      // ホーム付帯コンテンツ
      try { if (typeof fetchShortsForHome === 'function') fetchShortsForHome(); } catch(e){}
      try { if (typeof loadRecommendations === 'function') loadRecommendations(); } catch(e){}
    };
    run();
  };
  // --- 設定UIを動的に追加 ---
  function injectSettingsUI(){
    const panel = document.querySelector('#view-settings .settings-panel');
    if (!panel || panel.querySelector('#nyt-api-dashboard-section')) return;
    const CARD = 'background:var(--card-bg,var(--bg-color));border:1px solid var(--border-color);border-radius:14px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);';
    const TITLE = 'font-size:16px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px;';
    const DESC = 'font-size:12px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;';
    const PILL_BTN = 'padding:8px 16px;border-radius:999px;background:var(--chip-bg);font-size:13px;font-weight:500;border:1px solid var(--border-color);cursor:pointer;transition:all .15s;';
    // 1) API階層優先度 (inv / piped / min)
    const tierSec = document.createElement('div');
    tierSec.className = 'settings-section';
    tierSec.id = 'nyt-api-tier-section';
    tierSec.style.cssText = CARD;
    tierSec.innerHTML = `
      <div style="${TITLE}">🏆 API優先度（標準）</div>
      <div style="${DESC}">動画を取得する時に試すAPIの順番です。上にあるものから優先的に使います。標準: 上=Invidious / 中=Piped / 下=Min</div>
      <div id="nyt-tier-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      <div style="margin-top:12px;"><button onclick="resetApiTier()" style="${PILL_BTN}">標準に戻す</button></div>
    `;
    panel.appendChild(tierSec);
    // 2) 表示する動画 (すべて / 新着)
    const filtSec = document.createElement('div');
    filtSec.className = 'settings-section';
    filtSec.style.cssText = CARD;
    filtSec.innerHTML = `
      <div style="${TITLE}">🎬 動画の表示</div>
      <div style="${DESC}">「新着」にすると、最近投稿された動画のみ表示します。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;" id="nyt-filter-tabs">
        <button data-val="all" class="nyt-filter-tab" style="${PILL_BTN}">すべて</button>
        <button data-val="new" class="nyt-filter-tab" style="${PILL_BTN}">新着</button>
      </div>
    `;
    panel.appendChild(filtSec);
    const updateFilterTabs = () => {
      const cur = getFilter();
      filtSec.querySelectorAll('.nyt-filter-tab').forEach(b => {
        const active = b.dataset.val === cur;
        b.style.background = active ? 'var(--primary-color,#3b82f6)' : 'var(--chip-bg)';
        b.style.color = active ? '#fff' : 'var(--text-color)';
        b.style.borderColor = active ? 'var(--primary-color,#3b82f6)' : 'var(--border-color)';
      });
    };
    filtSec.querySelectorAll('.nyt-filter-tab').forEach(b => {
      b.onclick = () => {
        setFilter(b.dataset.val);
        updateFilterTabs();
        try { if (typeof loadTrend === 'function') loadTrend(); } catch(e){}
      };
    });
    updateFilterTabs();
    // 3) API成功率ダッシュボード
    const dashSec = document.createElement('div');
    dashSec.className = 'settings-section';
    dashSec.id = 'nyt-api-dashboard-section';
    dashSec.style.cssText = CARD;
    dashSec.innerHTML = `
      <div style="${TITLE}">📊 API成功率</div>
      <div style="${DESC}">各APIサーバーの接続成功率を表示します。</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button onclick="renderApiDashboard()" style="${PILL_BTN}">🔄 更新</button>
        <button onclick="resetApiStats()" style="${PILL_BTN}">🗑️ リセット</button>
      </div>
      <div id="nyt-api-dashboard" style="max-height:280px;overflow-y:auto;font-size:13px;border:1px solid var(--border-color);border-radius:10px;padding:4px 12px;"></div>
    `;
    panel.appendChild(dashSec);
    // 4) Invidiousインスタンス優先順位 (詳細)
    const prioSec = document.createElement('div');
    prioSec.className = 'settings-section';
    prioSec.style.cssText = CARD;
    prioSec.innerHTML = `
      <div style="${TITLE}">⚙️ Invidiousインスタンス順</div>
      <div style="${DESC}">上にあるインスタンスから優先的に試行します。「↑」「↓」で並び替え。</div>
      <div id="nyt-api-priority-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border-color);border-radius:10px;padding:4px 8px;"></div>
      <div style="margin-top:12px;"><button onclick="resetApiPriority()" style="${PILL_BTN}">既定順序に戻す</button></div>
    `;
    panel.appendChild(prioSec);
    renderTierList();
    renderApiDashboard();
    renderApiPriorityList();
  }
  const TIER_LABELS = { inv:'Invidious', piped:'Piped', min:'Min' };
  const TIER_DESC = { inv:'多くのインスタンスがあり安定', piped:'メタ情報が豊富', min:'軽量・補助用' };
  window.renderTierList = function(){
    const el = document.getElementById('nyt-tier-list');
    if (!el) return;
    const order = loadTier();
    const rankLabel = ['🥇 一番上','🥈 中','🥉 下'];
    el.innerHTML = order.map((k, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color);border-radius:10px;background:var(--chip-bg);">
        <span style="font-size:12px;color:var(--text-secondary);min-width:64px;">${rankLabel[i]}</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;">${TIER_LABELS[k]||k}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${TIER_DESC[k]||''}</div>
        </div>
        <button onclick="moveApiTier(${i},-1)" ${i===0?'disabled':''} style="padding:4px 10px;border-radius:8px;background:var(--bg-color);border:1px solid var(--border-color);font-size:13px;cursor:pointer;opacity:${i===0?0.4:1};">↑</button>
        <button onclick="moveApiTier(${i},1)" ${i===order.length-1?'disabled':''} style="padding:4px 10px;border-radius:8px;background:var(--bg-color);border:1px solid var(--border-color);font-size:13px;cursor:pointer;opacity:${i===order.length-1?0.4:1};">↓</button>
      </div>
    `).join('');
  };
  window.moveApiTier = function(idx, dir){
    const arr = loadTier();
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    saveTier(arr);
    renderTierList();
  };
  window.resetApiTier = function(){
    saveTier(DEFAULT_TIER.slice());
    renderTierList();
  };
  window.renderApiDashboard = function(){
    const el = document.getElementById('nyt-api-dashboard');
    if (!el) return;
    const stats = loadStats();
    const rows = Object.entries(stats).map(([host, s]) => {
      const total = s.ok + s.fail;
      const rate = total ? Math.round((s.ok/total)*100) : 0;
      const color = rate >= 80 ? '#22c55e' : rate >= 50 ? '#eab308' : '#ef4444';
      return { host, ok: s.ok, fail: s.fail, total, rate, color };
    }).sort((a,b) => b.total - a.total);
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">まだ統計データがありません。動画を読み込むと記録されます。</div>'; return; }
    el.innerHTML = rows.map(r => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border-color);">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:12px;">${r.host}</div>
        <div style="width:100px;height:6px;background:var(--hover-color);border-radius:3px;overflow:hidden;">
          <div style="width:${r.rate}%;height:100%;background:${r.color};"></div>
        </div>
        <div style="width:48px;text-align:right;font-weight:600;color:${r.color};">${r.rate}%</div>
        <div style="width:80px;text-align:right;font-size:11px;color:var(--text-secondary);">${r.ok}/${r.total}</div>
      </div>
    `).join('');
  };
  window.resetApiStats = function(){
    window._apiStats = {};
    saveStats({});
    renderApiDashboard();
  };
  window.renderApiPriorityList = function(){
    const el = document.getElementById('nyt-api-priority-list');
    if (!el) return;
    const base = (window.INVIDIOUS_INSTANCES || []).slice();
    const ordered = applyPriority(base);
    el.innerHTML = ordered.map((inst, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid var(--border-color);">
        <span style="width:24px;text-align:right;font-size:11px;color:var(--text-secondary);">${i+1}.</span>
        <span style="flex:1;font-family:monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${inst.replace('https://','')}</span>
        <button onclick="moveApiPriority(${i}, -1)" ${i===0?'disabled':''} style="padding:2px 8px;border-radius:6px;background:var(--chip-bg);font-size:12px;opacity:${i===0?0.4:1};">↑</button>
        <button onclick="moveApiPriority(${i}, 1)" ${i===ordered.length-1?'disabled':''} style="padding:2px 8px;border-radius:6px;background:var(--chip-bg);font-size:12px;opacity:${i===ordered.length-1?0.4:1};">↓</button>
      </div>
    `).join('');
  };
  window.moveApiPriority = function(idx, dir){
    const base = (window.INVIDIOUS_INSTANCES || []).slice();
    const ordered = applyPriority(base);
    const j = idx + dir;
    if (j < 0 || j >= ordered.length) return;
    [ordered[idx], ordered[j]] = [ordered[j], ordered[idx]];
    savePriority(ordered);
    renderApiPriorityList();
  };
  window.resetApiPriority = function(){
    savePriority([]);
    renderApiPriorityList();
  };
  // 設定画面が開かれたら注入。navigate をフック
  const _origNav2 = window.navigate;
  if (typeof _origNav2 === 'function') {
    window.navigate = function(viewName){
      const r = _origNav2.apply(this, arguments);
      if (viewName === 'settings') setTimeout(injectSettingsUI, 50);
      return r;
    };
  }
  // 既に設定が開いている可能性に備えて
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectSettingsUI, 500));
})();

// ===== Piped API 統合 + 検索ローダー + 自動再読み込み =====
(function(){
  const PIPED_INSTANCES = (window.PIPED_INSTANCES && window.PIPED_INSTANCES.length)
    ? window.PIPED_INSTANCES
    : [
      // フォールバック。完全なリストは instances/piped.json からロード済み
      'https://pipedapi.kavin.rocks', 'https://pipedapi-libre.kavin.rocks',
      'https://pipedapi.adminforge.de', 'https://pipedapi.r4fo.com',
      'https://piped.video', 'https://piped.privacydev.net',
    ];
  window.PIPED_INSTANCES = PIPED_INSTANCES;
  function pipedIdFromUrl(u){
    if (!u) return null;
    const m = String(u).match(/[?&]v=([A-Za-z0-9_-]{11})/) || String(u).match(/\/watch\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function parsePipedDate(s){
    if (!s) return 0;
    try { const t = Date.parse(s); return isNaN(t) ? 0 : Math.floor(t/1000); } catch(e) { return 0; }
  }
  function mapPipedToInv(it){
    if (!it) return null;
    const id = pipedIdFromUrl(it.url || it.videoId);
    if (!id) return null;
    const author = it.uploaderName || it.uploader || '';
    const thumb = (it.uploaderAvatar) ? [{url: it.uploaderAvatar}] : null;
    return {
      type: 'video',
      videoId: id,
      title: it.title || '',
      author,
      authorId: (it.uploaderUrl||'').replace(/^\/channel\//,''),
      authorThumbnails: thumb,
      lengthSeconds: it.duration || 0,
      viewCount: it.views || 0,
      published: parsePipedDate(it.uploadedDate || it.uploaded),
      publishedText: it.uploadedDate || '',
      liveNow: !!it.isShort ? false : !!it.live,
    };
  }
  function pipedItems(d){
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.items)) return d.items;
    return [];
  }
  async function fetchPipedSearch(query, page){
    const q = encodeURIComponent(query);
    const tasks = PIPED_INSTANCES.slice(0, 6).map(inst => {
      const url = `${inst}/search?q=${q}&filter=videos`;
      return fetch(url, { signal: AbortSignal.timeout(6000) })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => { const arr = pipedItems(d).map(mapPipedToInv).filter(Boolean); if (!arr.length) throw new Error('empty'); return arr; });
    });
    try { return await Promise.any(tasks); } catch(e) { return null; }
  }
  async function fetchPipedTrending(){
    const tasks = PIPED_INSTANCES.slice(0, 6).map(inst => {
      const url = `${inst}/trending?region=JP`;
      return fetch(url, { signal: AbortSignal.timeout(6000) })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => { const arr = pipedItems(d).map(mapPipedToInv).filter(Boolean); if (!arr.length) throw new Error('empty'); return arr; });
    });
    try { return await Promise.any(tasks); } catch(e) { return null; }
  }
  window.fetchPipedSearch = fetchPipedSearch;
  window.fetchPipedTrending = fetchPipedTrending;
  // fetchFromInvidious を Piped と並列レース
  if (typeof window.fetchFromInvidious === 'function') {
    const _origFFI = window.fetchFromInvidious;
    window.fetchFromInvidious = async function(query, context, page){
      // ユーザー要求: 検索結果は Invidious または Min-Pro のみで取得 (Pipedはスキップ)
      if (context === 'search') {
        return await _origFFI(query, context, page).catch(()=>null);
      }
      const invP = _origFFI(query, context, page).catch(()=>null);
      if (context === 'shorts' || context === 'channel-videos' || context === 'channel-home') {
        // Pipedの検索結果は精度が低いので、これらは Invidious 優先
        const r = await invP; if (r && r.length) return r;
        return await fetchPipedSearch(query, page||1);
      }
      const pipedP = (context === 'trend')
        ? fetchPipedTrending().catch(()=>null)
        : fetchPipedSearch(query, page||1).catch(()=>null);
      // 最初に空でない結果を返したほうを採用
      const both = await Promise.allSettled([invP, pipedP]);
      const a = both[0].status==='fulfilled' ? both[0].value : null;
      const b = both[1].status==='fulfilled' ? both[1].value : null;
      if (a && a.length && b && b.length) {
        // マージ（重複ID除去）
        const seen = new Set(); const out = [];
        for (const x of [...a, ...b]) {
          if (!x || !x.videoId || seen.has(x.videoId)) continue;
          seen.add(x.videoId); out.push(x);
        }
        return out;
      }
      return (a && a.length) ? a : ((b && b.length) ? b : null);
    };
  }
  // streamHome に Piped trending を合流
  const _origStreamHome = window.streamHome;
  // streamHome がクロージャ内なので直接置き換え不可。代わりに loadTrend 完了直後に Piped を追記。
  const _origLoadTrend = window.loadTrend;
  if (typeof _origLoadTrend === 'function') {
    window.loadTrend = async function(){
      const grid = document.getElementById('home-grid');
      const loader = document.getElementById('home-loader');
      // Piped trending を即時並走
      fetchPipedTrending().then(items => {
        if (!items || !items.length || !grid) return;
        const seen = new Set();
        grid.querySelectorAll('.video-card').forEach(c => { const id = c.getAttribute('data-vid'); if (id) seen.add(id); });
        const fresh = items.filter(v => v.videoId && !seen.has(v.videoId) && !(v.lengthSeconds>0 && v.lengthSeconds<=61));
        if (fresh.length && typeof window.mapInvVideo === 'function' && typeof window.renderResults === 'function') {
          window.renderResults(fresh.map(window.mapInvVideo), true);
          if (loader) loader.classList.add('hidden');
        }
      }).catch(()=>{});
      return await _origLoadTrend.apply(this, arguments);
    };
  }
  // 検索ローダーをスピナー化
  const sl = document.getElementById('search-loader');
  if (sl) {
    sl.innerHTML = '<div class="loader-spinner-wrap"><div class="spinner-ring"></div><div class="loader-text">読み込み中...</div></div>';
  }
  // handleSearch をフック: 開始時にローダー表示、結果が空ならリトライ
  let _searchWatchToken = 0;
  const _origHandleSearch = window.handleSearch;
  if (typeof _origHandleSearch === 'function') {
    window.handleSearch = function(e, externalQuery){
      const r = _origHandleSearch.apply(this, arguments);
      const grid = document.getElementById('search-results-list');
      const loader = document.getElementById('search-loader');
      if (loader) {
        loader.classList.remove('hidden');
        const t = loader.querySelector('.loader-text');
        if (t) t.textContent = '読み込み中...';
      }
      const q = externalQuery || (document.getElementById('search-input')||{}).value;
      const myTok = ++_searchWatchToken;
      let attempt = 0;
      const watch = () => {
        if (myTok !== _searchWatchToken) return;
        const have = grid ? grid.querySelectorAll('.video-card,.video-item').length : 0;
        if (have > 0) { if (loader) loader.classList.add('hidden'); return; }
        attempt++;
        if (attempt > 8) { if (loader) { const t = loader.querySelector('.loader-text'); if (t) t.textContent = '結果が見つかりません'; } return; }
        if (loader) { const t = loader.querySelector('.loader-text'); if (t) t.textContent = `読み込み中... (再試行 ${attempt})`; }
        try { if (q && typeof window.triggerSearch === 'function') { window.isFetching = false; window.triggerSearch(q, 'search'); } } catch(_){}
        setTimeout(watch, 1500);
      };
      setTimeout(watch, 1500);
      return r;
    };
  }
  // renderResults に data-vid を付与（重複検出用）
  const _origRR = window.renderResults;
  if (typeof _origRR === 'function') {
    window.renderResults = function(videos, append){
      const r = _origRR.apply(this, arguments);
      try {
        const grids = ['home-grid','search-results-list'];
        grids.forEach(id => {
          const g = document.getElementById(id);
          if (!g || !Array.isArray(videos)) return;
          const cards = g.querySelectorAll('.video-card');
          // 後ろから videos.length 個分にIDを刻む
          const start = Math.max(0, cards.length - videos.length);
          for (let i = 0; i < videos.length && (start+i) < cards.length; i++) {
            if (videos[i] && videos[i].id) cards[start+i].setAttribute('data-vid', videos[i].id);
          }
        });
      } catch(_){}
      return r;
    };
  }
})();
<script>
// ===== CORS自動回避: どのドメインでも動画APIにアクセス可能にする =====
(function(){
  // 信頼できるCORS対応プロキシ群（順に試行）
  const PROXIES = [
    (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + u,
    (u) => 'https://proxy.cors.sh/' + u,
    (u) => 'https://cors.eu.org/' + u,
    (u) => 'https://yacdn.org/serve/' + u,
    (u) => 'https://cors-proxy.htmldriven.com/?url=' + encodeURIComponent(u),
  ];
  window.__CORS_PROXIES = PROXIES;
  // 外部API判定（Invidious/Piped/Nadeko 等のYouTube系API）
  function isExternalApi(url){
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) return false;
      // 既にプロキシ経由ならスキップ
      if (/corsproxy\.io|allorigins|codetabs|cors\.sh|cors\.eu\.org|yacdn\.org|htmldriven|aijimy/i.test(u.hostname)) return false;
      // YouTube系API
      return /(invidious|nadeko|yewtu|piped|inv\.|y\.|tube|youtube|ggtyler|projectsegfau|nerdvpn)/i.test(u.hostname);
    } catch(e) { return false; }
  }
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    // 直接試して失敗 or CORS拒否ならプロキシで再試行
    if (!isExternalApi(url) || method.toUpperCase() !== 'GET') {
      return _origFetch(input, init);
    }
    // まず直アクセス
    try {
      const r = await _origFetch(input, init);
      if (r && r.ok) return r;
      // 失敗ステータスでもプロキシでリトライ
      throw new Error('bad-status:'+(r&&r.status));
    } catch(e) {
      // プロキシ順に試す（最大3個まで）
      for (let i = 0; i < Math.min(3, PROXIES.length); i++) {
        try {
          const proxied = PROXIES[i](url);
          const newInit = Object.assign({}, init || {});
          // signalは引き継ぐ
          const r2 = await _origFetch(proxied, newInit);
          if (r2 && r2.ok) return r2;
        } catch(_) { /* 次のプロキシ */ }
      }
      // 全部失敗: 元のエラーで投げ直し
      throw e;
    }
  };
  // 設定の proxy フラグをデフォルトON（保存済みでもONを優先）
  try {
    if (typeof getAppConfig === 'function') {
      const cfg = getAppConfig();
      if (cfg && cfg.proxy === false) {
        cfg.proxy = true;
        if (typeof saveSettings === 'function') saveSettings();
      }
    }
  } catch(_){}
})();

