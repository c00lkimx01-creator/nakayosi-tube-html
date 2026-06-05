// =================== レンダリング ===================
function formatDuration(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function formatTimestamp(ts) {
  if (!ts || ts === 0) return '';
  const d = new Date(ts*1000);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function formatRelativeJa(ts) {
  if (!ts || ts === 0) return '';
  const now = Date.now()/1000;
  let diff = now - ts;
  if (diff < 0) diff = 0;
  if (diff < 60) return `${Math.max(1,Math.floor(diff))}秒前`;
  if (diff < 3600) return `${Math.floor(diff/60)}分前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}時間前`;
  if (diff < 604800) return `${Math.floor(diff/86400)}日前`;
  if (diff < 2592000) return `${Math.floor(diff/604800)}週間前`;
  if (diff < 31536000) return `${Math.floor(diff/2592000)}か月前`;
  return `${Math.floor(diff/31536000)}年前`;
}
window.formatRelativeJa = formatRelativeJa;
function renderResults(videos, append = false) {
  if (searchContext === 'related') { renderRelatedVideos(videos, append); return; }
  if (searchContext === 'shorts') { renderShorts(videos, append); return; }
  if (searchContext === 'channel-shorts') { renderChannelShorts(videos, append); return; }
  if (searchContext === 'channel-live') { renderChannelLive(videos, append); return; }
  if (searchContext === 'channel-home-shorts') { renderChannelHomeShortsRow(videos); return; }
  if (searchContext === 'search') { renderSearchResults(videos, append); return; }
  // チャンネルホーム: 通常動画を横スクロール行 + 縦グリッド
  if (searchContext === 'channel' || searchContext === 'channel-home') {
    renderChannelHomeRow(videos);
    // 続けて縦グリッドにも表示
  }
  let containerId = 'home-grid';
  if (searchContext === 'channel' || searchContext === 'channel-home') containerId = 'channel-home-grid';
  if (searchContext === 'channel-videos') containerId = 'channel-grid';
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!append) container.innerHTML = '';
  videos.forEach(v => {
    const card = document.createElement('div'); card.className = 'video-card';
    const isLive = v.isLive || (v.title && (v.title.includes('ライブ')||v.title.includes('LIVE')||v.title.includes('live')||v.title.includes('配信')));
    const isArchived = v.isArchived||false;
    const durStr = formatDuration(v.duration), dateStr = v.publishedTimestamp ? formatTimestamp(v.publishedTimestamp) : '';
    const relStr = v.publishedTimestamp ? formatRelativeJa(v.publishedTimestamp) : (v.published||'');
    card.onclick = () => playVideo(v.id, v.title, v.channel, v.authorThumb);
    card.innerHTML = `<div class="thumbnail-container"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy" decoding="async">${v.isLive ? '<span class="live-thumb-badge">🔴 ライブ</span>' : isArchived ? `<span class="archived-badge">📅 ${relStr?relStr+'に':''}配信済み</span>` : (durStr ? `<span class="duration-badge">${durStr}</span>` : '')}</div><div class="video-info"><div class="channel-avatar" onclick="event.stopPropagation(); openChannel('${v.channel.replace(/'/g,"\\'")}','${v.authorThumb}')"><img src="${v.authorThumb}" loading="lazy" decoding="async"></div><div class="video-details"><div class="video-title">${v.title}</div><div class="video-meta-channel"><span style="cursor:pointer;" onclick="event.stopPropagation(); openChannel('${v.channel.replace(/'/g,"\\'")}','${v.authorThumb}')">${v.channel}</span></div><div class="video-meta">${v.isLive ? '<span style="color:#ff0000;font-weight:bold;">● ライブ配信中</span>' : isArchived ? `<span>${relStr?relStr+'に':''}配信済み</span>` : `${v.viewCount ? `<span>${formatViews(v.viewCount)}</span>` : ''}${v.published ? `<span>・ ${v.published}</span>` : ''}`}</div></div></div>`;
    container.appendChild(card);
  });
  document.getElementById('home-loader')?.classList.add('hidden');
  document.getElementById('channel-loader')?.classList.add('hidden');
  if ((searchContext === 'channel' || searchContext === 'channel-home') && videos.length > 0 && !append) renderChannelFeatured(videos[0]);
}
function renderChannelHomeRow(videos) {
  const row = document.getElementById('channel-home-row');
  if (!row) return;
  // 通常動画のみ (Shortsを除外)
  const regular = videos.filter(v => !v.isShort && (v.duration === undefined || v.duration === 0 || v.duration > 60));
  if (regular.length === 0) { row.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">動画が見つかりませんでした</div>'; return; }
  row.innerHTML = regular.slice(0, 20).map(v => {
    const safeTitle = (v.title||'').replace(/'/g,"\\'");
    const safeChannel = (v.channel||'').replace(/'/g,"\\'");
    const dur = formatDuration(v.duration);
    return `<div class="video-card-h" onclick="playVideo('${v.id}','${safeTitle}','${safeChannel}','${v.authorThumb||''}')">
      <div class="vh-thumb"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy">${dur ? `<span class="duration-badge">${dur}</span>` : ''}</div>
      <div class="vh-title">${v.title||''}</div>
      <div class="vh-meta">${v.viewCount?formatViews(v.viewCount):''}${v.published?` ・ ${v.published}`:''}</div>
    </div>`;
  }).join('');
}
function renderChannelHomeShortsRow(videos) {
  const row = document.getElementById('channel-home-shorts-row');
  if (!row) return;
  // fetchChannelShortsMultiPageから来た動画はすべてShortsとして扱う
  const shorts = (videos||[]).slice(0, 20);
  if (shorts.length === 0) { row.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">ショートが見つかりませんでした</div>'; return; }
  row.innerHTML = shorts.map(v => {
    const safeTitle = (v.title||'').replace(/'/g,"\\'");
    const safeChannel = (v.channel||'').replace(/'/g,"\\'");
    return `<div class="home-short-card" onclick="navigateToShortPage('${v.id}','${safeTitle}','${safeChannel}','${v.authorThumb||''}')">
      <div class="home-short-thumb"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" loading="lazy"></div>
      <div class="home-short-title">${v.title||''}</div>
    </div>`;
  }).join('');
}
function renderSearchResults(videos, append = false) {
  const container = document.getElementById('search-results-list');
  if (!container) return;
  if (!append) container.innerHTML = '';
  if (!append && (!videos || videos.length === 0)) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:14px;">該当する動画が見つかりませんでした。別のキーワードでお試しください。</div>';
    document.getElementById('search-loader')?.classList.add('hidden');
    return;
  }
  videos.forEach(v => {
    const item = document.createElement('div'); item.className = 'search-result-item';
    const isLive = v.isLive || (v.title && (v.title.includes('ライブ')||v.title.includes('LIVE')||v.title.includes('live')||v.title.includes('配信')));
    const isArchived = v.isArchived||false, durStr = formatDuration(v.duration), dateStr = v.publishedTimestamp ? formatTimestamp(v.publishedTimestamp) : '';
    const relStr = v.publishedTimestamp ? formatRelativeJa(v.publishedTimestamp) : (v.published||'');
    const channelSafe = v.channel.replace(/'/g,"\\'");
    item.onclick = () => playVideo(v.id, v.title, v.channel, v.authorThumb);
    item.innerHTML = `<div class="search-result-thumb"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy" decoding="async">${v.isLive ? '<span class="live-thumb-badge">🔴 ライブ</span>' : isArchived ? `<span class="archived-badge">📅 ${relStr?relStr+'に':''}配信済み</span>` : (durStr ? `<span class="duration-badge">${durStr}</span>` : '')}</div><div class="search-result-info"><div class="search-result-title">${v.title}</div><div class="search-result-meta">${v.isLive ? '<span style="color:#ff0000;font-weight:bold;">● ライブ配信中</span>' : isArchived ? `<span>${relStr?relStr+'に':''}配信済み</span>` : (durStr ? `<span>${durStr}</span>` : '')}${!v.isLive && v.published ? `<span>• ${v.published}</span>` : ''}</div><div class="search-result-channel" onclick="event.stopPropagation(); openChannel('${channelSafe}','${v.authorThumb}')"><div class="search-result-channel-icon"><img src="${v.authorThumb}" loading="lazy" decoding="async"></div><span class="search-result-channel-name">${v.channel}</span></div></div>`;
    container.appendChild(item);
  });
  document.getElementById('search-loader')?.classList.add('hidden');
}
function renderSearchChannels(channels) {
  const sec = document.getElementById('search-channels-section');
  if (!sec) return;
  if (!channels || channels.length === 0) { sec.classList.add('hidden'); sec.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  sec.innerHTML = channels.map(c => {
    const rawName = c.author||'';
    const name = rawName.replace(/'/g,"\\'");
    const thumb = c.authorThumbnails && c.authorThumbnails.length > 0 ? c.authorThumbnails[c.authorThumbnails.length-1].url : `https://i.pravatar.cc/150?u=${encodeURIComponent(rawName)}`;
    const subs = c.subCount ? `チャンネル登録者数 ${formatSubCount(c.subCount)}人` : '';
    const vids = c.videoCount ? `${c.videoCount}本の動画` : '';
    const handle = c.authorId ? `@${c.authorId}` : '';
    const meta = [handle, subs, vids].filter(Boolean).join(' • ');
    const desc = (c.description||'').replace(/</g,'&lt;');
    const verified = (c.subCount && c.subCount >= 100000) ? '<svg class="search-channel-card-verified" viewBox="0 0 24 24"><path d="M12 2L9.91 4.09 7 4l-.5 2.91L4 8l1.09 2.91L4 13.91l2.91.59L7 17.5l2.91-.5L12 19l2.09-2 2.91.5.5-2.91L20 13.91l-1.09-3L20 8l-2.91-1.09L17 4l-2.91.09L12 2zm-1.41 13.41L7 11.83l1.41-1.41 2.18 2.17L15.18 8l1.41 1.41-6 6z"/></svg>' : '';
    const subbed = isSubscribed(rawName);
    return `<div class="search-channel-card" onclick="openChannel('${name}','${thumb}')">
      <div class="search-channel-card-icon"><img src="${thumb}" loading="lazy" onerror="this.src='https://i.pravatar.cc/150?u=${encodeURIComponent(rawName)}'"></div>
      <div class="search-channel-card-info">
        <div class="search-channel-card-name">${rawName}${verified}</div>
        ${meta ? `<div class="search-channel-card-meta">${meta}</div>` : ''}
        ${desc ? `<div class="search-channel-card-desc">${desc}</div>` : ''}
      </div>
      <button class="search-channel-card-sub ${subbed?'subscribed':''}" onclick="event.stopPropagation();toggleSubscribeFromSearchCard('${name}','${thumb}',this)">${subbed?'登録済み':'登録'}</button>
    </div>`;
  }).join('');
}
function toggleSubscribeFromSearchCard(name, thumb, btn) {
  let subs = getSubscriptions();
  if (subs.find(s => s.name === name)) {
    subs = subs.filter(s => s.name !== name);
    btn.innerText = '登録'; btn.classList.remove('subscribed');
  } else {
    subs.push({ name, thumb }); btn.innerText = '登録済み'; btn.classList.add('subscribed');
  }
  saveSubscriptions(subs); renderSidebarSubscriptions();
}
function renderChannelFeatured(v) {
  const el = document.getElementById('channel-featured-video');
  if (!el || !v) return;
  el.innerHTML = `<div class="channel-featured-video" onclick="playVideo('${v.id}','${v.title.replace(/'/g,"\\'")}','${v.channel.replace(/'/g,"\\'")}','${v.authorThumb}')"><div class="channel-featured-thumb"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg"></div><div class="channel-featured-info"><div class="channel-featured-title">${v.title}</div><div style="font-size:13px;color:var(--text-secondary);margin-top:8px;">${v.channel}</div>${v.published ? `<div style="font-size:12px;color:var(--text-secondary);">${v.published}</div>` : ''}</div></div>`;
}
function renderChannelShorts(videos, append = false) {
  const grid = document.getElementById('channel-shorts-grid');
  if (!grid) return;
  if (!append) grid.innerHTML = '';
  if (videos.length === 0 && !append) { grid.innerHTML = '<div style="padding:24px;color:var(--text-secondary);">ショート動画が見つかりませんでした</div>'; document.getElementById('channel-shorts-loader')?.classList.add('hidden'); return; }
  const seen = new Set(Array.from(grid.querySelectorAll('[data-vid]')).map(el => el.dataset.vid));
  videos.forEach(v => {
    if (seen.has(v.id)) return; seen.add(v.id);
    const card = document.createElement('div'); card.className = 'channel-short-card'; card.dataset.vid = v.id;
    card.onclick = () => navigateToShortPage(v.id, v.title, v.channel, v.authorThumb);
    card.innerHTML = `<div class="channel-short-thumb"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" loading="lazy" decoding="async">${v.duration > 0 ? `<span class="duration-badge">${formatDuration(v.duration)}</span>` : ''}</div><div class="channel-short-title">${v.title}</div>`;
    grid.appendChild(card);
  });
  document.getElementById('channel-shorts-loader')?.classList.add('hidden');
}
function renderChannelLive(videos, append = false) {
  const container = document.getElementById('channel-live-grid');
  if (!container) return;
  if (!append) container.innerHTML = '';
  if (videos.length === 0 && !append) { container.innerHTML = '<div class="subs-empty">ライブ・配信動画が見つかりません</div>'; document.getElementById('channel-live-loader')?.classList.add('hidden'); return; }
  const sorted = [...videos].sort((a,b) => { const sA=a.isLive&&!a.isUpcoming?2:a.isUpcoming?1:0, sB=b.isLive&&!b.isUpcoming?2:b.isUpcoming?1:0; return sB-sA; });
  sorted.forEach(v => {
    const card = document.createElement('div'); card.className = 'video-card';
    const dateStr = v.publishedTimestamp ? formatTimestamp(v.publishedTimestamp) : '';
    card.onclick = () => playVideo(v.id, v.title, v.channel, v.authorThumb);
    card.innerHTML = `<div class="thumbnail-container"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg">${v.isLive&&!v.isUpcoming ? '<span class="live-thumb-badge">🔴 配信中</span>' : v.isUpcoming ? '<span class="live-thumb-badge" style="background:#1a73e8;">🕐 待機中</span>' : `<span class="archived-badge">📅 配信済み${dateStr?' '+dateStr:''}</span>`}</div><div class="video-info"><div class="channel-avatar"><img src="${v.authorThumb||''}" onerror="this.src='https://i.pravatar.cc/40?u=${encodeURIComponent(v.channel)}'"></div><div class="video-details"><div class="video-title">${v.title}</div><div class="video-meta">${v.isLive&&!v.isUpcoming ? '<span style="color:#ff0000;font-weight:bold;">● ライブ配信中</span>' : v.isUpcoming ? '<span style="color:#1a73e8;font-weight:bold;">⏰ 配信予定</span>' : (dateStr ? `<span>${dateStr} 配信済み</span>` : `<span>${v.published||''}</span>`)}</div></div></div>`;
    container.appendChild(card);
  });
  document.getElementById('channel-live-loader')?.classList.add('hidden');
}
let channelFilterMode = 'latest';
function setChannelFilter(btn, mode) {
  document.querySelectorAll('.channel-filter-chip').forEach(c => c.classList.remove('active')); btn.classList.add('active'); channelFilterMode = mode;
  const grid = document.getElementById('channel-grid'), cards = Array.from(grid.querySelectorAll('.video-card'));
  if (mode === 'popular') cards.sort(() => Math.random()-0.5); else if (mode === 'oldest') cards.reverse();
  grid.innerHTML = ''; cards.forEach(c => grid.appendChild(c));
}
window.addEventListener('scroll', () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000 && !isFetching) {
    if (currentView === 'home' && getAppConfig().trend) { document.getElementById('home-loader').classList.remove('hidden'); triggerSearch(lastQuery||"人気",'trend',true); }
    else if (currentView === 'search') { document.getElementById('search-loader').classList.remove('hidden'); triggerSearch(lastQuery,'search',true); }
    else if (currentView === 'watch') { document.getElementById('related-loader').classList.remove('hidden'); triggerSearch(currentVideoTitle.substring(0,20),'related',true); }
    else if (currentView === 'channel') { if (currentChannelTab === 'videos') { document.getElementById('channel-loader').classList.remove('hidden'); triggerSearch(lastQuery,'channel-videos',true); } }
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const sfp = document.getElementById('shorts-full-page');
  if (sfp) {
    const SHORT_QUERIES = ["人気","おすすめ","話題","面白い","かわいい","急上昇","新着","バズ","公式","ダンス","料理","ゲーム","アニメ","音楽","スポーツ","旅行","ペット","コメディ"];
    let _shortQIdx = 0;
    window._loadMoreShorts = async function(){
      if (window.__shortsLoadingMore) return;
      window.__shortsLoadingMore = true;
      const loader = document.getElementById('shorts-loader');
      if (loader) loader.classList.remove('hidden');
      try {
        // 直接 fetchFromInvidious を呼んで append描画 (triggerSearch の isFetching ロックを回避)
        const tries = 4;
        const seen = new Set(Array.from(document.querySelectorAll('#shorts-container .short-snap-item')).map(el => el.dataset.id).filter(Boolean));
        let added = 0;
        for (let i=0; i<tries && added < 6; i++) {
          const q = SHORT_QUERIES[(_shortQIdx++) % SHORT_QUERIES.length];
          const data = await (window.fetchFromInvidious ? window.fetchFromInvidious(q, 'shorts', 1).catch(()=>null) : null);
          if (!data || !data.length) continue;
          const fresh = [];
          for (const item of data) {
            if (!item || item.type !== 'video' || !item.videoId) continue;
            if (seen.has(item.videoId)) continue;
            if (item.lengthSeconds && item.lengthSeconds > 65) continue;
            seen.add(item.videoId);
            fresh.push({
              id: item.videoId, title: item.title, channel: item.author||'',
              isShort: true,
              authorThumb: item.authorThumbnails ? item.authorThumbnails[0].url : ('https://i.pravatar.cc/80?u='+encodeURIComponent(item.author||'')),
              duration: item.lengthSeconds||0,
              published: item.publishedText||'',
              viewCount: item.viewCount||0
            });
            if (fresh.length >= 8) break;
          }
          if (fresh.length && typeof renderShorts === 'function') {
            renderShorts(fresh, true);
            added += fresh.length;
          }
        }
      } catch(e) {}
      if (loader) loader.classList.add('hidden');
      window.__shortsLoadingMore = false;
    };
    sfp.addEventListener('scroll', () => {
      if (sfp.scrollTop + sfp.clientHeight >= sfp.scrollHeight - 600) {
        window._loadMoreShorts();
      }
    }, { passive: true });
    // ショート画面を開いた直後に、下の動画が空にならないよう即プリロード
    const _origNav = window.navigate;
    if (typeof _origNav === 'function') {
      window.navigate = function(viewName, opts){
        const r = _origNav.apply(this, arguments);
        if (viewName === 'shorts') {
          setTimeout(() => {
            const cnt = document.querySelectorAll('#shorts-container .short-snap-item').length;
            if (cnt < 4) window._loadMoreShorts();
          }, 400);
        }
        return r;
      };
    }
  }
  // Edu キーをアプリ起動時にプリフェッチ → 初回 Edu 切り替えを高速化
  try { fetchKahootKey().then(k => { if (k) currentEduKey = k; }); } catch(e) {}
  // 横スクロール領域に自動で矢印ボタンを付与
  attachHScrollArrows();
});
// ============ 横スクロール用の自動矢印ボタン ============
const HSB_TARGET_SELECTORS = [
  '#categories-bar',
  '#search-shorts-container',
  '#home-recommend-grid',
  '#channel-home-row',
  '#channel-home-shorts-row',
  '#channel-tabs-bar',
  '.channel-row-scroll',
  '.search-shorts-scroll',
];
function _hsbScroll(el, dir) {
  const amount = Math.max(240, el.clientWidth * 0.8);
  el.scrollBy({ left: amount * dir, behavior: 'smooth' });
}
function _hsbUpdate(el, prev, next) {
  const max = el.scrollWidth - el.clientWidth - 2;
  if (max <= 0) { prev.style.display = 'none'; next.style.display = 'none'; return; }
  prev.style.display = el.scrollLeft > 4 ? 'flex' : 'none';
  next.style.display = el.scrollLeft < max - 4 ? 'flex' : 'none';
}
function _hsbAttach(el) {
  if (!el || el.dataset.hsbAttached) return;
  // categories-bar は固定配置 → 直接 body に矢印を追加
  const isFixed = el.id === 'categories-bar';
  let host;
  if (isFixed) {
    host = el; // 内部に position:fixed の矢印を入れる
  } else {
    // 親に position:relative のラッパーを作る
    if (!el.parentElement) return;
    if (!el.parentElement.classList.contains('hsb-wrap') && !el.parentElement.classList.contains('h-scroll-wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'hsb-wrap';
      el.parentElement.insertBefore(wrap, el);
      wrap.appendChild(el);
      host = wrap;
    } else {
      host = el.parentElement;
    }
  }
  const prev = document.createElement('button');
  prev.className = 'hsb-arrow prev'; prev.type = 'button'; prev.setAttribute('aria-label','前へ');
  prev.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
  const next = document.createElement('button');
  next.className = 'hsb-arrow next'; next.type = 'button'; next.setAttribute('aria-label','次へ');
  next.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';
  prev.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _hsbScroll(el, -1); };
  next.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _hsbScroll(el, 1); };
  host.appendChild(prev); host.appendChild(next);
  el.dataset.hsbAttached = '1';
  const update = () => _hsbUpdate(el, prev, next);
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // 中身が後から差し込まれるので変化を監視
  const mo = new MutationObserver(() => setTimeout(update, 50));
  mo.observe(el, { childList: true, subtree: false });
  setTimeout(update, 100);
  setTimeout(update, 800);
}
function attachHScrollArrows() {
  HSB_TARGET_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(_hsbAttach);
  });
}
// 動的に追加された要素にも対応
const _hsbObserver = new MutationObserver(() => {
  HSB_TARGET_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { if (!el.dataset.hsbAttached) _hsbAttach(el); });
  });
});
document.addEventListener('DOMContentLoaded', () => _hsbObserver.observe(document.body, { childList: true, subtree: true }));
function handleWelcomeSearch(e) {
  e.preventDefault(); const q = document.getElementById('welcome-search-input').value;
  if(!q) return; document.getElementById('search-input').value = q; saveSettings(); handleSearch(e, q);
}
function handleCategorySearch(cat, btn) {
  document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active')); btn.classList.add('active');
  let query = cat === 'すべて' ? '人気' : cat;
  document.getElementById('search-input').value = cat === 'すべて' ? '' : cat;
  navigate('search');
  document.getElementById('search-shorts-section').classList.add('hidden');
  document.getElementById('search-shorts-container').innerHTML = '';
  document.getElementById('search-results-list').innerHTML = ''; const _sc=document.getElementById('search-channels-section'); if(_sc){_sc.innerHTML='';_sc.classList.add('hidden');}
  triggerSearch(query,'search');
  if (cat !== 'すべて') fetchShortsForSearch(query);
}
function handleSearch(e, externalQuery = null) {
  if(e) e.preventDefault();
  const q = externalQuery || document.getElementById('search-input').value;
  if(!q) return;
  saveSearchHistory(q);
  lastQuery = q;
  document.getElementById('search-shorts-section').classList.add('hidden');
  document.getElementById('search-shorts-container').innerHTML = '';
  document.getElementById('search-results-list').innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:14px;">検索中...</div>'; const _sc=document.getElementById('search-channels-section'); if(_sc){_sc.innerHTML='';_sc.classList.add('hidden');}
  try { history.pushState({ view: 'search', query: q }, '', `#/search?v=${encodeURIComponent(q)}`); } catch(e) {}
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-search')?.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('categories-bar').style.display = 'flex';
  document.getElementById('main-content').style.padding = '24px';
  document.getElementById('main-content').style.marginTop = '112px';
  currentView = 'search';
/* override: navigate末尾の自動クローズ削除 */
  triggerSearch(q,'search');
}
let currentChannelData = { name: '', thumb: '' };
let _openChannelToken = 0;
function openChannel(channelName, thumb = null) {
  const myToken = ++_openChannelToken;
  currentChannelData = { name: channelName, thumb: thumb || `https://i.pravatar.cc/150?u=${channelName}` };
  currentChannelId = null;
  navigate('channel');
  document.getElementById('channel-page-name').innerText = channelName;
  document.getElementById('channel-page-handle').innerText = `@${channelName.toLowerCase().replace(/\s/g,'')}`;
  document.getElementById('channel-page-meta').innerText = `登録者数 -- • 動画 --件`;
  const iconEl = document.getElementById('channel-page-icon');
  iconEl.src = currentChannelData.thumb;
  iconEl.onerror = () => { iconEl.src = `https://i.pravatar.cc/150?u=${encodeURIComponent(channelName)}`; };
  const canvas = document.getElementById('channel-banner-canvas'), bannerImg = document.getElementById('channel-banner-img');
  bannerImg.style.display = 'none'; canvas.style.display = 'block';
  setTimeout(() => drawFallbackBanner(canvas), 50);
  updateChannelSubscribeUI(channelName);
  currentChannelShortsPage = 1;
  isFetching = false;
  fetchChannelInfoFromInvidious(channelName).then(info => {
    if (myToken !== _openChannelToken) return; // stale: ユーザーは別チャンネルへ移動済み
    if (!info) return;
    if (info.authorId) {
      currentChannelId = info.authorId;
      document.getElementById('channel-page-handle').innerText = `@${info.authorId}`;
      try { history.replaceState({ view: 'channel', channelId: info.authorId, channelName }, '', `#/@${info.authorId}`); } catch(e) {}
      // IDが確定したのでホームタブが表示中ならコンテンツを正しいIDで再取得する
      if (currentChannelTab === 'home') {
        const homeGrid = document.getElementById('channel-home-grid');
        const homeRow = document.getElementById('channel-home-row');
        // グリッドが空 or まだ読み込み中テキストが残っている場合は再フェッチ
        const rowIsStillLoading = homeRow && homeRow.querySelector('div') &&
          homeRow.querySelector('div').textContent.includes('読み込み中');
        const gridIsEmpty = homeGrid && homeGrid.children.length === 0;
        if (gridIsEmpty || rowIsStillLoading) {
          triggerSearch(channelName, 'channel-home');
        }
      }
    }
    if (info.subCount) document.getElementById('channel-page-meta').innerText = `登録者数 ${formatSubCount(info.subCount)} • 動画 ${info.videoCount||'--'}件`;
    else if (info.videoCount) document.getElementById('channel-page-meta').innerText = `動画 ${info.videoCount}件`;
    const descEl = document.getElementById('channel-page-desc');
    if (descEl) descEl.innerText = info.description || '';
    if (info.authorThumbnails && info.authorThumbnails.length > 0) {
      const bestThumb = info.authorThumbnails[info.authorThumbnails.length-1];
      if (bestThumb) iconEl.src = bestThumb.url;
    }
    if (info.authorBanners && info.authorBanners.length > 0) {
      const bestBanner = info.authorBanners.reduce((best, b) => (!best || (b.width||0) > (best.width||0)) ? b : best, null);
      if (bestBanner && bestBanner.url) drawChannelBanner(bestBanner.url);
    }
  }).catch(() => {});
  switchChannelTab('home');
}
function switchChannelTab(tab) {
  currentChannelTab = tab;
  ['home','shorts','videos','live','playlists','collabs'].forEach(t => {
    const tabBtn = document.getElementById(`ch-tab-${t}`), tabContent = document.getElementById(`channel-tab-${t}`);
    if (tabBtn) tabBtn.classList.toggle('active', t === tab);
    if (tabContent) tabContent.style.display = t === tab ? 'block' : 'none';
  });
  const name = currentChannelData.name; lastQuery = name;
  if (tab === 'home') {
    document.getElementById('channel-home-grid').innerHTML = '';
    document.getElementById('channel-home-row').innerHTML = '<div style="color:var(--text-secondary);padding:12px;">読み込み中...</div>';
    document.getElementById('channel-home-shorts-row').innerHTML = '<div style="color:var(--text-secondary);padding:12px;">読み込み中...</div>';
    document.getElementById('channel-featured-video').innerHTML = '';
    triggerSearch(name,'channel-home');
    // Shortsはチャンネル専用APIで確実に取得（古いチャンネルの結果が上書きしないよう token チェック）
    (async () => {
      const tok = _openChannelToken;
      try {
        const { shorts } = await fetchChannelShortsMultiPage(name, 1);
        if (tok !== _openChannelToken) return;
        renderChannelHomeShortsRow(shorts || []);
      } catch (e) {
        if (tok !== _openChannelToken) return;
        renderChannelHomeShortsRow([]);
      }
    })();
  }
  else if (tab === 'shorts') { document.getElementById('channel-shorts-grid').innerHTML = ''; document.getElementById('channel-shorts-loader').classList.remove('hidden'); currentChannelShortsPage = 1; triggerSearch(name,'channel-shorts'); }
  else if (tab === 'videos') { document.getElementById('channel-grid').innerHTML = ''; document.getElementById('channel-loader').classList.remove('hidden'); triggerSearch(name,'channel-videos'); }
  else if (tab === 'live') { document.getElementById('channel-live-grid').innerHTML = ''; document.getElementById('channel-live-loader').classList.remove('hidden'); triggerSearch(name,'channel-live'); }
  else if (tab === 'playlists') { renderChannelPlaylists(); }
  else if (tab === 'collabs') { renderChannelCollabs(); }
}
// チャンネル内検索
function searchInChannel() {
  const q = (document.getElementById('channel-search-input')?.value || '').trim();
  if (!q) return;
  const name = currentChannelData.name || '';
  // 動画タブに切り替えてチャンネル名 + クエリで検索
  switchChannelTab('videos');
  document.getElementById('channel-grid').innerHTML = '';
  document.getElementById('channel-loader').classList.remove('hidden');
  lastQuery = `${name} ${q}`;
  triggerSearch(lastQuery, 'channel-videos');
}
// 再生リスト(チャンネル内): ユーザーの再生リストにチャンネル動画があるものを表示
function renderChannelPlaylists() {
  const list = document.getElementById('channel-playlists-list');
  if (!list) return;
  const name = (currentChannelData.name || '').toLowerCase();
  let pls = [];
  try { pls = JSON.parse(localStorage.getItem('playlists') || '[]'); } catch(e) {}
  const matches = pls.filter(p => (p.videos||[]).some(v => (v.channel||'').toLowerCase() === name));
  if (matches.length === 0) {
    list.innerHTML = '<div style="padding:24px;color:var(--text-secondary);">このチャンネルの動画を含む再生リストはまだありません</div>';
    return;
  }
  list.innerHTML = matches.map(p => {
    const first = (p.videos||[])[0];
    const thumb = first ? `https://i.ytimg.com/vi/${first.id}/mqdefault.jpg` : '';
    return `<div class="playlist-card" onclick="openPlaylist('${p.id}')">
      <div class="playlist-thumb">${thumb?`<img src="${thumb}">`:''}<span class="playlist-count">${(p.videos||[]).length}本</span></div>
      <div class="playlist-info"><div class="playlist-title">${p.name||'無題'}</div><div class="playlist-meta">再生リスト</div></div>
    </div>`;
  }).join('');
}
// コラボレーション: 登録チャンネルを参考にしたコラボ候補を表示
function renderChannelCollabs() {
  const grid = document.getElementById('channel-collabs-grid');
  const loader = document.getElementById('channel-collabs-loader');
  if (!grid) return;
  loader && loader.classList.add('hidden');
  let subs = [];
  try { subs = JSON.parse(localStorage.getItem('subscriptions') || '[]'); } catch(e) {}
  const others = subs.filter(s => (s.name||'').toLowerCase() !== (currentChannelData.name||'').toLowerCase()).slice(0, 12);
  if (others.length === 0) {
    grid.innerHTML = '<div class="channel-collab-empty">コラボレーションチャンネルはまだ登録されていません。登録チャンネルを追加すると候補が表示されます。</div>';
    return;
  }
  grid.innerHTML = others.map(s => {
    const thumb = s.thumb || `https://i.pravatar.cc/150?u=${encodeURIComponent(s.name)}`;
    const safe = (s.name||'').replace(/'/g,"\\'");
    return `<div class="channel-collab-card" onclick="openChannel('${safe}','${thumb}')">
      <img src="${thumb}" onerror="this.src='https://i.pravatar.cc/150?u=${encodeURIComponent(s.name)}'">
      <div class="channel-collab-name">${s.name||''}</div>
    </div>`;
  }).join('');
