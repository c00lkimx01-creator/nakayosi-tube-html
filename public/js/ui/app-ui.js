}
// =================== 動画再生 ===================
async function playVideo(id, title, channel = "投稿者", thumb = null) {
  currentVideoId = id; currentVideoTitle = title;
  currentChannelName = channel; currentChannelThumb = thumb || `https://i.pravatar.cc/150?u=${channel}`;
  currentGVFormats = null; currentGVAllFormats = null; selectedQuality = null;
  navigate('watch', { videoId: id, title, channel, thumb: thumb||null });
  document.getElementById('watch-title-text').innerText = title;
  document.getElementById('watch-channel-name').innerText = channel;
  const wci = document.getElementById('watch-channel-icon');
  wci.src = currentChannelThumb; wci.onerror = () => wci.src = `https://i.pravatar.cc/150?u=${encodeURIComponent(channel)}`;
  document.getElementById('watch-channel-trigger').onclick = () => openChannel(channel, currentChannelThumb);
  document.getElementById('related-videos').innerHTML = '';
  document.getElementById('api-views').innerText = "---"; document.getElementById('api-likes').innerText = "---";
  document.getElementById('api-date').innerText = ""; document.getElementById('api-desc').innerHTML = "概要欄を読み込んでいます...";
  document.getElementById('quality-wrap').style.display = 'none';
  updateWatchSubscribeUI(channel);
  prefetchYtdlp(id);
  setTimeout(() => switchStream(getAppConfig().stream), 50);
  saveToLocal('history',{id,title,channel,authorThumb: currentChannelThumb, savedAt: Date.now()});
  // 関連動画 / コメント / メタ情報を並列で取得 (役割分担で高速化)
  triggerSearch(title.substring(0,20),'related');
  fetchComments(id);
  fetchVideoApiDetails(id);
  fetchVideoMetaParallel(id, channel);
}
// 複数のInvidiousインスタンスを並列で叩き、最速のメタ情報で UI を補完
async function fetchVideoMetaParallel(videoId, fallbackChannel) {
  const instances = (typeof getInvidiousFor === 'function')
    ? getInvidiousFor('video')
    : (typeof INVIDIOUS_INSTANCES !== 'undefined' && INVIDIOUS_INSTANCES.length
        ? INVIDIOUS_INSTANCES.slice(0, 6)
        : ['https://invidious.f5.si','https://yt.omada.cafe','https://inv.nadeko.net']);
  const tasks = instances.map(inst => fetch(buildFetchUrl(`${inst}/api/v1/videos/${videoId}?fields=title,author,authorId,authorThumbnails,viewCount,likeCount,published,publishedText,description,descriptionHtml&hl=ja&region=JP`),
    { signal: AbortSignal.timeout(3500) })
    .then(r => r.ok ? r.json() : Promise.reject('bad'))
    .then(d => { if (!d || !d.title) throw new Error('empty'); return d; }));
  try {
    const meta = await Promise.any(tasks);
    if (meta.title && document.getElementById('watch-title-text')) {
      const cur = document.getElementById('watch-title-text').innerText;
      if (!cur || cur.length < 5) document.getElementById('watch-title-text').innerText = meta.title;
    }
    if (meta.author && document.getElementById('watch-channel-name')) {
      document.getElementById('watch-channel-name').innerText = meta.author;
      currentChannelName = meta.author;
    }
    if (meta.authorThumbnails && meta.authorThumbnails.length) {
      const t = meta.authorThumbnails[meta.authorThumbnails.length-1].url;
      const wci = document.getElementById('watch-channel-icon');
      if (wci) { wci.src = t; }
      currentChannelThumb = t;
    }
    const v = document.getElementById('api-views'); if (v && meta.viewCount) v.innerText = parseInt(meta.viewCount).toLocaleString();
    const l = document.getElementById('api-likes'); if (l && meta.likeCount) l.innerText = parseInt(meta.likeCount).toLocaleString();
    const dEl = document.getElementById('api-date'); if (dEl && meta.publishedText) dEl.innerText = ` • ${meta.publishedText}`;
    const desc = document.getElementById('api-desc');
    if (desc) {
      const cur = desc.innerHTML || '';
      if (cur.includes('読み込んで') || cur.includes('取得失敗') || cur.length < 8) {
        desc.innerHTML = meta.description ? _linkifyText(meta.description) : '概要はありません。';
      }
    }
    // 履歴も最新メタで上書き保存
    try {
      const list = JSON.parse(localStorage.getItem('history')||'[]');
      const idx = list.findIndex(x => x.id === videoId);
      if (idx >= 0) {
        list[idx].channel = meta.author || list[idx].channel || fallbackChannel;
        list[idx].authorThumb = (meta.authorThumbnails && meta.authorThumbnails.length) ? meta.authorThumbnails[meta.authorThumbnails.length-1].url : list[idx].authorThumb;
        list[idx].viewCount = meta.viewCount || list[idx].viewCount;
        list[idx].published = meta.publishedText || list[idx].published;
        localStorage.setItem('history', JSON.stringify(list));
      }
    } catch(e){}
  } catch(e) { /* 全失敗時は既存の fetchVideoApiDetails の結果を使う */ }
}
function toggleDescription() {
  const desc = document.getElementById('api-desc'); desc.classList.toggle('expanded');
  document.getElementById('desc-toggle-text').innerText = desc.classList.contains('expanded') ? "一部を表示" : "続きを読む";
}
async function fetchVideoApiDetails(videoId) {
  try {
    const res = await fetch(buildFetchUrl(`https://api.aijimy.com/get?code=get-youtube-videodata&text=${videoId}`));
    const t = await res.text();
    const views = (t.match(/再生回数:\s*(\d+)/)||[])[1], likes = (t.match(/高評価数:\s*(\d+)/)||[])[1];
    const date = (t.match(/公開日:\s*(.*?)\s*再生回数:/)||[])[1], des = (t.match(/概要欄:\s*([\s\S]*?)\s*公開日:/)||[])[1];
    document.getElementById('api-views').innerText = views ? parseInt(views).toLocaleString() : "---";
    document.getElementById('api-likes').innerText = likes ? parseInt(likes).toLocaleString() : "---";
    if(date) document.getElementById('api-date').innerText = ` • ${date.trim()}`;
    document.getElementById('api-desc').innerHTML = des ? _linkifyText(des.trim()) : "概要はありません。";
  } catch(e) { document.getElementById('api-desc').innerText = "取得失敗"; }
}
async function fetchKahootKey() {
  try { const res = await fetch(buildFetchUrl(KAHOOT_KEY_URL)); if(res.ok) { const data = await res.json(); return data.key||data.enc||data; } } catch(e) {}
  if(getAppConfig().proxy) for (const proxy of CORS_PROXIES) try { const res = await fetch(proxy + encodeURIComponent(KAHOOT_KEY_URL)); if(res.ok) { const data = await res.json(); return data.key||data.enc||data; } } catch(e) {}
  return null;
}
function buildEduUrl(videoId, enc) {
  const cfg = encodeURIComponent(JSON.stringify({enc: enc, hideTitle: true}));
  return `https://www.youtubeeducation.com/embed/${videoId}?autoplay=1&origin=https%3A%2F%2Fcreate.kahoot.it&embed_config=${cfg}`;
}
// switchStream: 3タイプのみ (type4=m3u8削除)
async function switchStream(type) {
  // パネルUI: ラベルと選択状態更新
  const lbl = document.getElementById('stream-label');
  if (lbl) lbl.textContent = type===1?'Nocookie':type===2?'Edu':'Stream';
  document.querySelectorAll('#stream-panel .stream-option').forEach(o => o.classList.toggle('active', parseInt(o.dataset.s)===type));
  const sp = document.getElementById('stream-panel'); if (sp) sp.classList.remove('open');
  // 設定にも反映（ショートにも適用）
  try {
    const c = JSON.parse(localStorage.getItem('study2525_config')||'{}');
    c.stream = type; c.shortStream = type;
    localStorage.setItem('study2525_config', JSON.stringify(c));
    if (typeof shortStreamType !== 'undefined') shortStreamType = type;
    if (typeof syncSettings === 'function') syncSettings({...c});
  } catch(e){}
  // URLハッシュに再生方法を反映
  try {
    if (currentVideoId) {
      const _sfx = type === 2 ? '&edu' : type === 3 ? '&stream=1' : '&nc';
      const _newHash = `#/watch?v=${currentVideoId}${_sfx}`;
      if (location.hash !== _newHash) history.replaceState(history.state, '', _newHash);
    }
  } catch(e){}
  document.getElementById('quality-wrap').style.display = 'none';
  currentGVFormats = null; currentGVAllFormats = null;
  const wrapper = document.getElementById('player-wrapper');
  if (type === 1) {
    wrapper.innerHTML = '<iframe id="yt-player" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    await new Promise(r => setTimeout(r, 0));
    const iframe = document.getElementById('yt-player');
    if (iframe) {
      let url = `https://www.youtube-nocookie.com/embed/${currentVideoId}?autoplay=1&rel=0&start=0`;
      if (watchLoopEnabled) url += `&loop=1&playlist=${currentVideoId}`;
      iframe.src = url;
    }
  } else if (type === 2) {
    wrapper.innerHTML = '<iframe id="yt-player" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    const key = await fetchKahootKey();
    if(key) {
      await new Promise(r => setTimeout(r, 0));
      const iframe = document.getElementById('yt-player');
      if (iframe) iframe.src = buildEduUrl(currentVideoId, key);
      setTimeout(applyWatchLoop, 50);
    } else { alert("Edu準備中"); switchStream(1); }
  } else if (type === 3) {
    // Manifest Hunter
    await setupWatchManifest(currentVideoId);
    setTimeout(applyWatchLoop, 50);
  }
}
function renderRelatedVideos(videos, append = false) {
  const container = document.getElementById('related-videos');
  const html = videos.map(v => {
    const isLive = v.isLive || (v.title && (v.title.includes('ライブ')||v.title.includes('LIVE')));
    const isArchived = v.isArchived||false;
    const ch = (v.channel||'').replace(/'/g,"\\'");
    const t = (v.title||'').replace(/'/g,"\\'");
    const thumb = v.authorThumb || `https://i.pravatar.cc/72?u=${encodeURIComponent(v.channel||'')}`;
    const dur = (typeof formatDuration === 'function') ? formatDuration(v.duration) : '';
    const meta = [v.viewCount ? formatViews(v.viewCount) : '', v.published || ''].filter(Boolean).join(' • ');
    return `<div class="related-video" onclick="playVideo('${v.id}','${t}','${ch}','${thumb}')">
      <div class="related-thumb">
        <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy">
        ${isLive ? '<span class="live-thumb-badge">🔴</span>' : isArchived ? '<span class="archived-badge">配信済</span>' : (dur ? `<span class="duration-badge">${dur}</span>` : '')}
      </div>
      <div class="related-info">
        <div class="related-title">${v.title||''}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer;" onclick="event.stopPropagation();openChannel('${ch}','${thumb}')">
          <img src="${thumb}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;background:var(--hover-color);" loading="lazy" onerror="this.src='https://i.pravatar.cc/40?u=${encodeURIComponent(v.channel||'')}'">
          <span style="font-size:12px;color:var(--text-secondary);">${v.channel||''}</span>
        </div>
        ${meta ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${meta}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  if (append) container.insertAdjacentHTML('beforeend', html); else container.innerHTML = html;
  document.getElementById('related-loader').classList.add('hidden');
}
// =================== ナビゲーション ===================
function navigate(viewName, opts = {}) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`)?.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  if(document.getElementById(`nav-${viewName}`)) document.getElementById(`nav-${viewName}`).classList.add('active');
  const showCats = ['home','search','history','subscriptions'].includes(viewName);
  document.getElementById('categories-bar').style.display = showCats ? 'flex' : 'none';
  if (viewName === 'shorts') {
    document.getElementById('main-content').style.padding = '0';
    document.getElementById('main-content').style.marginTop = '56px';
  } else {
    document.getElementById('main-content').style.padding = '24px';
    document.getElementById('main-content').style.marginTop = showCats ? '112px' : '56px';
  }
  currentView = viewName;
  // 動画再生中はメニュー(サイドバー)を完全に隠す
  document.body.classList.toggle('is-watching', viewName === 'watch');
/* override: watch時にサイドバーを強制クローズしない */
  if (viewName !== 'watch') {
    const wrapper = document.getElementById('player-wrapper');
    if(wrapper) wrapper.innerHTML = '<iframe id="yt-player" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    currentGVFormats = null; currentGVAllFormats = null;
  }
  if (viewName !== 'shorts') {
    document.querySelectorAll('#shorts-container .short-snap-item').forEach(item => {
      const iframe = item.querySelector('iframe'); if (iframe) iframe.src = 'about:blank';
      item.querySelectorAll('video, audio').forEach(el => { el.pause(); el.src = ''; });
    });
    if (shortObserver) { shortObserver.disconnect(); shortObserver = null; }
  }
  if (viewName === 'shorts' && document.getElementById('shorts-container').children.length === 0) {
    document.getElementById('shorts-loader').classList.remove('hidden');
    Object.keys(shortSrcMap).forEach(k => delete shortSrcMap[k]);
    shortStreamType = getAppConfig().shortStream || 1;
    triggerSearch(((typeof lastQuery!=="undefined"&&lastQuery)?lastQuery:"人気")+" #shorts",'shorts');
  }
  if (viewName === 'history') renderLocalList('history');
  if (viewName === 'settings') { renderSettingsSubsList(); syncSettings(getAppConfig()); }
  if (viewName === 'subscriptions') renderSubscriptionsPage();
  window.scrollTo(0, 0);
/* override: navigate末尾の自動クローズ削除 */
  if (!opts.noHistory) {
    let hash = '#/';
    if (viewName === 'home') hash = '#/home';
    else if (viewName === 'history') hash = '#/feed/history';
    else if (viewName === 'settings') hash = '#/setting';
    else if (viewName === 'subscriptions') hash = '#/feed/subscriptions';
    else if (viewName === 'playlists') hash = '#/playlists';
    else if (viewName === 'search') hash = lastQuery ? `#/search?v=${encodeURIComponent(lastQuery)}` : '#/search';
    else if (viewName === 'channel') hash = currentChannelId ? `#/@${currentChannelId}` : '#/channel';
    else if (viewName === 'welcome') hash = '#/';
    else if (viewName === 'watch' && opts.videoId) {
      let _sfx = '';
      try {
        const _s = (JSON.parse(localStorage.getItem('study2525_config')||'{}')).stream;
        if (_s === 2) _sfx = '&edu';
        else if (_s === 3) _sfx = '&stream=1';
        else _sfx = '&nc';
      } catch(e) { _sfx = '&nc'; }
      hash = `#/watch?v=${opts.videoId}${_sfx}`;
    }
    else if (viewName === 'shorts' && opts.videoId) hash = `#/shorts/${opts.videoId}`;
    else if (viewName === 'shorts') hash = '#/shorts';
    try { history.pushState({ view: viewName, ...opts }, '', hash); } catch(e) {}
  }
}
window.addEventListener('popstate', (e) => {
  if (!e.state) { navigate('home', { noHistory: true }); return; }
  const { view, videoId, title, channel, thumb, query, channelId, channelName } = e.state;
  if (view === 'watch' && videoId) playVideo(videoId, title||'', channel||'', thumb||null, true);
  else if (view === 'shorts' && videoId) navigateToShortPage(videoId, title, channel, thumb, true);
  else if (view === 'channel') {
    if (channelName) openChannel(channelName, null);
    else navigate('channel', { noHistory: true });
  }
  else if (view === 'search') {
    const searchQ = query || new URLSearchParams(location.search).get('v') || new URLSearchParams(location.search).get('q') || '';
    if (searchQ) {
      document.getElementById('search-input').value = searchQ;
      navigate('search', { noHistory: true });
      triggerSearch(searchQ, 'search');
    } else navigate('search', { noHistory: true });
  }
  else if (view) navigate(view, { noHistory: true });
});
function parseInitialUrl() {
  // ハッシュベースルーティングを優先
  let path = location.hash && location.hash.startsWith('#/') ? location.hash.slice(1) : (location.pathname + location.search);
  if(!path) path = '/';
  const watchMatch = path.match(/\/watch\?v=([a-zA-Z0-9_-]{11})(?:&(edu|nc|ytdlp|stream=1|stream))?/);
  const shortsMatch = path.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  // 新仕様: /#/search?v=keyword (旧 ?q= も後方互換)
  const searchMatchV = path.match(/\/search\?v=(.+)/);
  const searchMatchQ = path.match(/\/search\?q=(.+)/);
  // 新仕様: /#/@channelId (旧 /channel/id も後方互換)
  const channelAtMatch = path.match(/\/@([a-zA-Z0-9_@.-]+)/);
  const channelMatch = path.match(/\/channel\/([a-zA-Z0-9_@-]+)/);
  if (watchMatch) return { view: 'watch', videoId: watchMatch[1], streamMode: watchMatch[2] || null };
  if (shortsMatch) return { view: 'shorts', videoId: shortsMatch[1] };
  if (searchMatchV) return { view: 'search', query: decodeURIComponent(searchMatchV[1]) };
  if (searchMatchQ) return { view: 'search', query: decodeURIComponent(searchMatchQ[1]) };
  if (channelAtMatch) return { view: 'channel', channelId: channelAtMatch[1] };
  if (channelMatch) return { view: 'channel', channelId: channelMatch[1] };
  if (path === '/feed/history') return { view: 'history' };
  if (path === '/setting' || path === '/settings') return { view: 'settings' };
  if (path === '/feed/subscriptions') return { view: 'subscriptions' };
  if (path === '/home' || path === '/') return { view: 'home' };
  return null;
}
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('main-content').classList.toggle('sidebar-open');
}
function saveToLocal(key, video) {
  let list = JSON.parse(localStorage.getItem(key) || '[]');
  list = list.filter(v => v.id !== video.id); list.unshift(video);
  localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
}
function renderLocalList(type) {
  const items = JSON.parse(localStorage.getItem(type)||'[]');
  const grid = document.getElementById(`${type}-grid`);
  if (!grid) return;
  grid.innerHTML = items.map(v => {
    const ch = (v.channel || '').replace(/'/g,"\\'");
    const t = (v.title || '').replace(/'/g,"\\'");
    const thumb = v.authorThumb || `https://i.pravatar.cc/88?u=${encodeURIComponent(v.channel||v.id)}`;
    const meta = [v.viewCount ? formatViews(v.viewCount) : '', v.published || ''].filter(Boolean).join(' • ');
    return `<div class="video-card" onclick="playVideo('${v.id}','${t}','${ch||'YouTube Channel'}','${thumb}')">
      <div class="thumbnail-container"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy"></div>
      <div class="video-info">
        <div class="channel-avatar" onclick="event.stopPropagation();openChannel('${ch||''}','${thumb}')"><img src="${thumb}" loading="lazy" onerror="this.src='https://i.pravatar.cc/88?u=${encodeURIComponent(v.channel||v.id)}'"></div>
        <div class="video-details">
          <div class="video-title">${v.title||''}</div>
          ${v.channel ? `<div class="video-meta-channel" style="cursor:pointer;" onclick="event.stopPropagation();openChannel('${ch}','${thumb}')"><span>${v.channel}</span></div>` : ''}
          ${meta ? `<div class="video-meta">${meta}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  // 履歴項目のチャンネル情報が空ならバックグラウンドで補完取得
  if (type === 'history') {
    items.forEach(v => {
      if (!v.channel || !v.authorThumb) {
        backfillHistoryChannel(v.id);
      }
    });
  }
  if (type === 'history') {
    const empty = document.getElementById('history-empty');
    if (empty) empty.style.display = items.length === 0 ? 'block' : 'none';
  }
}
const _backfillInflight = new Set();
async function backfillHistoryChannel(videoId) {
  if (_backfillInflight.has(videoId)) return;
  _backfillInflight.add(videoId);
  try {
    const instances = (typeof INVIDIOUS_INSTANCES !== 'undefined' && INVIDIOUS_INSTANCES.length)
      ? INVIDIOUS_INSTANCES.slice(0, 5)
      : ['https://invidious.f5.si','https://yt.omada.cafe','https://inv.nadeko.net'];
    const tasks = instances.map(inst => fetch(buildFetchUrl(`${inst}/api/v1/videos/${videoId}?fields=title,author,authorThumbnails,viewCount,publishedText&hl=ja&region=JP`),
      { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : Promise.reject('bad'))
      .then(d => { if (!d || !d.title) throw new Error('empty'); return d; }));
    const meta = await Promise.any(tasks);
    const list = JSON.parse(localStorage.getItem('history')||'[]');
    const idx = list.findIndex(x => x.id === videoId);
    if (idx < 0) return;
    list[idx].title = list[idx].title || meta.title;
    list[idx].channel = meta.author || list[idx].channel;
    list[idx].authorThumb = (meta.authorThumbnails && meta.authorThumbnails.length) ? meta.authorThumbnails[meta.authorThumbnails.length-1].url : list[idx].authorThumb;
    list[idx].viewCount = meta.viewCount || list[idx].viewCount;
    list[idx].published = meta.publishedText || list[idx].published;
    localStorage.setItem('history', JSON.stringify(list));
    if (currentView === 'history') renderLocalList('history');
  } catch(e){} finally { _backfillInflight.delete(videoId); }
}
function clearWatchHistory() {
  if (!confirm('視聴履歴をすべて消去しますか？')) return;
  localStorage.removeItem('history');
  renderLocalList('history');
}
async function fetchComments(videoId) {
  const container = document.getElementById('comments-container');
  container.innerHTML = '<div class="loader">コメントを読み込み中...</div>';
  const commentApis = [
    async (id) => {
      const res = await fetch(`https://inv.nadeko.net/api/v1/comments/${id}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      if (!data.comments || data.comments.length === 0) throw new Error('no comments');
      return data.comments.map(c => ({ author: c.author||'名無し', content: c.content||c.contentHtml?.replace(/<[^>]+>/g,'')||'', avatar: c.authorThumbnails?.[c.authorThumbnails.length-1]?.url||'', likes: c.likeCount||0 }));
    },
    async (id) => {
      for (const instance of INVIDIOUS_INSTANCES.slice(0,6)) {
        try {
          const res = await fetch(`${instance}/api/v1/comments/${id}`, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) continue;
          const data = await res.json();
          if (!data.comments || data.comments.length === 0) continue;
          return data.comments.map(c => ({ author: c.author||'名無し', content: c.content||c.contentHtml?.replace(/<[^>]+>/g,'')||'', avatar: c.authorThumbnails?.[c.authorThumbnails.length-1]?.url||'', likes: c.likeCount||0 }));
        } catch(e) {}
      }
      throw new Error('all failed');
    }
  ];
  let comments = null;
  for (const api of commentApis) { try { comments = await api(videoId); if (comments && comments.length > 0) break; } catch(e) {} }
  if (!comments || comments.length === 0) {
    container.innerHTML = '<div style="color:var(--text-secondary);padding:8px;">コメントを読み込めませんでした。</div>';
    document.getElementById('comment-count').innerText = '0'; return;
  }
  document.getElementById('comment-count').innerText = comments.length;
  container.innerHTML = comments.slice(0,20).map(c => `<div class="comment"><img class="comment-avatar" src="${c.avatar}" onerror="this.src='https://i.pravatar.cc/40?u=${encodeURIComponent(c.author)}'"><div class="comment-body"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-weight:bold;font-size:13px;">${c.author}</span>${c.likes > 0 ? `<span style="font-size:12px;color:var(--text-secondary);">👍 ${c.likes.toLocaleString()}</span>` : ''}</div><div style="font-size:14px;line-height:1.5;">${(c.content||'').replace(/\n/g,'<br>')}</div></div></div>`).join('');
}
// =================== ショートUIヘルパー ===================
function toggleShortLike(btn) {
  const icon = btn.querySelector('.icon'), span = btn.querySelector('.short-like-count');
  const isLiked = btn.dataset.liked === '1'; btn.dataset.liked = isLiked ? '0' : '1';
  icon.style.color = isLiked ? '' : '#ff0000';
  if (span) {
    const cur = parseInt(span.textContent.replace(/[^0-9]/g,''))||0, newVal = isLiked ? Math.max(0,cur-1) : cur+1;
    span.textContent = newVal >= 10000 ? (newVal/1000).toFixed(0)+'K' : newVal.toLocaleString();
  }
}
function toggleShortDislike(btn) {
  const icon = btn.querySelector('.icon'), isDisliked = btn.dataset.disliked === '1';
  btn.dataset.disliked = isDisliked ? '0' : '1'; icon.style.color = isDisliked ? '' : '#aaa';
}
async function openShortComments(videoId, title) {
  const panel = document.getElementById(`short-comments-panel-${videoId}`);
  if (!panel) return;
  panel.style.display = 'block';
  const content = document.getElementById(`short-comments-content-${videoId}`);
  if (content.dataset.loaded === '1') return;
  content.innerHTML = '<div class="loader">コメントを読み込み中...</div>'; content.dataset.loaded = '1';
  const apis = [`https://inv.nadeko.net/api/v1/comments/${videoId}`, ...INVIDIOUS_INSTANCES.slice(0,4).map(i => `${i}/api/v1/comments/${videoId}`)];
  let comments = [];
  for (const url of apis) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(6000) }); if (!res.ok) continue; const data = await res.json(); if (data.comments && data.comments.length > 0) { comments = data.comments; break; } } catch(e) {}
  }
  if (comments.length === 0) { content.innerHTML = '<div style="color:var(--text-secondary);padding:8px;">コメントを読み込めませんでした。</div>'; return; }
  content.innerHTML = comments.slice(0,15).map(c => `<div style="display:flex;gap:10px;margin-bottom:14px;"><img src="${c.authorThumbnails?.[0]?.url||''}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;background:#eee;" onerror="this.src='https://i.pravatar.cc/36?u=${encodeURIComponent(c.author||'')}'"><div><div style="font-weight:bold;font-size:12px;margin-bottom:3px;">${c.author||'名無し'}</div><div style="font-size:13px;line-height:1.4;">${(c.content||'').replace(/\n/g,'<br>')}</div></div></div>`).join('');
}
function closeShortComments(videoId) {
  const panel = document.getElementById(`short-comments-panel-${videoId}`); if (panel) panel.style.display = 'none';
}
function toggleSubscribeFromShort(channelName, thumb, btn) {
  let subs = getSubscriptions();
  if (isSubscribed(channelName)) { subs = subs.filter(s => s.name !== channelName); btn.textContent='登録'; btn.classList.remove('subscribed'); }
  else { subs.unshift({ name: channelName, thumb, isLive: false }); btn.textContent='登録済み'; btn.classList.add('subscribed'); }
  saveSubscriptions(subs); renderSidebarSubscriptions();
}
// =================== 追加機能: 視聴回数 / 自動次再生 ===================
function formatViews(n){
  n = parseInt(n)||0;
  if(!n) return '';
  if(n >= 100000000) return (n/100000000).toFixed(1).replace(/\.0$/,'') + '億回視聴';
  if(n >= 10000) return (n/10000).toFixed(1).replace(/\.0$/,'') + '万回視聴';
  if(n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + '千回視聴';
  return n.toLocaleString() + '回視聴';
}
// getAppConfig 既定値に autoNext を追加（既存設定とマージ）
const _origGetAppConfig = getAppConfig;
getAppConfig = function(){ const c = _origGetAppConfig(); if(c.autoNext===undefined) c.autoNext = true; return c; };
const _origSaveNavSettings = saveNavSettings;
saveNavSettings = function(){
  _origSaveNavSettings();
  const el = document.getElementById('nav-setting-autonext');
  if(!el) return;
  try{
    const c = JSON.parse(localStorage.getItem('study2525_config'))||{};
    c.autoNext = el.checked;
    localStorage.setItem('study2525_config', JSON.stringify(c));
  }catch(e){}
};
const _origSyncSettings = syncSettings;
syncSettings = function(config){
  _origSyncSettings(config);
  const el = document.getElementById('nav-setting-autonext');
  if(el) el.checked = config.autoNext !== false;
};
// 関連動画キュー（次に再生する動画）
let _nextVideoQueue = [];
const _origRenderRelatedVideos = renderRelatedVideos;
renderRelatedVideos = function(videos, append=false){
  _origRenderRelatedVideos(videos, append);
  if(!append) _nextVideoQueue = [];
  videos.forEach(v => { if(v.id && v.id !== currentVideoId) _nextVideoQueue.push(v); });
  startEndedWatcher();
};
let _autoNextTimer = null;
let _ytApiReady = false;
let _ytPlayer = null;
// YouTube IFrame API ロード
(function loadYTApi(){
  if(window.YT) { _ytApiReady = true; return; }
  const t = document.createElement('script');
  t.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(t);
  window.onYouTubeIframeAPIReady = function(){ _ytApiReady = true; };
})();
function playNextVideo(){
  if(!getAppConfig().autoNext) return;
  const next = _nextVideoQueue.shift();
  if(!next) return;
  playVideo(next.id, next.title, next.channel, next.authorThumb);
}
function scheduleNext(){
  if(_autoNextTimer) clearTimeout(_autoNextTimer);
  if(!getAppConfig().autoNext) return;
  _autoNextTimer = setTimeout(playNextVideo, 5000);
}
function startEndedWatcher(){
  // HTML5 video (Manifest stream)
  const wrap = document.getElementById('player-wrapper');
  if(!wrap) return;
  const v = wrap.querySelector('video');
  if(v && !v.dataset.endedHooked){
    v.dataset.endedHooked = '1';
    v.addEventListener('ended', () => scheduleNext());
  }
  // YouTube iframe via IFrame API
  const iframe = document.getElementById('yt-player');
  if(iframe && _ytApiReady && !iframe.dataset.ytHooked){
    // iframeのsrcに enablejsapi=1 を付加
    if(iframe.src && iframe.src.indexOf('enablejsapi') === -1){
      const sep = iframe.src.indexOf('?') >= 0 ? '&' : '?';
      iframe.src = iframe.src + sep + 'enablejsapi=1';
    }
    iframe.dataset.ytHooked = '1';
    try{
      if(_ytPlayer && _ytPlayer.destroy) { try{ _ytPlayer.destroy(); }catch(e){} }
      _ytPlayer = new YT.Player(iframe, {
        events: {
          onStateChange: (e) => { if(e.data === YT.PlayerState.ENDED) scheduleNext(); }
        }
      });
    }catch(e){}
  }
}
// playVideo の後にウォッチャを起動
const _origPlayVideo = playVideo;
playVideo = async function(...args){
  if(_autoNextTimer){ clearTimeout(_autoNextTimer); _autoNextTimer = null; }
  await _origPlayVideo.apply(this, args);
  // プレイヤーが組み立てられるのを待つ
  setTimeout(startEndedWatcher, 800);
  setTimeout(startEndedWatcher, 2000);
};
// 初期化時に設定をUIに反映
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const c = getAppConfig();
    const el = document.getElementById('nav-setting-autonext');
    if(el) el.checked = c.autoNext !== false;
  }, 100);
});
// =================== 検索履歴ドロップダウン ===================
function showSearchSuggestions(){
  const box = document.getElementById('search-suggestions');
  if(!box) return;
  const inp = document.getElementById('search-input');
  const filter = (inp.value||'').toLowerCase();
  const list = getSearchHistory().filter(q => !filter || q.toLowerCase().includes(filter)).slice(0, 10);
  if(list.length === 0){ box.classList.remove('open'); return; }
  box.innerHTML = list.map(q => `<div class="search-suggestion-item" onmousedown="event.preventDefault();selectSuggestion('${q.replace(/'/g,"\\'")}')">
    <svg viewBox="0 0 24 24"><path d="M14.97,16.95L10,13.87V7h2v5.76l4.03,2.49L14.97,16.95z M12,3c-4.96,0-9,4.04-9,9s4.04,9,9,9s9-4.04,9-9S16.96,3,12,3"/></svg>
    <span>${q}</span>
    <span class="search-suggestion-remove" onmousedown="event.preventDefault();event.stopPropagation();removeSearchHistory('${q.replace(/'/g,"\\'")}')">×</span>
  </div>`).join('');
  box.classList.add('open');
}
function hideSearchSuggestions(){ const b=document.getElementById('search-suggestions'); if(b) b.classList.remove('open'); }
function selectSuggestion(q){
  document.getElementById('search-input').value = q;
  hideSearchSuggestions();
  handleSearch(null, q);
}
function removeSearchHistory(q){
  let sh = getSearchHistory().filter(x => x !== q);
  localStorage.setItem('search_history', JSON.stringify(sh));
  showSearchSuggestions();
  renderCategoryHistoryChips();
}
// カテゴリーバーに検索履歴を追加表示
function renderCategoryHistoryChips(){
  const bar = document.getElementById('categories-bar');
  if(!bar) return;
  bar.querySelectorAll('.search-history-chip').forEach(el => el.remove());
  const list = getSearchHistory().slice(0, 6);
  list.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'category-chip search-history-chip';
    btn.innerHTML = `🔍 ${q}`;
    btn.onclick = () => { document.getElementById('search-input').value = q; handleSearch(null, q); };
    bar.appendChild(btn);
  });
}
// saveSearchHistoryをラップしてチップを更新
const _origSaveSearchHistory = saveSearchHistory;
saveSearchHistory = function(q){ _origSaveSearchHistory(q); renderCategoryHistoryChips(); };
// =================== シアターモード ===================
function toggleTheaterMode(){
  const layout = document.querySelector('#view-watch .watch-layout');
  if(!layout) return;
  layout.classList.toggle('theater');
  const on = layout.classList.contains('theater');
  const btn = document.getElementById('theater-btn');
  if(btn) btn.classList.toggle('theater-active', on);
  const btnT = document.getElementById('theater-btn');
  if(btnT) btnT.title = on ? '通常表示' : 'シアターモード';
}
let watchLoopEnabled = false;
function toggleWatchLoop(){
  watchLoopEnabled = !watchLoopEnabled;
  const btn = document.getElementById('loop-btn');
  if(btn) btn.classList.toggle('loop-active', watchLoopEnabled);
  applyWatchLoop();
}
function applyWatchLoop(){
  const wrapper = document.getElementById('player-wrapper');
  if(!wrapper) return;
  const vid = wrapper.querySelector('video');
  if(vid){ vid.loop = watchLoopEnabled; }
  const aud = wrapper.querySelector('audio');
  if(aud){ aud.loop = watchLoopEnabled; }
  const iframe = wrapper.querySelector('iframe');
  if(iframe && iframe.src && currentVideoId && !iframe.src.includes('about:blank')){
    let src = iframe.src;
    const hasLoop = /[?&]loop=1/.test(src);
    if(watchLoopEnabled && !hasLoop){
      src += (src.includes('?')?'&':'?') + `loop=1&playlist=${currentVideoId}`;
      iframe.src = src;
    } else if(!watchLoopEnabled && hasLoop){
      src = src.replace(/([?&])loop=1/g,'$1').replace(new RegExp(`([?&])playlist=${currentVideoId}`,'g'),'$1').replace(/[?&]$/,'').replace(/&&+/g,'&').replace(/\?&/,'?');
      iframe.src = src;
    }
  }
}
// =================== 再生リスト ===================
function getPlaylists(){ try { return JSON.parse(localStorage.getItem('playlists')||'[]'); } catch(e){ return []; } }
function savePlaylists(pl){ localStorage.setItem('playlists', JSON.stringify(pl)); }
function createPlaylist(name){
  if(!name || !name.trim()) return null;
  const pl = getPlaylists();
  const id = 'pl_' + Date.now();
  pl.unshift({ id, name: name.trim(), videos: [], createdAt: Date.now() });
  savePlaylists(pl);
  return id;
}
function createPlaylistFromInput(){
  const inp = document.getElementById('new-playlist-input');
  if(createPlaylist(inp.value)){ inp.value=''; renderPlaylists(); }
}
function addVideoToPlaylist(plId, video){
  const pl = getPlaylists();
  const target = pl.find(p => p.id === plId);
  if(!target) return;
  if(target.videos.some(v => v.id === video.id)) return;
  target.videos.unshift(video);
  savePlaylists(pl);
}
function renderPlaylists(){
  const grid = document.getElementById('playlists-grid');
  if(!grid) return;
  const pl = getPlaylists();
  if(pl.length === 0){ grid.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">再生リストはありません</div>'; return; }
  grid.innerHTML = pl.map(p => {
    const cover = p.videos[0] ? `https://i.ytimg.com/vi/${p.videos[0].id}/mqdefault.jpg` : '';
    return `<div class="playlist-card" onclick="openPlaylist('${p.id}')">
      <div class="playlist-thumb">${cover ? `<img src="${cover}">` : ''}<span class="playlist-count">${p.videos.length}本</span></div>
      <div class="playlist-info">
        <div class="playlist-title">${p.name}</div>
        <div class="playlist-meta">${p.videos.length}本の動画</div>
        <button onclick="event.stopPropagation();deletePlaylist('${p.id}')" style="margin-top:8px;background:none;border:1px solid var(--border-color);padding:4px 10px;border-radius:6px;cursor:pointer;color:var(--text-color);font-size:12px;">削除</button>
      </div>
    </div>`;
  }).join('');
}
function deletePlaylist(id){
  if(!confirm('削除しますか？')) return;
  savePlaylists(getPlaylists().filter(p => p.id !== id));
  renderPlaylists();
}
function openPlaylist(id){
  const p = getPlaylists().find(x => x.id === id); if(!p) return;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-playlist-detail').classList.add('active');
  document.getElementById('playlist-detail-title').textContent = p.name;
  const grid = document.getElementById('playlist-detail-grid');
  if(p.videos.length === 0){ grid.innerHTML = '<div style="color:var(--text-secondary);">動画がありません</div>'; return; }
  grid.innerHTML = p.videos.map(v => `<div class="video-card" onclick="playVideo('${v.id}','${(v.title||'').replace(/'/g,"\\'")}','${(v.channel||'').replace(/'/g,"\\'")}')">
    <div class="thumbnail-container"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy"></div>
    <div class="video-details" style="padding:10px 0;"><div class="video-title">${v.title||''}</div><div class="video-meta-channel"><span>${v.channel||''}</span></div></div>
  </div>`).join('');
}
function openAddToPlaylist(){
  if(!currentVideoId) return;
  const modal = document.getElementById('add-to-playlist-modal');
  const list = document.getElementById('playlist-options-list');
  const pl = getPlaylists();
  list.innerHTML = pl.length === 0 ? '<div style="color:var(--text-secondary);padding:8px;">まだありません。下から作成してください。</div>' :
    pl.map(p => `<div class="playlist-option" onclick="addCurrentToPlaylist('${p.id}')">
      <input type="checkbox" ${p.videos.some(v=>v.id===currentVideoId)?'checked':''} style="pointer-events:none;">
      <span>${p.name}</span><span style="color:var(--text-secondary);font-size:12px;margin-left:auto;">${p.videos.length}本</span>
    </div>`).join('');
  modal.classList.add('open');
}
function closeAddToPlaylist(){ document.getElementById('add-to-playlist-modal').classList.remove('open'); }
function addCurrentToPlaylist(plId){
  if(!currentVideoId) return;
  addVideoToPlaylist(plId, { id: currentVideoId, title: currentVideoTitle, channel: currentChannelName });
  openAddToPlaylist();
}
function createAndAddToPlaylist(){
  const inp = document.getElementById('modal-new-playlist');
  const id = createPlaylist(inp.value);
  if(id && currentVideoId){ addVideoToPlaylist(id, { id: currentVideoId, title: currentVideoTitle, channel: currentChannelName }); }
  inp.value = ''; openAddToPlaylist();
}
// navigate('playlists') サポート
const _origNavigate2 = navigate;
navigate = function(viewName, opts){
  _origNavigate2(viewName, opts);
  if(viewName === 'playlists') renderPlaylists();
};
// hashchange対応
window.addEventListener('hashchange', () => {
  const init = parseInitialUrl();
  if(!init) return;
  if(init.view === 'watch' && init.videoId) playVideo(init.videoId, '', '', null);
  else if(init.view === 'shorts' && init.videoId) navigateToShortPage(init.videoId, '', '', null, true);
  else if(init.view === 'search' && init.query){
    document.getElementById('search-input').value = init.query;
    navigate('search', { noHistory: true });
    triggerSearch(init.query, 'search');
  } else if(init.view){ navigate(init.view, { noHistory: true }); }
});
/* ===================== カスタム拡張: メニュー/関連/3点/興味なし/よく見た ===================== */
/* 視聴中も常にサイドバー (collapsed) を最低限表示し、トグル可能にする */
(function injectStyles(){
  const style = document.createElement('style');
  style.textContent = `
    /* 視聴中: サイドバーは表示。closedはアイコンのみ、openはフル */
    body.is-watching .sidebar { display: block !important; }
    body.is-watching main { margin-left: 72px !important; }
    body.is-watching main.sidebar-open { margin-left: 240px !important; }
    @media (max-width: 1100px) {
      body.is-watching main, body.is-watching main.sidebar-open { margin-left: 0 !important; }
    }
    /* 視聴ページ以外は常にメニュー(サイドバー)を表示 */
    body:not(.is-watching) .sidebar { display: block !important; }
    /* 関連動画は通常モード時、デバイス問わず右側に表示 */
    .watch-layout { display: flex !important; flex-wrap: nowrap !important; }
    .watch-layout .watch-sidebar { display: block !important; width: 402px !important; flex-shrink: 0 !important; }
    @media (max-width: 1100px) {
      .watch-layout { flex-wrap: wrap !important; }
      .watch-layout .watch-sidebar { width: 100% !important; }
    }
    /* シアターモード時のみ関連動画を非表示 */
    .watch-layout.theater .watch-sidebar { display: none !important; }
    /* 関連動画上のタグ */
    .related-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); }
    .related-tag { background: var(--chip-bg); padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
    .related-tag:hover { background: var(--chip-hover); }
    .related-tag.active { background: var(--text-color); color: var(--bg-color); }
    /* 動画カードの3点メニュー */
    .video-card { position: relative; }
    .vcard-menu-btn { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.55); color: #fff; display: none; align-items: center; justify-content: center; font-size: 18px; line-height: 1; z-index: 5; }
    .video-card:hover .vcard-menu-btn { display: flex; }
    @media (max-width: 900px) { .vcard-menu-btn { display: flex; } }
    .vcard-menu-btn:hover { background: rgba(0,0,0,0.8); }
    .vcard-menu-popup { position: absolute; top: 42px; right: 6px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 20; min-width: 180px; padding: 6px 0; }
    .vcard-menu-popup .item { padding: 10px 14px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 10px; color: var(--text-color); }
    .vcard-menu-popup .item:hover { background: var(--hover-color); }
    /* よく見た動画セクション */
    .frequent-section { margin-bottom: 32px; }
    .frequent-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: bold; margin-bottom: 16px; }
    .frequent-title svg { width: 22px; height: 22px; fill: var(--primary-color); }
    .frequent-scroll { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; }
    .frequent-scroll .video-card { flex: 0 0 320px; }
    @media (max-width: 600px) { .frequent-scroll .video-card { flex: 0 0 260px; } }
    /* 検索履歴チップは非表示 */
    .category-chip.search-history-chip { display: none !important; }
    .search-suggestions { display: none !important; }
  `;
  document.head.appendChild(style);
})();
/* ---- 検索履歴UIを完全に無効化 ---- */
window.showSearchSuggestions = function(){};
window.renderCategoryHistoryChips = function(){
  const bar = document.getElementById('categories-bar');
  if(bar) bar.querySelectorAll('.search-history-chip').forEach(el => el.remove());
};
/* ---- 興味のないリスト ---- */
function getNotInterested(){ try { return JSON.parse(localStorage.getItem('not_interested')||'[]'); } catch(e){ return []; } }
function addNotInterested(id){
  if(!id) return;
  const list = getNotInterested();
  if(!list.includes(id)){ list.push(id); localStorage.setItem('not_interested', JSON.stringify(list)); }
  document.querySelectorAll(`[data-vcard-id="${id}"]`).forEach(el => el.remove());
  document.querySelectorAll(`.related-video[data-vid="${id}"]`).forEach(el => el.remove());
}
window.addNotInterested = addNotInterested;
function isNotInterested(id){ return getNotInterested().includes(id); }
/* ---- 視聴回数 (よく見た動画用) ---- */
function bumpFrequent(video){
  if(!video || !video.id) return;
  let map = {};
  try { map = JSON.parse(localStorage.getItem('frequent_map')||'{}'); } catch(e){}
  const cur = map[video.id] || { count: 0 };
  cur.count = (cur.count||0) + 1;
  cur.title = video.title || cur.title || '';
  cur.channel = video.channel || cur.channel || '';
  cur.thumb = video.authorThumb || cur.thumb || '';
  cur.last = Date.now();
  map[video.id] = cur;
  localStorage.setItem('frequent_map', JSON.stringify(map));
}
function getFrequent(){
  let map = {};
  try { map = JSON.parse(localStorage.getItem('frequent_map')||'{}'); } catch(e){}
  return Object.entries(map)
    .map(([id, v]) => ({ id, ...v }))
    .filter(v => v.count >= 2 && !isNotInterested(id))
    .sort((a,b) => (b.count - a.count) || (b.last - a.last))
    .slice(0, 12);
}
/* playVideo をラップして視聴回数を加算 */
(function(){
  const orig = window.playVideo;
  window.playVideo = function(id, title, channel, thumb){
    bumpFrequent({ id, title, channel, authorThumb: thumb });
    setTimeout(renderFrequentSection, 50);
    return orig.apply(this, arguments);
  };
})();
function renderFrequentSection(){
  const home = document.getElementById('view-home');
  if(!home) return;
  let sec = document.getElementById('frequent-section');
  const list = getFrequent();
  if(list.length === 0){ if(sec) sec.remove(); return; }
  if(!sec){
    sec = document.createElement('div');
    sec.id = 'frequent-section';
    sec.className = 'frequent-section';
    sec.innerHTML = `
      <div class="frequent-title">
        <svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3zm-1 4v6l5 3 .8-1.3-4.3-2.6V7H12z"/></svg>
        よく見た動画
      </div>
      <div class="frequent-scroll" id="frequent-scroll"></div>`;
    const main = home.querySelector('#main-content, .main-content') || home;
    home.insertBefore(sec, home.firstChild);
  }
  const scroll = sec.querySelector('#frequent-scroll');
  scroll.innerHTML = '';
  list.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.style.cursor = 'pointer';
    card.dataset.vcardId = v.id;
    card.onclick = () => playVideo(v.id, v.title||'', v.channel||'', v.thumb||'');
    card.innerHTML = `
      <div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000;margin-bottom:8px;">
        <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
      </div>
      <div style="font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${(v.title||'').replace(/</g,'&lt;')}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${(v.channel||'').replace(/</g,'&lt;')} ・ ${v.count}回視聴</div>`;
    addCardMenu(card, v.id);
    scroll.appendChild(card);
  });
}
/* ---- 3点メニューを動画カードに付与 ---- */
function addCardMenu(card, videoId){
  if(!card || !videoId || card.querySelector('.vcard-menu-btn')) return;
  card.dataset.vcardId = videoId;
  const btn = document.createElement('button');
  btn.className = 'vcard-menu-btn';
  btn.innerHTML = '⋮';
  btn.title = 'メニュー';
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll('.vcard-menu-popup').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'vcard-menu-popup';
    pop.innerHTML = `
      <div class="item" data-act="not">🚫 興味がない</div>
      <div class="item" data-act="copy">🔗 リンクをコピー</div>
    `;
    pop.querySelector('[data-act="not"]').onclick = (ev) => { ev.stopPropagation(); addNotInterested(videoId); pop.remove(); };
    pop.querySelector('[data-act="copy"]').onclick = (ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(`https://youtu.be/${videoId}`); pop.remove(); };
    card.appendChild(pop);
    setTimeout(() => {
      const close = (e2) => { if(!pop.contains(e2.target)) { pop.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  };
  card.appendChild(btn);
}
/* MutationObserverでvideo-cardに3点メニューを自動付与 + 興味なしを除外 */
function processCard(card){
  if(!card || !(card instanceof Element)) return;
  // 興味なしフィルタ
  let id = card.dataset.vcardId;
  if(!id){
    const m = (card.getAttribute('onclick')||'').match(/playVideo\('([a-zA-Z0-9_-]{11})'/);
    if(m) id = m[1];
  }
  if(!id){
    const img = card.querySelector('img[src*="i.ytimg.com/vi/"]');
    if(img){ const mm = img.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//); if(mm) id = mm[1]; }
  }
  if(id){
    if(isNotInterested(id)) { card.remove(); return; }
    addCardMenu(card, id);
  }
}
function processAllCards(root){
  (root||document).querySelectorAll('.video-card, .video-card-h, .related-video, .search-result-item, .home-short-card, .channel-short-card').forEach(processCard);
  // 興味なしフィルタを関連動画にも
  document.querySelectorAll('.related-video').forEach(el => {
    const m = (el.getAttribute('onclick')||'').match(/playVideo\('([a-zA-Z0-9_-]{11})'/);
    if(m){ if(isNotInterested(m[1])) el.remove(); else el.dataset.vid = m[1]; }
  });
}
const _cardObserver = new MutationObserver(muts => {
  for(const m of muts){
    m.addedNodes.forEach(n => {
      if(n.nodeType === 1){
        if(n.matches && n.matches('.video-card, .video-card-h, .related-video, .search-result-item, .home-short-card, .channel-short-card')) processCard(n);
        if(n.querySelectorAll) n.querySelectorAll('.video-card, .video-card-h, .related-video, .search-result-item, .home-short-card, .channel-short-card').forEach(processCard);
      }
    });
  }
});
document.addEventListener('DOMContentLoaded', () => {
  _cardObserver.observe(document.body, { childList: true, subtree: true });
  processAllCards();
  renderFrequentSection();
  /* ---- 関連動画の上にタグを表示 ---- */
  const RELATED_TAGS = ['すべて','関連','ゲーム','音楽','ニュース','ライブ','アニメ','料理','スポーツ','解説'];
  const relatedRoot = document.getElementById('related-videos');
  if(relatedRoot && !document.getElementById('related-tags')){
    const tagsEl = document.createElement('div');
    tagsEl.id = 'related-tags';
    tagsEl.className = 'related-tags';
    tagsEl.innerHTML = RELATED_TAGS.map((t,i) => `<button class="related-tag${i===0?' active':''}" data-tag="${t}">${t}</button>`).join('');
    relatedRoot.parentNode.insertBefore(tagsEl, relatedRoot);
    tagsEl.querySelectorAll('.related-tag').forEach(b => {
      b.onclick = () => {
        tagsEl.querySelectorAll('.related-tag').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const t = b.dataset.tag;
        const base = (window.currentVideoTitle||'').substring(0,20);
        let q = base;
        if(t === '関連' || t === 'すべて') q = base;
        else q = (base ? base+' ' : '') + t;
        document.getElementById('related-loader')?.classList.remove('hidden');
        relatedRoot.innerHTML = '';
        triggerSearch(q || t, 'related');
      };
    });
  }
  /* 視聴中以外は最初からサイドバーを開いておく */
  setTimeout(() => {
    if(!document.body.classList.contains('is-watching')){
      document.getElementById('sidebar')?.classList.add('open');
      document.getElementById('main-content')?.classList.add('sidebar-open');
    }
  }, 300);
});
/* navigate ラッパ: 視聴ページ以外でサイドバーを自動展開 */
(function(){
  const orig = window.navigate;
  if(typeof orig !== 'function') return;
  window.navigate = function(viewName, opts){
    const r = orig.apply(this, arguments);
    setTimeout(() => {
      const sb = document.getElementById('sidebar');
      const mc = document.getElementById('main-content');
      if(viewName !== 'watch' && viewName !== 'shorts'){
        sb?.classList.add('open');
        mc?.classList.add('sidebar-open');
      }
      processAllCards();
      if(viewName === 'home') renderFrequentSection();
    }, 50);
    return r;
  };
})();