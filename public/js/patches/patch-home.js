// ============ 追加設定: yt-dlp画質 / 自動再生秒数制限 ============
(function(){
  const _origGet = getAppConfig;
  getAppConfig = function(){
    const c = _origGet();
    if (c.ytdlpQuality === undefined) c.ytdlpQuality = '720p';
    if (c.autoNextLimitEnabled === undefined) c.autoNextLimitEnabled = false;
    if (c.autoNextLimit === undefined) c.autoNextLimit = 600;
    return c;
  };
  window.saveExtraSettings = function(){
    try {
      const c = JSON.parse(localStorage.getItem('study2525_config')||'{}');
      const q = document.getElementById('nav-setting-ytdlp-quality'); if (q) c.ytdlpQuality = q.value;
      const le = document.getElementById('nav-setting-autonext-limit-enabled'); if (le) c.autoNextLimitEnabled = le.checked;
      const lh = document.getElementById('nav-setting-autonext-limit-h');
      const lm = document.getElementById('nav-setting-autonext-limit-m');
      const ls = document.getElementById('nav-setting-autonext-limit-s');
      if (lh || lm || ls) {
        const h = Math.max(0, parseInt(lh?.value)||0);
        const m = Math.max(0, parseInt(lm?.value)||0);
        const s = Math.max(0, parseInt(ls?.value)||0);
        const total = Math.max(10, h*3600 + m*60 + s);
        c.autoNextLimit = total;
        const ln = document.getElementById('nav-setting-autonext-limit'); if (ln) ln.value = total;
      } else {
        const ln = document.getElementById('nav-setting-autonext-limit'); if (ln) c.autoNextLimit = Math.max(10, parseInt(ln.value)||600);
      }
      localStorage.setItem('study2525_config', JSON.stringify(c));
    } catch(e){}
  };
  const _origSync = syncSettings;
  syncSettings = function(config){
    _origSync(config);
    const q = document.getElementById('nav-setting-ytdlp-quality'); if (q && config.ytdlpQuality) q.value = config.ytdlpQuality;
    const le = document.getElementById('nav-setting-autonext-limit-enabled'); if (le) le.checked = !!config.autoNextLimitEnabled;
    const ln = document.getElementById('nav-setting-autonext-limit'); if (ln && config.autoNextLimit) ln.value = config.autoNextLimit;
    const total = Math.max(0, parseInt(config.autoNextLimit)||0);
    const lh = document.getElementById('nav-setting-autonext-limit-h');
    const lm = document.getElementById('nav-setting-autonext-limit-m');
    const ls = document.getElementById('nav-setting-autonext-limit-s');
    if (lh) lh.value = Math.floor(total/3600);
    if (lm) lm.value = Math.floor((total%3600)/60);
    if (ls) ls.value = total%60;
  };
  // 自動再生時に秒数制限を考慮
  const _origPlayNext = window.playNextVideo;
  window.playNextVideo = function(){
    if (!getAppConfig().autoNext) return;
    const cfg = getAppConfig();
    if (cfg.autoNextLimitEnabled) {
      // 先頭の動画長さを確認
      const q = (window._nextVideoQueue || []);
      while (q.length) {
        const n = q[0];
        const dur = parseInt(n.duration||n.lengthSeconds||0);
        if (dur && dur > cfg.autoNextLimit) { q.shift(); continue; }
        break;
      }
    }
    _origPlayNext && _origPlayNext();
  };
  // ストリーム選択パネルのトグル
  window.toggleStreamPanel = function(e){
    if (e) e.stopPropagation();
    const p = document.getElementById('stream-panel'); if (p) p.classList.toggle('open');
  };
  document.addEventListener('click', (e) => {
    const p = document.getElementById('stream-panel');
    if (!p) return;
    if (!e.target.closest('.stream-wrap')) p.classList.remove('open');
  });
  // ホームに遷移したらショート & おすすめを常にロード
  const _origNav = window.navigate;
  if (typeof _origNav === 'function') {
    window.navigate = function(viewName, opts){
      const r = _origNav.apply(this, arguments);
      if (viewName === 'home') {
        setTimeout(() => {
          try { if (typeof fetchShortsForHome === 'function') fetchShortsForHome(); } catch(e){}
          // おすすめ削除済み
        }, 100);
      }
      return r;
    };
  }
})();

// ===== タイムアウト無効化（設定） =====
(function(){
  try {
    const orig = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = function(ms){
      try {
        if (localStorage.getItem('disableTimeout') === '1') {
          // 中断しないシグナル
          return new AbortController().signal;
        }
      } catch(e){}
      return orig(ms);
    };
  } catch(e){}
})();
// タイムアウト無効化: 既定で常時ON
try { if (localStorage.getItem('disableTimeout') !== '0') localStorage.setItem('disableTimeout','1'); } catch(e){}
window.toggleDisableTimeout = function(v){
  try { localStorage.setItem('disableTimeout', v ? '1' : '0'); } catch(e){}
};
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (localStorage.getItem('disableTimeout') == null) localStorage.setItem('disableTimeout','1');
    const cb = document.getElementById('setting-disable-timeout');
    if (cb) cb.checked = localStorage.getItem('disableTimeout') !== '0';
  } catch(e){}
});
// ===== サムネイル高画質化（プロキシ経由） =====
window.THUMB_PROXY = 'https://wista-thumb-01.onrender.com/';
window.getHQThumb = function(id){
  return window.THUMB_PROXY + 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
};
// 画像のエラー時にプロキシ無し→hqdefault→mqdefaultへフォールバック
document.addEventListener('error', function(e){
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  const m = (img.src||'').match(/\/vi\/([a-zA-Z0-9_-]{11})\/(maxresdefault|hqdefault|mqdefault)/);
  if (!m) return;
  const id = m[1], lvl = m[2];
  if (img.dataset.thumbFallback) return; // 連続防止
  if (lvl === 'maxresdefault') {
    img.dataset.thumbFallback = '1';
    img.src = 'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';
  } else if (lvl === 'hqdefault') {
    img.dataset.thumbFallback = '2';
    img.src = 'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg';
  }
}, true);
// ===== チャンネル名に www.youtube.com を含む動画は除外 =====
window.isInvalidChannel = function(name){
  if (!name) return false;
  const n = String(name).toLowerCase();
  return n.includes('www.youtube.com');
};
// ===== サイトアクセス数 =====
(async function(){
  const el = document.getElementById('access-counter-value');
  if (!el) return;
  // ローカル累計 + 外部カウンタの大きい方を表示
  let local = 0;
  try { local = parseInt(localStorage.getItem('siteAccessCount')||'0',10) + 1; localStorage.setItem('siteAccessCount', String(local)); } catch(e){}
  el.textContent = local.toLocaleString();
  try {
    const r = await fetch('https://abacus.jasoncameron.dev/hit/nakayoshitube.app/visits', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j.value === 'number') {
        const max = Math.max(local, j.value);
        el.textContent = max.toLocaleString();
      }
    }
  } catch(e){}
})();
// ===== ホーム用：複数InvidiousインスタンスからトレンドAPIと急上昇APIを並列取得 =====
window.fetchHomeMixed = async function(targetCount){
  targetCount = targetCount || 20;
  const pool = (typeof getInvidiousFor === 'function') ? getInvidiousFor('trend') : (window.INVIDIOUS_INSTANCES||[]).slice(0,14);
  const seen = new Set();
  const results = [];
  const tryFetch = (inst, path) => {
    const url = (typeof buildFetchUrl === 'function' ? buildFetchUrl(inst+path) : inst+path);
    return fetch(url, { signal: AbortSignal.timeout(2500) })
      .then(r => r.ok ? r.json() : null)
      .then(d => Array.isArray(d) ? d : null)
      .catch(() => null);
  };
  const paths = [
    '/api/v1/trending?region=JP&hl=ja',
    '/api/v1/popular?region=JP&hl=ja',
  ];
  // 全instance x 全path を並列発射（多めに撃って速いやつを採用）
  const tasks = [];
  pool.slice(0, 16).forEach(inst => paths.forEach(p => tasks.push(tryFetch(inst, p))));
  // 早く返ったものから処理
  await new Promise(resolve => {
    let remaining = tasks.length;
    let firstDone = false;
    const minCount = Math.min(8, targetCount); // 8件揃ったら即返す
    tasks.forEach(t => t.then(arr => {
      if (Array.isArray(arr)) {
        for (const v of arr) {
          if (!v || !v.videoId || seen.has(v.videoId)) continue;
          if (v.lengthSeconds > 0 && v.lengthSeconds <= 61) continue; // Shorts除外
          if (window.isInvalidChannel(v.author)) continue;
          seen.add(v.videoId);
          results.push(v);
          if (typeof window.__onHomePartial === 'function') { try { window.__onHomePartial(v); } catch(e){} }
          if (results.length >= minCount && !firstDone) { firstDone = true; resolve(); }
        }
      }
      if (--remaining <= 0) resolve();
    }));
    // 安全装置：最大3.5秒で終了
    setTimeout(() => resolve(), 3500);
  });
  return results.slice(0, targetCount);
};
// === チャンネルアイコン後追い取得（ストリーミング描画時のフォールバック） ===
window.__fetchChannelIconFor = (function(){
  const cache = new Map();
  const pending = new Map();
  return async function(videoId, channelName){
    if (!videoId || !channelName) return;
    if (cache.has(channelName)) {
      _applyIcon(videoId, cache.get(channelName));
      return;
    }
    if (pending.has(channelName)) return;
    const p = (async () => {
      const pool = (window.INVIDIOUS_INSTANCES||[]).slice(0,6);
      for (const inst of pool) {
        try {
          const url = (typeof buildFetchUrl === 'function' ? buildFetchUrl : (x=>x))(inst+'/api/v1/search?q='+encodeURIComponent(channelName)+'&type=channel&page=1');
          const r = await fetch(url, { signal: AbortSignal.timeout(3500) });
          if (!r.ok) continue;
          const d = await r.json();
          const ch = (Array.isArray(d) ? d : []).find(x => x && x.type === 'channel');
          if (ch && ch.authorThumbnails && ch.authorThumbnails.length) {
            const t = ch.authorThumbnails[ch.authorThumbnails.length-1].url;
            const icon = t.startsWith('//') ? 'https:'+t : t;
            cache.set(channelName, icon);
            _applyIcon(videoId, icon);
            return;
          }
        } catch(e) {}
      }
    })();
    pending.set(channelName, p);
    p.finally(()=>pending.delete(channelName));
  };
  function _applyIcon(videoId, iconUrl){
    try {
      document.querySelectorAll('.video-card').forEach(card => {
        const img = card.querySelector('.thumbnail-container img');
        if (img && img.src && img.src.indexOf('/vi/'+videoId+'/') !== -1) {
          const av = card.querySelector('.channel-avatar img');
          if (av && (!av.src || av.src.indexOf('pravatar') !== -1)) av.src = iconUrl;
        }
      });
    } catch(e){}
  }
})();
// ===== 新しいloadTrend：高速・重複なし・スピナー表示 =====
window.loadTrend = async function(){
  const grid = document.getElementById('home-grid');
  const loader = document.getElementById('home-loader');
  if (loader) loader.classList.remove('hidden');
  if (grid) grid.innerHTML = '';
  try { if (typeof seenVideoIds !== 'undefined') seenVideoIds.clear(); } catch(e){}
  // 取得できた動画から順に表示（ストリーミング描画）
  const _streamedIds = new Set();
  const _prevPartial = window.__onHomePartial;
  window.__onHomePartial = function(v){
    try {
      if (!v || !v.videoId || _streamedIds.has(v.videoId)) return;
      _streamedIds.add(v.videoId);
      const mapped = [{
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
      }];
      if (typeof searchContext !== 'undefined') searchContext = 'trend';
      if (typeof renderResults === 'function') renderResults(mapped, true);
      if (loader) loader.classList.add('hidden');
      // チャンネルアイコンを正しく取得（authorThumbnails が無い動画用）
      if (!v.authorThumbnails && v.author && typeof window.__fetchChannelIconFor === 'function') {
        window.__fetchChannelIconFor(v.videoId, v.author);
      }
    } catch(e) { console.warn('[homePartial] render err', e); }
  };
  const videos = await window.fetchHomeMixed(22);
  // 復元
  window.__onHomePartial = _prevPartial;
  if (!videos.length) {
    // フォールバック：従来の検索ベースで取得
    try { if (typeof triggerSearch === 'function') triggerSearch('人気 日本','trend'); } catch(e){}
    return;
  }
  const mapped = videos.map(v => ({
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
  }));
  try {
    if (typeof searchContext !== 'undefined') searchContext = 'trend';
    // ストリーミングで既に描画済み。追加分のみ append
    if (typeof renderResults === 'function') {
      const already = _streamedIds;
      const remaining = mapped.filter(m => !already.has(m.id));
      if (remaining.length) renderResults(remaining, true);
    }
    else if (grid && _streamedIds.size === 0) {
      // 直接描画フォールバック
      grid.innerHTML = mapped.map(v => `<div class="video-card" onclick="playVideo('${v.id}','${(v.title||'').replace(/'/g,"\\'")}','${(v.channel||'').replace(/'/g,"\\'")}','${v.authorThumb}')">
        <div class="thumbnail-container"><img src="${window.getHQThumb(v.id)}" loading="lazy"></div>
        <div class="video-info"><div class="video-details"><div class="video-title">${v.title||''}</div><div class="video-meta-channel"><span>${v.channel||''}</span></div></div></div>
      </div>`).join('');
    }
    if (loader) loader.classList.add('hidden');
  } catch(e) { console.error(e); }
  // Shortsとおすすめも継続して読み込む
  try { if (typeof fetchShortsForHome === 'function') fetchShortsForHome(); } catch(e){}
  try { if (typeof loadRecommendations === 'function') loadRecommendations(); } catch(e){}
};
// ===== 検索：min-pro.duckdns.org/api/search を追加 =====
window.fetchExtraSearch = async function(query){
  try {
    const r = await fetch('https://min-pro.duckdns.org/api/search?q='+encodeURIComponent(query), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.results || d.items || d.videos || []);
    return arr.map(v => ({
      type: 'video',
      videoId: v.videoId || v.id || v.video_id,
      title: v.title || v.name,
      author: v.author || v.channel || v.uploader,
      authorThumbnails: v.authorThumbnails || (v.channelThumbnail ? [{url:v.channelThumbnail}] : null),
      lengthSeconds: v.lengthSeconds || v.duration || 0,
      viewCount: v.viewCount || v.views || 0,
      publishedText: v.publishedText || v.published || '',
      published: v.publishedTimestamp || 0,
      liveNow: v.liveNow || false
    })).filter(x => x.videoId && !window.isInvalidChannel(x.author));
  } catch(e) { return []; }
};
// fetchFromInvidiousをラップして、search時に外部APIの結果もマージ
(function(){
  if (typeof window.fetchFromInvidious !== 'function') {
    // 元関数が読み込まれた後にラップ
    const obs = setInterval(() => {
      if (typeof window.fetchFromInvidious === 'function') {
        clearInterval(obs);
        wrap();
      }
    }, 50);
  } else wrap();
  function wrap(){
    const orig = window.fetchFromInvidious;
    window.fetchFromInvidious = async function(query, context, page){
      if (context === 'search') {
        const [inv, extra] = await Promise.all([
          orig(query, context, page).catch(()=>null),
          (page===1?window.fetchExtraSearch(query):Promise.resolve([]))
        ]);
        const out = [];
        const seen = new Set();
        (extra||[]).forEach(v => { if (v.videoId && !seen.has(v.videoId)) { seen.add(v.videoId); out.push(v); } });
        (inv||[]).forEach(v => { if (v && v.videoId && !seen.has(v.videoId)) { seen.add(v.videoId); out.push(v); } });
        return out.length ? out : (inv||null);
      }
      return orig(query, context, page);
    };
  }
})();
// ===== renderResultsをラップ：www.youtube.com含むチャンネルを除外、サムネを高画質に差し替え =====
(function(){
  const apply = () => {
    if (typeof window.renderResults !== 'function') return false;
    const orig = window.renderResults;
    window.renderResults = function(videos, append){
      const filtered = (videos||[]).filter(v => !window.isInvalidChannel(v.channel));
      const ret = orig(filtered, append);
      // 描画後にサムネを差し替え
      try {
        document.querySelectorAll('.video-card .thumbnail-container img, .home-row-scroll img, .recommend-scroll img').forEach(img => {
          const m = (img.src||'').match(/\/vi\/([a-zA-Z0-9_-]{11})\/mqdefault\.jpg/);
          if (m && !img.dataset.hq) { img.dataset.hq='1'; img.src = window.getHQThumb(m[1]); }
        });
      } catch(e){}
      return ret;
    };
    return true;
  };
  if (!apply()) {
    const t = setInterval(() => { if (apply()) clearInterval(t); }, 80);
    setTimeout(() => clearInterval(t), 10000);
  }
})();

