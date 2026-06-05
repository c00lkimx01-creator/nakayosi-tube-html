// =================== APIフェッチ ===================
async function fetchFromInvidious(query, context, page = 1) {
  let q = query; if (context === 'shorts') q += ' #shorts';
  const role = (context === 'shorts') ? 'shorts'
             : (context === 'trend')  ? 'trend'
             : (context === 'search') ? 'search'
             : 'search';
  // 検索の信頼性を最大化するため、役割プールではなく全インスタンスを使用
  const pool = (context === 'search') ? INVIDIOUS_INSTANCES.slice() : getInvidiousFor(role);
  const path = `/api/v1/search?q=${encodeURIComponent(q)}&page=${page}&hl=ja&region=JP`;
  const CORS_FALLBACKS = [
    (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + u,
  ];
  const tryUrl = (url, timeout = 5000) => fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then(r => { if (!r.ok) throw new Error('bad'); return r.json(); })
    .then(d => { if (!d || (Array.isArray(d) && d.length === 0)) throw new Error('empty'); return d; });
  // ラウンド1: 直接アクセスを全インスタンスでレース
  const direct = pool.map(inst => tryUrl(buildFetchUrl(`${inst}${path}`), 4500));
  try { return await Promise.any(direct); } catch(e) {}
  // ラウンド2: CORSプロキシ経由で再レース（直接失敗時のフォールバック）
  const proxied = [];
  for (const inst of pool.slice(0, 10)) {
    for (const wrap of CORS_FALLBACKS) {
      proxied.push(tryUrl(wrap(`${inst}${path}`), 6500));
    }
  }
  try { return await Promise.any(proxied); } catch(e) { return null; }
}
function _pickBestChannel(list, target) {
  if (!Array.isArray(list)) return null;
  const channels = list.filter(c => c && c.type === 'channel' && c.authorId);
  if (channels.length === 0) return null;
  const norm = s => (s||'').toLowerCase().replace(/[\s\u3000@\-_]/g,'');
  const t = norm(target);
  if (!t) return channels[0];
  // 1) 完全一致
  let m = channels.find(c => norm(c.author) === t);
  if (m) return m;
  // 2) ハンドル一致
  m = channels.find(c => norm(c.authorId) === t || (c.authorHandle && norm(c.authorHandle) === t));
  if (m) return m;
  // 3) 部分一致（登録者数が多い順）
  const partial = channels.filter(c => {
    const n = norm(c.author);
    return n.includes(t) || t.includes(n);
  }).sort((a,b) => (b.subCount||0) - (a.subCount||0));
  if (partial.length) return partial[0];
  // 4) 登録者数が一番多いチャンネル
  return channels.slice().sort((a,b) => (b.subCount||0) - (a.subCount||0))[0];
}
async function fetchChannelInfoFromInvidious(channelName) {
  let foundChannel = null;
  // Step1: identify channel via search across instances
  for (let instance of INVIDIOUS_INSTANCES) {
    try {
      const searchUrl = buildFetchUrl(`${instance}/api/v1/search?q=${encodeURIComponent(channelName)}&type=channel&page=1`);
      const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(3500) });
      if (!sRes.ok) continue;
      const sData = await sRes.json();
      const channel = _pickBestChannel(sData, channelName);
      if (channel && channel.authorId) { foundChannel = channel; break; }
    } catch(e) {}
  }
  if (!foundChannel) return null;
  // Step2: fetch detailed info (banner/description) — try ALL instances until one returns banners
  let bestDetail = null;
  for (let instance of INVIDIOUS_INSTANCES) {
    try {
      const detailUrl = buildFetchUrl(`${instance}/api/v1/channels/${foundChannel.authorId}`);
      const dRes = await fetch(detailUrl, { signal: AbortSignal.timeout(3500) });
      if (!dRes.ok) continue;
      const detail = await dRes.json();
      if (!bestDetail) bestDetail = detail;
      if (detail.authorBanners && detail.authorBanners.length > 0) { bestDetail = detail; break; }
    } catch(e) {}
  }
  return { ...foundChannel, ...(bestDetail||{}), authorId: foundChannel.authorId };
}
// Search channels by query (returns multiple channel objects)
async function searchChannelsFromInvidious(query, limit = 3) {
  for (let instance of INVIDIOUS_INSTANCES) {
    try {
      const url = buildFetchUrl(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=channel&page=1`);
      const r = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!r.ok) continue;
      const data = await r.json();
      const channels = (data || []).filter(c => c.type === 'channel').slice(0, limit);
      if (channels.length > 0) return channels;
    } catch(e) {}
  }
  return [];
}
async function fetchChannelLiveVideos(channelName, knownChannelId = null) {
  let channelId = knownChannelId || null, channelInfo = null;
  if (!channelId) {
    for (let instance of INVIDIOUS_INSTANCES) {
      try {
        const searchUrl = buildFetchUrl(`${instance}/api/v1/search?q=${encodeURIComponent(channelName)}&type=channel&page=1`);
        const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
        if (!sRes.ok) continue;
        const sData = await sRes.json();
        const channel = _pickBestChannel(sData, channelName);
        if (channel) { channelId = channel.authorId; channelInfo = channel; break; }
      } catch(e) {}
    }
  }
  if (!channelId) return { videos: [], channelInfo: null };
  const allVideos = [];
  for (let instance of INVIDIOUS_INSTANCES) {
    try {
      const streamsUrl = buildFetchUrl(`${instance}/api/v1/channels/${channelId}/streams`);
      const res = await fetch(streamsUrl, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      const videos = data.videos || data || [];
      if (Array.isArray(videos) && videos.length > 0) { videos.forEach(v => { if (v.videoId && !allVideos.find(x => x.videoId === v.videoId)) allVideos.push({ ...v, _sourceType: 'stream' }); }); break; }
    } catch(e) {}
  }
  return { videos: allVideos, channelInfo };
}
async function fetchChannelVideos(channelName, page = 1, knownChannelId = null) {
  // IDが既知の場合は検索スキップ、直接動画取得
  if (knownChannelId) {
    for (let instance of INVIDIOUS_INSTANCES) {
      try {
        const videosUrl = buildFetchUrl(`${instance}/api/v1/channels/${knownChannelId}/videos?page=${page}`);
        const vRes = await fetch(videosUrl, { signal: AbortSignal.timeout(4000) });
        if (!vRes.ok) continue;
        const vData = await vRes.json();
        return { videos: vData.videos || [], channelInfo: null };
      } catch(e) {}
    }
    return null;
  }
  for (let instance of INVIDIOUS_INSTANCES) {
    try {
      const searchUrl = buildFetchUrl(`${instance}/api/v1/search?q=${encodeURIComponent(channelName)}&type=channel&page=1`);
      const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
      if (!sRes.ok) continue;
      const sData = await sRes.json();
      const channel = _pickBestChannel(sData, channelName);
      if (!channel) continue;
      const videosUrl = buildFetchUrl(`${instance}/api/v1/channels/${channel.authorId}/videos?page=${page}`);
      const vRes = await fetch(videosUrl, { signal: AbortSignal.timeout(4000) });
      if (!vRes.ok) continue;
      const vData = await vRes.json();
      return { videos: vData.videos || [], channelInfo: channel };
    } catch(e) {}
  }
  return null;
}
async function fetchChannelShortsMultiPage(channelName, startPage = 1, knownChannelId = null) {
  let channelId = knownChannelId || null;
  if (!channelId) {
    for (let instance of INVIDIOUS_INSTANCES) {
      try {
        const searchUrl = buildFetchUrl(`${instance}/api/v1/search?q=${encodeURIComponent(channelName)}&type=channel&page=1`);
        const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
        if (!sRes.ok) continue;
        const sData = await sRes.json();
        const channel = _pickBestChannel(sData, channelName);
        if (channel) { channelId = channel.authorId; break; }
      } catch(e) {}
    }
  }
  if (!channelId) return { shorts: [], hasMore: false };
  const pagesToFetch = [startPage, startPage+1, startPage+2];
  const allVideos = [];
  for (const page of pagesToFetch) {
    for (let instance of INVIDIOUS_INSTANCES) {
      try {
        const videosUrl = buildFetchUrl(`${instance}/api/v1/channels/${channelId}/videos?page=${page}`);
        const vRes = await fetch(videosUrl, { signal: AbortSignal.timeout(4000) });
        if (!vRes.ok) continue;
        const vData = await vRes.json();
        if (vData.videos && vData.videos.length > 0) { allVideos.push(...vData.videos); break; }
      } catch(e) {}
    }
  }
  const shorts = allVideos.filter(v => v.lengthSeconds > 0 && v.lengthSeconds <= 61).map(v => ({ id: v.videoId, title: v.title, channel: v.author || channelName, isShort: true, authorThumb: v.authorThumbnails ? v.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(v.author||channelName)}`, duration: v.lengthSeconds, published: v.publishedText||'', viewCount: v.viewCount||0 }));
  return { shorts, hasMore: allVideos.length >= 20 };
}
// =================== CSE ===================
window.__gcse = {
  parsetags: 'explicit',
  initializationCallback: function() {
    google.search.cse.element.render({ div: "hidden-cse-container", tag: 'searchresults-only', gname: 'studyCse' });
    initApp();
    const config = getAppConfig();
    if (!config.isFirstVisit && config.trend) loadTrend();
    else if (!config.isFirstVisit && !config.trend) document.getElementById('home-loader').classList.add('hidden');
  },
  searchCallbacks: {
    web: {
      ready: function(name, q, promos, results) {
        isFetching = false; clearTimeout(captchaTimer);
        document.getElementById('hidden-cse-container').style.display = 'none';
        let videos = [];
        if (results && results.length > 0) {
          results.forEach(r => {
            const urlStr = r.unescapedUrl || r.url || "", titleStr = r.titleNoFormatting || r.title || "";
            const isShort = urlStr.includes('/shorts/') || titleStr.toLowerCase().includes('#shorts');
            const id = (urlStr.match(/(?:v=|vi\/|youtu\.be\/|embed\/|v%3D|video\/|shorts\/)([a-zA-Z0-9_-]{11})/) || [])[1];
            if (searchContext === 'shorts' && !isShort && !urlStr.includes('shorts')) return;
            if (id && id.length === 11 && !seenVideoIds.has(id)) {
              seenVideoIds.add(id);
              const mockChannel = (r.visibleUrl||"YouTube Channel").split('/')[0];
              videos.push({ id, title: titleStr, isShort, channel: mockChannel, authorThumb: `https://i.pravatar.cc/150?u=${mockChannel}` });
            }
          });
        }
        renderResults(videos, currentPage > 1);
        if (searchContext === 'trend' && currentPage <= 1) { fetchShortsForHome(); loadRecommendations(); }
        return true;
      }
    }
  }
};
async function triggerSearch(query, context, append = false) {
  if (isFetching) return; isFetching = true; searchContext = context; lastQuery = query;
  if (!append) { seenVideoIds.clear(); currentPage = 1; } else { currentPage++; }
  if (context === 'channel-home' || context === 'channel-videos') {
    isFetching = false;
    const _chTok = (typeof _openChannelToken !== 'undefined') ? _openChannelToken : 0;
    const _knownId = (typeof currentChannelId !== 'undefined') ? currentChannelId : null;
    const result = await fetchChannelVideos(query, currentPage, _knownId);
    if (_chTok !== _openChannelToken) return; // 別チャンネルに移動済み
    if (result && result.videos && result.videos.length > 0) {
      let videos = result.videos.map(v => ({ id: v.videoId, title: v.title, channel: v.author || query, isShort: false, authorThumb: v.authorThumbnails ? v.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(v.author||query)}`, duration: v.lengthSeconds||0, published: v.publishedText||'', viewCount: v.viewCount||0, isLive: v.liveNow||false, isArchived: !v.liveNow && v.lengthSeconds > 0 && (v.title && (v.title.includes('ライブ')||v.title.includes('配信')||v.title.includes('LIVE'))), publishedTimestamp: v.published||0 }));
      renderResults(videos, append);
      if (result.channelInfo && !append) updateChannelHeaderInfo(result.channelInfo);
      return;
    }
    const invData = await fetchFromInvidious(query, context, currentPage);
    if (_chTok !== _openChannelToken) return; // 別チャンネルに移動済み
    if (invData && invData.length > 0) {
      let videos = [];
      invData.forEach(item => {
        if (item.type === 'video' && item.videoId && !seenVideoIds.has(item.videoId)) {
          const authorNorm = (item.author||'').toLowerCase().trim(), queryNorm = query.toLowerCase().trim();
          if (!authorNorm.includes(queryNorm) && !queryNorm.includes(authorNorm)) return;
          seenVideoIds.add(item.videoId);
          videos.push({ id: item.videoId, title: item.title, channel: item.author||query, isShort: false, isLive: item.liveNow||false, isArchived: !item.liveNow && (item.title && (item.title.includes('ライブ')||item.title.includes('配信')||item.title.includes('LIVE'))), authorThumb: item.authorThumbnails ? item.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(item.author||query)}`, duration: item.lengthSeconds||0, published: item.publishedText||'', viewCount: item.viewCount||0, publishedTimestamp: item.published||0 });
        }
      });
      renderResults(videos, append); return;
    }
    // 両APIとも空: ローダーを消して空状態を表示
    document.getElementById('channel-loader')?.classList.add('hidden');
    if (context === 'channel-home') {
      if (typeof renderChannelHomeRow === 'function') renderChannelHomeRow([]);
    }
    return;
  }
  if (context === 'channel-shorts') {
    const cleanName = query.replace(/\s*shorts\s*/gi,'').replace(/#/g,'').trim();
    currentChannelShortsName = cleanName; isFetching = false;
    const _chTok = (typeof _openChannelToken !== 'undefined') ? _openChannelToken : 0;
    const _knownId = (typeof currentChannelId !== 'undefined') ? currentChannelId : null;
    const { shorts, hasMore } = await fetchChannelShortsMultiPage(cleanName, currentChannelShortsPage, _knownId);
    if (_chTok !== _openChannelToken) return; // 別チャンネルに移動済み
    // ユーザー要求: そのチャンネル本人が投稿したShortのみ表示する。
    // 他チャンネルが混ざる検索フォールバックは行わない。
    if (shorts.length > 0) {
      // 二重に著者名でフィルタして安全側に倒す
      const filtered = shorts.filter(s => {
        const a = (s.channel || '').toLowerCase().trim();
        const c = (cleanName || '').toLowerCase().trim();
        return !a || !c || a.includes(c) || c.includes(a);
      });
      renderChannelShorts(filtered, append);
      const moreBtn = document.getElementById('channel-shorts-more-btn');
      if (moreBtn) moreBtn.style.display = hasMore ? 'block' : 'none';
    } else {
      document.getElementById('channel-shorts-loader')?.classList.add('hidden');
      const grid = document.getElementById('channel-shorts-grid');
      if (grid && !append) grid.innerHTML = '<div style="padding:24px;color:var(--text-secondary);">このチャンネルのショート動画は見つかりませんでした</div>';
    }
    return;
  }
  if (context === 'channel-live') {
    const chName = query.replace(/ ライブ$/, '').trim(); isFetching = false;
    const _chTok = (typeof _openChannelToken !== 'undefined') ? _openChannelToken : 0;
    const _knownId = (typeof currentChannelId !== 'undefined') ? currentChannelId : null;
    const { videos: liveVideos, channelInfo } = await fetchChannelLiveVideos(chName, _knownId);
    if (_chTok !== _openChannelToken) return; // 別チャンネルに移動済み
    if (liveVideos && liveVideos.length > 0) {
      const mapped = liveVideos.map(v => ({ id: v.videoId, title: v.title||'', channel: v.author||chName, isShort: false, isLive: !!(v.liveNow||v.isUpcoming), isUpcoming: !!v.isUpcoming, isArchived: !v.liveNow && !v.isUpcoming, authorThumb: v.authorThumbnails ? v.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(v.author||chName)}`, duration: v.lengthSeconds||0, published: v.publishedText||'', viewCount: v.viewCount||0, publishedTimestamp: v.published||0 }));
      renderChannelLive(mapped, append);
      if (channelInfo && !append) updateChannelHeaderInfo(channelInfo);
    } else {
      const result = await fetchChannelVideos(chName, 1, _knownId);
      if (_chTok !== _openChannelToken) return; // 別チャンネルに移動済み
      if (result && result.videos) {
        const liveFiltered = result.videos.filter(v => v.liveNow || v.isUpcoming || (v.title && v.title.match(/ライブ|配信|LIVE|live|生放送|STREAM/i)));
        const mapped = (liveFiltered.length > 0 ? liveFiltered : result.videos.slice(0,12)).map(v => ({ id: v.videoId, title: v.title, channel: v.author||chName, isShort: false, isLive: !!(v.liveNow||v.isUpcoming), isUpcoming: !!v.isUpcoming, isArchived: !v.liveNow && !v.isUpcoming && (v.title && !!v.title.match(/ライブ|配信|LIVE|live|生放送/i)), authorThumb: v.authorThumbnails ? v.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(v.author||chName)}`, duration: v.lengthSeconds||0, published: v.publishedText||'', viewCount: v.viewCount||0, publishedTimestamp: v.published||0 }));
        renderChannelLive(mapped, append);
      } else {
        document.getElementById('channel-live-loader')?.classList.add('hidden');
        document.getElementById('channel-live-grid').innerHTML = '<div class="subs-empty">ライブ・配信動画が見つかりません</div>';
      }
    }
    return;
  }
  const invData = await fetchFromInvidious(query, context, currentPage);
  if (invData && invData.length > 0) {
    isFetching = false; let videos = [];
    invData.forEach(item => {
      if (item.type === 'video' && item.videoId && !seenVideoIds.has(item.videoId)) {
        if (context === 'shorts' && item.lengthSeconds > 61) return;
        // ホーム(trend)ではShortsを除外
        if (context === 'trend' && item.lengthSeconds > 0 && item.lengthSeconds <= 61) return;
        if (context === 'trend' && (item.title||'').toLowerCase().includes('#shorts')) return;
        // ホーム(trend)では投稿日が1年以内の動画のみ表示
        if (context === 'trend' && !_isWithinOneYear(item)) return;
        seenVideoIds.add(item.videoId);
        videos.push({ id: item.videoId, title: item.title, channel: item.author, isShort: item.lengthSeconds > 0 && item.lengthSeconds <= 61, isLive: item.liveNow||false, authorThumb: item.authorThumbnails ? item.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${item.author}`, duration: item.lengthSeconds||0, published: item.publishedText||'', viewCount: item.viewCount||0 });
      }
    });
    renderResults(videos, append);
    if (context === 'search' && !append) { fetchShortsForSearch(query); searchChannelsFromInvidious(query, 3).then(renderSearchChannels); }
    if (context === 'trend' && !append) { fetchShortsForHome(); loadRecommendations(); }
    return;
  }
  // 検索コンテキストではCSEキャプチャを使わず、空結果メッセージを表示する
  isFetching = false;
  if (context === 'search') {
    const container = document.getElementById('search-results-list');
    if (container && !append) {
      container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:14px;">検索結果が取得できませんでした。少し時間をおいて再度お試しください。</div>';
    }
    document.getElementById('search-loader')?.classList.add('hidden');
    // バックグラウンドで関連チャンネル取得は継続
    if (!append) searchChannelsFromInvidious(query, 3).then(renderSearchChannels).catch(()=>{});
    return;
  }
  // 検索以外（trend等）は従来通りCSEフォールバック
  clearTimeout(captchaTimer);
  captchaTimer = setTimeout(() => {
    if (isFetching) {
      const c = document.getElementById('hidden-cse-container');
      c.style.display = 'block'; c.style.position = 'fixed'; c.style.top = '100px'; c.style.left = '50%'; c.style.transform = 'translateX(-50%)'; c.style.zIndex = '10000';
    }
  }, 3000);
  try {
    const element = google.search.cse.element.getElement('studyCse');
    const decor = append ? ["", " pv", " hd"][Math.floor(Math.random()*3)] : "";
    element.execute(query + decor + " site:youtube.com");
  } catch(e) { isFetching = false; }
}
async function loadMoreChannelShorts() {
  currentChannelShortsPage += 3;
  document.getElementById('channel-shorts-more-btn').style.display = 'none';
  document.getElementById('channel-shorts-loader').classList.remove('hidden');
  const _knownId = (typeof currentChannelId !== 'undefined') ? currentChannelId : null;
  const { shorts, hasMore } = await fetchChannelShortsMultiPage(currentChannelShortsName, currentChannelShortsPage, _knownId);
  renderChannelShorts(shorts, true);
  const moreBtn = document.getElementById('channel-shorts-more-btn');
  if (moreBtn) moreBtn.style.display = hasMore && shorts.length > 0 ? 'block' : 'none';
}
function updateChannelHeaderInfo(channelInfo) {
  if (!channelInfo) return;
  const nameEl = document.getElementById('channel-page-name'), handleEl = document.getElementById('channel-page-handle'), metaEl = document.getElementById('channel-page-meta'), iconEl = document.getElementById('channel-page-icon'), descEl = document.getElementById('channel-page-desc');
  if (channelInfo.author) nameEl.innerText = channelInfo.author;
  if (channelInfo.authorId) { handleEl.innerText = `@${channelInfo.authorId}`; currentChannelId = channelInfo.authorId; try { history.replaceState({ view: 'channel', channelId: channelInfo.authorId }, '', `#/@${channelInfo.authorId}`); } catch(e) {} }
  if (channelInfo.subCount) metaEl.innerText = `登録者数 ${formatSubCount(channelInfo.subCount)} • 動画 ${channelInfo.videoCount||'--'}件`;
  else if (channelInfo.videoCount) metaEl.innerText = `動画 ${channelInfo.videoCount}件`;
  if (descEl && channelInfo.description) descEl.innerText = channelInfo.description;
  if (channelInfo.authorThumbnails && channelInfo.authorThumbnails.length > 0) iconEl.src = channelInfo.authorThumbnails[channelInfo.authorThumbnails.length-1].url;
  if (channelInfo.authorBanners && channelInfo.authorBanners.length > 0) {
    const bestBanner = channelInfo.authorBanners.reduce((best, b) => (!best || (b.width || 0) > (best.width || 0)) ? b : best, null);
    if (bestBanner && bestBanner.url) drawChannelBanner(bestBanner.url);
  } else { drawChannelBanner(null); }
  updateChannelSubscribeUI(nameEl.innerText);
}
function formatSubCount(n) {
  if (!n) return '--';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'万人';
  if (n >= 10000) return Math.floor(n/10000)+'万人';
  if (n >= 1000) return (n/1000).toFixed(1)+'K人';
  return n+'人';
}
function drawChannelBanner(bannerUrl) {
  const img = document.getElementById('channel-banner-img'), canvas = document.getElementById('channel-banner-canvas');
  if (bannerUrl) { img.src = bannerUrl; img.style.display = 'block'; canvas.style.display = 'none'; }
  else { img.style.display = 'none'; canvas.style.display = 'block'; drawFallbackBanner(canvas); }
}
function drawFallbackBanner(canvas) {
  canvas.width = canvas.offsetWidth || 1280; canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const colors = [['#ff0000','#ff6b6b'],['#4285f4','#34a853'],['#ff6d00','#ffab00'],['#7c4dff','#e040fb'],['#00bcd4','#009688'],['#e91e63','#ff5722'],['#1a237e','#283593']];
  const c = colors[Math.floor(Math.random()*colors.length)];
  const grad = ctx.createLinearGradient(0,0,canvas.width,canvas.height);
  grad.addColorStop(0,c[0]); grad.addColorStop(1,c[1]);
  ctx.fillStyle = grad; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalAlpha = 0.15; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(canvas.width*0.8,canvas.height*0.3,120,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(canvas.width*0.2,canvas.height*0.9,80,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
}
function hScroll(containerId, dir) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const amount = Math.max(240, el.clientWidth * 0.8);
  el.scrollBy({ left: amount * dir, behavior: 'smooth' });
}
function renderShortCardsTo(container, shorts) {
  container.innerHTML = '';
  shorts.forEach(v => {
    const div = document.createElement('div'); div.className = 'home-short-card';
    div.onclick = () => navigateToShortPage(v.videoId, v.title, v.author, v.authorThumbnails?.[0]?.url);
    div.innerHTML = `<div class="home-short-thumb"><img src="https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg'"></div><div class="home-short-title">${v.title||''}</div>`;
    container.appendChild(div);
  });
}
async function fetchShortsForHome() {
  const container = document.getElementById('home-shorts-container'), section = document.getElementById('home-shorts');
  const container2 = document.getElementById('home-shorts2-container'), section2 = document.getElementById('home-shorts2');
  if (!container || !section) return;
  // 並列で複数クエリ。最初の応答が来た瞬間に即描画(高速化)
  const queries = ["人気 #shorts","#shorts 人気","ショート 人気","shorts popular japan","おすすめ #shorts","面白い #shorts","話題 #shorts","#shorts 急上昇","新着 #shorts","バズ #shorts","かわいい #shorts","公式 #shorts"];
  const seen = new Set();
  let shorts = [];
  let firstShown = false;
  const FIRST_LIMIT = 36, SECOND_LIMIT = 36;
  const tasks = queries.map(q => fetchFromInvidious(q,"shorts",1).then(data => {
    if (!data || !data.length) return;
    for (const v of data) {
      if (!v.videoId || seen.has(v.videoId)) continue;
      if (v.lengthSeconds < 0 || (v.lengthSeconds > 65 && !v.isShort)) continue;
      if (!_isWithinOneYear(v)) continue;
      seen.add(v.videoId); shorts.push(v);
    }
    if (!firstShown && shorts.length >= 1) {
      firstShown = true;
      renderShortCardsTo(container, shorts.slice(0, FIRST_LIMIT));
      section.classList.remove('hidden');
    } else if (firstShown) {
      renderShortCardsTo(container, shorts.slice(0, FIRST_LIMIT));
      if (container2 && section2 && shorts.length > FIRST_LIMIT) {
        renderShortCardsTo(container2, shorts.slice(FIRST_LIMIT, FIRST_LIMIT + SECOND_LIMIT));
        section2.classList.remove('hidden');
      }
    }
  }).catch(() => null));
  await Promise.all(tasks);
  if (shorts.length === 0) return;
  if (!firstShown) { renderShortCardsTo(container, shorts.slice(0, FIRST_LIMIT)); section.classList.remove('hidden'); }
  if (container2 && section2 && shorts.length > FIRST_LIMIT) {
    renderShortCardsTo(container2, shorts.slice(FIRST_LIMIT, FIRST_LIMIT + SECOND_LIMIT));
    section2.classList.remove('hidden');
  }
  // 横スクロール動画行を追加で取得
  fetchHomeRowVideos();
}
async function fetchHomeRowVideos() {
  const wrap = document.getElementById('home-row-videos');
  const scroll = document.getElementById('home-row-videos-scroll');
  if (!wrap || !scroll) return;
  const queries = ["急上昇 日本","話題","おすすめ 動画"];
  let vids = [];
  for (const q of queries) {
    const data = await fetchFromInvidious(q, "trend", 1);
    if (data && data.length > 0) {
      vids = data.filter(v => v.type === 'video' && v.videoId && (v.lengthSeconds||0) > 65 && _isWithinOneYear(v)).slice(0, 12);
      if (vids.length > 0) break;
    }
  }
  if (vids.length === 0) return;
  scroll.innerHTML = '';
  vids.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.style.cursor = 'pointer';
    const ch = v.author || '';
    const authorId = v.authorId || '';
    let avatar = (v.authorThumbnails && v.authorThumbnails.length)
      ? (v.authorThumbnails.find(t=>t.width>=48) || v.authorThumbnails[v.authorThumbnails.length-1]).url
      : `https://i.pravatar.cc/88?u=${encodeURIComponent(ch)}`;
    if (avatar && avatar.startsWith('//')) avatar = 'https:' + avatar;
    card.onclick = () => playVideo(v.videoId, v.title||'', ch, avatar);
    card.innerHTML = `
      <div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000;margin-bottom:10px;">
        <img src="https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
      </div>
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <img src="${avatar}" onclick="event.stopPropagation();openChannel('${ch.replace(/'/g,"\\'")}','${avatar}')" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;cursor:pointer;background:var(--hover-color);" loading="lazy" onerror="this.src='https://i.pravatar.cc/72?u=${encodeURIComponent(ch)}'">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${v.title||''}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;cursor:pointer;" onclick="event.stopPropagation();openChannel('${ch.replace(/'/g,"\\'")}','${avatar}')">${ch}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${v.viewCountText || (v.viewCount ? v.viewCount.toLocaleString()+'回視聴':'')}${v.publishedText ? ' • '+v.publishedText : ''}</div>
        </div>
      </div>
    `;
    scroll.appendChild(card);
  });
  wrap.classList.remove('hidden');
}
async function fetchShortsForSearch(query) {
  const data = await fetchFromInvidious(query + ' #shorts',"shorts",1);
  if (data && data.length > 0) {
    const shorts = data.filter(v => v.videoId && v.lengthSeconds > 0 && v.lengthSeconds <= 61).slice(0,8);
    if (shorts.length === 0) return;
    const container = document.getElementById('search-shorts-container');
    container.innerHTML = '';
    shorts.forEach(v => {
      const div = document.createElement('div'); div.className = 'home-short-card';
      div.onclick = () => navigateToShortPage(v.videoId, v.title, v.author, v.authorThumbnails?.[0]?.url);
      div.innerHTML = `<div class="home-short-thumb"><img src="https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg" loading="lazy" decoding="async"></div><div class="home-short-title">${v.title}</div>`;
      container.appendChild(div);
    });
    document.getElementById('search-shorts-section').classList.remove('hidden');
  }
}
function navigateToShortPage(videoId, title, channel, thumb, noHistory = false) {
  navigate('shorts', { videoId, title, channel, thumb, noHistory });
  setTimeout(() => {
    const container = document.getElementById('shorts-container');
    container.innerHTML = ''; currentShortItems = [];
    initShortObserver();
    const targetVideo = { id: videoId, title: title||'', channel: channel||'', authorThumb: thumb || `https://i.pravatar.cc/80?u=${videoId}`, isShort: true };
    renderShorts([targetVideo], false);
    triggerSearch(((typeof lastQuery!=="undefined"&&lastQuery)?lastQuery:"人気")+" #shorts",'shorts',true);
  }, 100);
}
