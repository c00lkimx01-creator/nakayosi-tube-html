// =================== 設定管理 ===================
function getAppConfig() {
  const defaults = { proxy: true, stream: 1, shortStream: 1, trend: true, theme: 'light', isFirstVisit: true };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('study2525_config')) }; } catch(e) { return defaults; }
}
function saveSettings() {
  const config = {
    proxy: document.getElementById('setting-proxy').checked,
    stream: parseInt(document.getElementById('setting-stream').value) || 1,
    shortStream: parseInt(document.getElementById('setting-short-stream').value) || 1,
    trend: document.getElementById('setting-trend').checked,
    theme: document.body.getAttribute('data-theme') || 'light',
    isFirstVisit: false
  };
  localStorage.setItem('study2525_config', JSON.stringify(config)); syncSettings(config);
}
function saveNavSettings() {
  const config = {
    proxy: document.getElementById('nav-setting-proxy').checked,
    stream: parseInt(document.getElementById('nav-setting-stream').value) || 1,
    shortStream: parseInt(document.getElementById('nav-setting-short-stream').value) || 1,
    trend: document.getElementById('nav-setting-trend').checked,
    theme: document.body.getAttribute('data-theme') || 'light',
    isFirstVisit: false
  };
  localStorage.setItem('study2525_config', JSON.stringify(config)); syncSettings(config);
}
function syncSettings(config) {
  const p1 = document.getElementById('setting-proxy'), p2 = document.getElementById('nav-setting-proxy');
  const t1 = document.getElementById('setting-trend'), t2 = document.getElementById('nav-setting-trend');
  const th1 = document.getElementById('setting-theme'), th2 = document.getElementById('nav-setting-theme');
  const s1 = document.getElementById('setting-stream'), s2 = document.getElementById('nav-setting-stream');
  const ss1 = document.getElementById('setting-short-stream'), ss2 = document.getElementById('nav-setting-short-stream');
  if(p1) p1.checked = config.proxy; if(p2) p2.checked = config.proxy;
  if(t1) t1.checked = config.trend; if(t2) t2.checked = config.trend;
  if(th1) th1.checked = config.theme==='dark'; if(th2) th2.checked = config.theme==='dark';
  if(s1) s1.value = config.stream; if(s2) s2.value = config.stream;
  if(ss1) ss1.value = config.shortStream; if(ss2) ss2.value = config.shortStream;
  ['welcome-stream-options','nav-stream-options'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('.stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val) === config.stream));
  });
  ['welcome-short-stream-options','nav-short-stream-options'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('.stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val) === config.shortStream));
  });
}
function selectWelcomeStream(val) {
  document.getElementById('setting-stream').value = val;
  document.querySelectorAll('#welcome-stream-options .stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val)===val));
  saveSettings();
}
function selectWelcomeShortStream(val) {
  document.getElementById('setting-short-stream').value = val;
  document.querySelectorAll('#welcome-short-stream-options .stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val)===val));
  saveSettings();
}
function selectNavStream(val) {
  document.getElementById('nav-setting-stream').value = val;
  document.querySelectorAll('#nav-stream-options .stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val)===val));
  saveNavSettings();
}
function selectNavShortStream(val) {
  document.getElementById('nav-setting-short-stream').value = val;
  document.querySelectorAll('#nav-short-stream-options .stream-option-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.val)===val));
  saveNavSettings();
}
function buildFetchUrl(targetUrl) { return getAppConfig().proxy ? CORS_PROXIES[0] + encodeURIComponent(targetUrl) : targetUrl; }
function initApp() {
  const config = getAppConfig();
  // デバイス設定に従ってテーマを切替（ユーザーが明示的に設定していない場合）
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (!config.themeManual) {
    const deviceTheme = mql.matches ? 'dark' : 'light';
    document.body.setAttribute('data-theme', deviceTheme);
    config.theme = deviceTheme;
    try { localStorage.setItem('study2525_config', JSON.stringify(config)); } catch(e){}
    if (mql.addEventListener) {
      mql.addEventListener('change', (e) => {
        const cfg = getAppConfig();
        if (cfg.themeManual) return;
        const t = e.matches ? 'dark' : 'light';
        document.body.setAttribute('data-theme', t);
        cfg.theme = t;
        try { localStorage.setItem('study2525_config', JSON.stringify(cfg)); } catch(e){}
        syncSettings(cfg);
      });
    }
  } else if (config.theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
  }
  shortStreamType = config.shortStream || 1;
  syncSettings(config);
  renderSidebarSubscriptions();
  const urlState = parseInitialUrl();
  if (config.isFirstVisit) {
    navigate('welcome', { noHistory: true });
  } else if (urlState && urlState.view === 'watch' && urlState.videoId) {
    navigate('home', { noHistory: true });
    if (urlState.streamMode) {
      try {
        const _c = JSON.parse(localStorage.getItem('study2525_config')||'{}');
        const _m = urlState.streamMode === 'edu' ? 2 : (urlState.streamMode === 'ytdlp' || urlState.streamMode === 'stream' || urlState.streamMode === 'stream=1') ? 3 : 1;
        _c.stream = _m; _c.shortStream = _m;
        localStorage.setItem('study2525_config', JSON.stringify(_c));
      } catch(e){}
    }
    fetch(`https://inv.nadeko.net/api/v1/videos/${urlState.videoId}?fields=title,author,authorThumbnails&hl=ja&region=JP`)
      .then(r => r.json()).then(d => {
        playVideo(urlState.videoId, d.title || urlState.videoId, d.author || '', d.authorThumbnails?.[0]?.url || null, true);
      }).catch(() => playVideo(urlState.videoId, urlState.videoId, '', null, true));
  } else if (urlState && urlState.view === 'history') {
    navigate('history');
  } else if (urlState && urlState.view === 'settings') {
    navigate('settings');
  } else if (urlState && urlState.view === 'subscriptions') {
    navigate('subscriptions');
  } else {
    navigate('home');
  }
}
function toggleTheme() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
  const config = getAppConfig(); config.theme = isDark ? 'light' : 'dark'; config.themeManual = true;
  localStorage.setItem('study2525_config', JSON.stringify(config));
  syncSettings(config);
}
function toggleThemeFromSettings() {
  const isDark = document.getElementById('setting-theme').checked;
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const c = getAppConfig(); c.themeManual = true; localStorage.setItem('study2525_config', JSON.stringify(c));
  saveSettings();
}
function toggleThemeFromNavSettings() {
  const isDark = document.getElementById('nav-setting-theme').checked;
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const c = getAppConfig(); c.themeManual = true; localStorage.setItem('study2525_config', JSON.stringify(c));
  saveNavSettings();
}
function finishSetup() { saveSettings(); navigate('home'); if(getAppConfig().trend) loadTrend(); }
// =================== 登録チャンネル ===================
function getSubscriptions() { try { return JSON.parse(localStorage.getItem('subscriptions') || '[]'); } catch(e) { return []; } }
function saveSubscriptions(subs) { localStorage.setItem('subscriptions', JSON.stringify(subs)); }
function isSubscribed(channelName) { return getSubscriptions().some(s => s.name === channelName); }
function toggleSubscribeChannel() {
  const name = document.getElementById('channel-page-name').innerText;
  const thumb = document.getElementById('channel-page-icon').src;
  let subs = getSubscriptions();
  if (isSubscribed(name)) { subs = subs.filter(s => s.name !== name); } else { subs.unshift({ name, thumb, channelId: currentChannelId || null, isLive: Math.random() < 0.15 }); }
  saveSubscriptions(subs); updateChannelSubscribeUI(name); renderSidebarSubscriptions();
}
function toggleSubscribeFromWatch() {
  const name = document.getElementById('watch-channel-name').innerText;
  const thumb = document.getElementById('watch-channel-icon').src;
  let subs = getSubscriptions();
  if (isSubscribed(name)) { subs = subs.filter(s => s.name !== name); } else { subs.unshift({ name, thumb, isLive: Math.random() < 0.15 }); }
  saveSubscriptions(subs); updateWatchSubscribeUI(name); renderSidebarSubscriptions();
}
function updateChannelSubscribeUI(name) {
  const btn = document.getElementById('channel-subscribe-btn');
  const bell = document.getElementById('channel-bell-btn');
  const join = document.getElementById('channel-join-btn');
  if (!btn) return;
  if (isSubscribed(name)) {
    btn.innerText = '登録済み'; btn.classList.add('subscribed');
    bell.style.display = 'flex'; join.style.display = 'block';
  } else {
    btn.innerText = 'チャンネル登録'; btn.classList.remove('subscribed');
    bell.style.display = 'none'; join.style.display = 'none';
  }
}
function updateWatchSubscribeUI(name) {
  const btn = document.getElementById('watch-subscribe-btn');
  if (!btn) return;
  if (isSubscribed(name)) { btn.innerText = '登録済み'; btn.classList.add('subscribed'); }
  else { btn.innerText = '登録'; btn.classList.remove('subscribed'); }
}
function renderSidebarSubscriptions() {
  const subs = getSubscriptions();
  const container = document.getElementById('sidebar-subscriptions');
  if (!container) return;
  if (subs.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = subs.slice(0, 8).map(s => `
    <div class="sidebar-channel-item" onclick="openChannel('${s.name.replace(/'/g,"\\'")}', '${s.thumb}')">
      <img src="${s.thumb}" onerror="this.src='https://i.pravatar.cc/40?u=${encodeURIComponent(s.name)}'">
      <span class="channel-name-sidebar">${s.name}</span>
      ${s.isLive ? '<span class="live-badge">LIVE</span>' : ''}
    </div>
  `).join('');
}
function renderSubscriptionsPage() {
  const subs = getSubscriptions();
  const grid = document.getElementById('subs-grid');
  if (!grid) return;
  if (subs.length === 0) {
    grid.innerHTML = '<div class="subs-empty" style="padding:60px 0;">チャンネルを登録するとここに表示されます<br><br><button onclick="navigate(\'home\')" style="padding:10px 24px;border-radius:20px;background:var(--primary-color);color:#fff;font-weight:bold;font-size:14px;margin-top:12px;">ホームへ戻る</button></div>';
    return;
  }
  grid.innerHTML = `
    <div style="margin-bottom:24px;">
      <h3 style="font-size:18px;font-weight:700;margin:0 0 14px 0;display:flex;align-items:center;gap:8px;">
        <svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:var(--primary-color);"><path d="M10 16.5v-9l6 4.5-6 4.5zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>
        新着動画
      </h3>
      <div id="subs-new-uploads" class="home-row-scroll" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;"><div style="padding:16px;color:var(--text-secondary);">読み込み中...</div></div>
    </div>
    <h3 style="font-size:18px;font-weight:700;margin:0 0 12px 0;">登録チャンネル</h3>
    ${subs.map(s => `
      <div class="sub-channel-card" onclick="openChannel('${s.name.replace(/'/g,"\\'")}', '${s.thumb}')">
        <img src="${s.thumb}" onerror="this.src='https://i.pravatar.cc/56?u=${encodeURIComponent(s.name)}'">
        <div class="sub-channel-info">
          <div class="sub-channel-name">${s.name}</div>
          <div class="sub-channel-meta">${s.isLive ? '🔴 ライブ配信中' : '登録済みチャンネル'}</div>
        </div>
        <button class="unsub-btn" onclick="event.stopPropagation(); unsubscribeChannelPage('${s.name.replace(/'/g,"\\'")}', this)">登録解除</button>
      </div>
    `).join('')}
  `;
  fetchSubscriptionsNewUploads(subs);
}
async function fetchSubscriptionsNewUploads(subs) {
  const row = document.getElementById('subs-new-uploads');
  if (!row) return;
  const all = [];
  await Promise.all(subs.slice(0, 12).map(async s => {
    try {
      const r = await fetchChannelVideos(s.name, 1);
      if (r && r.videos) {
        r.videos.slice(0, 5).forEach(v => {
          if (v.videoId && (v.lengthSeconds||0) > 65) {
            all.push({ ...v, _channel: s.name, _thumb: s.thumb, _ts: v.published || 0 });
          }
        });
      }
    } catch(e) {}
  }));
  if (all.length === 0) { row.innerHTML = '<div style="padding:16px;color:var(--text-secondary);">新着動画はありません</div>'; return; }
  all.sort((a,b) => (b._ts||0) - (a._ts||0));
  row.innerHTML = '';
  all.slice(0, 24).forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.style.cssText = 'flex:0 0 320px;cursor:pointer;';
    card.onclick = () => playVideo(v.videoId, v.title||'', v._channel, v._thumb);
    const isNew = v._ts && (Date.now()/1000 - v._ts) < 86400*3;
    card.innerHTML = `
      <div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000;margin-bottom:10px;position:relative;">
        <img src="https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
        ${isNew ? '<span style="position:absolute;top:8px;left:8px;background:#ff0000;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;">NEW</span>' : ''}
      </div>
      <div style="display:flex;gap:10px;">
        <img src="${v._thumb}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='https://i.pravatar.cc/72?u=${encodeURIComponent(v._channel)}'">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${v.title||''}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${v._channel}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${v.publishedText||''}</div>
          ${isNew ? '<span style="display:inline-block;margin-top:4px;background:#ff0000;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;letter-spacing:0.5px;">新着</span>' : ''}
        </div>
      </div>
    `;
    row.appendChild(card);
  });
}
function unsubscribeChannelPage(name, btn) {
  let subs = getSubscriptions().filter(s => s.name !== name);
  saveSubscriptions(subs); renderSubscriptionsPage(); renderSidebarSubscriptions(); renderSettingsSubsList();
}
function renderSettingsSubsList() {
  const subs = getSubscriptions();
  const el = document.getElementById('settings-subs-list');
  if (!el) return;
  if (subs.length === 0) { el.innerHTML = '<div style="color:var(--text-secondary);padding:8px 0;">登録チャンネルはありません</div>'; return; }
  el.innerHTML = subs.map(s => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-color);">
      <img src="${s.thumb}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" onerror="this.src='https://i.pravatar.cc/40?u=${encodeURIComponent(s.name)}'">
      <span style="flex:1;font-weight:500;">${s.name}</span>
      ${s.isLive ? '<span style="background:#ff0000;color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:4px;">LIVE</span>' : ''}
      <button onclick="unsubscribeChannelSettings('${s.name.replace(/'/g,"\\'")}')" style="padding:6px 14px;border-radius:16px;background:var(--hover-color);font-size:13px;">登録解除</button>
    </div>
  `).join('');
}
function unsubscribeChannelSettings(name) {
  let subs = getSubscriptions().filter(s => s.name !== name);
  saveSubscriptions(subs); renderSettingsSubsList(); renderSidebarSubscriptions();
}
